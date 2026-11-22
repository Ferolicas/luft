import {
  balanceAt,
  computeCohorts,
  dayOf,
  daysPastDueAt,
  loanPerformance,
  monthEnd,
  PREPAYMENT_DAYS,
  UNKNOWN_DIMENSION,
  type InstallmentInput,
  type LoanInput,
} from './cohorts';

/** Synthetic loan: 6 monthly installments of 100.000 principal, due on the 10th. */
function loan(
  id: string,
  originated: string,
  payments: Array<string | null>,
  extra: Partial<LoanInput> = {},
): LoanInput {
  const [year, month] = originated.split('-').map(Number);
  const installments: InstallmentInput[] = payments.map((paidAt, index) => {
    const due = new Date(Date.UTC(year, month - 1 + index + 1, 10));
    return {
      sequence: index + 1,
      dueDate: due.toISOString().slice(0, 10),
      principalCOP: 100_000,
      status: paidAt ? 'PAID' : 'PENDING',
      paidAt,
    };
  });
  return {
    id,
    userId: `user-${id}`,
    originatedAt: originated,
    principalCOP: 100_000 * payments.length,
    status: 'ACTIVE',
    productCode: 'BUILDER_1',
    category: null,
    archetype: 'CONSTRUCTOR',
    installments,
    ...extra,
  };
}

describe('vintage helpers', () => {
  it('uses the Colombian day for timestamps and keeps plain dates', () => {
    expect(dayOf('2026-07-01')).toBe('2026-07-01');
    expect(dayOf(new Date('2026-07-01T03:00:00Z'))).toBe('2026-06-30');
    expect(dayOf(new Date('2026-07-01T05:00:00Z'))).toBe('2026-07-01');
  });

  it('finds the end of each month on books', () => {
    expect(monthEnd('2026-01', 1)).toBe('2026-02-28');
    expect(monthEnd('2026-11', 2)).toBe('2027-01-31');
    expect(monthEnd('2028-01', 1)).toBe('2028-02-29');
  });

  it('measures days past due from the oldest unpaid installment', () => {
    const item = loan('a', '2026-01-15', ['2026-02-10', null, null, null]);
    // Second installment due 2026-03-10 and never paid.
    expect(daysPastDueAt(item, '2026-03-10')).toBe(0);
    expect(daysPastDueAt(item, '2026-03-31')).toBe(21);
    expect(daysPastDueAt(item, '2026-04-30')).toBe(51);
    // A payment made later does not erase the past.
    const cured = loan('b', '2026-01-15', ['2026-02-10', '2026-04-20', null]);
    expect(daysPastDueAt(cured, '2026-03-31')).toBe(21);
    expect(daysPastDueAt(cured, '2026-04-30')).toBe(20);
    expect(balanceAt(cured, '2026-03-31')).toBe(200_000);
    expect(balanceAt(cured, '2026-04-30')).toBe(100_000);
  });

  it('summarizes the behaviour of one loan', () => {
    const item = loan('c', '2026-01-15', [
      '2026-02-10', // on time
      '2026-03-25', // 15 days late
      '2026-03-26', // paid 15 days before its 2026-04-10 due date
      null, // due 2026-05-10, unpaid
      null, // due 2026-06-10, unpaid
      null, // due 2026-07-10, not yet due
    ]);
    const performance = loanPerformance(item, '2026-06-30');
    expect(performance).toMatchObject({
      installmentsDue: 5,
      installmentsOnTime: 2,
      installmentsLate: 1,
      installmentsOverdue: 2,
      installmentsPrepaid: 1,
      maxDaysPastDue: 51,
      currentDaysPastDue: 51,
      everDpd30: true,
      everDpd60: false,
      everDpd90: false,
      closed: false,
      writtenOff: false,
      prepaidLoan: false,
    });
    expect(PREPAYMENT_DAYS).toBe(15);
  });

  it('detects prepaid and written-off loans', () => {
    const prepaid = loan('d', '2026-01-15', [
      '2026-02-10',
      '2026-02-20',
      '2026-02-20',
    ]);
    expect(loanPerformance(prepaid, '2026-06-30')).toMatchObject({
      closed: true,
      prepaidLoan: true,
      installmentsPrepaid: 2,
      maxDaysPastDue: 0,
    });
    const defaulted = loan('e', '2026-01-15', [null, null, null], {
      status: 'DEFAULTED',
    });
    expect(loanPerformance(defaulted, '2026-08-31')).toMatchObject({
      defaulted: true,
      writtenOff: false,
      everDpd90: true,
      closed: false,
    });
    const writtenOff = loan('w', '2026-01-15', [null, null, null], {
      status: 'WRITTEN_OFF',
      defaultedAt: '2026-05-15T15:00:00Z',
      writtenOffAt: '2026-07-20T15:00:00Z',
    });
    // Before the write-off date the loan was only in default.
    expect(loanPerformance(writtenOff, '2026-06-30')).toMatchObject({
      defaulted: true,
      writtenOff: false,
    });
    expect(loanPerformance(writtenOff, '2026-08-31')).toMatchObject({
      defaulted: true,
      writtenOff: true,
    });
    // Without dates the current status is the only evidence.
    const undated = loan('x', '2026-01-15', [null], { status: 'WRITTEN_OFF' });
    expect(loanPerformance(undated, '2026-08-31').writtenOff).toBe(true);
  });

  it('ignores waived installments', () => {
    const item = loan('f', '2026-01-15', [null, '2026-03-10']);
    item.installments[0].status = 'WAIVED';
    expect(daysPastDueAt(item, '2026-06-30')).toBe(0);
    expect(loanPerformance(item, '2026-06-30')).toMatchObject({
      installmentsDue: 1,
      installmentsOnTime: 1,
      closed: true,
    });
  });
});

describe('cohorts (cosechas)', () => {
  const january = [
    loan('j1', '2026-01-05', ['2026-02-10', '2026-03-10', '2026-04-10']),
    loan('j2', '2026-01-20', ['2026-02-10', null, null]),
    loan('j3', '2026-01-28', [null, null, null], { status: 'WRITTEN_OFF' }),
  ];
  const march = [
    loan('m1', '2026-03-03', ['2026-04-10', '2026-05-10', null], {
      productCode: 'BUILDER_2',
      archetype: 'ESTRATEGA',
    }),
  ];
  const report = computeCohorts([...january, ...march], { asOf: '2026-06-30' });

  it('returns valid empty structures without data', () => {
    const empty = computeCohorts([], { asOf: '2026-06-30' });
    expect(empty.cohorts).toEqual([]);
    expect(empty.totals).toMatchObject({
      loans: 0,
      borrowers: 0,
      originatedCOP: 0,
      outstandingCOP: 0,
    });
    expect(empty.totals.installments.onTimeRate).toBeNull();
    expect(empty.totals.delinquency.everRate30).toBeNull();
  });

  it('groups loans by origination month', () => {
    expect(report.cohorts.map((cohort) => cohort.originationMonth)).toEqual([
      '2026-01',
      '2026-03',
    ]);
    const [first, second] = report.cohorts;
    expect(first).toMatchObject({
      loans: 3,
      borrowers: 3,
      originatedCOP: 900_000,
      dimensionValue: 'TODOS',
    });
    expect(second).toMatchObject({ loans: 1, originatedCOP: 300_000 });
    expect(report.totals.loans).toBe(4);
    expect(report.totals.originatedCOP).toBe(1_200_000);
  });

  it('reports balance, on-time payments, write-offs and delinquency', () => {
    const [first] = report.cohorts;
    // j1 paid in full, j2 owes two installments, j3 owes three.
    expect(first.outstandingCOP).toBe(500_000);
    expect(first.closedLoans).toBe(1);
    expect(first.writtenOffLoans).toBe(1);
    expect(first.writtenOffCOP).toBe(300_000);
    expect(first.activeLoans).toBe(1);
    expect(first.installments).toMatchObject({
      due: 9,
      paidOnTime: 4,
      paidLate: 0,
      overdueUnpaid: 5,
    });
    expect(first.installments.onTimeRate).toBeCloseTo(0.4444, 4);
    expect(first.delinquency).toMatchObject({
      ever30: 2,
      ever60: 2,
      ever90: 2,
      current90: 2,
    });
    expect(first.delinquency.everRate30).toBeCloseTo(0.6667, 4);
  });

  it('builds the delinquency curve by month on books', () => {
    const [first] = report.cohorts;
    // January vintage observed at the end of Feb..Jun (MOB 1..5).
    expect(first.monthsOnBooks.map((row) => row.mob)).toEqual([1, 2, 3, 4, 5]);
    expect(first.monthsOnBooks.map((row) => row.observedOn)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    // End of Feb: j3 is 18 days late (due Feb 10) → nobody at 30+ yet.
    expect(first.monthsOnBooks[0]).toMatchObject({ dpd30: 0, dpd60: 0 });
    // End of Mar: j3 at 49 days; j2 at 21 days.
    expect(first.monthsOnBooks[1]).toMatchObject({
      dpd30: 1,
      dpd60: 0,
      dpd90: 0,
    });
    // End of Apr: j3 at 79 days, j2 at 51 days.
    expect(first.monthsOnBooks[2]).toMatchObject({
      dpd30: 2,
      dpd60: 1,
      dpd90: 0,
    });
    // End of May: j3 at 110 days, j2 at 82 days.
    expect(first.monthsOnBooks[3]).toMatchObject({
      dpd30: 2,
      dpd60: 2,
      dpd90: 1,
    });
    expect(first.monthsOnBooks[3].rate30).toBeCloseTo(0.6667, 4);
    // Balance at risk: both delinquent loans carry the whole open balance.
    expect(first.monthsOnBooks[3].balanceCOP).toBe(500_000);
    expect(first.monthsOnBooks[3].balance30COP).toBe(500_000);
    expect(first.monthsOnBooks[3].portfolioAtRisk30).toBe(1);
    // March vintage only has three elapsed months.
    expect(report.cohorts[1].monthsOnBooks.map((row) => row.mob)).toEqual([
      1, 2, 3,
    ]);
  });

  it('does not show months that have not elapsed, nor future loans', () => {
    const early = computeCohorts([...january, ...march], {
      asOf: '2026-02-15',
    });
    expect(early.cohorts).toHaveLength(1);
    expect(early.cohorts[0].monthsOnBooks).toEqual([]);
    expect(early.cohorts[0].loans).toBe(3);
  });

  it('splits vintages by product and by archetype when the data exists', () => {
    const byProduct = computeCohorts([...january, ...march], {
      asOf: '2026-06-30',
      groupBy: 'product',
    });
    expect(
      byProduct.cohorts.map(
        (cohort) => `${cohort.originationMonth}:${cohort.dimensionValue}`,
      ),
    ).toEqual(['2026-01:BUILDER_1', '2026-03:BUILDER_2']);
    const byArchetype = computeCohorts([...january, ...march], {
      asOf: '2026-06-30',
      groupBy: 'archetype',
    });
    expect(byArchetype.cohorts.map((cohort) => cohort.dimensionValue)).toEqual([
      'CONSTRUCTOR',
      'ESTRATEGA',
    ]);
  });

  it('labels a missing dimension instead of inventing one', () => {
    const byCategory = computeCohorts(january, {
      asOf: '2026-06-30',
      groupBy: 'category',
    });
    expect(byCategory.cohorts).toHaveLength(1);
    expect(byCategory.cohorts[0].dimensionValue).toBe(UNKNOWN_DIMENSION);
  });

  it('counts prepayments', () => {
    const prepaid = loan('p1', '2026-01-05', [
      '2026-01-20',
      '2026-01-20',
      '2026-01-20',
    ]);
    const result = computeCohorts([prepaid], { asOf: '2026-06-30' });
    expect(result.cohorts[0]).toMatchObject({
      prepaidLoans: 1,
      closedLoans: 1,
    });
    expect(result.cohorts[0].installments.prepaid).toBe(3);
    expect(result.cohorts[0].capitalPrepayments).toBe(0);
    // Capital prepayments recorded by STARTIF are added up when present.
    const withCapital = computeCohorts(
      [
        { ...prepaid, capitalPrepayments: { count: 2, amountCOP: 150_000 } },
        loan('p2', '2026-01-09', ['2026-02-10'], { status: 'DEFAULTED' }),
      ],
      { asOf: '2026-06-30' },
    );
    expect(withCapital.cohorts[0]).toMatchObject({
      capitalPrepayments: 2,
      capitalPrepaidCOP: 150_000,
      defaultedLoans: 1,
      writtenOffLoans: 0,
    });
  });
});
