import type { EngineRule } from '../matching/rule-engine';
import { runBacktest, type BacktestCase } from './backtest';
import type { LoanPerformance } from './cohorts';
import {
  computeEffectiveness,
  NO_CREDIT_COHORT,
  type UserJourney,
} from './effectiveness';

const performance = (
  input: Partial<LoanPerformance> = {},
): LoanPerformance => ({
  maxDaysPastDue: 0,
  currentDaysPastDue: 0,
  everDpd30: false,
  everDpd60: false,
  everDpd90: false,
  installmentsDue: 6,
  installmentsOnTime: 6,
  installmentsLate: 0,
  installmentsOverdue: 0,
  installmentsPrepaid: 0,
  defaulted: false,
  writtenOff: false,
  closed: true,
  prepaidLoan: false,
  ...input,
});

const user = (id: string, input: Partial<UserJourney> = {}): UserJourney => ({
  userId: id,
  cohortMonth: '2026-01',
  initialScore: null,
  finalScore: null,
  lessonsCompleted: 0,
  loans: [],
  archetypes: [],
  ...input,
});

describe('intervention effectiveness', () => {
  it('returns valid empty structures without data', () => {
    const report = computeEffectiveness([]);
    expect(report.users).toBe(0);
    expect(report.score.cohorts).toEqual([]);
    expect(report.score.overall).toMatchObject({
      withBoth: 0,
      averageInitial: null,
      averageFinal: null,
      averageDelta: null,
      medianDelta: null,
    });
    expect(report.lessons.buckets).toHaveLength(4);
    expect(report.lessons.buckets.every((bucket) => bucket.users === 0)).toBe(
      true,
    );
    expect(report.archetypeStability).toMatchObject({
      usersWithHistory: 0,
      stabilityRate: null,
      transitions: [],
    });
  });

  it('compares initial and final score for the same people, by cohort', () => {
    const report = computeEffectiveness([
      user('a', { initialScore: 500, finalScore: 560 }),
      user('b', { initialScore: 620, finalScore: 600 }),
      user('c', { initialScore: 480, finalScore: 480 }),
      // Only an initial inquiry: must not distort the averages.
      user('d', { initialScore: 900 }),
      user('e', {
        cohortMonth: '2026-02',
        initialScore: 400,
        finalScore: 450,
      }),
      user('f', { cohortMonth: null, initialScore: 700 }),
    ]);
    const january = report.score.cohorts.find(
      (cohort) => cohort.cohortMonth === '2026-01',
    );
    expect(january).toMatchObject({
      users: 4,
      withInitial: 4,
      withFinal: 3,
      withBoth: 3,
      averageInitial: 533.33,
      averageFinal: 546.67,
      averageDelta: 13.33,
      medianDelta: 0,
      improved: 1,
      unchanged: 1,
      declined: 1,
    });
    expect(report.score.cohorts.map((cohort) => cohort.cohortMonth)).toEqual([
      '2026-01',
      '2026-02',
      NO_CREDIT_COHORT,
    ]);
    expect(report.score.overall).toMatchObject({ users: 6, withBoth: 4 });
    expect(report.score.overall.averageDelta).toBe(22.5);
  });

  it('relates completed lessons to payment behaviour', () => {
    const report = computeEffectiveness([
      user('a', {
        lessonsCompleted: 0,
        loans: [performance({ installmentsOnTime: 3, everDpd30: true })],
      }),
      user('b', {
        lessonsCompleted: 2,
        loans: [performance({ installmentsOnTime: 5 })],
      }),
      user('c', { lessonsCompleted: 9, loans: [performance(), performance()] }),
      // No loan: there is no payment behaviour to relate.
      user('d', { lessonsCompleted: 12 }),
    ]);
    const bucket = (key: string) =>
      report.lessons.buckets.find((item) => item.key === key);
    expect(bucket('0')).toMatchObject({
      users: 1,
      loans: 1,
      onTimeRate: 0.5,
      ever30: 1,
      ever30Rate: 1,
    });
    expect(bucket('1-3')).toMatchObject({ users: 1, onTimeRate: 0.8333 });
    expect(bucket('4-7')).toMatchObject({ users: 0, onTimeRate: null });
    expect(bucket('8+')).toMatchObject({
      users: 1,
      loans: 2,
      installmentsDue: 12,
      onTimeRate: 1,
      ever30Rate: 0,
    });
  });

  it('measures archetype stability over time', () => {
    const report = computeEffectiveness([
      user('a', { archetypes: ['INICIADOR', 'INICIADOR', 'INICIADOR'] }),
      user('b', { archetypes: ['INICIADOR', 'CONSTRUCTOR', 'ESTRATEGA'] }),
      user('c', { archetypes: ['INICIADOR', 'CONSTRUCTOR'] }),
      // A single record says nothing about stability.
      user('d', { archetypes: ['EXPLORADOR'] }),
    ]);
    expect(report.archetypeStability).toMatchObject({
      usersWithHistory: 3,
      stable: 1,
      changed: 2,
      stabilityRate: 0.3333,
      averageChanges: 1,
    });
    expect(report.archetypeStability.transitions).toEqual([
      { from: 'INICIADOR', to: 'CONSTRUCTOR', count: 2 },
      { from: 'CONSTRUCTOR', to: 'ESTRATEGA', count: 1 },
    ]);
  });

  it('states that the reading is descriptive and promises nothing', () => {
    const { note } = computeEffectiveness([]);
    expect(note).toMatch(/descriptivo/i);
    expect(note).toMatch(/múltiples factores/);
    expect(note).not.toMatch(/garantiza|aumentar[aá]|subir[aá]/i);
  });
});

describe('backtesting', () => {
  const rules: EngineRule[] = [
    {
      id: 'r-score',
      position: 1,
      field: 'score',
      operator: 'gte',
      value: 600,
      kind: 'REQUISITO',
      weight: 1,
      label: 'Puntaje mínimo 600',
      internal: false,
      exceptionAllowed: false,
      exceptionApprovalLevel: null,
    },
    {
      id: 'r-arrears',
      position: 2,
      field: 'currentArrears',
      operator: 'eq',
      value: true,
      kind: 'EXCLUSION',
      weight: 1,
      label: 'Mora vigente',
      internal: false,
      exceptionAllowed: false,
      exceptionApprovalLevel: null,
    },
  ];
  const item = (
    userId: string,
    facts: BacktestCase['facts'],
    extra: Partial<BacktestCase> = {},
  ): BacktestCase => ({
    userId,
    facts,
    recordedStatus: null,
    approved: null,
    maxDaysPastDue: null,
    ...extra,
  });

  it('returns valid empty structures without snapshots', () => {
    const result = runBacktest([], rules);
    expect(result).toMatchObject({
      evaluated: 0,
      users: 0,
      predicted: { ELEGIBLE: 0, CON_BRECHAS: 0, EXCLUIDO: 0 },
      eligibleRate: null,
      averageFitPercent: null,
      topGaps: [],
      topExclusions: [],
    });
    expect(result.approval.agreementRate).toBeNull();
    expect(result.delinquency.eligible.rate).toBeNull();
  });

  const cases = [
    item(
      'a',
      { score: 700, currentArrears: false },
      { approved: true, maxDaysPastDue: 0, recordedStatus: 'ELEGIBLE' },
    ),
    item(
      'b',
      { score: 650, currentArrears: false },
      { approved: false, maxDaysPastDue: 45, recordedStatus: 'ELEGIBLE' },
    ),
    item(
      'c',
      { score: 500, currentArrears: false },
      { approved: false, maxDaysPastDue: 95, recordedStatus: 'ELEGIBLE' },
    ),
    item(
      'd',
      { score: 580, currentArrears: false },
      { approved: true, maxDaysPastDue: 10, recordedStatus: 'CON_BRECHAS' },
    ),
    item(
      'e',
      { score: 720, currentArrears: true },
      { recordedStatus: 'EXCLUIDO' },
    ),
    item('f', { currentArrears: false }),
  ];

  it('re-executes the rules over each snapshot', () => {
    const result = runBacktest(cases, rules);
    expect(result.evaluated).toBe(6);
    expect(result.users).toBe(6);
    expect(result.predicted).toEqual({
      ELEGIBLE: 2,
      CON_BRECHAS: 3,
      EXCLUIDO: 1,
    });
    expect(result.eligibleRate).toBe(0.3333);
    // 100 + 100 + 50 + 50 + 0 (excluded) + 50 (score unknown)
    expect(result.averageFitPercent).toBe(58.33);
  });

  it('compares the prediction against real institution decisions', () => {
    const { approval } = runBacktest(cases, rules);
    expect(approval).toMatchObject({
      withDecision: 4,
      eligibleApproved: 1,
      eligibleRejected: 1,
      notEligibleApproved: 1,
      notEligibleRejected: 1,
      agreementRate: 0.5,
      approvalRateEligible: 0.5,
      approvalRateNotEligible: 0.5,
    });
  });

  it('compares the prediction against real delinquency at each threshold', () => {
    const at30 = runBacktest(cases, rules, { delinquencyDays: 30 }).delinquency;
    expect(at30).toMatchObject({
      thresholdDays: 30,
      withLoan: 4,
      eligible: { loans: 2, delinquent: 1, rate: 0.5 },
      notEligible: { loans: 2, delinquent: 1, rate: 0.5 },
    });
    const at90 = runBacktest(cases, rules, { delinquencyDays: 90 }).delinquency;
    expect(at90.eligible).toEqual({ loans: 2, delinquent: 0, rate: 0 });
    expect(at90.notEligible).toEqual({ loans: 2, delinquent: 1, rate: 0.5 });
  });

  it('reports who changes versus the result recorded at the time', () => {
    expect(runBacktest(cases, rules).versusRecorded).toEqual({
      compared: 5,
      unchanged: 4,
      nowEligible: 0,
      noLongerEligible: 1,
    });
    const looser = rules.map((rule) =>
      rule.id === 'r-score' ? { ...rule, value: 550 } : rule,
    );
    expect(runBacktest(cases, looser).versusRecorded).toMatchObject({
      nowEligible: 1,
      noLongerEligible: 1,
    });
  });

  it('ranks the rules that block the most, separating missing data', () => {
    const result = runBacktest(cases, rules);
    expect(result.topGaps).toEqual([
      {
        ruleId: 'r-score',
        label: 'Puntaje mínimo 600',
        field: 'score',
        fieldLabel: 'Puntaje de crédito',
        notMet: 2,
        missingData: 1,
      },
    ]);
    expect(result.topExclusions).toEqual([
      {
        ruleId: 'r-arrears',
        label: 'Mora vigente',
        field: 'currentArrears',
        fieldLabel: 'Mora actual en LUFT',
        excluded: 1,
      },
    ]);
  });

  it('is reproducible: same snapshots and rules, same result', () => {
    const first = runBacktest(cases, rules, { delinquencyDays: 60 });
    const second = runBacktest(
      JSON.parse(JSON.stringify(cases)) as BacktestCase[],
      JSON.parse(JSON.stringify(rules)) as EngineRule[],
      { delinquencyDays: 60 },
    );
    expect(second).toEqual(first);
  });
});
