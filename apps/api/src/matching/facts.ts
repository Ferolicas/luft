import { z } from 'zod';
import { FACT_KEYS, type Facts, type FactValue } from './fact-catalog';

/**
 * Pure fact builder: turns what LUFT knows about a person into the flat fact
 * set the policy engine evaluates. A fact that cannot be established is
 * `null` ("unknown") and the engine never counts it as met.
 */

/** Loose view of the financial context saved by the LUFT journey. */
export interface ProfileContext {
  employment?: { situation?: unknown; contractType?: unknown };
  income?: { sources?: unknown };
  debts?: {
    cardSpendMonthlyCOP?: unknown;
    totalDebtCOP?: unknown;
    fixedExpensesMonthlyCOP?: unknown;
  };
  recurring?: { socialSecurity?: unknown };
}

/**
 * What the profile source provides about one person. This is the extension
 * point for the category catalog: when LUFT publishes categories and
 * versioned archetypes, only the profile source changes — the fact builder,
 * the engine and the stored policies stay the same.
 */
export interface ProfileSignals {
  /** Service category code (JOVEN, ADULTO, FAMILIA…). `null` while unknown. */
  category: string | null;
  archetype: string | null;
  primaryGoal: string | null;
  /** Section keys of the financial profile that are complete. */
  completedSections: string[];
  context: ProfileContext;
  /** Kinds of the documents already uploaded. */
  documents: string[];
  /**
   * Tax orientation: `true` = possible filing obligation, `false` = no alert,
   * `null` = not enough data. It is an alert, never a determination.
   */
  taxAlert: boolean | null;
}

export const supplementSchema = z.object({
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  city: z.string().trim().min(2).max(80).nullable().optional(),
  department: z.string().trim().min(2).max(80).nullable().optional(),
  activityStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type Supplement = z.infer<typeof supplementSchema>;

export interface InstallmentFact {
  dueDate: Date | string;
  status: string;
  paidAt: Date | string | null;
}

export interface FactSources {
  /** Moment of the evaluation (kept in the snapshot). */
  asOf: Date;
  /** Business day (America/Bogota, YYYY-MM-DD) used for ages and arrears. */
  today: string;
  stratum: number | null;
  profile: ProfileSignals;
  supplement: Supplement | null;
  bureau: { score: number | null; hasHistory: boolean | null };
  installments: InstallmentFact[];
  request: { amountCOP: number | null; termMonths: number | null };
}

const SETTLED = new Set(['PAID', 'WAIVED']);
const DAY_MS = 86_400_000;

const isoDay = (value: Date | string) =>
  (typeof value === 'string' ? new Date(value) : value)
    .toISOString()
    .slice(0, 10);
const dayNumber = (day: string) => Math.floor(Date.parse(day) / DAY_MS);

const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function validDay(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) || isoDay(new Date(time)) !== value ? null : value;
}

/** Whole years between two ISO days. */
export function fullYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

/** Whole months between two ISO days. */
export function fullMonths(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

function incomeFacts(context: ProfileContext) {
  const raw = context.income?.sources;
  if (!Array.isArray(raw)) return null;
  const sources = raw.flatMap((row: any) => {
    const kind = text(row?.kind);
    const monthly = amount(row?.monthlyCOP);
    return kind && monthly !== null ? [{ kind, monthly }] : [];
  });
  if (sources.length === 0) return null;
  const positive = sources.filter((row) => row.monthly > 0);
  const top = [...positive].sort(
    (a, b) => b.monthly - a.monthly || (a.kind < b.kind ? -1 : 1),
  )[0];
  return {
    monthly: sources.reduce((sum, row) => sum + row.monthly, 0),
    kinds: [...new Set(positive.map((row) => row.kind))].sort(),
    primary: top?.kind ?? null,
  };
}

/** Upper bound used when there is debt and no income (never a met ratio). */
export const DEBT_RATIO_CAP = 99;

export function buildFacts(source: FactSources): {
  facts: Facts;
  provenance: Record<string, string>;
} {
  const { profile, supplement, today } = source;
  const context = profile.context ?? {};
  const income = incomeFacts(context);
  const totalDebt = amount(context.debts?.totalDebtCOP);
  const fixed = amount(context.debts?.fixedExpensesMonthlyCOP);
  const card = amount(context.debts?.cardSpendMonthlyCOP);

  let debtRatio: number | null = null;
  if (income && totalDebt !== null) {
    if (totalDebt === 0) debtRatio = 0;
    else if (income.monthly === 0) debtRatio = DEBT_RATIO_CAP;
    else
      debtRatio = Math.min(
        DEBT_RATIO_CAP,
        Math.round((totalDebt / (income.monthly * 12)) * 10_000) / 10_000,
      );
  }
  const capacity =
    income && fixed !== null && card !== null
      ? Math.max(0, income.monthly - fixed - card)
      : null;

  const overdueDays = source.installments
    .filter((row) => !SETTLED.has(row.status) && isoDay(row.dueDate) < today)
    .map((row) => dayNumber(today) - dayNumber(isoDay(row.dueDate)));
  const onTime = source.installments.filter(
    (row) =>
      row.status === 'PAID' &&
      row.paidAt !== null &&
      isoDay(row.paidAt) <= isoDay(row.dueDate),
  ).length;

  const birth = validDay(supplement?.birthDate);
  const started = validDay(supplement?.activityStartDate);
  const documents = [...new Set(profile.documents)].sort();
  const taxFormalization = documents.includes('TAX_RETURN')
    ? 'DECLARACION_CARGADA'
    : profile.taxAlert === null
      ? null
      : profile.taxAlert
        ? 'ALERTA_SIN_SOPORTE'
        : 'SIN_ALERTA';

  const values: Record<string, FactValue> = {
    category: text(profile.category),
    archetype: text(profile.archetype),
    primaryGoal: text(profile.primaryGoal),
    ageYears: birth && birth <= today ? fullYears(birth, today) : null,
    city: text(supplement?.city),
    department: text(supplement?.department),
    stratum:
      typeof source.stratum === 'number' && Number.isInteger(source.stratum)
        ? source.stratum
        : null,
    monthlyIncomeCOP: income?.monthly ?? null,
    incomeSources: income ? income.kinds : null,
    primaryIncomeSource: income?.primary ?? null,
    employmentSituation: text(context.employment?.situation),
    contractType: text(context.employment?.contractType),
    tenureMonths:
      started && started <= today ? fullMonths(started, today) : null,
    score:
      typeof source.bureau.score === 'number' &&
      Number.isFinite(source.bureau.score)
        ? source.bureau.score
        : null,
    hasCreditHistory: source.bureau.hasHistory,
    onTimeInstallments: onTime,
    currentArrears: overdueDays.length > 0,
    maxDaysPastDue: overdueDays.length ? Math.max(...overdueDays) : 0,
    debtToIncomeRatio: debtRatio,
    availableCapacityCOP: capacity,
    requestedAmountCOP: source.request.amountCOP,
    requestedTermMonths: source.request.termMonths,
    documentsUploaded: documents,
    taxFormalization,
    socialSecurity: text(context.recurring?.socialSecurity),
  };

  const declared = new Set(['ageYears', 'city', 'department', 'tenureMonths']);
  const requested = new Set(['requestedAmountCOP', 'requestedTermMonths']);
  const facts: Facts = {};
  const provenance: Record<string, string> = {};
  for (const key of FACT_KEYS) {
    const value = values[key] ?? null;
    facts[key] = value;
    provenance[key] =
      value === null
        ? 'DESCONOCIDO'
        : declared.has(key)
          ? 'DECLARADO'
          : requested.has(key)
            ? 'SOLICITUD'
            : 'LUFT';
  }
  return { facts, provenance };
}

export interface FactSnapshot {
  schemaVersion: 1;
  asOf: string;
  today: string;
  facts: Facts;
  provenance: Record<string, string>;
}

export function snapshotOf(source: FactSources): FactSnapshot {
  return {
    schemaVersion: 1,
    asOf: source.asOf.toISOString(),
    today: source.today,
    ...buildFacts(source),
  };
}

/** Calendar day in Colombia (UTC-5, no daylight saving). */
export function businessDay(now: Date = new Date()): string {
  return new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Stable JSON (sorted keys) so the same facts always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function parseSnapshot(json: string): FactSnapshot | null {
  try {
    const value = JSON.parse(json) as FactSnapshot;
    return value &&
      typeof value === 'object' &&
      value.facts &&
      typeof value.facts === 'object'
      ? value
      : null;
  } catch {
    return null;
  }
}

export interface MissingRequirement {
  code: string;
  kind: 'CONSENT' | 'PROFILE';
  label: string;
  href: string;
}

/** Minimum the person must have before a matching can run. */
export function matchingRequirements(input: {
  dataConsentActive: boolean;
  archetype: string | null;
  completedSections: readonly string[];
}): MissingRequirement[] {
  const missing: MissingRequirement[] = [];
  if (!input.dataConsentActive)
    missing.push({
      code: 'DATA_PROCESSING',
      kind: 'CONSENT',
      label:
        'Necesitamos tu autorización vigente de tratamiento de datos para evaluar productos.',
      href: '/app/perfil/cuenta',
    });
  if (!input.archetype)
    missing.push({
      code: 'ARCHETYPE',
      kind: 'PROFILE',
      label: 'Completa tu diagnóstico inicial para conocer tu perfil.',
      href: '/app',
    });
  const sections: Array<[string, string, string]> = [
    [
      'employment',
      'Cuéntanos tu situación laboral.',
      '/app/perfil/financiero/trabajo',
    ],
    [
      'income',
      'Registra tus ingresos mensuales.',
      '/app/perfil/financiero/trabajo',
    ],
    [
      'debts',
      'Registra tus deudas y gastos fijos.',
      '/app/perfil/financiero/patrimonio',
    ],
  ];
  for (const [code, label, href] of sections)
    if (!input.completedSections.includes(code))
      missing.push({
        code: `SECTION_${code.toUpperCase()}`,
        kind: 'PROFILE',
        label,
        href,
      });
  return missing;
}
