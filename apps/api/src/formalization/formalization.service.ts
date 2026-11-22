import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import {
  CONSENT_TEXTS,
  CONSENT_VERSION,
  isActive,
} from '../consents/consent-catalog';
import { DatabaseService } from '../database/database.service';
import type {
  FormalizationCase,
  TaxRuleVersion,
} from '../generated/luft/client';
import { isUniqueViolation, PAGE_SIZE, paged } from '../luft/http';
import {
  targetTaxYear,
  taxCheck,
  type FinancialContext,
  type TaxRule,
} from '../luft/journey';
import { readJourneyState } from '../luft/journey-state';
import { RealtimeService } from '../realtime/realtime.service';
import { ProfileFactsService } from '../route/profile-facts.service';
import { RouteService } from '../route/route.service';
import { DocumentVaultService } from '../vault/document-vault.service';
import {
  canTransition,
  FORMALIZATION_LABELS,
  isFormalizationStatus,
  phaseOf,
  preparationReady,
  staffActions,
  statusAfterDiagnosis,
  statusAfterObservation,
  taxAnswersSchema,
  taxRuleInputSchema,
  userActions,
  type FormalizationStatus,
  type TaxAnswers,
} from './formalization';

const DECLARATION = 'TAX_DECLARATION';
const SUPPORT = 'TAX_SUPPORT';
const MAX_DECLARATIONS = 3;
const MAX_SUPPORTS = 10;
const REVIEW_ROLES = ['LEGAL', 'FINANCE', 'SUPERADMIN'];

const EXTRACTION_PENDING = {
  available: false,
  status: 'configuration_required',
  message:
    'La lectura automática de la declaración aún no está habilitada. Un profesional revisará el documento que cargues.',
} as const;

const DIAN_PENDING = {
  available: false,
  status: 'configuration_required',
  message:
    'La presentación ante la DIAN desde LUFT aún no está habilitada. La declaración se presenta por los canales de la DIAN y aquí registramos el número de formulario.',
} as const;

type Check = ReturnType<typeof taxCheck>;

@Injectable()
export class FormalizationService {
  private readonly logger = new Logger(FormalizationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly vault: DocumentVaultService,
    private readonly profileFacts: ProfileFactsService,
    private readonly routes: RouteService,
  ) {}

  toRule(row: TaxRuleVersion): TaxRule {
    return {
      id: row.id,
      taxYear: row.taxYear,
      version: row.version,
      uvtCOP: row.uvtCOP,
      wealthUvt: row.wealthUvt,
      incomeUvt: row.incomeUvt,
      cardSpendUvt: row.cardSpendUvt,
      purchasesUvt: row.purchasesUvt,
      depositsUvt: row.depositsUvt,
      sourceDocument: row.sourceDocument,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    };
  }

  async activeRule(taxYear: number): Promise<TaxRule | null> {
    const row = await this.db.luft.taxRuleVersion.findFirst({
      where: { taxYear, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    return row ? this.toRule(row) : null;
  }

  /** Orientation with the rule version of the corresponding taxable year. */
  async check(context: FinancialContext): Promise<Check> {
    const taxYear = targetTaxYear();
    return taxCheck(context, await this.activeRule(taxYear), taxYear);
  }

  private async context(userId: string): Promise<FinancialContext> {
    const profile = await this.db.luft.financialProfile.findUnique({
      where: { userId },
    });
    return this.profileFacts.decryptContext(
      readJourneyState(profile?.demographicAnswers),
    );
  }

  private async ensureCase(userId: string): Promise<FormalizationCase> {
    const where = { userId_taxYear: { userId, taxYear: targetTaxYear() } };
    const existing = await this.db.luft.formalizationCase.findUnique({ where });
    if (existing) return existing;
    try {
      return await this.db.luft.formalizationCase.create({
        data: where.userId_taxYear,
      });
    } catch (error) {
      // A parallel request opened the case first (one per person and year).
      if (!isUniqueViolation(error)) throw error;
      return this.db.luft.formalizationCase.findUniqueOrThrow({ where });
    }
  }

  private status(row: FormalizationCase): FormalizationStatus {
    return isFormalizationStatus(row.status) ? row.status : 'SIN_EVALUAR';
  }

  private async consent(userId: string) {
    const consents = await this.db.luft.consent.findMany({
      where: { userId, kind: 'TAX_ASSISTANCE' },
      orderBy: { acceptedAt: 'desc' },
    });
    return consents.find((consent) => isActive(consent)) ?? null;
  }

  /**
   * Moves the case through the machine. The update is guarded by the status
   * it was read with, so two concurrent actions cannot both apply.
   */
  private async transition(
    row: FormalizationCase,
    to: FormalizationStatus,
    action: string,
    actor: { id?: string; role: string },
    options: {
      note?: string;
      data?: Record<string, unknown>;
      notifyAs?: string;
    } = {},
  ): Promise<FormalizationCase> {
    const from = this.status(row);
    if (from !== to && !canTransition(from, to))
      throw new ConflictException({
        code: 'invalid_transition',
        message: `El caso está en "${FORMALIZATION_LABELS[from]}" y no puede pasar a "${FORMALIZATION_LABELS[to]}".`,
      });
    const moved = await this.db.luft.formalizationCase.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: to, ...options.data },
    });
    if (!moved.count)
      throw new ConflictException({
        code: 'case_changed',
        message: 'El caso cambió mientras lo procesábamos. Vuelve a cargarlo.',
      });
    const event = await this.db.luft.formalizationEvent.create({
      data: {
        caseId: row.id,
        userId: row.userId,
        action,
        fromStatus: from,
        toStatus: to,
        actorUserId: actor.id,
        actorRole: actor.role,
        note: options.note,
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: `formalization.${action.toLowerCase()}`,
      resource: 'FormalizationCase',
      resourceId: row.id,
      payload: { from, to, taxYear: row.taxYear },
    });
    this.realtime.toUser(row.userId, 'formalization:status', {
      caseId: row.id,
      eventId: event.id,
      status: options.notifyAs ?? to,
    });
    return this.db.luft.formalizationCase.findUniqueOrThrow({
      where: { id: row.id },
    });
  }

  /**
   * Runs the diagnosis with the active rule. It only moves cases the user has
   * not started working on; it is an alert, never a definitive determination.
   */
  async diagnose(userId: string, known?: FinancialContext) {
    const row = await this.ensureCase(userId);
    const current = this.status(row);
    const check = await this.check(known ?? (await this.context(userId)));
    if (!['SIN_EVALUAR', 'NO_REQUIERE', 'POSIBLE_OBLIGACION'].includes(current))
      return { row, check };
    if (!check.available || !check.ready) return { row, check };
    const next = statusAfterDiagnosis(current, check);
    const data = {
      ruleVersionId: check.rule?.id ?? null,
      mayHaveToFile: check.mayHaveToFile,
      diagnosisCiphertext: this.crypto.encrypt(JSON.stringify(check)),
      diagnosedAt: new Date(),
    };
    if (next === current) {
      const updated = await this.db.luft.formalizationCase.update({
        where: { id: row.id },
        data,
      });
      return { row: updated, check };
    }
    try {
      const updated = await this.transition(
        row,
        next,
        'DIAGNOSED',
        { id: userId, role: 'SYSTEM' },
        { data },
      );
      return { row: updated, check };
    } catch (error) {
      // Another request diagnosed or moved the case at the same time: read it again.
      if (!(error instanceof ConflictException)) throw error;
      return { row: await this.ensureCase(userId), check };
    }
  }

  async diagnoseQuietly(userId: string, known?: FinancialContext) {
    try {
      return await this.diagnose(userId, known);
    } catch (error) {
      this.logger.warn(
        `No se pudo diagnosticar el caso tributario de ${userId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private storedDiagnosis(row: FormalizationCase): Check | null {
    if (!row.diagnosisCiphertext) return null;
    return JSON.parse(this.crypto.decrypt(row.diagnosisCiphertext)) as Check;
  }

  private caseView(row: FormalizationCase) {
    const status = this.status(row);
    const approved = Boolean(row.reviewApprovedAt);
    return {
      id: row.id,
      taxYear: row.taxYear,
      status,
      statusLabel: FORMALIZATION_LABELS[status],
      phase: phaseOf(status, approved),
      mayHaveToFile: row.mayHaveToFile,
      alreadyFiled: row.alreadyFiled,
      path: row.path,
      preparation: (row.preparation as TaxAnswers | null) ?? null,
      diagnosedAt: row.diagnosedAt,
      submittedAt: row.submittedAt,
      reviewApproved: approved,
      reviewApprovedAt: row.reviewApprovedAt,
      formNumber: row.formNumberCiphertext
        ? this.crypto.decrypt(row.formNumberCiphertext)
        : null,
      filedAt: row.filedAt ? row.filedAt.toISOString().slice(0, 10) : null,
      verifiedAt: row.verifiedAt,
      updatedAt: row.updatedAt,
    };
  }

  private async history(caseId: string) {
    const events = await this.db.luft.formalizationEvent.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    });
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      from: event.fromStatus,
      to: event.toStatus,
      toLabel: isFormalizationStatus(event.toStatus)
        ? FORMALIZATION_LABELS[event.toStatus]
        : event.toStatus,
      note: event.note,
      actor:
        event.actorRole === 'SYSTEM'
          ? 'SYSTEM'
          : event.actorRole === 'USER'
            ? 'USER'
            : 'STAFF',
      at: event.createdAt,
    }));
  }

  private async view(row: FormalizationCase, live?: Check) {
    const [documents, history, consent] = await Promise.all([
      this.vault.list(row.userId, row.id),
      this.history(row.id),
      this.consent(row.userId),
    ]);
    const status = this.status(row);
    const frozen = ![
      'SIN_EVALUAR',
      'NO_REQUIERE',
      'POSIBLE_OBLIGACION',
    ].includes(status);
    const diagnosis =
      (frozen ? this.storedDiagnosis(row) : null) ??
      live ??
      this.storedDiagnosis(row) ??
      (await this.check(await this.context(row.userId)));
    return {
      case: this.caseView(row),
      diagnosis,
      consent: {
        kind: 'TAX_ASSISTANCE',
        granted: Boolean(consent),
        version: CONSENT_VERSION,
        text: CONSENT_TEXTS.TAX_ASSISTANCE,
      },
      documents: documents.map((document) => this.vault.view(document)),
      limits: { declarations: MAX_DECLARATIONS, supports: MAX_SUPPORTS },
      history,
      actions: userActions({
        status,
        hasConsent: Boolean(consent),
        declarationDocuments: documents.filter(
          (document) => document.purpose === DECLARATION,
        ).length,
        preparationReady: preparationReady(row.preparation),
      }),
      extraction: EXTRACTION_PENDING,
      dian: DIAN_PENDING,
    };
  }

  // ---- User --------------------------------------------------------------

  async overview(user: AuthenticatedUser) {
    const { row, check } = await this.diagnose(user.id);
    return this.view(row, check);
  }

  /** "¿Ya presentaste tu declaración?" plus the authorization to treat it. */
  async answer(
    user: AuthenticatedUser,
    body: unknown,
    metadata: { ip?: string; userAgent?: string },
  ) {
    const input = z
      .object({ alreadyFiled: z.boolean(), authorization: z.literal(true) })
      .strict()
      .parse(body);
    let { row } = await this.diagnose(user.id);
    const status = this.status(row);
    if (!['NO_REQUIERE', 'POSIBLE_OBLIGACION'].includes(status))
      throw new ConflictException({
        code: 'invalid_state',
        message:
          status === 'SIN_EVALUAR'
            ? 'Primero completa ingresos, patrimonio y deudas para hacer tu diagnóstico.'
            : 'Tu caso ya está en curso.',
      });
    let consent = await this.consent(user.id);
    if (!consent) {
      consent = await this.db.luft.consent.create({
        data: {
          userId: user.id,
          kind: 'TAX_ASSISTANCE',
          version: CONSENT_VERSION,
          textSnapshot: CONSENT_TEXTS.TAX_ASSISTANCE,
          textHash: this.crypto.hash(CONSENT_TEXTS.TAX_ASSISTANCE),
          ipHash: metadata.ip ? this.crypto.hash(metadata.ip) : undefined,
          userAgent: metadata.userAgent?.slice(0, 500),
          scope: ['Declaración de renta', 'Soportes tributarios'],
        },
      });
      await this.audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'consent.accepted',
        resource: 'Consent',
        resourceId: consent.id,
        ip: metadata.ip,
        payload: {
          kind: 'TAX_ASSISTANCE',
          version: CONSENT_VERSION,
          textHash: consent.textHash,
        },
      });
    }
    const data = {
      alreadyFiled: input.alreadyFiled,
      path: input.alreadyFiled ? 'UPLOAD' : 'GUIDED',
      consentId: consent.id,
    };
    if (input.alreadyFiled)
      await this.db.luft.formalizationEvent.create({
        data: {
          caseId: row.id,
          userId: user.id,
          action: 'ANSWERED_ALREADY_FILED',
          fromStatus: row.status,
          toStatus: row.status,
          actorUserId: user.id,
          actorRole: 'USER',
        },
      });
    row = input.alreadyFiled
      ? await this.db.luft.formalizationCase.update({
          where: { id: row.id },
          data,
        })
      : await this.transition(
          row,
          'PREPARACION_GUIADA',
          'GUIDED_PREPARATION_STARTED',
          { id: user.id, role: 'USER' },
          { data },
        );
    await this.routes.syncQuietly(user.id, 'formalization');
    return this.view(row);
  }

  private async requireConsent(userId: string) {
    const consent = await this.consent(userId);
    if (!consent)
      throw new BadRequestException({
        code: 'consent_required',
        consent: 'TAX_ASSISTANCE',
        message:
          'Autoriza el tratamiento de tu declaración y soportes para continuar.',
      });
    return consent;
  }

  async upload(
    user: AuthenticatedUser,
    kind: string,
    fileName: string,
    buffer: Buffer,
  ) {
    const purpose =
      kind === 'declaration'
        ? DECLARATION
        : kind === 'support'
          ? SUPPORT
          : null;
    if (!purpose)
      throw new NotFoundException('Tipo de documento no reconocido.');
    await this.requireConsent(user.id);
    let { row } = await this.diagnose(user.id);
    const status = this.status(row);
    const draft = [
      'NO_REQUIERE',
      'POSIBLE_OBLIGACION',
      'DOCUMENTO_CARGADO',
      'PREPARACION_GUIADA',
    ].includes(status);
    if (!draft)
      throw new ConflictException({
        code: 'invalid_state',
        message:
          status === 'SIN_EVALUAR'
            ? 'Primero completa tu diagnóstico tributario.'
            : 'Tu caso ya fue enviado a revisión y no admite más documentos.',
      });
    const existing = await this.vault.list(user.id, row.id);
    const limit = purpose === DECLARATION ? MAX_DECLARATIONS : MAX_SUPPORTS;
    if (existing.filter((item) => item.purpose === purpose).length >= limit)
      throw new BadRequestException(
        `Puedes cargar máximo ${limit} archivos de este tipo.`,
      );
    const document = await this.vault.store({
      userId: user.id,
      purpose,
      refId: row.id,
      fileName,
      buffer,
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'formalization.document.uploaded',
      resource: 'UserDocument',
      resourceId: document.id,
      payload: {
        caseId: row.id,
        purpose,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
      },
    });
    if (purpose === DECLARATION && status !== 'DOCUMENTO_CARGADO')
      row = await this.transition(
        row,
        'DOCUMENTO_CARGADO',
        'DECLARATION_UPLOADED',
        { id: user.id, role: 'USER' },
        { data: { path: 'UPLOAD', alreadyFiled: true } },
      );
    await this.routes.syncQuietly(user.id, 'formalization');
    return {
      document: this.vault.view(document),
      ...(await this.view(row)),
    };
  }

  async documentFile(user: AuthenticatedUser, id: string) {
    const file = await this.vault.read(user.id, id);
    if (![DECLARATION, SUPPORT].includes(file.document.purpose))
      throw new NotFoundException('Documento no encontrado.');
    return file;
  }

  async deleteDocument(user: AuthenticatedUser, id: string) {
    let row = await this.ensureCase(user.id);
    const status = this.status(row);
    if (
      ![
        'NO_REQUIERE',
        'POSIBLE_OBLIGACION',
        'DOCUMENTO_CARGADO',
        'PREPARACION_GUIADA',
      ].includes(status)
    )
      throw new ConflictException({
        code: 'invalid_state',
        message:
          'Tu caso está en revisión y sus documentos no se pueden retirar.',
      });
    const documents = await this.vault.list(user.id, row.id);
    const document = documents.find((item) => item.id === id);
    if (!document) throw new NotFoundException('Documento no encontrado.');
    await this.vault.remove(user.id, id);
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'formalization.document.deleted',
      resource: 'UserDocument',
      resourceId: id,
      payload: { caseId: row.id, purpose: document.purpose },
    });
    const declarationsLeft = documents.filter(
      (item) => item.purpose === DECLARATION && item.id !== id,
    ).length;
    if (status === 'DOCUMENTO_CARGADO' && declarationsLeft === 0) {
      row = await this.transition(
        row,
        'POSIBLE_OBLIGACION',
        'DECLARATION_REMOVED',
        { id: user.id, role: 'USER' },
        { data: { alreadyFiled: null, path: null } },
      );
      row = (await this.diagnose(user.id)).row;
      await this.routes.syncQuietly(user.id, 'formalization');
    }
    return this.view(row);
  }

  /** Guided preparation: the step-by-step answers also served by `/luft/tax-return`. */
  async savePreparation(user: AuthenticatedUser, body: unknown) {
    const answers = taxAnswersSchema.parse(body);
    let row = await this.storePreparation(user.id, answers);
    if (this.status(row) === 'SIN_EVALUAR')
      row = (await this.diagnose(user.id)).row;
    return this.view(row);
  }

  async storePreparation(userId: string, answers: TaxAnswers) {
    const row = await this.ensureCase(userId);
    const status = this.status(row);
    if (['REVISION', 'PRESENTADO', 'VERIFICADO'].includes(status))
      throw new ConflictException({
        code: 'invalid_state',
        message: 'Tu caso ya fue enviado a revisión y no se puede editar.',
      });
    const data = { preparation: answers as object };
    if (status === 'POSIBLE_OBLIGACION' && row.alreadyFiled !== true)
      return this.transition(
        row,
        'PREPARACION_GUIADA',
        'GUIDED_PREPARATION_STARTED',
        { id: userId, role: 'USER' },
        { data: { ...data, path: 'GUIDED', alreadyFiled: false } },
      );
    return this.db.luft.formalizationCase.update({
      where: { id: row.id },
      data,
    });
  }

  async submit(user: AuthenticatedUser) {
    const row = await this.ensureCase(user.id);
    await this.requireConsent(user.id);
    const status = this.status(row);
    const documents = await this.vault.list(user.id, row.id);
    const declarations = documents.filter(
      (item) => item.purpose === DECLARATION,
    ).length;
    if (status === 'DOCUMENTO_CARGADO' && declarations === 0)
      throw new BadRequestException(
        'Carga tu declaración antes de enviarla a revisión.',
      );
    if (status === 'PREPARACION_GUIADA' && !preparationReady(row.preparation))
      throw new BadRequestException(
        'Completa la preparación guiada (al menos tus ingresos) antes de enviarla.',
      );
    if (!['DOCUMENTO_CARGADO', 'PREPARACION_GUIADA'].includes(status))
      throw new ConflictException({
        code: 'invalid_state',
        message: 'Tu caso no está listo para enviarse a revisión.',
      });
    const updated = await this.transition(
      row,
      'REVISION',
      'SUBMITTED_FOR_REVIEW',
      { id: user.id, role: 'USER' },
      {
        data: {
          submittedAt: new Date(),
          reviewApprovedAt: null,
          reviewApprovedBy: null,
        },
      },
    );
    for (const role of REVIEW_ROLES)
      this.realtime.toRole(role, 'formalization:new', {
        caseId: row.id,
        taxYear: row.taxYear,
      });
    await this.routes.syncQuietly(user.id, 'formalization');
    return this.view(updated);
  }

  /** Keeps the request to use a DIAN channel in the case history (it still fails closed). */
  async recordDianRequest(userId: string, step: string) {
    const row = await this.ensureCase(userId);
    await this.db.luft.formalizationEvent.create({
      data: {
        caseId: row.id,
        userId,
        action: 'DIAN_CHANNEL_REQUESTED',
        fromStatus: row.status,
        toStatus: row.status,
        actorUserId: userId,
        actorRole: 'USER',
        note: step,
      },
    });
  }

  // ---- Staff -------------------------------------------------------------

  private async people(userIds: string[]) {
    const users = await this.db.identity.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, fullName: true, email: true, phone: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  async queue(page: number, status?: string) {
    const where = {
      status:
        status && isFormalizationStatus(status.toUpperCase())
          ? status.toUpperCase()
          : { in: ['REVISION', 'PRESENTADO'] },
    };
    const [rows, total] = await Promise.all([
      this.db.luft.formalizationCase.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.luft.formalizationCase.count({ where }),
    ]);
    const people = await this.people(rows.map((row) => row.userId));
    return paged(
      rows.map((row) => {
        const view = this.caseView(row);
        return {
          id: view.id,
          userId: row.userId,
          userName: people.get(row.userId)?.fullName ?? null,
          taxYear: view.taxYear,
          status: view.status,
          statusLabel: view.statusLabel,
          phase: view.phase,
          path: view.path,
          mayHaveToFile: view.mayHaveToFile,
          reviewApproved: view.reviewApproved,
          submittedAt: view.submittedAt,
          updatedAt: view.updatedAt,
          actions: staffActions(view.status, view.reviewApproved),
        };
      }),
      total,
      page,
    );
  }

  private async staffCase(id: string) {
    const row = await this.db.luft.formalizationCase.findUnique({
      where: { id },
      include: { ruleVersion: true },
    });
    if (!row) throw new NotFoundException('Caso no encontrado.');
    return row;
  }

  async caseDetail(actor: AuthenticatedUser, id: string) {
    const row = await this.staffCase(id);
    const [documents, history, people] = await Promise.all([
      this.vault.list(row.userId, row.id),
      this.history(row.id),
      this.people([row.userId]),
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'formalization.case.viewed',
      resource: 'FormalizationCase',
      resourceId: row.id,
    });
    const view = this.caseView(row);
    const person = people.get(row.userId);
    return {
      case: view,
      user: person
        ? {
            id: person.id,
            fullName: person.fullName,
            email: person.email,
            phone: person.phone,
          }
        : null,
      rule: row.ruleVersion ? this.ruleView(row.ruleVersion) : null,
      diagnosis: this.storedDiagnosis(row),
      documents: documents.map((document) => this.vault.view(document)),
      history,
      actions: staffActions(view.status, view.reviewApproved),
    };
  }

  async staffDocument(actor: AuthenticatedUser, caseId: string, id: string) {
    const row = await this.staffCase(caseId);
    const file = await this.vault.read(row.userId, id);
    if (file.document.refId !== row.id)
      throw new NotFoundException('Documento no encontrado.');
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'formalization.document.viewed',
      resource: 'UserDocument',
      resourceId: id,
      payload: { caseId },
    });
    return file;
  }

  private async afterStaff(row: FormalizationCase, actor: AuthenticatedUser) {
    await this.routes.syncQuietly(row.userId, 'formalization');
    return this.caseDetail(actor, row.id);
  }

  /** Professional observations: the case goes back so the user can fix it. */
  async observe(actor: AuthenticatedUser, id: string, body: unknown) {
    const { note } = z
      .object({ note: z.string().trim().min(10).max(4_000) })
      .strict()
      .parse(body);
    const row = await this.staffCase(id);
    const status = this.status(row);
    if (!['REVISION', 'PRESENTADO'].includes(status))
      throw new ConflictException('El caso no está en revisión.');
    const updated = await this.transition(
      row,
      statusAfterObservation(status, row.path),
      'OBSERVED',
      { id: actor.id, role: actor.role },
      {
        note,
        data: {
          reviewerId: actor.id,
          reviewApprovedAt: null,
          reviewApprovedBy: null,
          ...(status === 'PRESENTADO'
            ? { formNumberCiphertext: null, filedAt: null }
            : {}),
        },
      },
    );
    return this.afterStaff(updated, actor);
  }

  /** Professional approval of the draft: next comes signature and filing. */
  async approve(actor: AuthenticatedUser, id: string, body: unknown) {
    const { note } = z
      .object({ note: z.string().trim().max(4_000).optional() })
      .strict()
      .parse(body ?? {});
    const row = await this.staffCase(id);
    if (this.status(row) !== 'REVISION' || row.reviewApprovedAt)
      throw new ConflictException('El caso no está pendiente de aprobación.');
    const updated = await this.transition(
      row,
      'REVISION',
      'REVIEW_APPROVED',
      { id: actor.id, role: actor.role },
      {
        note,
        notifyAs: 'APROBADO',
        data: {
          reviewerId: actor.id,
          reviewApprovedBy: actor.id,
          reviewApprovedAt: new Date(),
        },
      },
    );
    return this.afterStaff(updated, actor);
  }

  /** Records a declaration that was really filed with the DIAN (form number and date). */
  async markFiled(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = z
      .object({
        formNumber: z
          .string()
          .trim()
          .regex(/^[0-9A-Za-z-]{6,40}$/, 'Número de formulario inválido.'),
        filedAt: z.coerce.date().max(new Date(Date.now() + 86_400_000)),
        note: z.string().trim().max(4_000).optional(),
      })
      .strict()
      .parse(body);
    const row = await this.staffCase(id);
    if (this.status(row) !== 'REVISION' || !row.reviewApprovedAt)
      throw new ConflictException(
        'Aprueba la revisión antes de registrar la presentación.',
      );
    const updated = await this.transition(
      row,
      'PRESENTADO',
      'MARKED_FILED',
      { id: actor.id, role: actor.role },
      {
        note: input.note,
        data: {
          formNumberCiphertext: this.crypto.encrypt(input.formNumber),
          filedAt: input.filedAt,
        },
      },
    );
    return this.afterStaff(updated, actor);
  }

  /** Final verification: only now the case becomes verified evidence. */
  async verify(actor: AuthenticatedUser, id: string, body: unknown) {
    const { note } = z
      .object({ note: z.string().trim().max(4_000).optional() })
      .strict()
      .parse(body ?? {});
    const row = await this.staffCase(id);
    if (this.status(row) !== 'PRESENTADO')
      throw new ConflictException('El caso aún no está presentado.');
    const updated = await this.transition(
      row,
      'VERIFICADO',
      'VERIFIED',
      { id: actor.id, role: actor.role },
      { note, data: { verifiedBy: actor.id, verifiedAt: new Date() } },
    );
    return this.afterStaff(updated, actor);
  }

  // ---- Tax rules ---------------------------------------------------------

  private ruleView(row: TaxRuleVersion) {
    return {
      ...this.toRule(row),
      sourceUrl: row.sourceUrl,
      effectiveTo: row.effectiveTo
        ? row.effectiveTo.toISOString().slice(0, 10)
        : null,
      status: row.status,
      notes: row.notes,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      activatedAt: row.activatedAt,
      createdAt: row.createdAt,
    };
  }

  async rules(page: number, taxYear?: string) {
    const year = Number.parseInt(taxYear ?? '', 10);
    const where = Number.isFinite(year) ? { taxYear: year } : {};
    const [rows, total] = await Promise.all([
      this.db.luft.taxRuleVersion.findMany({
        where,
        orderBy: [{ taxYear: 'desc' }, { version: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.luft.taxRuleVersion.count({ where }),
    ]);
    return paged(
      rows.map((row) => this.ruleView(row)),
      total,
      page,
    );
  }

  async createRule(actor: AuthenticatedUser, body: unknown) {
    const input = taxRuleInputSchema.parse(body);
    const latest = await this.db.luft.taxRuleVersion.findFirst({
      where: { taxYear: input.taxYear },
      orderBy: { version: 'desc' },
    });
    const rule = await this.db.luft.taxRuleVersion.create({
      data: {
        ...input,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        createdBy: actor.id,
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'tax_rule.created',
      resource: 'TaxRuleVersion',
      resourceId: rule.id,
      payload: {
        taxYear: rule.taxYear,
        version: rule.version,
        uvtCOP: rule.uvtCOP,
        sourceDocument: rule.sourceDocument,
      },
    });
    return this.ruleView(rule);
  }

  async approveRule(actor: AuthenticatedUser, id: string) {
    const moved = await this.db.luft.taxRuleVersion.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        status: 'APPROVED',
        approvedBy: actor.id,
        approvedAt: new Date(),
      },
    });
    if (!moved.count)
      throw new ConflictException('Solo se aprueba una versión en borrador.');
    const rule = await this.db.luft.taxRuleVersion.findUniqueOrThrow({
      where: { id },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'tax_rule.approved',
      resource: 'TaxRuleVersion',
      resourceId: id,
      payload: { taxYear: rule.taxYear, version: rule.version },
    });
    return this.ruleView(rule);
  }

  /** Puts an approved version in force; the previous one of that year is superseded. */
  async activateRule(actor: AuthenticatedUser, id: string) {
    const rule = await this.db.luft.taxRuleVersion.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException('Regla no encontrada.');
    if (rule.status !== 'APPROVED')
      throw new ConflictException(
        'Solo una versión aprobada puede ponerse vigente.',
      );
    const now = new Date();
    const [, activated] = await this.db.luft.$transaction([
      this.db.luft.taxRuleVersion.updateMany({
        where: { taxYear: rule.taxYear, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', effectiveTo: now },
      }),
      this.db.luft.taxRuleVersion.update({
        where: { id },
        data: { status: 'ACTIVE', activatedAt: now },
      }),
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'tax_rule.activated',
      resource: 'TaxRuleVersion',
      resourceId: id,
      payload: { taxYear: rule.taxYear, version: rule.version },
    });
    return this.ruleView(activated);
  }
}
