/** Formas reales de `/api/admin/analytics/*`. Las tasas son fracciones (0.12 = 12 %) o `null` sin denominador. */

export type CohortGroup = "month" | "product" | "category" | "archetype";

export interface CohortMetrics {
  loans: number;
  borrowers: number;
  originatedCOP: number;
  outstandingCOP: number;
  activeLoans: number;
  closedLoans: number;
  prepaidLoans: number;
  capitalPrepayments: number;
  capitalPrepaidCOP: number;
  defaultedLoans: number;
  writtenOffLoans: number;
  writtenOffCOP: number;
  installments: { due: number; paidOnTime: number; paidLate: number; overdueUnpaid: number; prepaid: number; onTimeRate: number | null };
  delinquency: { current30: number; current60: number; current90: number; ever30: number; ever60: number; ever90: number; currentRate30: number | null; everRate30: number | null; everRate60: number | null; everRate90: number | null };
}
export interface MobPoint { mob: number; observedOn: string; loans: number; dpd30: number; dpd60: number; dpd90: number; rate30: number | null; rate60: number | null; rate90: number | null; balanceCOP: number; balance30COP: number; portfolioAtRisk30: number | null }
export interface Cohort extends CohortMetrics { originationMonth: string; groupBy: CohortGroup; dimensionValue: string; monthsOnBooks: MobPoint[] }

export interface CohortsResponse {
  asOf: string;
  groupBy: CohortGroup;
  cohorts: Cohort[];
  totals: CohortMetrics;
  from: string | null;
  to: string | null;
  generatedAt: string;
  analyticsVersion: string;
  availability: { product: boolean; category: boolean; archetype: boolean };
  definitions: Record<string, string>;
}
export interface CohortSnapshot { id: string; asOf: string; groupBy: CohortGroup; originationMonth: string; dimensionValue: string; analyticsVersion: string; metrics: Cohort; createdAt: string }

export interface ScoreCohort { cohortMonth: string; users: number; withInitial: number; withFinal: number; withBoth: number; averageInitial: number | null; averageFinal: number | null; averageDelta: number | null; medianDelta: number | null; improved: number; unchanged: number; declined: number }
export interface Effectiveness {
  users: number;
  score: { overall: ScoreCohort; cohorts: ScoreCohort[] };
  lessons: { buckets: Array<{ key: string; label: string; users: number; loans: number; installmentsDue: number; installmentsOnTime: number; onTimeRate: number | null; ever30: number; ever30Rate: number | null }> };
  archetypeStability: { usersWithHistory: number; stable: number; changed: number; stabilityRate: number | null; averageChanges: number | null; transitions: Array<{ from: string; to: string; count: number }> };
  note: string;
  from: string | null;
  to: string | null;
  asOf: string;
  generatedAt: string;
  analyticsVersion: string;
}

export interface BacktestResult {
  evaluated: number;
  users: number;
  predicted: { ELEGIBLE: number; CON_BRECHAS: number; EXCLUIDO: number };
  eligibleRate: number | null;
  averageFitPercent: number | null;
  approval: { withDecision: number; eligibleApproved: number; eligibleRejected: number; notEligibleApproved: number; notEligibleRejected: number; agreementRate: number | null; approvalRateEligible: number | null; approvalRateNotEligible: number | null };
  delinquency: { thresholdDays: number; withLoan: number; eligible: { loans: number; delinquent: number; rate: number | null }; notEligible: { loans: number; delinquent: number; rate: number | null } };
  versusRecorded: { compared: number; unchanged: number; nowEligible: number; noLongerEligible: number };
  topGaps: Array<{ ruleId: string; label: string; field: string | null; fieldLabel: string | null; notMet: number; missingData: number }>;
  topExclusions: Array<{ ruleId: string; label: string; field: string | null; fieldLabel: string | null; excluded: number }>;
  coverage: { snapshotsInWindow: number; snapshotsSelected: number; unreadableSnapshots: number; truncated: boolean };
  outcomesObservedAt: string;
}
export interface BacktestRow { id: string; kind: "POLICY_VERSION" | "RULE_SET"; label: string | null; policyVersionId: string | null; engineVersion: string; snapshotsEvaluated: number; eligibleRate: number | null; predicted: BacktestResult["predicted"]; createdBy: string | null; createdByName: string | null; createdAt: string }
export interface Backtest extends Omit<BacktestRow, "eligibleRate" | "predicted"> { params: Record<string, unknown>; paramsHash: string; rules: Array<{ field: string; operator: string; value: unknown; kind: string; weight: number; label: string }>; result: BacktestResult }

export const GROUP_LABEL: Record<CohortGroup, string> = { month: "Mes de originación", product: "Producto", category: "Categoría", archetype: "Arquetipo" };
export const dimensionLabel = (value: string) => (value === "TODOS" ? "Todos" : value === "SIN_DATO" ? "Sin dato" : value);
