import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MATCH_ENGINE_VERSION } from './fact-catalog';
import {
  businessDay,
  canonicalJson,
  fullYears,
  matchingRequirements,
  parseSnapshot,
  snapshotOf,
  supplementSchema,
  type FactSnapshot,
  type Supplement,
} from './facts';
import { isInForce } from './policy-lifecycle';
import { PolicyService } from './policy.service';
import {
  AUTHORIZATION_VERSION,
  authorizationScope,
  authorizationText,
  nextPresentationStatus,
  PRESENTATION_STATUS_LABELS,
  sharedData,
  type PresentationStatusName,
} from './presentation';
import { PROFILE_SOURCE, type ProfileSource } from './profile-source';
import {
  evaluatePolicy,
  explain,
  headline,
  rulesFromSnapshot,
  storedExplanation,
  type MatchStatusName,
  type StoredExplanation,
} from './rule-engine';
import { authorizeSchema, runSchema } from './schemas';
import {
  isoDay,
  isRealDay,
  isUniqueViolation,
  PAGE_SIZE,
  pageNumber,
  paginated,
  parseId,
  parseInput,
  toNumber,
  toRate,
} from './validation';

const DISCLAIMER =
  'El encaje compara tu perfil con los criterios que cada entidad publicó. No es una oferta ni una aprobación: la decisión final siempre es de la entidad.';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

interface ProductSnapshot {
  institutionId: string;
  institutionName: string;
  institutionKind: string;
  productId: string;
  name: string;
  kind: string;
  description: string | null;
  minAmountCOP: number | null;
  maxAmountCOP: number | null;
  minTermMonths: number | null;
  maxTermMonths: number | null;
  referenceRateEA: number | null;
  guarantees: string[];
  requiredDocuments: string[];
  channel: string | null;
}

interface PresentationRow {
  id: string;
  resultId: string;
  status: PresentationStatusName;
  requiresException: boolean;
  authorizedAt: Date;
  revokedAt: Date | null;
  presentedAt: Date | null;
  decidedAt: Date | null;
  approvedAmountCOP: bigint | null;
  approvedRateEA: { toString(): string } | null;
  approvedTermMonths: number | null;
  finalProductName: string | null;
  decisionReason: string | null;
}

interface ResultRow {
  id: string;
  runId: string;
  productId: string;
  institutionId: string;
  policyVersionId: string;
  policyVersionNumber: number;
  policyEffectiveFrom: Date | null;
  productSnapshot: unknown;
  rulesSnapshot: unknown;
  fitPercent: number;
  status: MatchStatusName;
  presentable: boolean;
  explanation: unknown;
  createdAt: Date;
  presentation?: PresentationRow | null;
}

const STATUS_ORDER: Record<MatchStatusName, number> = {
  ELEGIBLE: 0,
  CON_BRECHAS: 1,
  EXCLUIDO: 2,
};

/** Matching for the person: readiness, runs, explanations and authorizations. */
@Injectable()
export class MatchingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly policies: PolicyService,
    @Inject(PROFILE_SOURCE) private readonly profiles: ProfileSource,
  ) {}

  // ------------------------------------------------------------- preparación

  private async prepare(userId: string) {
    const [consent, signals, supplement] = await Promise.all([
      this.db.luft.consent.findFirst({
        where: { userId, kind: 'DATA_PROCESSING', revokedAt: null },
        orderBy: { acceptedAt: 'desc' },
        select: { id: true },
      }),
      this.profiles.signals(userId),
      this.loadSupplement(userId),
    ]);
    const missing = matchingRequirements({
      dataConsentActive: Boolean(consent),
      archetype: signals.archetype,
      completedSections: signals.completedSections,
    });
    return { ready: missing.length === 0, missing, signals, supplement };
  }

  async readiness(user: AuthenticatedUser) {
    const { ready, missing, supplement } = await this.prepare(user.id);
    return {
      ready,
      missing,
      declared: this.supplementView(supplement.data, supplement.updatedAt),
    };
  }

  private async loadSupplement(userId: string) {
    const row = await this.db.scoring.matchingSupplement.findUnique({
      where: { userId },
    });
    if (!row) return { data: null as Supplement | null, updatedAt: null };
    try {
      const parsed = supplementSchema.safeParse(
        JSON.parse(this.crypto.decrypt(row.dataCiphertext)),
      );
      return {
        data: parsed.success ? parsed.data : null,
        updatedAt: row.updatedAt,
      };
    } catch {
      return { data: null, updatedAt: row.updatedAt };
    }
  }

  private supplementView(data: Supplement | null, updatedAt: Date | null) {
    return {
      birthDate: data?.birthDate ?? null,
      city: data?.city ?? null,
      department: data?.department ?? null,
      activityStartDate: data?.activityStartDate ?? null,
      updatedAt,
    };
  }

  async declaredProfile(user: AuthenticatedUser) {
    const supplement = await this.loadSupplement(user.id);
    return this.supplementView(supplement.data, supplement.updatedAt);
  }

  /** Data only the person can declare: birth date, city and activity start. */
  async saveDeclaredProfile(user: AuthenticatedUser, body: unknown) {
    const input = parseInput(supplementSchema, body);
    const today = businessDay();
    if (input.birthDate) {
      const age = isRealDay(input.birthDate)
        ? fullYears(input.birthDate, today)
        : -1;
      if (age < 18 || age > 110)
        throw new BadRequestException({
          code: 'validation_error',
          message: 'Revisa tu fecha de nacimiento: debes ser mayor de edad.',
        });
    }
    if (
      input.activityStartDate &&
      (!isRealDay(input.activityStartDate) || input.activityStartDate > today)
    )
      throw new BadRequestException({
        code: 'validation_error',
        message: 'La fecha de inicio de tu actividad no puede ser futura.',
      });
    const current = await this.loadSupplement(user.id);
    const merged: Supplement = { ...(current.data ?? {}), ...input };
    const dataCiphertext = this.crypto.encrypt(JSON.stringify(merged));
    const saved = await this.db.scoring.matchingSupplement.upsert({
      where: { userId: user.id },
      create: { userId: user.id, dataCiphertext },
      update: { dataCiphertext },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'matching.declared_profile.saved',
      resource: 'MatchingSupplement',
      resourceId: saved.id,
      payload: { fields: Object.keys(input) },
    });
    return this.supplementView(merged, saved.updatedAt);
  }

  // ------------------------------------------------------------------ ejecución

  async run(user: AuthenticatedUser, body: unknown, meta: RequestMeta = {}) {
    const input = parseInput(runSchema, body);
    const { ready, missing, signals, supplement } = await this.prepare(user.id);
    if (!ready)
      throw new BadRequestException({
        code: 'matching_requirements_missing',
        message: 'Completa estos pasos antes de buscar productos.',
        missing,
      });
    const now = new Date();
    const today = businessDay(now);
    const day = new Date(`${today}T00:00:00Z`);
    const [inquiry, profile, loans, versions] = await Promise.all([
      this.db.luft.scoreInquiry.findFirst({
        where: { userId: user.id, status: 'COMPLETED', score: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: { score: true, existingHistory: true },
      }),
      this.db.luft.financialProfile.findUnique({
        where: { userId: user.id },
        select: { currentScore: true, existingHistory: true },
      }),
      this.db.startif.loan.findMany({
        where: { userId: user.id },
        select: {
          installments: {
            select: { dueDate: true, status: true, paidAt: true },
          },
        },
      }),
      this.db.scoring.policyVersion.findMany({
        where: {
          status: 'VIGENTE',
          effectiveFrom: { lte: day },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
          product: {
            active: true,
            institution: { active: true },
            ...(input.productKinds?.length
              ? { kind: { in: input.productKinds } }
              : {}),
          },
        },
        include: {
          rules: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
          product: { include: { institution: true } },
        },
      }),
    ]);

    const snapshot = snapshotOf({
      asOf: now,
      today,
      stratum: user.stratum ?? null,
      profile: signals,
      supplement: supplement.data,
      bureau: {
        score: inquiry?.score ?? profile?.currentScore ?? null,
        hasHistory:
          inquiry?.existingHistory ?? profile?.existingHistory ?? null,
      },
      installments: loans.flatMap((loan) => loan.installments),
      request: {
        amountCOP: input.requestedAmountCOP ?? null,
        termMonths: input.requestedTermMonths ?? null,
      },
    });
    const canonical = canonicalJson(snapshot);

    const evaluated = versions.map((version) => {
      const rules = this.policies.engineRules(version.rules);
      const evaluation = evaluatePolicy(snapshot.facts, rules);
      const product: ProductSnapshot = {
        institutionId: version.product.institutionId,
        institutionName: version.product.institution.name,
        institutionKind: version.product.institution.kind,
        productId: version.productId,
        name: version.product.name,
        kind: version.product.kind,
        description: version.product.description,
        minAmountCOP: toNumber(version.product.minAmountCOP),
        maxAmountCOP: toNumber(version.product.maxAmountCOP),
        minTermMonths: version.product.minTermMonths,
        maxTermMonths: version.product.maxTermMonths,
        referenceRateEA: toRate(version.product.referenceRateEA),
        guarantees: (version.product.guarantees as string[]) ?? [],
        requiredDocuments:
          (version.product.requiredDocuments as string[]) ?? [],
        channel: version.product.channel,
      };
      return { version, rules, evaluation, product };
    });

    const run = await this.db.scoring.matchRun.create({
      data: {
        userId: user.id,
        engineVersion: MATCH_ENGINE_VERSION,
        factsCiphertext: this.crypto.encrypt(canonical),
        factsHash: this.crypto.hash(canonical),
        requestedAmountCOP:
          input.requestedAmountCOP != null
            ? BigInt(input.requestedAmountCOP)
            : null,
        requestedTermMonths: input.requestedTermMonths ?? null,
        productsEvaluated: evaluated.length,
        eligibleCount: evaluated.filter(
          (item) => item.evaluation.status === 'ELEGIBLE',
        ).length,
        results: {
          create: evaluated.map((item) => ({
            userId: user.id,
            institutionId: item.product.institutionId,
            productId: item.version.productId,
            policyVersionId: item.version.id,
            policyVersionNumber: item.version.version,
            policyEffectiveFrom: item.version.effectiveFrom,
            productSnapshot: item.product as object,
            rulesSnapshot: item.rules as object[],
            fitPercent: item.evaluation.fitPercent,
            status: item.evaluation.status,
            presentable: item.evaluation.presentable,
            explanation: storedExplanation(item.evaluation) as object,
          })),
        },
      },
      select: { id: true },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'matching.run.created',
      resource: 'MatchRun',
      resourceId: run.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      payload: {
        engineVersion: MATCH_ENGINE_VERSION,
        productsEvaluated: evaluated.length,
        policyVersionIds: evaluated.map((item) => item.version.id),
        eligible: evaluated.filter(
          (item) => item.evaluation.status === 'ELEGIBLE',
        ).length,
      },
    });
    this.realtime.toUser(user.id, 'matching:updated', { runId: run.id });
    return this.runView(user.id, run.id);
  }

  /** Latest run with results and explanations (or what is missing to run). */
  async latest(user: AuthenticatedUser) {
    const last = await this.db.scoring.matchRun.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const readiness = await this.readiness(user);
    if (!last)
      return { run: null, results: [], readiness, disclaimer: DISCLAIMER };
    return { ...(await this.runView(user.id, last.id)), readiness };
  }

  async runDetail(user: AuthenticatedUser, id: string) {
    return this.runView(user.id, parseId(id, 'Ejecución no encontrada.'));
  }

  async history(user: AuthenticatedUser, pageInput?: string) {
    const page = pageNumber(pageInput);
    const where = { userId: user.id };
    const [runs, total] = await Promise.all([
      this.db.scoring.matchRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          createdAt: true,
          engineVersion: true,
          productsEvaluated: true,
          requestedAmountCOP: true,
          requestedTermMonths: true,
          results: { select: { status: true } },
        },
      }),
      this.db.scoring.matchRun.count({ where }),
    ]);
    return paginated(
      runs.map((run) => ({
        id: run.id,
        createdAt: run.createdAt,
        engineVersion: run.engineVersion,
        productsEvaluated: run.productsEvaluated,
        requestedAmountCOP: toNumber(run.requestedAmountCOP),
        requestedTermMonths: run.requestedTermMonths,
        summary: this.summary(run.results),
      })),
      total,
      page,
    );
  }

  // --------------------------------------------------------------- autorización

  /** Exact text and scope the person is about to authorize. */
  async authorizationPreview(user: AuthenticatedUser, resultId: string) {
    const result = await this.ownResult(user.id, resultId);
    const state = this.authorizationState(
      await this.authorizationContext(user.id, [result]),
      result,
    );
    const product = result.productSnapshot as unknown as ProductSnapshot;
    const scope = authorizationScope(rulesFromSnapshot(result.rulesSnapshot));
    const text = authorizationText({
      institutionName: product.institutionName,
      productName: product.name,
      scope,
    });
    return {
      resultId: result.id,
      allowed: state.allowed,
      blockedCode: state.code,
      blockedReason: state.message,
      version: AUTHORIZATION_VERSION,
      text,
      textHash: this.crypto.hash(text),
      scope,
      institution: {
        id: product.institutionId,
        name: product.institutionName,
      },
      product: { id: product.productId, name: product.name },
    };
  }

  /** Express authorization to present the person's data to ONE institution. */
  async authorize(
    user: AuthenticatedUser,
    resultId: string,
    body: unknown,
    meta: RequestMeta = {},
  ) {
    const input = parseInput(authorizeSchema, body);
    const result = await this.ownResult(user.id, resultId);
    const state = this.authorizationState(
      await this.authorizationContext(user.id, [result]),
      result,
    );
    if (!state.allowed)
      throw new ConflictException({ code: state.code, message: state.message });
    const product = result.productSnapshot as unknown as ProductSnapshot;
    const rules = rulesFromSnapshot(result.rulesSnapshot);
    const scope = authorizationScope(rules);
    const text = authorizationText({
      institutionName: product.institutionName,
      productName: product.name,
      scope,
    });
    const textHash = this.crypto.hash(text);
    if (input.version !== AUTHORIZATION_VERSION || input.textHash !== textHash)
      throw new ConflictException({
        code: 'authorization_text_changed',
        message:
          'El texto de la autorización cambió. Léelo de nuevo antes de aceptar.',
      });
    const snapshot = this.snapshotOfRun(result.run);
    if (!snapshot)
      throw new ConflictException({
        code: 'result_outdated',
        message: 'Vuelve a buscar productos antes de autorizar.',
      });
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        fullName: true,
        email: true,
        phone: true,
        documentCiphertext: true,
      },
    });
    const evaluation = evaluatePolicy(snapshot.facts, rules);
    const shared = sharedData({
      scope,
      applicant: {
        fullName: identity.fullName,
        document: this.crypto.decrypt(identity.documentCiphertext),
        phone: identity.phone,
        email: identity.email,
      },
      facts: snapshot.facts,
      match: {
        status: result.status,
        fitPercent: result.fitPercent,
        policyVersion: result.policyVersionNumber,
        evaluatedAt: result.createdAt.toISOString(),
        requiresException: evaluation.requiresException,
      },
    });
    const presentation = await this.db.scoring.matchPresentation
      .create({
        data: {
          resultId: result.id,
          userId: user.id,
          institutionId: result.institutionId,
          productId: result.productId,
          policyVersionId: result.policyVersionId,
          authorizationVersion: AUTHORIZATION_VERSION,
          authorizationText: text,
          authorizationHash: textHash,
          authorizedScope: scope as object,
          ipHash: meta.ip ? this.crypto.hash(meta.ip) : undefined,
          userAgent: meta.userAgent?.slice(0, 500),
          sharedDataCiphertext: this.crypto.encrypt(JSON.stringify(shared)),
          requiresException: evaluation.requiresException,
        },
      })
      .catch((error) => {
        if (isUniqueViolation(error))
          throw new ConflictException({
            code: 'already_authorized',
            message: 'Ya autorizaste la presentación de este producto.',
          });
        throw error;
      });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'matching.presentation.authorized',
      resource: 'MatchPresentation',
      resourceId: presentation.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      payload: {
        resultId: result.id,
        institutionId: result.institutionId,
        productId: result.productId,
        policyVersionId: result.policyVersionId,
        version: AUTHORIZATION_VERSION,
        textHash,
        scope: [
          ...scope.identity.map((item) => item.key),
          ...scope.facts.map((item) => item.key),
        ],
      },
    });
    for (const role of ['COMMERCIAL', 'RISK'])
      this.realtime.toRole(role, 'matching:presentation', {
        id: presentation.id,
        status: presentation.status,
      });
    return this.presentationView(presentation, product);
  }

  /**
   * Revokes the authorization before the data is presented (→ REVOCADA, the
   * shared copy is destroyed) or withdraws from the process afterwards
   * (→ DESISTIDA, the institution stops seeing the data).
   */
  async revoke(
    user: AuthenticatedUser,
    resultId: string,
    meta: RequestMeta = {},
  ) {
    const id = parseId(resultId, 'Autorización no encontrada.');
    const presentation = await this.db.scoring.matchPresentation.findFirst({
      where: { resultId: id, userId: user.id },
      include: { result: { select: { productSnapshot: true } } },
    });
    if (!presentation)
      throw new NotFoundException('Autorización no encontrada.');
    const to = nextPresentationStatus({
      from: presentation.status,
      action: 'revoke',
      actor: 'USER',
    });
    if (!to)
      throw new ConflictException({
        code: 'not_revocable',
        message:
          'Esta presentación ya tiene una decisión y no puede revocarse.',
      });
    const now = new Date();
    const updated = await this.db.scoring.matchPresentation.updateMany({
      where: { id: presentation.id, status: presentation.status },
      data:
        to === 'REVOCADA'
          ? { status: to, revokedAt: now, sharedDataCiphertext: null }
          : {
              status: to,
              revokedAt: now,
              decidedAt: now,
              decidedBy: user.id,
              decidedByRole: 'USER',
              decisionReason: 'Desistimiento de la persona.',
            },
    });
    if (updated.count !== 1)
      throw new ConflictException({
        code: 'presentation_changed',
        message: 'La presentación cambió de estado. Recarga para continuar.',
      });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action:
        to === 'REVOCADA'
          ? 'matching.presentation.revoked'
          : 'matching.presentation.withdrawn',
      resource: 'MatchPresentation',
      resourceId: presentation.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      payload: {
        from: presentation.status,
        to,
        institutionId: presentation.institutionId,
        productId: presentation.productId,
      },
    });
    for (const role of ['COMMERCIAL', 'RISK'])
      this.realtime.toRole(role, 'matching:presentation', {
        id: presentation.id,
        status: to,
      });
    const fresh = await this.db.scoring.matchPresentation.findUniqueOrThrow({
      where: { id: presentation.id },
    });
    return this.presentationView(
      fresh,
      presentation.result.productSnapshot as unknown as ProductSnapshot,
    );
  }

  async presentations(user: AuthenticatedUser) {
    const rows = await this.db.scoring.matchPresentation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { result: { select: { productSnapshot: true } } },
    });
    return {
      items: rows.map((row) =>
        this.presentationView(
          row,
          row.result.productSnapshot as unknown as ProductSnapshot,
        ),
      ),
    };
  }

  /**
   * Account erasure hook. Presentations that reached an institution are kept
   * with their run as evidence of the authorization; everything else the
   * matching module holds about the person is deleted.
   */
  async eraseUserData(userId: string) {
    const kept = await this.db.scoring.matchPresentation.findMany({
      where: { userId, presentedAt: { not: null } },
      select: { result: { select: { runId: true } } },
    });
    const keptRuns = [...new Set(kept.map((row) => row.result.runId))];
    await this.db.scoring.$transaction([
      this.db.scoring.matchPresentation.deleteMany({
        where: { userId, presentedAt: null },
      }),
      this.db.scoring.matchRun.deleteMany({
        where: { userId, id: { notIn: keptRuns } },
      }),
      this.db.scoring.matchingSupplement.deleteMany({ where: { userId } }),
      this.db.scoring.allyReferral.deleteMany({ where: { userId } }),
    ]);
    return { retainedPresentations: kept.length };
  }

  // ------------------------------------------------------------------ internos

  private snapshotOfRun(run: { factsCiphertext: string }): FactSnapshot | null {
    try {
      return parseSnapshot(this.crypto.decrypt(run.factsCiphertext));
    } catch {
      return null;
    }
  }

  private async ownResult(userId: string, resultId: string) {
    const result = await this.db.scoring.matchResult.findFirst({
      where: { id: parseId(resultId, 'Resultado no encontrado.'), userId },
      include: { run: true, presentation: true },
    });
    if (!result) throw new NotFoundException('Resultado no encontrado.');
    return result;
  }

  /** Loads once what is needed to decide which results can be authorized. */
  private async authorizationContext(
    userId: string,
    results: readonly ResultRow[],
  ) {
    const [latest, versions, open] = await Promise.all([
      this.db.scoring.matchRun.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
      this.db.scoring.policyVersion.findMany({
        where: {
          id: { in: [...new Set(results.map((row) => row.policyVersionId))] },
        },
        select: {
          id: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          product: {
            select: {
              active: true,
              institution: { select: { active: true } },
            },
          },
        },
      }),
      this.db.scoring.matchPresentation.findMany({
        where: { userId, status: { in: ['AUTORIZADA', 'PRESENTADA'] } },
        select: { productId: true },
      }),
    ]);
    const today = businessDay();
    return {
      latestRunId: latest?.id ?? null,
      inForce: new Set(
        versions
          .filter(
            (version) =>
              isInForce(version, today) &&
              version.product.active &&
              version.product.institution.active,
          )
          .map((version) => version.id),
      ),
      openProducts: new Set(open.map((row) => row.productId)),
    };
  }

  /** Whether a result can still be authorized, and why not when it cannot. */
  private authorizationState(
    context: Awaited<ReturnType<MatchingService['authorizationContext']>>,
    result: ResultRow,
  ): { allowed: boolean; code: string | null; message: string | null } {
    const blocked = (code: string, message: string) => ({
      allowed: false,
      code,
      message,
    });
    if (result.presentation)
      return blocked(
        'already_authorized',
        'Ya autorizaste la presentación de este resultado.',
      );
    if (!result.presentable)
      return blocked(
        'not_presentable',
        result.status === 'EXCLUIDO'
          ? 'La política vigente de la entidad descarta este producto para tu perfil actual.'
          : 'Completa los datos o criterios pendientes antes de autorizar la presentación.',
      );
    if (context.openProducts.has(result.productId))
      return blocked(
        'already_authorized',
        'Ya tienes una presentación en curso para este producto.',
      );
    if (
      context.latestRunId !== result.runId ||
      !context.inForce.has(result.policyVersionId)
    )
      return blocked(
        'result_outdated',
        'Este resultado ya no está vigente. Vuelve a buscar productos para autorizar.',
      );
    return { allowed: true, code: null, message: null };
  }

  private summary(results: ReadonlyArray<{ status: MatchStatusName }>) {
    const count = (status: MatchStatusName) =>
      results.filter((item) => item.status === status).length;
    return {
      eligible: count('ELEGIBLE'),
      withGaps: count('CON_BRECHAS'),
      excluded: count('EXCLUIDO'),
    };
  }

  private async runView(userId: string, runId: string) {
    const run = await this.db.scoring.matchRun.findFirst({
      where: { id: runId, userId },
      include: { results: { include: { presentation: true } } },
    });
    if (!run) throw new NotFoundException('Ejecución no encontrada.');
    const snapshot = this.snapshotOfRun(run);
    const rows = run.results as ResultRow[];
    const context = await this.authorizationContext(userId, rows);
    const results = rows.map((result) => {
      const product = result.productSnapshot as ProductSnapshot;
      const rules = rulesFromSnapshot(result.rulesSnapshot);
      // The explanation with the person's own values is rebuilt from the
      // encrypted snapshot; stored explanations never contain those values.
      const evaluation = snapshot
        ? evaluatePolicy(snapshot.facts, rules)
        : null;
      const stored = result.explanation as StoredExplanation;
      const source = evaluation ?? stored;
      const state = this.authorizationState(context, result);
      return {
        id: result.id,
        status: result.status,
        fitPercent: result.fitPercent,
        presentable: result.presentable,
        requiresException: source.requiresException,
        headline: headline(result.status, source.requiresException),
        institution: {
          id: product.institutionId,
          name: product.institutionName,
          kind: product.institutionKind,
        },
        product: {
          id: product.productId,
          name: product.name,
          kind: product.kind,
          description: product.description,
          minAmountCOP: product.minAmountCOP,
          maxAmountCOP: product.maxAmountCOP,
          minTermMonths: product.minTermMonths,
          maxTermMonths: product.maxTermMonths,
          referenceRateEA: product.referenceRateEA,
          guarantees: product.guarantees,
          requiredDocuments: product.requiredDocuments,
          channel: product.channel,
        },
        policy: {
          versionId: result.policyVersionId,
          version: result.policyVersionNumber,
          effectiveFrom: isoDay(result.policyEffectiveFrom),
        },
        totals: {
          rules: source.totals.rules,
          passed: source.totals.passed,
          gaps: source.totals.gaps,
          blockingGaps: source.totals.blockingGaps,
          missingData: source.totals.missingData,
          exclusions: source.totals.exclusions,
        },
        explanation: explain(source, 'user'),
        presentation: result.presentation
          ? this.presentationView(result.presentation, product)
          : null,
        authorization: {
          allowed: state.allowed,
          blockedCode: state.code,
          blockedReason: state.message,
        },
      };
    });
    results.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.fitPercent - a.fitPercent ||
        (a.institution.name < b.institution.name
          ? -1
          : a.institution.name > b.institution.name
            ? 1
            : 0) ||
        (a.product.name < b.product.name ? -1 : 1),
    );
    return {
      run: {
        id: run.id,
        createdAt: run.createdAt,
        engineVersion: run.engineVersion,
        requestedAmountCOP: toNumber(run.requestedAmountCOP),
        requestedTermMonths: run.requestedTermMonths,
        productsEvaluated: run.productsEvaluated,
        summary: this.summary(rows),
      },
      results,
      disclaimer: DISCLAIMER,
    };
  }

  private presentationView(row: PresentationRow, product: ProductSnapshot) {
    return {
      id: row.id,
      resultId: row.resultId,
      status: row.status,
      statusLabel: PRESENTATION_STATUS_LABELS[row.status],
      requiresException: row.requiresException,
      institution: { id: product.institutionId, name: product.institutionName },
      product: { id: product.productId, name: product.name },
      authorizedAt: row.authorizedAt,
      revokedAt: row.revokedAt,
      presentedAt: row.presentedAt,
      decidedAt: row.decidedAt,
      approvedAmountCOP: toNumber(row.approvedAmountCOP),
      approvedRateEA: toRate(row.approvedRateEA),
      approvedTermMonths: row.approvedTermMonths,
      finalProductName: row.finalProductName,
      decisionReason: row.decisionReason,
      canRevoke: row.status === 'AUTORIZADA' || row.status === 'PRESENTADA',
    };
  }
}
