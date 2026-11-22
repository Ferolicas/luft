import { factField, type Facts } from '../matching/fact-catalog';
import {
  evaluatePolicy,
  type EngineRule,
  type MatchStatusName,
} from '../matching/rule-engine';
import { ratio } from './cohorts';

/**
 * Pure backtest: re-executes a rule set over historical fact snapshots and
 * compares the outcome with what really happened (institution decisions and
 * loan delinquency). Deterministic: same cases + same rules → same result.
 */

export const DELINQUENCY_THRESHOLDS = [30, 60, 90] as const;
export type DelinquencyThreshold = (typeof DELINQUENCY_THRESHOLDS)[number];

export interface BacktestCase {
  userId: string;
  /** Facts of the historical snapshot. */
  facts: Facts;
  /** Status recorded at the time for the same product, when there was one. */
  recordedStatus: MatchStatusName | null;
  /** Real decision of the institution: true approved, false rejected. */
  approved: boolean | null;
  /** Worst days past due observed on the person's loans; `null` without loans. */
  maxDaysPastDue: number | null;
}

export interface BacktestResult {
  evaluated: number;
  users: number;
  predicted: Record<MatchStatusName, number>;
  eligibleRate: number | null;
  averageFitPercent: number | null;
  approval: {
    withDecision: number;
    eligibleApproved: number;
    eligibleRejected: number;
    notEligibleApproved: number;
    notEligibleRejected: number;
    agreementRate: number | null;
    approvalRateEligible: number | null;
    approvalRateNotEligible: number | null;
  };
  delinquency: {
    thresholdDays: DelinquencyThreshold;
    withLoan: number;
    eligible: { loans: number; delinquent: number; rate: number | null };
    notEligible: { loans: number; delinquent: number; rate: number | null };
  };
  versusRecorded: {
    compared: number;
    unchanged: number;
    nowEligible: number;
    noLongerEligible: number;
  };
  topGaps: Array<{
    ruleId: string;
    label: string;
    field: string;
    fieldLabel: string;
    notMet: number;
    missingData: number;
  }>;
  topExclusions: Array<{
    ruleId: string;
    label: string;
    field: string;
    fieldLabel: string;
    excluded: number;
  }>;
}

export function runBacktest(
  cases: readonly BacktestCase[],
  rules: readonly EngineRule[],
  options: { delinquencyDays?: DelinquencyThreshold } = {},
): BacktestResult {
  const thresholdDays = options.delinquencyDays ?? 30;
  const predicted: Record<MatchStatusName, number> = {
    ELEGIBLE: 0,
    CON_BRECHAS: 0,
    EXCLUIDO: 0,
  };
  const approval = {
    eligibleApproved: 0,
    eligibleRejected: 0,
    notEligibleApproved: 0,
    notEligibleRejected: 0,
  };
  const loans = {
    eligible: { loans: 0, delinquent: 0 },
    notEligible: { loans: 0, delinquent: 0 },
  };
  const recorded = {
    compared: 0,
    unchanged: 0,
    nowEligible: 0,
    noLongerEligible: 0,
  };
  const gaps = new Map<string, { notMet: number; missingData: number }>();
  const exclusions = new Map<string, number>();
  let fitTotal = 0;

  for (const item of cases) {
    const evaluation = evaluatePolicy(item.facts, rules);
    const eligible = evaluation.status === 'ELEGIBLE';
    predicted[evaluation.status] += 1;
    fitTotal += evaluation.fitPercent;

    if (item.approved !== null) {
      if (eligible && item.approved) approval.eligibleApproved += 1;
      else if (eligible) approval.eligibleRejected += 1;
      else if (item.approved) approval.notEligibleApproved += 1;
      else approval.notEligibleRejected += 1;
    }
    if (item.maxDaysPastDue !== null) {
      const bucket = eligible ? loans.eligible : loans.notEligible;
      bucket.loans += 1;
      if (item.maxDaysPastDue >= thresholdDays) bucket.delinquent += 1;
    }
    if (item.recordedStatus !== null) {
      const was = item.recordedStatus === 'ELEGIBLE';
      recorded.compared += 1;
      if (was === eligible) recorded.unchanged += 1;
      else if (eligible) recorded.nowEligible += 1;
      else recorded.noLongerEligible += 1;
    }
    for (const gap of evaluation.gaps) {
      if (!gap.blocking) continue;
      const entry = gaps.get(gap.ruleId) ?? { notMet: 0, missingData: 0 };
      if (gap.outcome === 'DATO_FALTANTE') entry.missingData += 1;
      else entry.notMet += 1;
      gaps.set(gap.ruleId, entry);
    }
    for (const exclusion of evaluation.exclusions)
      exclusions.set(
        exclusion.ruleId,
        (exclusions.get(exclusion.ruleId) ?? 0) + 1,
      );
  }

  const describe = (ruleId: string) => {
    const rule = rules.find((item) => item.id === ruleId);
    return {
      ruleId,
      label: rule?.label ?? ruleId,
      field: rule?.field ?? '',
      fieldLabel: factField(rule?.field ?? '')?.label ?? rule?.field ?? '',
    };
  };
  const withDecision =
    approval.eligibleApproved +
    approval.eligibleRejected +
    approval.notEligibleApproved +
    approval.notEligibleRejected;
  const rate = (bucket: { loans: number; delinquent: number }) => ({
    ...bucket,
    rate: ratio(bucket.delinquent, bucket.loans),
  });

  return {
    evaluated: cases.length,
    users: new Set(cases.map((item) => item.userId)).size,
    predicted,
    eligibleRate: ratio(predicted.ELEGIBLE, cases.length),
    averageFitPercent: cases.length
      ? Math.round((fitTotal / cases.length) * 100) / 100
      : null,
    approval: {
      withDecision,
      ...approval,
      agreementRate: ratio(
        approval.eligibleApproved + approval.notEligibleRejected,
        withDecision,
      ),
      approvalRateEligible: ratio(
        approval.eligibleApproved,
        approval.eligibleApproved + approval.eligibleRejected,
      ),
      approvalRateNotEligible: ratio(
        approval.notEligibleApproved,
        approval.notEligibleApproved + approval.notEligibleRejected,
      ),
    },
    delinquency: {
      thresholdDays,
      withLoan: loans.eligible.loans + loans.notEligible.loans,
      eligible: rate(loans.eligible),
      notEligible: rate(loans.notEligible),
    },
    versusRecorded: recorded,
    topGaps: [...gaps.entries()]
      .map(([ruleId, entry]) => ({ ...describe(ruleId), ...entry }))
      .sort(
        (a, b) =>
          b.notMet + b.missingData - (a.notMet + a.missingData) ||
          (a.ruleId < b.ruleId ? -1 : 1),
      )
      .slice(0, 10),
    topExclusions: [...exclusions.entries()]
      .map(([ruleId, excluded]) => ({ ...describe(ruleId), excluded }))
      .sort((a, b) => b.excluded - a.excluded || (a.ruleId < b.ruleId ? -1 : 1))
      .slice(0, 10),
  };
}
