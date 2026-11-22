import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import {
  activationIssues,
  annualEffectiveRate,
  isComplete,
  productCodeSchema,
  productTerms,
  productVersionInputSchema,
  rateString,
  type CompleteTerms,
  type ProductCode,
} from './credit-product';
import {
  readSecondCreditPolicy,
  secondCreditPolicySchema,
} from './second-credit';

const reasonSchema = z.object({
  reason: z.string().trim().min(5).max(2_000),
});

/** Catálogo de productos de crédito: lectura para originación y gestión para staff. */
@Injectable()
export class CreditProductService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Versión vigente de un producto, o `null` si no hay ninguna activa. */
  async active(code: ProductCode) {
    const row = await this.db.startif.creditProduct.findFirst({
      where: { code, status: 'ACTIVE' },
    });
    if (!row) return null;
    const terms = productTerms(row);
    // La base de datos garantiza que una versión ACTIVE está completa.
    if (!isComplete(terms)) return null;
    return { row, terms: terms as CompleteTerms };
  }

  async requireActive(code: ProductCode) {
    const product = await this.active(code);
    if (!product)
      throw new BadRequestException({
        code: 'product_unavailable',
        message: 'Este crédito no está disponible en este momento.',
      });
    return product;
  }

  /** Versión más reciente de un código, sin importar su estado. */
  latest(code: ProductCode) {
    return this.db.startif.creditProduct.findFirst({
      where: { code },
      orderBy: { version: 'desc' },
    });
  }

  async list() {
    const rows = await this.db.startif.creditProduct.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
    return { items: rows.map((row) => this.serialize(row)) };
  }

  async createVersion(actor: AuthenticatedUser, code: string, body: unknown) {
    const productCode = productCodeSchema.parse(code);
    const input = productVersionInputSchema.parse(body ?? {});
    const previous = await this.latest(productCode);
    if (!previous) throw new NotFoundException('Producto no encontrado.');
    const pick = <T>(value: T | undefined, fallback: T): T =>
      value === undefined ? fallback : value;
    const amount = (
      value: number | null | undefined,
      fallback: bigint | null,
    ) =>
      value === undefined ? fallback : value === null ? null : BigInt(value);
    const rate = (value: number | null | undefined, fallback: unknown) =>
      value === undefined
        ? fallback === null || fallback === undefined
          ? null
          : rateString(Number(fallback))
        : value === null
          ? null
          : rateString(value);
    // Un monto fijo nuevo reemplaza al rango heredado, y viceversa.
    const fixedGiven = input.principalCOP != null;
    const rangeGiven =
      input.minPrincipalCOP != null || input.maxPrincipalCOP != null;
    const requirements =
      previous.sequence === 2
        ? secondCreditPolicySchema.parse({
            ...readSecondCreditPolicy(previous.requirements),
            ...(input.requirements ?? {}),
          })
        : null;
    if (previous.sequence !== 2 && input.requirements)
      throw new BadRequestException(
        'Solo el crédito 2 tiene requisitos configurables.',
      );
    const data = {
      code: productCode,
      version: previous.version + 1,
      name: pick(input.name, previous.name),
      purpose: previous.purpose,
      description: pick(input.description, previous.description),
      sequence: previous.sequence,
      principalCOP:
        rangeGiven && !fixedGiven
          ? null
          : amount(input.principalCOP, previous.principalCOP),
      minPrincipalCOP:
        fixedGiven && !rangeGiven
          ? null
          : amount(input.minPrincipalCOP, previous.minPrincipalCOP),
      maxPrincipalCOP:
        fixedGiven && !rangeGiven
          ? null
          : amount(input.maxPrincipalCOP, previous.maxPrincipalCOP),
      termMonths: pick(input.termMonths, previous.termMonths),
      monthlyRate: rate(input.monthlyRate, previous.monthlyRate),
      geometricDecrease: rate(
        input.geometricDecrease,
        previous.geometricDecrease,
      ),
      disbursementMode: previous.disbursementMode,
      requirements: requirements ?? undefined,
      defaultAfterDays: pick(input.defaultAfterDays, previous.defaultAfterDays),
      status: 'DRAFT' as const,
      createdBy: actor.id,
    };
    if (
      data.principalCOP !== null &&
      (data.minPrincipalCOP !== null || data.maxPrincipalCOP !== null)
    )
      throw new BadRequestException(
        'Define un monto fijo o un rango, no ambos.',
      );
    if ((data.minPrincipalCOP === null) !== (data.maxPrincipalCOP === null))
      throw new BadRequestException('El rango necesita monto mínimo y máximo.');
    if (
      data.minPrincipalCOP !== null &&
      data.maxPrincipalCOP !== null &&
      data.minPrincipalCOP > data.maxPrincipalCOP
    )
      throw new BadRequestException(
        'El monto mínimo no puede superar el máximo.',
      );
    const created = await this.db.startif.creditProduct
      .create({ data })
      .catch((error: any) => {
        // Dos personas creando la misma versión a la vez.
        if (error?.code === 'P2002')
          throw new BadRequestException(
            'Ya se creó esa versión. Vuelve a cargar el catálogo.',
          );
        throw error;
      });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.product.version_created',
      resource: 'CreditProduct',
      resourceId: created.id,
      payload: this.auditTerms(created),
    });
    return this.serialize(created);
  }

  async activate(actor: AuthenticatedUser, id: string, body: unknown) {
    const { reason } = reasonSchema.parse(body ?? {});
    const product = await this.db.startif.creditProduct.findUnique({
      where: { id: z.string().uuid().parse(id) },
    });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    if (!['DRAFT', 'SUSPENDED'].includes(product.status))
      throw new BadRequestException(
        'Solo se activa una versión en borrador o suspendida.',
      );
    const terms = productTerms(product);
    const issues = activationIssues(terms);
    if (issues.length || !isComplete(terms))
      throw new BadRequestException({
        code: 'product_incomplete',
        message: 'La versión no tiene todas sus condiciones definidas.',
        issues,
      });
    // Si hay tasa de usura cargada, la versión no puede superarla. La
    // validación definitiva se repite en cada aprobación.
    const today = new Date();
    const usury = await this.db.startif.usuryRate.findFirst({
      where: { effectiveFrom: { lte: today }, effectiveTo: { gte: today } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const annual = annualEffectiveRate(terms.monthlyRate);
    if (usury && annual > Number(usury.annualEffectiveRate))
      throw new BadRequestException({
        code: 'rate_exceeds_legal_limit',
        requestedAnnualEffective: annual,
        legalAnnualEffective: Number(usury.annualEffectiveRate),
      });
    const now = new Date();
    const result = await this.db.startif
      .$transaction(async (tx) => {
        const superseded = await tx.creditProduct.updateMany({
          where: {
            code: product.code,
            status: 'ACTIVE',
            id: { not: product.id },
          },
          data: {
            status: 'SUPERSEDED',
            effectiveTo: now,
            statusReason: `Sustituida por la versión ${product.version}.`,
          },
        });
        const claimed = await tx.creditProduct.updateMany({
          where: { id: product.id, status: { in: ['DRAFT', 'SUSPENDED'] } },
          data: {
            status: 'ACTIVE',
            effectiveFrom: now,
            effectiveTo: null,
            activatedBy: actor.id,
            statusReason: reason,
          },
        });
        if (!claimed.count)
          throw new BadRequestException('La versión ya cambió de estado.');
        return {
          superseded: superseded.count,
          product: await tx.creditProduct.findUniqueOrThrow({
            where: { id: product.id },
          }),
        };
      })
      .catch((error: any) => {
        // El índice único parcial impide dos versiones vigentes a la vez.
        if (error?.code === 'P2002')
          throw new BadRequestException(
            'Otra versión del producto se activó al mismo tiempo.',
          );
        throw error;
      });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.product.activated',
      resource: 'CreditProduct',
      resourceId: product.id,
      payload: {
        ...this.auditTerms(result.product),
        reason,
        supersededVersions: result.superseded,
        usuryRateId: usury?.id ?? null,
      },
    });
    return this.serialize(result.product);
  }

  async suspend(actor: AuthenticatedUser, id: string, body: unknown) {
    const { reason } = reasonSchema.parse(body ?? {});
    const productId = z.string().uuid().parse(id);
    const claimed = await this.db.startif.creditProduct.updateMany({
      where: { id: productId, status: 'ACTIVE' },
      data: {
        status: 'SUSPENDED',
        effectiveTo: new Date(),
        suspendedBy: actor.id,
        statusReason: reason,
      },
    });
    const product = await this.db.startif.creditProduct.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    if (!claimed.count)
      throw new BadRequestException('Solo se suspende una versión vigente.');
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.product.suspended',
      resource: 'CreditProduct',
      resourceId: product.id,
      payload: { ...this.auditTerms(product), reason },
    });
    return this.serialize(product);
  }

  private auditTerms(row: Parameters<typeof productTerms>[0]) {
    const terms = productTerms(row);
    return {
      code: terms.code,
      version: terms.version,
      principalCOP: terms.principalCOP,
      minPrincipalCOP: terms.minPrincipalCOP,
      maxPrincipalCOP: terms.maxPrincipalCOP,
      termMonths: terms.termMonths,
      monthlyRate: terms.monthlyRate,
      geometricDecrease: terms.geometricDecrease,
      defaultAfterDays: terms.defaultAfterDays,
      requirements: (terms.requirements ?? null) as Record<
        string,
        unknown
      > | null,
    };
  }

  serialize(
    row: Parameters<typeof productTerms>[0] & {
      id: string;
      description: string | null;
      statusReason: string | null;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
      createdBy: string | null;
      activatedBy: string | null;
      suspendedBy: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    const terms = productTerms(row);
    return {
      id: row.id,
      ...terms,
      description: row.description,
      requirements:
        terms.sequence === 2
          ? readSecondCreditPolicy(terms.requirements)
          : null,
      activationIssues: activationIssues(terms),
      statusReason: row.statusReason,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      createdBy: row.createdBy,
      activatedBy: row.activatedBy,
      suspendedBy: row.suspendedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
