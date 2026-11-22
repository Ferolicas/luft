import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { MATCH_ENGINE_VERSION } from '../matching/fact-catalog';
import { businessDay, canonicalJson, parseSnapshot } from '../matching/facts';
import { PolicyService } from '../matching/policy.service';
import { PROFILE_SOURCE, type ProfileSource } from '../matching/profile-source';
import type { EngineRule, MatchStatusName } from '../matching/rule-engine';
import { ruleSchema } from '../matching/schemas';
import {
  isRealDay,
  PAGE_SIZE,
  pageNumber,
  paginated,
  parseId,
  parseInput,
  uuidSchema,
} from '../matching/validation';
import { runBacktest, type BacktestCase } from './backtest';
import {
  ANALYTICS_VERSION,
  COHORT_GROUPS,
  computeCohorts,
  dayOf,
  loanPerformance,
  monthOf,
  PREPAYMENT_DAYS,
  type CohortGroupBy,
  type LoanInput,
} from './cohorts';
import { computeEffectiveness, type UserJourney } from './effectiveness';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Hard cap of snapshots evaluated by one backtest (synchronous request). */
export const BACKTEST_SNAPSHOT_LIMIT = 5_000;

const optionalText = (pattern: RegExp, message: string) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().regex(pattern, message).optional(),
  );

const cohortQuerySchema = z.object({
  groupBy: z.preprocess(
    (value) => (value === '' || value === undefined ? 'month' : value),
    z.enum(COHORT_GROUPS),
  ),
  from: optionalText(MONTH, 'Usa el formato AAAA-MM.'),
  to: optionalText(MONTH, 'Usa el formato AAAA-MM.'),
  asOf: optionalText(DAY, 'Usa el formato AAAA-MM-DD.'),
});

const snapshotSchema = z.object({
  groupBy: z.enum(COHORT_GROUPS).default('month'),
  asOf: optionalText(DAY, 'Usa el formato AAAA-MM-DD.'),
});

const backtestSchema = z
  .object({
    label: z.string().trim().min(3).max(160).optional(),
    policyVersionId: uuidSchema.optional(),
    rules: z.array(ruleSchema).min(1).max(60).optional(),
    /** With a free rule set: compare against the decisions of this product. */
    productId: uuidSchema.optional(),
    from: optionalText(DAY, 'Usa el formato AAAA-MM-DD.'),
    to: optionalText(DAY, 'Usa el formato AAAA-MM-DD.'),
    snapshots: z.enum(['LATEST_PER_USER', 'ALL']).default('LATEST_PER_USER'),
    delinquencyDays: z
      .union([z.literal(30), z.literal(60), z.literal(90)])
      .default(30),
    loanWindow: z.enum(['ANY', 'AFTER_SNAPSHOT']).default('ANY'),
  })
  .refine((value) => Boolean(value.policyVersionId) !== Boolean(value.rules), {
    message: 'Envía policyVersionId o rules (solo uno).',
  })
  .refine(
    (value) =>
      (!value.from || isRealDay(value.from)) &&
      (!value.to || isRealDay(value.to)),
    { message: 'La fecha no existe.', path: ['from'] },
  )
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'La fecha inicial debe ser anterior a la final.',
    path: ['to'],
  });

const dateOrNull = (value: unknown): Date | null =>
  value instanceof Date ? value : null;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Cohorts/vintages, intervention effectiveness and backtesting. Reads STARTIF,
 * LUFT and scoring through their own clients; returns aggregates only.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly policies: PolicyService,
    @Inject(PROFILE_SOURCE) private readonly profiles: ProfileSource,
  ) {}

  // -------------------------------------------------------------------- cosechas

  /** Loads every loan with its installments and the segment of its holder. */
  private async loadLoans(): Promise<LoanInput[]> {
    const rows = await this.db.startif.loan.findMany({
      include: { installments: true, application: true },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((row) => row.userId))];
    const [segments, prepayments, history] = await Promise.all([
      this.profiles.segments(userIds),
      this.capitalPrepayments(),
      this.db.luft.archetypeResult.findMany({
        where: { userId: { in: userIds } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, archetype: true, createdAt: true },
      }),
    ]);
    return rows.map((row) => {
      const originatedAt = row.disbursedAt ?? row.createdAt;
      // Archetype known when the loan was originated; the current one is the
      // fallback when no versioned record exists before that date.
      const atOrigination = history
        .filter(
          (item) =>
            item.userId === row.userId && item.createdAt <= originatedAt,
        )
        .at(-1)?.archetype;
      const segment = segments.get(row.userId);
      // Tolerant read of columns STARTIF adds with its versioned products
      // (`Loan.productCode`, `defaultedAt`, `writtenOffAt`): `findMany`
      // returns them as soon as the client is regenerated; until then the
      // purpose of the application identifies the product.
      const loan = row as unknown as Record<string, unknown>;
      const application = row.application as unknown as Record<string, unknown>;
      return {
        id: row.id,
        userId: row.userId,
        originatedAt,
        principalCOP: Number(row.principalCOP),
        status: row.status,
        productCode:
          text(loan.productCode) ??
          text(application?.productCode) ??
          text(application?.purpose),
        category: segment?.category ?? null,
        archetype: atOrigination ?? segment?.archetype ?? null,
        defaultedAt: dateOrNull(loan.defaultedAt),
        writtenOffAt: dateOrNull(loan.writtenOffAt),
        capitalPrepayments: prepayments.get(row.id),
        installments: row.installments.map((item) => ({
          sequence: item.sequence,
          dueDate: item.dueDate,
          principalCOP: Number(item.principalCOP),
          status: item.status,
          paidAt: item.paidAt,
        })),
      };
    });
  }

  /**
   * EXTENSION POINT — capital prepayments ("abonos anticipados").
   *
   * STARTIF records them in `startif."LoanPrepayment"`, a table that may not
   * exist in every deployment. It is read with raw SQL only when the table
   * has `loanId` and `amountCOP`; rows count once applied when an `appliedAt`
   * column exists. Anything else leaves the metric at zero instead of
   * failing the report.
   */
  private async capitalPrepayments() {
    const result = new Map<string, { count: number; amountCOP: number }>();
    try {
      const columns = await this.db.startif.$queryRaw<
        Array<{ column_name: string }>
      >`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'startif' AND table_name = 'LoanPrepayment'`;
      const names = new Set(columns.map((item) => item.column_name));
      if (!names.has('loanId') || !names.has('amountCOP')) return result;
      type Row = { loanId: string; count: number; total: string };
      const rows = names.has('appliedAt')
        ? await this.db.startif.$queryRaw<Row[]>`
            SELECT "loanId"::text AS "loanId", COUNT(*)::int AS "count",
                   COALESCE(SUM("amountCOP"), 0)::text AS "total"
            FROM "startif"."LoanPrepayment"
            WHERE "appliedAt" IS NOT NULL GROUP BY "loanId"`
        : await this.db.startif.$queryRaw<Row[]>`
            SELECT "loanId"::text AS "loanId", COUNT(*)::int AS "count",
                   COALESCE(SUM("amountCOP"), 0)::text AS "total"
            FROM "startif"."LoanPrepayment" GROUP BY "loanId"`;
      for (const row of rows)
        result.set(row.loanId, {
          count: Number(row.count),
          amountCOP: Number(row.total),
        });
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer los abonos anticipados: ${(error as Error).message}`,
      );
    }
    return result;
  }

  private asOf(value: string | undefined) {
    const today = businessDay();
    if (!value) return today;
    if (!isRealDay(value))
      throw new BadRequestException({
        code: 'validation_error',
        message: 'La fecha de corte no existe.',
      });
    if (value > today)
      throw new BadRequestException({
        code: 'validation_error',
        message: 'La fecha de corte no puede ser futura.',
      });
    return value;
  }

  async cohorts(query: Record<string, string | undefined>) {
    const input = parseInput(cohortQuerySchema, query);
    const asOf = this.asOf(input.asOf);
    const loans = (await this.loadLoans()).filter((loan) => {
      const month = monthOf(dayOf(loan.originatedAt));
      return (
        (!input.from || month >= input.from) && (!input.to || month <= input.to)
      );
    });
    return {
      ...computeCohorts(loans, { asOf, groupBy: input.groupBy }),
      from: input.from ?? null,
      to: input.to ?? null,
      generatedAt: new Date(),
      analyticsVersion: ANALYTICS_VERSION,
      availability: {
        product: loans.some((loan) => loan.productCode),
        category: loans.some((loan) => loan.category),
        archetype: loans.some((loan) => loan.archetype),
      },
      definitions: {
        originationMonth:
          'Mes de desembolso del préstamo (o de creación si no hay desembolso registrado).',
        monthsOnBooks:
          'MOB n = cierre del mes n posterior al mes de originación. Solo se muestran los meses ya transcurridos.',
        daysPastDue:
          'Días desde el vencimiento de la cuota impaga más antigua a la fecha de observación.',
        prepayment: `Cuota pagada con ${PREPAYMENT_DAYS} días o más de anticipación; préstamo prepagado si se canceló con esa anticipación frente a su última cuota.`,
        capitalPrepayment:
          'Abonos anticipados a capital registrados por STARTIF (0 si esa tabla no existe).',
        default:
          'Préstamos declarados en incumplimiento (DEFAULTED) que aún no han sido castigados.',
        writeOff:
          'Préstamos castigados: estado WRITTEN_OFF o fecha de castigo registrada.',
        balance:
          'Capital de las cuotas no pagadas por completo a la fecha de observación.',
      },
    };
  }

  /** Freezes the vintages of a cut-off date so their evolution can be compared. */
  async saveCohortSnapshot(actor: AuthenticatedUser, body: unknown) {
    const input = parseInput(snapshotSchema, body);
    const asOf = this.asOf(input.asOf);
    const report = computeCohorts(await this.loadLoans(), {
      asOf,
      groupBy: input.groupBy,
    });
    const day = new Date(`${asOf}T00:00:00Z`);
    await this.db.scoring.$transaction(
      report.cohorts.map((cohort) =>
        this.db.scoring.cohort.upsert({
          where: {
            asOf_groupBy_originationMonth_dimensionValue: {
              asOf: day,
              groupBy: input.groupBy,
              originationMonth: cohort.originationMonth,
              dimensionValue: cohort.dimensionValue.slice(0, 80),
            },
          },
          create: {
            asOf: day,
            groupBy: input.groupBy,
            originationMonth: cohort.originationMonth,
            dimensionValue: cohort.dimensionValue.slice(0, 80),
            metrics: cohort as unknown as object,
            engineVersion: ANALYTICS_VERSION,
            createdBy: actor.id,
          },
          update: {
            metrics: cohort as unknown as object,
            engineVersion: ANALYTICS_VERSION,
            createdBy: actor.id,
          },
        }),
      ),
    );
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'analytics.cohort_snapshot.saved',
      resource: 'Cohort',
      payload: {
        asOf,
        groupBy: input.groupBy,
        cohorts: report.cohorts.length,
      },
    });
    return { asOf, groupBy: input.groupBy, saved: report.cohorts.length };
  }

  async cohortSnapshots(query: {
    page?: string;
    groupBy?: string;
    originationMonth?: string;
  }) {
    const page = pageNumber(query.page);
    const where = {
      ...(COHORT_GROUPS.includes(query.groupBy as CohortGroupBy)
        ? { groupBy: query.groupBy }
        : {}),
      ...(query.originationMonth && MONTH.test(query.originationMonth)
        ? { originationMonth: query.originationMonth }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.scoring.cohort.findMany({
        where,
        orderBy: [
          { asOf: 'desc' },
          { originationMonth: 'asc' },
          { dimensionValue: 'asc' },
        ],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.cohort.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        asOf: row.asOf.toISOString().slice(0, 10),
        groupBy: row.groupBy,
        originationMonth: row.originationMonth,
        dimensionValue: row.dimensionValue,
        analyticsVersion: row.engineVersion,
        metrics: row.metrics,
        createdAt: row.createdAt,
      })),
      total,
      page,
    );
  }

  // ----------------------------------------------------------------- efectividad

  async effectiveness(query: Record<string, string | undefined>) {
    const input = parseInput(
      z.object({
        from: optionalText(MONTH, 'Usa el formato AAAA-MM.'),
        to: optionalText(MONTH, 'Usa el formato AAAA-MM.'),
      }),
      query,
    );
    const asOf = businessDay();
    const [loans, inquiries, lessons, archetypes] = await Promise.all([
      this.loadLoans(),
      this.db.luft.scoreInquiry.findMany({
        where: { status: 'COMPLETED', score: { not: null } },
        orderBy: { requestedAt: 'asc' },
        select: { userId: true, type: true, score: true },
      }),
      this.db.luft.lessonProgress.groupBy({
        by: ['userId'],
        where: { completedAt: { not: null } },
        _count: { _all: true },
      }),
      this.db.luft.archetypeResult.findMany({
        orderBy: { createdAt: 'asc' },
        select: { userId: true, archetype: true },
      }),
    ]);
    const users = new Map<string, UserJourney>();
    const journey = (userId: string) => {
      let item = users.get(userId);
      if (!item) {
        item = {
          userId,
          cohortMonth: null,
          initialScore: null,
          finalScore: null,
          lessonsCompleted: 0,
          loans: [],
          archetypes: [],
        };
        users.set(userId, item);
      }
      return item;
    };
    for (const loan of loans) {
      const item = journey(loan.userId);
      const month = monthOf(dayOf(loan.originatedAt));
      if (!item.cohortMonth || month < item.cohortMonth)
        item.cohortMonth = month;
      item.loans.push(loanPerformance(loan, asOf));
    }
    for (const inquiry of inquiries) {
      const item = journey(inquiry.userId);
      // First INITIAL and last FINAL inquiry of each person.
      if (inquiry.type === 'INITIAL' && item.initialScore === null)
        item.initialScore = inquiry.score;
      if (inquiry.type === 'FINAL') item.finalScore = inquiry.score;
    }
    for (const row of lessons)
      journey(row.userId).lessonsCompleted = row._count._all;
    for (const row of archetypes)
      journey(row.userId).archetypes.push(row.archetype);

    const filtered = [...users.values()].filter((user) => {
      if (!input.from && !input.to) return true;
      if (!user.cohortMonth) return false;
      return (
        (!input.from || user.cohortMonth >= input.from) &&
        (!input.to || user.cohortMonth <= input.to)
      );
    });
    return {
      ...computeEffectiveness(filtered),
      from: input.from ?? null,
      to: input.to ?? null,
      asOf,
      generatedAt: new Date(),
      analyticsVersion: ANALYTICS_VERSION,
    };
  }

  // ----------------------------------------------------------------- backtesting

  /**
   * Refreshes the observed outcomes (loan behaviour and institution decisions)
   * the backtests compare against.
   */
  async syncOutcomes(): Promise<{
    observedAt: Date;
    loans: number;
    presentations: number;
  }> {
    const observedAt = new Date();
    const asOf = businessDay(observedAt);
    const [loans, presentations] = await Promise.all([
      this.loadLoans(),
      this.db.scoring.matchPresentation.findMany({
        where: { status: { in: ['APROBADA', 'RECHAZADA', 'DESISTIDA'] } },
        select: {
          id: true,
          userId: true,
          productId: true,
          status: true,
          approvedAmountCOP: true,
          decidedAt: true,
        },
      }),
    ]);
    const writes = [
      ...loans.map((loan) => {
        const performance = loanPerformance(loan, asOf);
        const data = {
          userId: loan.userId,
          originationMonth: monthOf(dayOf(loan.originatedAt)),
          productCode: loan.productCode?.slice(0, 80) ?? null,
          approved: true,
          amountCOP: BigInt(loan.principalCOP),
          maxDaysPastDue: performance.maxDaysPastDue,
          everDpd30: performance.everDpd30,
          everDpd60: performance.everDpd60,
          everDpd90: performance.everDpd90,
          installmentsDue: performance.installmentsDue,
          installmentsOnTime: performance.installmentsOnTime,
          installmentsLate: performance.installmentsLate,
          installmentsPrepaid: performance.installmentsPrepaid,
          writtenOff: performance.writtenOff,
          closed: performance.closed,
          observedAt,
        };
        return this.db.scoring.outcome.upsert({
          where: {
            subjectType_subjectId: { subjectType: 'LOAN', subjectId: loan.id },
          },
          create: { subjectType: 'LOAN', subjectId: loan.id, ...data },
          update: data,
        });
      }),
      ...presentations.map((row) => {
        const data = {
          userId: row.userId,
          originationMonth: row.decidedAt
            ? monthOf(dayOf(row.decidedAt))
            : null,
          productCode: row.productId,
          // A withdrawn case has no decision from the institution.
          approved:
            row.status === 'DESISTIDA' ? null : row.status === 'APROBADA',
          amountCOP: row.approvedAmountCOP,
          observedAt,
        };
        return this.db.scoring.outcome.upsert({
          where: {
            subjectType_subjectId: {
              subjectType: 'PRESENTATION',
              subjectId: row.id,
            },
          },
          create: { subjectType: 'PRESENTATION', subjectId: row.id, ...data },
          update: data,
        });
      }),
    ];
    for (let index = 0; index < writes.length; index += 200)
      await this.db.scoring.$transaction(writes.slice(index, index + 200));
    return {
      observedAt,
      loans: loans.length,
      presentations: presentations.length,
    };
  }

  async createBacktest(actor: AuthenticatedUser, body: unknown) {
    const input = parseInput(backtestSchema, body);
    let rules: EngineRule[];
    let productId = input.productId ?? null;
    let policy: { id: string; version: number; productName: string } | null =
      null;
    if (input.policyVersionId) {
      const version = await this.db.scoring.policyVersion.findUnique({
        where: { id: input.policyVersionId },
        include: {
          rules: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
          product: { select: { name: true } },
        },
      });
      if (!version) throw new NotFoundException('Versión no encontrada.');
      rules = this.policies.engineRules(version.rules);
      productId = version.productId;
      policy = {
        id: version.id,
        version: version.version,
        productName: version.product.name,
      };
    } else {
      rules = (input.rules ?? []).map((rule, index) => ({
        id: `rule-${index + 1}`,
        position: index + 1,
        ...rule,
      }));
    }
    if (rules.length === 0)
      throw new BadRequestException({
        code: 'validation_error',
        message: 'La política no tiene reglas para evaluar.',
      });

    const now = new Date();
    const from = input.from ? new Date(`${input.from}T00:00:00-05:00`) : null;
    const to = input.to ? new Date(`${input.to}T23:59:59.999-05:00`) : now;
    const outcomes = await this.syncOutcomes();
    const runs = await this.db.scoring.matchRun.findMany({
      where: { createdAt: { ...(from ? { gte: from } : {}), lte: to } },
      orderBy: { createdAt: 'desc' },
      take: BACKTEST_SNAPSHOT_LIMIT + 1,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        factsCiphertext: true,
        results: {
          where: { productId: productId ?? undefined },
          select: { productId: true, status: true },
        },
      },
    });
    const truncated = runs.length > BACKTEST_SNAPSHOT_LIMIT;
    const seen = new Set<string>();
    const selected = runs.slice(0, BACKTEST_SNAPSHOT_LIMIT).filter((run) => {
      if (input.snapshots === 'ALL') return true;
      if (seen.has(run.userId)) return false;
      seen.add(run.userId);
      return true;
    });
    const userIds = [...new Set(selected.map((run) => run.userId))];
    const observed = userIds.length
      ? await this.db.scoring.outcome.findMany({
          where: { userId: { in: userIds } },
          orderBy: { observedAt: 'asc' },
        })
      : [];

    let unreadable = 0;
    const cases: BacktestCase[] = [];
    for (const run of selected) {
      let snapshot: ReturnType<typeof parseSnapshot> = null;
      try {
        snapshot = parseSnapshot(this.crypto.decrypt(run.factsCiphertext));
      } catch {
        snapshot = null;
      }
      if (!snapshot) {
        unreadable += 1;
        continue;
      }
      const snapshotMonth = monthOf(dayOf(run.createdAt));
      const mine = observed.filter((item) => item.userId === run.userId);
      const decisions = mine.filter(
        (item) =>
          item.subjectType === 'PRESENTATION' &&
          item.approved !== null &&
          (!productId || item.productCode === productId),
      );
      const loans = mine.filter(
        (item) =>
          item.subjectType === 'LOAN' &&
          (input.loanWindow === 'ANY' ||
            (item.originationMonth ?? '') >= snapshotMonth),
      );
      cases.push({
        userId: run.userId,
        facts: snapshot.facts,
        recordedStatus: productId
          ? ((run.results[0]?.status as MatchStatusName | undefined) ?? null)
          : null,
        approved: decisions.length ? decisions.at(-1)!.approved : null,
        maxDaysPastDue: loans.length
          ? Math.max(...loans.map((item) => item.maxDaysPastDue))
          : null,
      });
    }

    const result = runBacktest(cases, rules, {
      delinquencyDays: input.delinquencyDays,
    });
    const params = {
      kind: input.policyVersionId ? 'POLICY_VERSION' : 'RULE_SET',
      policyVersionId: input.policyVersionId ?? null,
      productId,
      from: from?.toISOString() ?? null,
      to: to.toISOString(),
      snapshots: input.snapshots,
      delinquencyDays: input.delinquencyDays,
      loanWindow: input.loanWindow,
      snapshotLimit: BACKTEST_SNAPSHOT_LIMIT,
    };
    const stored = {
      ...result,
      coverage: {
        snapshotsInWindow: Math.min(runs.length, BACKTEST_SNAPSHOT_LIMIT),
        snapshotsSelected: selected.length,
        unreadableSnapshots: unreadable,
        truncated,
      },
      outcomesObservedAt: outcomes.observedAt.toISOString(),
    };
    const saved = await this.db.scoring.backtestRun.create({
      data: {
        kind: input.policyVersionId ? 'POLICY_VERSION' : 'RULE_SET',
        label:
          input.label ??
          (policy
            ? `${policy.productName} · versión ${policy.version}`
            : `Reglas de elegibilidad (${rules.length})`),
        policyVersionId: input.policyVersionId ?? null,
        params: params as object,
        paramsHash: this.crypto.hash(canonicalJson({ params, rules })),
        rulesSnapshot: rules as unknown as object[],
        engineVersion: MATCH_ENGINE_VERSION,
        snapshotsEvaluated: cases.length,
        result: stored as unknown as object,
        createdBy: actor.id,
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'analytics.backtest.created',
      resource: 'BacktestRun',
      resourceId: saved.id,
      payload: {
        ...params,
        rules: rules.length,
        snapshotsEvaluated: cases.length,
        paramsHash: saved.paramsHash,
      },
    });
    return this.backtest(saved.id);
  }

  async backtests(pageInput?: string) {
    const page = pageNumber(pageInput);
    const [rows, total] = await Promise.all([
      this.db.scoring.backtestRun.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.backtestRun.count(),
    ]);
    const names = await this.names(rows.map((row) => row.createdBy));
    return paginated(
      rows.map((row) => {
        const result = row.result as {
          eligibleRate?: number | null;
          predicted?: Record<string, number>;
        };
        return {
          id: row.id,
          kind: row.kind,
          label: row.label,
          policyVersionId: row.policyVersionId,
          engineVersion: row.engineVersion,
          snapshotsEvaluated: row.snapshotsEvaluated,
          eligibleRate: result.eligibleRate ?? null,
          predicted: result.predicted ?? null,
          createdBy: row.createdBy,
          createdByName: names.get(row.createdBy) ?? null,
          createdAt: row.createdAt,
        };
      }),
      total,
      page,
    );
  }

  async backtest(id: string) {
    const row = await this.db.scoring.backtestRun.findUnique({
      where: { id: parseId(id, 'Backtest no encontrado.') },
    });
    if (!row) throw new NotFoundException('Backtest no encontrado.');
    const names = await this.names([row.createdBy]);
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      policyVersionId: row.policyVersionId,
      engineVersion: row.engineVersion,
      params: row.params,
      paramsHash: row.paramsHash,
      rules: row.rulesSnapshot,
      snapshotsEvaluated: row.snapshotsEvaluated,
      result: row.result,
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) ?? null,
      createdAt: row.createdAt,
    };
  }

  private async names(ids: readonly string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, string>();
    const users = await this.db.identity.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
