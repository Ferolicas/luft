import { FACT_KEYS } from './fact-catalog';
import {
  buildFacts,
  businessDay,
  canonicalJson,
  DEBT_RATIO_CAP,
  fullMonths,
  fullYears,
  matchingRequirements,
  parseSnapshot,
  snapshotOf,
  type FactSources,
} from './facts';

const source = (overrides: Partial<FactSources> = {}): FactSources => ({
  asOf: new Date('2026-11-22T15:00:00Z'),
  today: '2026-11-22',
  stratum: 3,
  profile: {
    category: null,
    archetype: 'CONSTRUCTOR',
    primaryGoal: 'IMPROVE_SCORE',
    completedSections: ['employment', 'income', 'debts'],
    context: {
      employment: { situation: 'EMPLEADO', contractType: 'LABORAL' },
      income: {
        sources: [
          { kind: 'SALARIO', monthlyCOP: 2_000_000 },
          { kind: 'ARRIENDOS', monthlyCOP: 500_000 },
          { kind: 'OTROS', monthlyCOP: 0 },
        ],
      },
      debts: {
        totalDebtCOP: 6_000_000,
        fixedExpensesMonthlyCOP: 900_000,
        cardSpendMonthlyCOP: 300_000,
      },
      recurring: { socialSecurity: 'EMPLEADO' },
    },
    documents: ['BANK_STATEMENTS', 'BANK_STATEMENTS'],
    taxAlert: false,
  },
  supplement: {
    birthDate: '2001-11-23',
    city: 'Medellín',
    department: 'Antioquia',
    activityStartDate: '2024-03-15',
  },
  bureau: { score: 655, hasHistory: true },
  installments: [
    { dueDate: '2026-08-10', status: 'PAID', paidAt: '2026-08-09T20:00:00Z' },
    { dueDate: '2026-09-10', status: 'PAID', paidAt: '2026-09-12T14:00:00Z' },
    { dueDate: '2026-10-10', status: 'OVERDUE', paidAt: null },
    { dueDate: '2026-12-10', status: 'PENDING', paidAt: null },
  ],
  request: { amountCOP: 8_000_000, termMonths: 36 },
  ...overrides,
});

describe('fact builder', () => {
  it('returns every catalog field, known or null', () => {
    const { facts, provenance } = buildFacts(source());
    expect(Object.keys(facts).sort()).toEqual([...FACT_KEYS].sort());
    expect(Object.keys(provenance).sort()).toEqual([...FACT_KEYS].sort());
  });

  it('derives income, capacity and indebtedness from the profile', () => {
    const { facts } = buildFacts(source());
    expect(facts.monthlyIncomeCOP).toBe(2_500_000);
    expect(facts.incomeSources).toEqual(['ARRIENDOS', 'SALARIO']);
    expect(facts.primaryIncomeSource).toBe('SALARIO');
    expect(facts.availableCapacityCOP).toBe(1_300_000);
    // 6.000.000 / (2.500.000 × 12)
    expect(facts.debtToIncomeRatio).toBe(0.2);
    expect(facts.employmentSituation).toBe('EMPLEADO');
    expect(facts.contractType).toBe('LABORAL');
    expect(facts.socialSecurity).toBe('EMPLEADO');
    expect(facts.stratum).toBe(3);
    expect(facts.score).toBe(655);
    expect(facts.hasCreditHistory).toBe(true);
    expect(facts.requestedAmountCOP).toBe(8_000_000);
    expect(facts.requestedTermMonths).toBe(36);
  });

  it('counts on-time installments and current arrears from the portfolio', () => {
    const { facts } = buildFacts(source());
    expect(facts.onTimeInstallments).toBe(1);
    expect(facts.currentArrears).toBe(true);
    expect(facts.maxDaysPastDue).toBe(43);
    const clean = buildFacts(source({ installments: [] })).facts;
    expect(clean.onTimeInstallments).toBe(0);
    expect(clean.currentArrears).toBe(false);
    expect(clean.maxDaysPastDue).toBe(0);
  });

  it('computes age and tenure in whole units from declared dates', () => {
    const { facts, provenance } = buildFacts(source());
    // Birthday is tomorrow: still 24.
    expect(facts.ageYears).toBe(24);
    expect(facts.tenureMonths).toBe(32);
    expect(facts.city).toBe('Medellín');
    expect(provenance.ageYears).toBe('DECLARADO');
    expect(provenance.requestedAmountCOP).toBe('SOLICITUD');
    expect(provenance.score).toBe('LUFT');
    expect(fullYears('2001-11-22', '2026-11-22')).toBe(25);
    expect(fullMonths('2024-03-22', '2026-11-22')).toBe(32);
    expect(fullMonths('2024-03-23', '2026-11-22')).toBe(31);
  });

  it('leaves unknown what LUFT does not know', () => {
    const { facts, provenance } = buildFacts(
      source({
        stratum: null,
        supplement: null,
        bureau: { score: null, hasHistory: null },
        request: { amountCOP: null, termMonths: null },
        profile: {
          category: null,
          archetype: null,
          primaryGoal: null,
          completedSections: [],
          context: {},
          documents: [],
          taxAlert: null,
        },
      }),
    );
    for (const key of [
      'category',
      'archetype',
      'ageYears',
      'city',
      'stratum',
      'monthlyIncomeCOP',
      'incomeSources',
      'tenureMonths',
      'employmentSituation',
      'contractType',
      'score',
      'hasCreditHistory',
      'debtToIncomeRatio',
      'availableCapacityCOP',
      'requestedAmountCOP',
      'requestedTermMonths',
      'taxFormalization',
    ]) {
      expect(facts[key]).toBeNull();
      expect(provenance[key]).toBe('DESCONOCIDO');
    }
    // "No documents" is a known fact, not a missing one.
    expect(facts.documentsUploaded).toEqual([]);
  });

  it('keeps the category unknown until the catalog source provides it', () => {
    expect(buildFacts(source()).facts.category).toBeNull();
    const withCategory = source();
    withCategory.profile.category = 'JOVEN';
    expect(buildFacts(withCategory).facts.category).toBe('JOVEN');
  });

  it('reads the tax orientation as an alert, never as a determination', () => {
    const fact = (taxAlert: boolean | null, documents: string[]) => {
      const input = source();
      input.profile.taxAlert = taxAlert;
      input.profile.documents = documents;
      return buildFacts(input).facts.taxFormalization;
    };
    expect(fact(false, [])).toBe('SIN_ALERTA');
    expect(fact(true, [])).toBe('ALERTA_SIN_SOPORTE');
    expect(fact(true, ['TAX_RETURN'])).toBe('DECLARACION_CARGADA');
    expect(fact(null, [])).toBeNull();
  });

  it('never reports a favourable ratio when there is debt and no income', () => {
    const input = source();
    input.profile.context.income = {
      sources: [{ kind: 'OTROS', monthlyCOP: 0 }],
    };
    const { facts } = buildFacts(input);
    expect(facts.debtToIncomeRatio).toBe(DEBT_RATIO_CAP);
    expect(facts.primaryIncomeSource).toBeNull();
    expect(facts.incomeSources).toEqual([]);
  });

  it('ignores malformed declared dates and future dates', () => {
    const { facts } = buildFacts(
      source({
        supplement: {
          birthDate: '2001-02-30',
          activityStartDate: '2027-01-01',
        },
      }),
    );
    expect(facts.ageYears).toBeNull();
    expect(facts.tenureMonths).toBeNull();
  });
});

describe('fact snapshot', () => {
  it('serializes canonically regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe(
      '{"a":[2,{"c":"x","d":null}],"b":1}',
    );
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    const first = canonicalJson(snapshotOf(source()));
    const second = canonicalJson(snapshotOf(source()));
    expect(second).toBe(first);
  });

  it('round-trips through its JSON form', () => {
    const snapshot = snapshotOf(source());
    const parsed = parseSnapshot(canonicalJson(snapshot));
    expect(parsed).toEqual(snapshot);
    expect(canonicalJson(parsed)).toBe(canonicalJson(snapshot));
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot('{"schemaVersion":1}')).toBeNull();
  });

  it('uses the Colombian calendar day', () => {
    expect(businessDay(new Date('2026-11-23T03:30:00Z'))).toBe('2026-11-22');
    expect(businessDay(new Date('2026-11-23T05:00:00Z'))).toBe('2026-11-23');
  });
});

describe('matching requirements', () => {
  it('is ready with consent, archetype and the minimum sections', () => {
    expect(
      matchingRequirements({
        dataConsentActive: true,
        archetype: 'CONSTRUCTOR',
        completedSections: ['employment', 'income', 'debts', 'assets'],
      }),
    ).toEqual([]);
  });

  it('lists exactly what is missing, with where to complete it', () => {
    const missing = matchingRequirements({
      dataConsentActive: false,
      archetype: null,
      completedSections: ['employment'],
    });
    expect(missing.map((item) => item.code)).toEqual([
      'DATA_PROCESSING',
      'ARCHETYPE',
      'SECTION_INCOME',
      'SECTION_DEBTS',
    ]);
    expect(missing[0].kind).toBe('CONSENT');
    for (const item of missing) {
      expect(item.href.startsWith('/app')).toBe(true);
      expect(item.label.length).toBeGreaterThan(10);
    }
  });
});
