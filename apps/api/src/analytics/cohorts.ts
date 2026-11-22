/**
 * Pure vintage ("cosecha") analytics over STARTIF loans. Nothing here touches
 * the database: the service loads loans, installments and segments and these
 * functions only compute. With no data every function returns empty, valid
 * structures.
 */

export const ANALYTICS_VERSION = 'analytics-2026.11';

/** An installment paid at least this many days before it is due is a prepayment. */
export const PREPAYMENT_DAYS = 15;
export const MAX_MONTHS_ON_BOOKS = 36;
export const UNKNOWN_DIMENSION = 'SIN_DATO';

/** Loan status that means the balance was written off ("castigo"). */
const WRITTEN_OFF = 'WRITTEN_OFF';
/** Loan status for a declared default ("incumplimiento"), before a write-off. */
const DEFAULTED = 'DEFAULTED';
const CLOSED = new Set(['COMPLETED', 'CLOSED', 'PAID']);

export interface InstallmentInput {
  sequence: number;
  dueDate: Date | string;
  principalCOP: number;
  status: string;
  paidAt: Date | string | null;
}

export interface LoanInput {
  id: string;
  userId: string;
  /** Disbursement date, or creation date when it was not recorded. */
  originatedAt: Date | string;
  principalCOP: number;
  status: string;
  productCode: string | null;
  category: string | null;
  archetype: string | null;
  /** Dates STARTIF records when it declares a default / writes a loan off. */
  defaultedAt?: Date | string | null;
  writtenOffAt?: Date | string | null;
  /** Capital prepayments ("abonos anticipados") recorded by STARTIF. */
  capitalPrepayments?: { count: number; amountCOP: number };
  installments: InstallmentInput[];
}

export const COHORT_GROUPS = [
  'month',
  'product',
  'category',
  'archetype',
] as const;
export type CohortGroupBy = (typeof COHORT_GROUPS)[number];

const DAY_MS = 86_400_000;
const BOGOTA_OFFSET_MS = 5 * 3_600_000;

/** Calendar day in Colombia for a timestamp; date-only strings pass through. */
export function dayOf(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(date.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Due dates are stored as plain dates (UTC midnight): never shift them. */
export function dueDay(value: Date | string): string {
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

const dayNumber = (day: string) => Math.floor(Date.parse(day) / DAY_MS);
export const daysBetween = (from: string, to: string) =>
  dayNumber(to) - dayNumber(from);

export const monthOf = (day: string) => day.slice(0, 7);

/** Last calendar day of the month that is `offset` months after `month`. */
export function monthEnd(month: string, offset = 0): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + offset + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export const ratio = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;

const paidDay = (row: InstallmentInput): string | null => {
  if (row.paidAt) return dayOf(row.paidAt);
  // A settled installment without a timestamp is taken as paid when due.
  return row.status === 'PAID' ? dueDay(row.dueDate) : null;
};
const waived = (row: InstallmentInput) => row.status === 'WAIVED';

/** Unpaid as of the END of `day` (a payment made that day counts as paid). */
const unpaidAt = (row: InstallmentInput, day: string) => {
  if (waived(row)) return false;
  const paid = paidDay(row);
  return paid === null || paid > day;
};

/** Days past due of a loan at the end of `day`: age of its oldest unpaid due installment. */
export function daysPastDueAt(loan: LoanInput, day: string): number {
  let worst = 0;
  for (const row of loan.installments) {
    const due = dueDay(row.dueDate);
    if (due < day && unpaidAt(row, day))
      worst = Math.max(worst, daysBetween(due, day));
  }
  return worst;
}

/** Principal still owed at the end of `day`. */
export function balanceAt(loan: LoanInput, day: string): number {
  return loan.installments
    .filter((row) => unpaidAt(row, day))
    .reduce((sum, row) => sum + row.principalCOP, 0);
}

/**
 * A dated event counts from its date; without a date the current status is
 * the only evidence and is taken as already true.
 */
const flagged = (
  at: Date | string | null | undefined,
  byStatus: boolean,
  asOf: string,
) => (at ? dayOf(at) <= asOf : byStatus);

export interface LoanPerformance {
  maxDaysPastDue: number;
  currentDaysPastDue: number;
  everDpd30: boolean;
  everDpd60: boolean;
  everDpd90: boolean;
  installmentsDue: number;
  installmentsOnTime: number;
  installmentsLate: number;
  installmentsOverdue: number;
  installmentsPrepaid: number;
  defaulted: boolean;
  writtenOff: boolean;
  closed: boolean;
  prepaidLoan: boolean;
}

/** Behaviour of one loan observed at the end of `asOf`. */
export function loanPerformance(
  loan: LoanInput,
  asOf: string,
): LoanPerformance {
  let maxDaysPastDue = 0;
  let due = 0;
  let onTime = 0;
  let late = 0;
  let overdue = 0;
  let prepaid = 0;
  let lastDue = '';
  let lastPaid = '';
  let allPaid = loan.installments.length > 0;
  for (const row of loan.installments) {
    if (waived(row)) continue;
    const dueOn = dueDay(row.dueDate);
    const paid = paidDay(row);
    const paidByNow = paid !== null && paid <= asOf;
    if (dueOn > lastDue) lastDue = dueOn;
    if (!paidByNow) allPaid = false;
    else if (paid > lastPaid) lastPaid = paid;
    if (paidByNow && daysBetween(paid, dueOn) >= PREPAYMENT_DAYS) prepaid += 1;
    if (dueOn > asOf) continue;
    due += 1;
    if (paidByNow && paid <= dueOn) onTime += 1;
    else {
      // Lateness peaks the day it is finally paid, or today if still unpaid.
      const until = paidByNow ? paid : asOf;
      maxDaysPastDue = Math.max(maxDaysPastDue, daysBetween(dueOn, until));
      if (paidByNow) late += 1;
      else if (dueOn < asOf) overdue += 1;
    }
  }
  return {
    maxDaysPastDue,
    currentDaysPastDue: daysPastDueAt(loan, asOf),
    everDpd30: maxDaysPastDue >= 30,
    everDpd60: maxDaysPastDue >= 60,
    everDpd90: maxDaysPastDue >= 90,
    installmentsDue: due,
    installmentsOnTime: onTime,
    installmentsLate: late,
    installmentsOverdue: overdue,
    installmentsPrepaid: prepaid,
    defaulted: flagged(loan.defaultedAt, loan.status === DEFAULTED, asOf),
    writtenOff: flagged(loan.writtenOffAt, loan.status === WRITTEN_OFF, asOf),
    closed: allPaid || CLOSED.has(loan.status),
    prepaidLoan:
      allPaid &&
      Boolean(lastDue) &&
      daysBetween(lastPaid, lastDue) >= PREPAYMENT_DAYS,
  };
}

export interface MonthOnBooks {
  mob: number;
  observedOn: string;
  loans: number;
  dpd30: number;
  dpd60: number;
  dpd90: number;
  rate30: number | null;
  rate60: number | null;
  rate90: number | null;
  balanceCOP: number;
  balance30COP: number;
  portfolioAtRisk30: number | null;
}

export interface CohortMetrics {
  originationMonth: string;
  groupBy: CohortGroupBy;
  dimensionValue: string;
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
  installments: {
    due: number;
    paidOnTime: number;
    paidLate: number;
    overdueUnpaid: number;
    prepaid: number;
    onTimeRate: number | null;
  };
  delinquency: {
    current30: number;
    current60: number;
    current90: number;
    ever30: number;
    ever60: number;
    ever90: number;
    currentRate30: number | null;
    everRate30: number | null;
    everRate60: number | null;
    everRate90: number | null;
  };
  monthsOnBooks: MonthOnBooks[];
}

const dimensionOf = (loan: LoanInput, groupBy: CohortGroupBy): string => {
  if (groupBy === 'month') return 'TODOS';
  const value =
    groupBy === 'product'
      ? loan.productCode
      : groupBy === 'category'
        ? loan.category
        : loan.archetype;
  // '|' separates month and dimension in the grouping key.
  return value?.trim().replaceAll('|', '/') || UNKNOWN_DIMENSION;
};

function cohortMetrics(
  originationMonth: string,
  groupBy: CohortGroupBy,
  dimensionValue: string,
  loans: LoanInput[],
  asOf: string,
): CohortMetrics {
  const performance = loans.map((loan) => loanPerformance(loan, asOf));
  const sum = (pick: (item: LoanPerformance) => number) =>
    performance.reduce((total, item) => total + pick(item), 0);
  const count = (test: (item: LoanPerformance) => boolean) =>
    performance.filter(test).length;
  const due = sum((item) => item.installmentsDue);
  const onTime = sum((item) => item.installmentsOnTime);

  const monthsOnBooks: MonthOnBooks[] = [];
  for (let mob = 1; mob <= MAX_MONTHS_ON_BOOKS; mob += 1) {
    const observedOn = monthEnd(originationMonth, mob);
    if (observedOn > asOf) break;
    const dpd = loans.map((loan) => daysPastDueAt(loan, observedOn));
    const balances = loans.map((loan) => balanceAt(loan, observedOn));
    const balanceCOP = balances.reduce((total, value) => total + value, 0);
    const balance30COP = balances.reduce(
      (total, value, index) => total + (dpd[index] >= 30 ? value : 0),
      0,
    );
    const over = (days: number) => dpd.filter((value) => value >= days).length;
    monthsOnBooks.push({
      mob,
      observedOn,
      loans: loans.length,
      dpd30: over(30),
      dpd60: over(60),
      dpd90: over(90),
      rate30: ratio(over(30), loans.length),
      rate60: ratio(over(60), loans.length),
      rate90: ratio(over(90), loans.length),
      balanceCOP,
      balance30COP,
      portfolioAtRisk30: ratio(balance30COP, balanceCOP),
    });
  }

  const writtenOff = loans.filter((_, index) => performance[index].writtenOff);
  return {
    originationMonth,
    groupBy,
    dimensionValue,
    loans: loans.length,
    borrowers: new Set(loans.map((loan) => loan.userId)).size,
    originatedCOP: loans.reduce((total, loan) => total + loan.principalCOP, 0),
    outstandingCOP: loans.reduce(
      (total, loan) => total + balanceAt(loan, asOf),
      0,
    ),
    activeLoans: count((item) => !item.closed && !item.writtenOff),
    closedLoans: count((item) => item.closed),
    prepaidLoans: count((item) => item.prepaidLoan),
    capitalPrepayments: loans.reduce(
      (total, loan) => total + (loan.capitalPrepayments?.count ?? 0),
      0,
    ),
    capitalPrepaidCOP: loans.reduce(
      (total, loan) => total + (loan.capitalPrepayments?.amountCOP ?? 0),
      0,
    ),
    defaultedLoans: count((item) => item.defaulted && !item.writtenOff),
    writtenOffLoans: writtenOff.length,
    writtenOffCOP: writtenOff.reduce(
      (total, loan) => total + balanceAt(loan, asOf),
      0,
    ),
    installments: {
      due,
      paidOnTime: onTime,
      paidLate: sum((item) => item.installmentsLate),
      overdueUnpaid: sum((item) => item.installmentsOverdue),
      prepaid: sum((item) => item.installmentsPrepaid),
      onTimeRate: ratio(onTime, due),
    },
    delinquency: {
      current30: count((item) => item.currentDaysPastDue >= 30),
      current60: count((item) => item.currentDaysPastDue >= 60),
      current90: count((item) => item.currentDaysPastDue >= 90),
      ever30: count((item) => item.everDpd30),
      ever60: count((item) => item.everDpd60),
      ever90: count((item) => item.everDpd90),
      currentRate30: ratio(
        count((item) => item.currentDaysPastDue >= 30),
        loans.length,
      ),
      everRate30: ratio(
        count((item) => item.everDpd30),
        loans.length,
      ),
      everRate60: ratio(
        count((item) => item.everDpd60),
        loans.length,
      ),
      everRate90: ratio(
        count((item) => item.everDpd90),
        loans.length,
      ),
    },
    monthsOnBooks,
  };
}

export interface CohortReport {
  asOf: string;
  groupBy: CohortGroupBy;
  cohorts: CohortMetrics[];
  totals: Omit<
    CohortMetrics,
    'originationMonth' | 'groupBy' | 'dimensionValue' | 'monthsOnBooks'
  >;
}

/**
 * Vintages by origination month, optionally split by product, category or
 * archetype. Loans originated after `asOf` are ignored.
 */
export function computeCohorts(
  loans: readonly LoanInput[],
  options: { asOf: string; groupBy?: CohortGroupBy },
): CohortReport {
  const groupBy = options.groupBy ?? 'month';
  const groups = new Map<string, LoanInput[]>();
  const included: LoanInput[] = [];
  for (const loan of loans) {
    const originated = dayOf(loan.originatedAt);
    if (originated > options.asOf) continue;
    included.push(loan);
    const key = `${monthOf(originated)}|${dimensionOf(loan, groupBy)}`;
    groups.set(key, [...(groups.get(key) ?? []), loan]);
  }
  const cohorts = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, members]) => {
      const [month, value] = key.split('|');
      return cohortMetrics(month, groupBy, value, members, options.asOf);
    });
  return {
    asOf: options.asOf,
    groupBy,
    cohorts,
    // Portfolio totals have no single origination month, hence no MOB curve.
    totals: totalsOf(
      cohortMetrics('9999-12', groupBy, 'TODOS', included, options.asOf),
    ),
  };
}

function totalsOf(metrics: CohortMetrics): CohortReport['totals'] {
  const {
    originationMonth: _month,
    groupBy: _group,
    dimensionValue: _value,
    monthsOnBooks: _mob,
    ...rest
  } = metrics;
  void _month;
  void _group;
  void _value;
  void _mob;
  return rest;
}
