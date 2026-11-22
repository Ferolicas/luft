import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  allyFunnelView,
  canApproveException,
  INSTITUTION_VISIBLE_STATUSES,
  institutionCanSeeApplicant,
  nextPresentationStatus,
  PRESENTATION_STATUS_LABELS,
  PRESENTATION_STATUSES,
  type AllyFunnelKey,
  type PresentationActor,
  type PresentationStatusName,
  type SharedData,
} from './presentation';
import { explain, type StoredExplanation } from './rule-engine';
import { decisionSchema, presentSchema } from './schemas';
import {
  isoDay,
  isRealDay,
  optionalEnum,
  PAGE_SIZE,
  pageNumber,
  paginated,
  parseId,
  parseInput,
  toNumber,
  toRate,
} from './validation';

interface ProductSnapshot {
  institutionId: string;
  institutionName: string;
  productId: string;
  name: string;
  kind: string;
}

const NOT_FOUND = 'Presentación no encontrada.';

/**
 * Follow-up of presentations: LUFT staff, the institution portal and the
 * aggregated ally funnel. No banking integration exists: "presentada" is
 * always recorded by a person.
 */
@Injectable()
export class PresentationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // -------------------------------------------------------------------- staff

  async staffList(query: {
    page?: string;
    status?: string;
    institutionId?: string;
  }) {
    const page = pageNumber(query.page);
    const status = optionalEnum(PRESENTATION_STATUSES, query.status);
    const where = {
      ...(status ? { status } : {}),
      ...(query.institutionId
        ? { institutionId: parseId(query.institutionId) }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.scoring.matchPresentation.findMany({
        where,
        include: { result: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.matchPresentation.count({ where }),
    ]);
    const names = await this.names(rows.map((row) => row.userId));
    return paginated(
      rows.map((row) => ({
        ...this.baseView(row),
        user: { id: row.userId, fullName: names.get(row.userId) ?? null },
      })),
      total,
      page,
    );
  }

  /** Full detail for staff, including the data the person authorized. */
  async staffDetail(actor: AuthenticatedUser, id: string) {
    const row = await this.load(id);
    const names = await this.names([
      row.userId,
      row.presentedBy,
      row.decidedBy,
      row.exceptionApprovedBy,
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'matching.presentation.viewed',
      resource: 'MatchPresentation',
      resourceId: row.id,
      payload: { subjectUserId: row.userId, audience: 'STAFF' },
    });
    const stored = row.result.explanation as unknown as StoredExplanation;
    return {
      ...this.baseView(row),
      user: { id: row.userId, fullName: names.get(row.userId) ?? null },
      presentedByName: row.presentedBy
        ? (names.get(row.presentedBy) ?? null)
        : null,
      decidedByName: row.decidedBy ? (names.get(row.decidedBy) ?? null) : null,
      exceptionApprovedByName: row.exceptionApprovedBy
        ? (names.get(row.exceptionApprovedBy) ?? null)
        : null,
      exceptionNote: row.exceptionNote,
      presentationNote: row.presentationNote,
      authorization: {
        version: row.authorizationVersion,
        text: row.authorizationText,
        textHash: row.authorizationHash,
        scope: row.authorizedScope,
        authorizedAt: row.authorizedAt,
      },
      shared: this.shared(row.sharedDataCiphertext),
      explanation: explain(stored, 'staff'),
    };
  }

  /** A person from LUFT records that the case was presented to the entity. */
  async present(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = parseInput(presentSchema, body);
    const row = await this.load(id);
    const to = nextPresentationStatus({
      from: row.status,
      action: 'present',
      actor: 'STAFF',
    });
    if (!to) throw this.invalidStatus(row.status);
    const levels = this.exceptionLevels(row);
    const internalLevels = levels.filter((level) => level !== 'INSTITUTION');
    if (row.requiresException && !canApproveException(actor.role, levels))
      throw new ForbiddenException({
        code: 'exception_approval_required',
        message:
          'Este caso no cumple un requisito y necesita aprobación de excepción de un nivel superior.',
        levels,
      });
    if (row.requiresException && internalLevels.length && !input.exceptionNote)
      throw new BadRequestException({
        code: 'exception_note_required',
        message: 'Describe por qué se aprueba la excepción.',
        levels,
      });
    const approvesException =
      row.requiresException && internalLevels.length > 0;
    const now = new Date();
    await this.move(row, to, {
      presentedAt: now,
      presentedBy: actor.id,
      presentationChannel: input.channel,
      presentationNote: input.note ?? null,
      ...(approvesException
        ? {
            exceptionApprovedBy: actor.id,
            exceptionApprovedRole: actor.role,
            exceptionNote: input.exceptionNote,
          }
        : {}),
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'matching.presentation.presented',
      resource: 'MatchPresentation',
      resourceId: row.id,
      payload: {
        subjectUserId: row.userId,
        institutionId: row.institutionId,
        productId: row.productId,
        channel: input.channel,
        exceptionApproved: approvesException,
        exceptionLevels: levels,
      },
    });
    await this.notify(row, to);
    return this.staffDetail(actor, row.id);
  }

  async staffDecide(actor: AuthenticatedUser, id: string, body: unknown) {
    const row = await this.load(id);
    await this.decide(actor, row, body, 'STAFF');
    return this.staffDetail(actor, row.id);
  }

  // --------------------------------------------------------- portal de entidad

  private async institutionLink(user: AuthenticatedUser) {
    const link = await this.db.scoring.institutionUser.findUnique({
      where: { userId: user.id },
      include: { institution: true },
    });
    if (!link || !link.institution.active)
      throw new ForbiddenException({
        code: 'institution_link_required',
        message: 'Tu cuenta no está vinculada a una entidad activa.',
      });
    return link;
  }

  async institutionHome(user: AuthenticatedUser) {
    const { institution } = await this.institutionLink(user);
    const groups = await this.db.scoring.matchPresentation.groupBy({
      by: ['status'],
      where: {
        institutionId: institution.id,
        status: { in: INSTITUTION_VISIBLE_STATUSES },
      },
      _count: { _all: true },
    });
    return {
      institution: {
        id: institution.id,
        name: institution.name,
        kind: institution.kind,
      },
      totals: INSTITUTION_VISIBLE_STATUSES.map((status) => ({
        status,
        label: PRESENTATION_STATUS_LABELS[status],
        count:
          groups.find((group) => group.status === status)?._count._all ?? 0,
      })),
    };
  }

  /** Only what LUFT already presented to THIS institution. */
  async institutionList(
    user: AuthenticatedUser,
    query: { page?: string; status?: string },
  ) {
    const { institution } = await this.institutionLink(user);
    const page = pageNumber(query.page);
    const status = optionalEnum(INSTITUTION_VISIBLE_STATUSES, query.status);
    const where = {
      institutionId: institution.id,
      status: status ?? { in: INSTITUTION_VISIBLE_STATUSES },
    };
    const [rows, total] = await Promise.all([
      this.db.scoring.matchPresentation.findMany({
        where,
        include: { result: true },
        orderBy: { presentedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.matchPresentation.count({ where }),
    ]);
    const items = rows.map((row) => this.institutionView(row, false));
    if (items.some((item) => item.applicantName))
      await this.audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'matching.presentation.listed',
        resource: 'MatchPresentation',
        payload: {
          audience: 'INSTITUTION',
          institutionId: institution.id,
          presentationIds: items
            .filter((item) => item.applicantName)
            .map((item) => item.id),
        },
      });
    return paginated(items, total, page);
  }

  async institutionDetail(user: AuthenticatedUser, id: string) {
    const { institution } = await this.institutionLink(user);
    const row = await this.loadForInstitution(institution.id, id);
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'matching.presentation.viewed',
      resource: 'MatchPresentation',
      resourceId: row.id,
      payload: {
        subjectUserId: row.userId,
        audience: 'INSTITUTION',
        institutionId: institution.id,
        personalDataShown: institutionCanSeeApplicant(row.status),
      },
    });
    return this.institutionView(row, true);
  }

  async institutionDecide(user: AuthenticatedUser, id: string, body: unknown) {
    const { institution } = await this.institutionLink(user);
    const row = await this.loadForInstitution(institution.id, id);
    await this.decide(user, row, body, 'INSTITUTION');
    return this.institutionView(
      await this.loadForInstitution(institution.id, row.id),
      true,
    );
  }

  // ----------------------------------------------------------- portal de aliado

  private async allyLink(user: AuthenticatedUser) {
    const link = await this.db.scoring.allyUser.findUnique({
      where: { userId: user.id },
      include: { ally: true },
    });
    if (!link || !link.ally.active)
      throw new ForbiddenException({
        code: 'ally_link_required',
        message: 'Tu cuenta no está vinculada a un aliado activo.',
      });
    return link;
  }

  async allyHome(user: AuthenticatedUser) {
    const { ally } = await this.allyLink(user);
    return {
      ally: { id: ally.id, name: ally.name, referralCode: ally.referralCode },
    };
  }

  /** Aggregated funnel of the ally's referrals. Counts only. */
  async allyFunnel(
    user: AuthenticatedUser,
    query: { from?: string; to?: string },
  ) {
    const { ally } = await this.allyLink(user);
    const from = query.from && isRealDay(query.from) ? query.from : null;
    const to = query.to && isRealDay(query.to) ? query.to : null;
    const counts = await this.funnelCounts(ally.id, from, to);
    return {
      ally: { id: ally.id, name: ally.name },
      period: { from, to },
      ...allyFunnelView(counts),
    };
  }

  async funnelCounts(
    allyId: string,
    from: string | null,
    to: string | null,
  ): Promise<Record<AllyFunnelKey, number>> {
    const referrals = await this.db.scoring.allyReferral.findMany({
      where: {
        referredByAllyId: allyId,
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(`${from}T00:00:00-05:00`) } : {}),
                ...(to ? { lte: new Date(`${to}T23:59:59.999-05:00`) } : {}),
              },
            }
          : {}),
      },
      select: { userId: true },
    });
    const ids = referrals.map((row) => row.userId);
    const empty: Record<AllyFunnelKey, number> = {
      referred: ids.length,
      verified: 0,
      diagnosed: 0,
      profileCompleted: 0,
      creditApplied: 0,
      creditActive: 0,
      matched: 0,
      authorized: 0,
      presented: 0,
      approved: 0,
    };
    if (ids.length === 0) return empty;
    const within = { userId: { in: ids } };
    const distinct = (rows: Array<{ userId: string }>) =>
      new Set(rows.map((row) => row.userId)).size;
    const [
      verified,
      diagnosed,
      profileCompleted,
      applications,
      loans,
      runs,
      presentations,
    ] = await Promise.all([
      this.db.identity.user.count({
        where: { id: { in: ids }, phoneVerifiedAt: { not: null } },
      }),
      this.db.luft.financialProfile.count({
        where: { ...within, archetype: { not: null } },
      }),
      this.db.luft.financialProfile.count({
        where: { ...within, completionPercent: { gte: 100 } },
      }),
      this.db.startif.creditApplication.findMany({
        where: within,
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.db.startif.loan.findMany({
        where: within,
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.db.scoring.matchRun.findMany({
        where: within,
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.db.scoring.matchPresentation.findMany({
        where: within,
        select: { userId: true, status: true, presentedAt: true },
      }),
    ]);
    return {
      referred: ids.length,
      verified,
      diagnosed,
      profileCompleted,
      creditApplied: distinct(applications),
      creditActive: distinct(loans),
      matched: distinct(runs),
      authorized: distinct(presentations),
      presented: distinct(presentations.filter((row) => row.presentedAt)),
      approved: distinct(
        presentations.filter((row) => row.status === 'APROBADA'),
      ),
    };
  }

  // ------------------------------------------------------------------ internos

  private async decide(
    actor: AuthenticatedUser,
    row: Awaited<ReturnType<PresentationService['load']>>,
    body: unknown,
    as: Exclude<PresentationActor, 'USER'>,
  ) {
    const input = parseInput(decisionSchema, body);
    const to = nextPresentationStatus({
      from: row.status,
      action: 'decide',
      actor: as,
      decision: input.decision,
    });
    if (!to) throw this.invalidStatus(row.status);
    const product = row.result.productSnapshot as unknown as ProductSnapshot;
    const now = new Date();
    await this.move(row, to, {
      decidedAt: now,
      decidedBy: actor.id,
      decidedByRole: actor.role,
      decisionReason: input.reason ?? null,
      ...(input.decision === 'APROBADA'
        ? {
            approvedAmountCOP: BigInt(input.approvedAmountCOP),
            approvedRateEA: input.approvedRateEA.toFixed(5),
            approvedTermMonths: input.approvedTermMonths,
            finalProductName: input.finalProductName ?? product.name,
          }
        : {}),
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'matching.presentation.decided',
      resource: 'MatchPresentation',
      resourceId: row.id,
      payload: {
        subjectUserId: row.userId,
        institutionId: row.institutionId,
        productId: row.productId,
        decision: input.decision,
        registeredBy: as,
        ...(input.decision === 'APROBADA'
          ? {
              approvedAmountCOP: input.approvedAmountCOP,
              approvedRateEA: input.approvedRateEA,
              approvedTermMonths: input.approvedTermMonths,
              finalProductName: input.finalProductName ?? product.name,
            }
          : {}),
      },
    });
    await this.notify(row, to);
  }

  /** Optimistic status change: fails if someone else moved it first. */
  private async move(
    row: { id: string; status: PresentationStatusName },
    to: PresentationStatusName,
    data: Record<string, unknown>,
  ) {
    const updated = await this.db.scoring.matchPresentation.updateMany({
      where: { id: row.id, status: row.status },
      data: { ...data, status: to },
    });
    if (updated.count !== 1)
      throw new ConflictException({
        code: 'presentation_changed',
        message: 'La presentación cambió de estado. Recarga para continuar.',
      });
  }

  private async notify(
    row: { id: string; userId: string; institutionId: string },
    status: PresentationStatusName,
  ) {
    this.realtime.toUser(row.userId, 'matching:presentation', {
      id: row.id,
      status,
    });
    for (const role of ['COMMERCIAL', 'RISK'])
      this.realtime.toRole(role, 'matching:presentation', {
        id: row.id,
        status,
      });
    // Never broadcast to the INSTITUTION role room: each entity only hears
    // about its own cases.
    const links = await this.db.scoring.institutionUser.findMany({
      where: { institutionId: row.institutionId },
      select: { userId: true },
    });
    for (const link of links)
      this.realtime.toUser(link.userId, 'institution:presentation', {
        id: row.id,
        status,
      });
  }

  private invalidStatus(status: PresentationStatusName) {
    return new ConflictException({
      code: 'invalid_presentation_status',
      message: `La presentación está en estado «${PRESENTATION_STATUS_LABELS[status]}» y no admite esta acción.`,
      status,
    });
  }

  private async load(id: string) {
    const row = await this.db.scoring.matchPresentation.findUnique({
      where: { id: parseId(id, NOT_FOUND) },
      include: { result: true },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** A foreign or not-yet-presented case answers 404: existence is not leaked. */
  private async loadForInstitution(institutionId: string, id: string) {
    const row = await this.db.scoring.matchPresentation.findFirst({
      where: {
        id: parseId(id, NOT_FOUND),
        institutionId,
        status: { in: INSTITUTION_VISIBLE_STATUSES },
      },
      include: { result: true },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private exceptionLevels(row: { result: { explanation: unknown } }): string[] {
    const stored = row.result.explanation as StoredExplanation | null;
    return Array.isArray(stored?.exceptionApprovalLevels)
      ? stored.exceptionApprovalLevels
      : [];
  }

  private shared(ciphertext: string | null): SharedData | null {
    if (!ciphertext) return null;
    try {
      return JSON.parse(this.crypto.decrypt(ciphertext)) as SharedData;
    } catch {
      return null;
    }
  }

  private async names(ids: ReadonlyArray<string | null | undefined>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map<string, string>();
    const users = await this.db.identity.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  private baseView(row: Awaited<ReturnType<PresentationService['load']>>) {
    const product = row.result.productSnapshot as unknown as ProductSnapshot;
    return {
      id: row.id,
      resultId: row.resultId,
      status: row.status,
      statusLabel: PRESENTATION_STATUS_LABELS[row.status],
      institution: { id: row.institutionId, name: product.institutionName },
      product: { id: row.productId, name: product.name, kind: product.kind },
      policy: {
        versionId: row.policyVersionId,
        version: row.result.policyVersionNumber,
        effectiveFrom: isoDay(row.result.policyEffectiveFrom),
      },
      match: {
        status: row.result.status,
        fitPercent: row.result.fitPercent,
        evaluatedAt: row.result.createdAt,
      },
      requiresException: row.requiresException,
      exceptionLevels: this.exceptionLevels(row),
      exceptionApprovedBy: row.exceptionApprovedBy,
      exceptionApprovedRole: row.exceptionApprovedRole,
      authorizedAt: row.authorizedAt,
      revokedAt: row.revokedAt,
      presentedAt: row.presentedAt,
      presentedBy: row.presentedBy,
      presentationChannel: row.presentationChannel,
      decidedAt: row.decidedAt,
      decidedBy: row.decidedBy,
      decidedByRole: row.decidedByRole,
      approvedAmountCOP: toNumber(row.approvedAmountCOP),
      approvedRateEA: toRate(row.approvedRateEA),
      approvedTermMonths: row.approvedTermMonths,
      finalProductName: row.finalProductName,
      decisionReason: row.decisionReason,
      allowedActions:
        row.status === 'AUTORIZADA'
          ? ['present']
          : row.status === 'PRESENTADA'
            ? ['decide']
            : [],
    };
  }

  /**
   * What an institution sees. Personal data comes ONLY from the copy the
   * person authorized, and only while the case is open or approved.
   */
  private institutionView(
    row: Awaited<ReturnType<PresentationService['load']>>,
    detail: boolean,
  ) {
    const product = row.result.productSnapshot as unknown as ProductSnapshot;
    const visible = institutionCanSeeApplicant(row.status);
    const shared = visible ? this.shared(row.sharedDataCiphertext) : null;
    return {
      id: row.id,
      status: row.status,
      statusLabel: PRESENTATION_STATUS_LABELS[row.status],
      product: { id: row.productId, name: product.name, kind: product.kind },
      policy: {
        version: row.result.policyVersionNumber,
        effectiveFrom: isoDay(row.result.policyEffectiveFrom),
      },
      match: {
        status: row.result.status,
        fitPercent: row.result.fitPercent,
        evaluatedAt: row.result.createdAt,
      },
      requiresException: row.requiresException,
      presentedAt: row.presentedAt,
      presentationChannel: row.presentationChannel,
      decidedAt: row.decidedAt,
      decidedByRole: row.decidedByRole,
      approvedAmountCOP: toNumber(row.approvedAmountCOP),
      approvedRateEA: toRate(row.approvedRateEA),
      approvedTermMonths: row.approvedTermMonths,
      finalProductName: row.finalProductName,
      decisionReason: row.decisionReason,
      canDecide: row.status === 'PRESENTADA',
      dataAvailable: Boolean(shared),
      applicantName: shared?.applicant.fullName ?? null,
      ...(detail
        ? {
            applicant: shared?.applicant ?? null,
            facts: shared?.facts ?? [],
            authorization: {
              version: row.authorizationVersion,
              authorizedAt: row.authorizedAt,
              text: row.authorizationText,
            },
          }
        : {}),
    };
  }
}
