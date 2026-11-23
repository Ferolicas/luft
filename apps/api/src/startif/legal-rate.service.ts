import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import { bogotaDate } from './credit-lifecycle';
import {
  applicableLegalRates,
  LEGAL_RATE_DATASET,
  LEGAL_RATE_MODALITY,
  SYSTEM_ACTOR_ID,
  type CertificationRow,
} from './legal-rate';

/**
 * Mantiene al día la tasa máxima legal con la certificación oficial. Si la
 * fuente no responde o trae algo inesperado no se guarda nada: sin tasa
 * vigente la aprobación de créditos sigue bloqueada.
 */
@Injectable()
export class LegalRateService {
  private readonly logger = new Logger(LegalRateService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Tasa vigente en el día calendario de Colombia. */
  current(now = new Date()) {
    const today = new Date(`${bogotaDate(now)}T00:00:00Z`);
    return this.db.startif.usuryRate.findFirst({
      where: { effectiveFrom: { lte: today }, effectiveTo: { gte: today } },
      orderBy: [{ effectiveFrom: 'desc' }, { verifiedAt: 'desc' }],
    });
  }

  /** La vigente; si falta, la busca en la fuente oficial antes de rendirse. */
  async currentOrSync(now = new Date()) {
    const found = await this.current(now);
    if (found) return found;
    try {
      await this.sync(now);
    } catch (error) {
      this.logger.warn(
        `No se pudo consultar la tasa legal oficial: ${(error as Error).message}`,
      );
    }
    return this.current(now);
  }

  /** Carga las certificaciones vigentes y próximas. Devuelve cuántas guardó. */
  async sync(now = new Date()): Promise<number> {
    const url = `${LEGAL_RATE_DATASET}?modalidad=${encodeURIComponent(LEGAL_RATE_MODALITY)}&$order=${encodeURIComponent('vigencia_desde DESC')}&$limit=6`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`datos.gov.co respondió ${response.status}`);
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows))
      throw new Error('datos.gov.co devolvió un formato inesperado');
    const rates = applicableLegalRates(
      rows as CertificationRow[],
      bogotaDate(now),
    );
    let saved = 0;
    for (const rate of rates) {
      const effectiveFrom = new Date(`${rate.effectiveFrom}T00:00:00Z`);
      const effectiveTo = new Date(`${rate.effectiveTo}T00:00:00Z`);
      const key = {
        category_effectiveFrom: { category: rate.category, effectiveFrom },
      };
      const existing = await this.db.startif.usuryRate.findUnique({
        where: key,
      });
      // Un registro hecho por una persona no se pisa.
      if (existing && existing.createdBy !== SYSTEM_ACTOR_ID) continue;
      if (
        existing &&
        Number(existing.annualEffectiveRate) === rate.annualEffectiveRate &&
        existing.effectiveTo.getTime() === effectiveTo.getTime() &&
        existing.sourceUrl === rate.sourceUrl
      )
        continue;
      const data = {
        annualEffectiveRate: rate.annualEffectiveRate.toFixed(5),
        effectiveTo,
        sourceUrl: rate.sourceUrl,
        sourceDocumentHash: createHash('sha256')
          .update(JSON.stringify(rate))
          .digest('hex'),
        verifiedAt: new Date(),
        createdBy: SYSTEM_ACTOR_ID,
      };
      const record = await this.db.startif.usuryRate.upsert({
        where: key,
        create: { category: rate.category, effectiveFrom, ...data },
        update: data,
      });
      await this.audit.record({
        actorRole: 'SYSTEM',
        action: 'legal.usury_rate.updated',
        resource: 'UsuryRate',
        resourceId: record.id,
        payload: {
          category: rate.category,
          annualEffectiveRate: rate.annualEffectiveRate,
          bankCurrentRate: rate.bankCurrentRate,
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveTo: effectiveTo.toISOString(),
          resolution: rate.resolution,
          sourceUrl: rate.sourceUrl,
          automatic: true,
        },
      });
      this.logger.log(
        `Tasa máxima legal ${rate.effectiveFrom}–${rate.effectiveTo}: ${(rate.annualEffectiveRate * 100).toFixed(2)} % E.A. (Resolución ${rate.resolution})`,
      );
      saved += 1;
    }
    return saved;
  }
}
