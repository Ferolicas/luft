import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { taxAnswersSchema } from '../formalization/formalization';
import { FormalizationService } from '../formalization/formalization.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RouteService } from '../route/route.service';
import {
  classificationSchema,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_KIND,
  profileBlocks,
  SECTION_KEYS,
  sectionSchemas,
  sniffMime,
  targetTaxYear,
  type Classification,
  type DocumentKind,
  type FinancialContext,
  type SectionKey,
  type StoredDocument,
} from './journey';

import {
  readJourneyState,
  type JourneyState,
  type TaxReturnState,
} from './journey-state';

export type { JourneyState, TaxReturnState };

/**
 * Archetype codes used before V2. They are only a fallback for the credit
 * flow when a category has no active archetypes; the versioned engine in
 * `catalog/archetype-engine.ts` assigns the real one.
 */
const ARCHETYPE_BY_GOAL: Record<Classification['goal'], string> = {
  START: 'INICIADOR',
  IMPROVE_SCORE: 'CONSTRUCTOR',
  GUIDE_YOUTH: 'EXPLORADOR',
};

@Injectable()
export class JourneyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    private readonly formalization: FormalizationService,
    private readonly routes: RouteService,
  ) {}

  static readState(value: unknown): JourneyState {
    return readJourneyState(value);
  }

  private async load(userId: string) {
    const profile = await this.db.luft.financialProfile.findUnique({
      where: { userId },
    });
    return {
      profile,
      state: JourneyService.readState(profile?.demographicAnswers),
    };
  }

  private context(state: JourneyState): FinancialContext {
    if (!state.context) return {};
    return JSON.parse(this.crypto.decrypt(state.context)) as FinancialContext;
  }

  /** Non-sensitive summary; safe to ship with the dashboard. */
  summarize(state: JourneyState) {
    const documents = state.documents ?? [];
    return {
      classification: state.classification ?? null,
      sections: state.sections ?? {},
      documents,
      ...profileBlocks(state.sections ?? {}, documents),
      taxReturn: state.taxReturn ?? null,
    };
  }

  private async save(
    userId: string,
    state: JourneyState,
    extra: {
      archetype?: string;
      primaryGoal?: string;
      existingHistory?: boolean;
    } = {},
  ) {
    const { percent } = profileBlocks(
      state.sections ?? {},
      state.documents ?? [],
    );
    const data = {
      demographicAnswers: state as object,
      completionPercent: percent,
      ...extra,
    };
    await this.db.luft.financialProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.summarize(state);
  }

  async journey(user: AuthenticatedUser) {
    const { state } = await this.load(user.id);
    return this.summarize(state);
  }

  async classify(user: AuthenticatedUser, body: unknown) {
    const input = classificationSchema.parse(body);
    const { profile, state } = await this.load(user.id);
    state.classification = { ...input, answeredAt: new Date().toISOString() };
    await this.save(user.id, state, {
      primaryGoal: input.goal,
      ...(profile?.existingHistory == null
        ? { existingHistory: input.creditExperience !== 'NONE' }
        : {}),
    });
    // Category suggestion, archetype (with explanation) and route stage follow the classification.
    const route = await this.routes.syncQuietly(user.id, 'classification');
    let archetype = route?.assignment?.archetypeCode ?? profile?.archetype;
    if (!archetype) {
      archetype = ARCHETYPE_BY_GOAL[input.goal];
      await this.db.luft.financialProfile.update({
        where: { userId: user.id },
        data: { archetype },
      });
    }
    await this.audit.record({
      actorUserId: user.id,
      action: 'profile.classification.saved',
      resource: 'FinancialProfile',
      payload: {
        ...input,
        archetype,
        category: route?.route.category.code ?? null,
        ruleVersion: route?.assignment
          ? `archetype-v${route.assignment.archetypeVersion}`
          : 'classification-2026.11',
      },
    });
    this.realtime.toUser(user.id, 'profile:updated', { archetype });
    return this.journey(user);
  }

  async financialProfile(user: AuthenticatedUser) {
    const { state } = await this.load(user.id);
    const context = this.context(state);
    return {
      ...this.summarize(state),
      context,
      taxCheck: await this.formalization.check(context),
    };
  }

  async saveSection(user: AuthenticatedUser, section: string, body: unknown) {
    if (!SECTION_KEYS.includes(section as SectionKey))
      throw new NotFoundException('Sección no encontrada.');
    const key = section as SectionKey;
    const parsed = sectionSchemas[key].parse(body);
    const { state } = await this.load(user.id);
    const context = {
      ...this.context(state),
      [key]: parsed,
    } as FinancialContext;
    state.context = this.crypto.encrypt(JSON.stringify(context));
    state.sections = { ...state.sections, [key]: new Date().toISOString() };
    const summary = await this.save(user.id, state);
    await this.audit.record({
      actorUserId: user.id,
      action: 'profile.financial_section.saved',
      resource: 'FinancialProfile',
      payload: { section: key, completionPercent: summary.percent },
    });
    this.realtime.toUser(user.id, 'profile:updated', {
      completionPercent: summary.percent,
    });
    // New facts: re-run the tax diagnosis, then the archetype, route and evidence.
    const diagnosis = await this.formalization.diagnoseQuietly(
      user.id,
      context,
    );
    await this.routes.syncQuietly(user.id, `profile_section:${key}`);
    return {
      ...summary,
      context,
      taxCheck: diagnosis?.check ?? (await this.formalization.check(context)),
    };
  }

  private storageDir(userId: string) {
    return join(
      this.config.getOrThrow<string>('PRIVATE_STORAGE_PATH'),
      'documents',
      userId,
    );
  }

  async uploadDocument(
    user: AuthenticatedUser,
    kind: string,
    fileName: string,
    buffer: Buffer,
  ) {
    if (!DOCUMENT_KINDS.includes(kind as DocumentKind))
      throw new NotFoundException('Tipo de documento no reconocido.');
    if (buffer.length === 0)
      throw new BadRequestException('El archivo está vacío.');
    if (buffer.length > MAX_DOCUMENT_BYTES)
      throw new PayloadTooLargeException('El archivo supera los 10 MB.');
    const mimeType = sniffMime(buffer);
    if (!mimeType)
      throw new BadRequestException('Solo aceptamos archivos PDF, JPG o PNG.');
    const { state } = await this.load(user.id);
    const documents = state.documents ?? [];
    if (
      documents.filter((item) => item.kind === kind).length >=
      MAX_DOCUMENTS_PER_KIND
    )
      throw new BadRequestException(
        `Puedes cargar máximo ${MAX_DOCUMENTS_PER_KIND} archivos en este documento.`,
      );
    const document: StoredDocument = {
      id: randomUUID(),
      kind: kind as DocumentKind,
      fileName:
        fileName
          .replace(/[^\p{L}\p{N} ._()-]/gu, '')
          .trim()
          .slice(0, 120) || 'documento',
      mimeType,
      sizeBytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      uploadedAt: new Date().toISOString(),
    };
    const dir = this.storageDir(user.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(dir, `${document.id}.bin`),
      this.crypto.encryptBuffer(buffer),
      { mode: 0o600 },
    );
    state.documents = [...documents, document];
    const summary = await this.save(user.id, state);
    await this.audit.record({
      actorUserId: user.id,
      action: 'profile.document.uploaded',
      resource: 'UserDocument',
      resourceId: document.id,
      payload: {
        kind: document.kind,
        mimeType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
      },
    });
    await this.routes.syncQuietly(user.id, 'profile_document');
    return { document, ...summary };
  }

  async documentFile(user: AuthenticatedUser, id: string) {
    const { state } = await this.load(user.id);
    const document = (state.documents ?? []).find((item) => item.id === id);
    if (!document) throw new NotFoundException('Documento no encontrado.');
    const encrypted = await readFile(
      join(this.storageDir(user.id), `${document.id}.bin`),
    ).catch(() => null);
    if (!encrypted) throw new NotFoundException('Documento no encontrado.');
    return { document, content: this.crypto.decryptBuffer(encrypted) };
  }

  async deleteDocument(user: AuthenticatedUser, id: string) {
    const { state } = await this.load(user.id);
    const document = (state.documents ?? []).find((item) => item.id === id);
    if (!document) throw new NotFoundException('Documento no encontrado.');
    await rm(join(this.storageDir(user.id), `${document.id}.bin`), {
      force: true,
    });
    state.documents = (state.documents ?? []).filter((item) => item.id !== id);
    const summary = await this.save(user.id, state);
    await this.audit.record({
      actorUserId: user.id,
      action: 'profile.document.deleted',
      resource: 'UserDocument',
      resourceId: document.id,
      payload: { kind: document.kind, sha256: document.sha256 },
    });
    await this.routes.syncQuietly(user.id, 'profile_document');
    return summary;
  }

  async saveTaxAnswers(user: AuthenticatedUser, body: unknown) {
    const answers = taxAnswersSchema.parse(body);
    // The guided preparation belongs to the formalization case of that taxable year.
    await this.formalization.storePreparation(user.id, answers);
    const { state } = await this.load(user.id);
    state.taxReturn = {
      taxYear: targetTaxYear(),
      status: state.taxReturn?.status ?? 'DRAFT',
      requestedAt: state.taxReturn?.requestedAt,
      answers,
      updatedAt: new Date().toISOString(),
    };
    return this.save(user.id, state);
  }

  /**
   * There is no contracted DIAN channel yet. The request is kept as a pending
   * workflow and the call fails closed instead of simulating a tax result.
   */
  async requestTaxService(
    user: AuthenticatedUser,
    step: 'connection' | 'calculation',
  ) {
    const { state } = await this.load(user.id);
    const now = new Date().toISOString();
    state.taxReturn = {
      taxYear: state.taxReturn?.taxYear ?? targetTaxYear(),
      answers: state.taxReturn?.answers,
      status: 'CONFIGURATION_REQUIRED',
      requestedAt: state.taxReturn?.requestedAt ?? now,
      updatedAt: now,
    };
    await this.save(user.id, state);
    await this.audit.record({
      actorUserId: user.id,
      action: 'tax_return.requested',
      resource: 'TaxReturn',
      payload: { step, status: 'CONFIGURATION_REQUIRED' },
    });
    await this.formalization.recordDianRequest(user.id, step).catch(() => null);
    throw new ServiceUnavailableException({
      code: 'configuration_required',
      provider: 'DIAN',
      message:
        'La preparación y presentación de la declaración ante la DIAN aún no está habilitada. Tu solicitud quedó registrada y te avisaremos cuando puedas continuar.',
    });
  }
}
