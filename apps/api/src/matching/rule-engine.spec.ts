import { FACT_FIELDS, OPERATORS, type Facts } from './fact-catalog';
import { canonicalJson } from './facts';
import {
  evaluateCondition,
  evaluatePolicy,
  explain,
  headline,
  INTERNAL_RULE_LABEL,
  rulesFromSnapshot,
  storedExplanation,
  type EngineRule,
} from './rule-engine';

let sequence = 0;
const rule = (input: Partial<EngineRule> & Pick<EngineRule, 'field'>) =>
  ({
    id: `rule-${(sequence += 1).toString().padStart(3, '0')}`,
    position: sequence,
    operator: 'eq',
    value: true,
    kind: 'REQUISITO',
    weight: 1,
    label: `Regla sobre ${input.field}`,
    internal: false,
    exceptionAllowed: false,
    exceptionApprovalLevel: null,
    ...input,
  }) as EngineRule;

const facts: Facts = {
  monthlyIncomeCOP: 2_500_000,
  score: 640,
  stratum: 3,
  city: 'Bogotá',
  employmentSituation: 'EMPLEADO',
  contractType: 'LABORAL',
  hasCreditHistory: true,
  currentArrears: false,
  maxDaysPastDue: 0,
  documentsUploaded: ['BANK_STATEMENTS', 'EMPLOYMENT_CERTIFICATE'],
  incomeSources: ['SALARIO'],
  ageYears: null,
  requestedAmountCOP: 5_000_000,
};

describe('rule engine · operators', () => {
  it('covers every operator of the catalog', () => {
    const tested = new Set([
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'between',
      'in',
      'not_in',
      'includes_any',
      'includes_all',
      'includes_none',
    ]);
    expect([...OPERATORS].sort()).toEqual([...tested].sort());
  });

  it('eq / neq compare numbers, booleans and text', () => {
    expect(evaluateCondition(3, 'eq', 3)).toBe(true);
    expect(evaluateCondition(3, 'eq', 4)).toBe(false);
    expect(evaluateCondition(true, 'eq', true)).toBe(true);
    expect(evaluateCondition(false, 'neq', true)).toBe(true);
    expect(evaluateCondition('EMPLEADO', 'eq', 'EMPLEADO')).toBe(true);
    expect(evaluateCondition('EMPLEADO', 'neq', 'EMPLEADO')).toBe(false);
  });

  it('compares text without accents, case or outer spaces', () => {
    expect(evaluateCondition('Bogotá', 'eq', ' bogota ')).toBe(true);
    expect(evaluateCondition('Medellín', 'in', ['BOGOTA', 'medellin'])).toBe(
      true,
    );
  });

  it('gt / gte / lt / lte respect their boundaries', () => {
    expect(evaluateCondition(600, 'gt', 600)).toBe(false);
    expect(evaluateCondition(601, 'gt', 600)).toBe(true);
    expect(evaluateCondition(600, 'gte', 600)).toBe(true);
    expect(evaluateCondition(599, 'gte', 600)).toBe(false);
    expect(evaluateCondition(600, 'lt', 600)).toBe(false);
    expect(evaluateCondition(599, 'lt', 600)).toBe(true);
    expect(evaluateCondition(600, 'lte', 600)).toBe(true);
    expect(evaluateCondition(601, 'lte', 600)).toBe(false);
  });

  it('between is inclusive on both ends', () => {
    expect(evaluateCondition(18, 'between', [18, 28])).toBe(true);
    expect(evaluateCondition(28, 'between', [18, 28])).toBe(true);
    expect(evaluateCondition(29, 'between', [18, 28])).toBe(false);
    expect(evaluateCondition(17, 'between', [18, 28])).toBe(false);
  });

  it('in / not_in work on scalars', () => {
    expect(evaluateCondition(2, 'in', [1, 2, 3])).toBe(true);
    expect(evaluateCondition(5, 'in', [1, 2, 3])).toBe(false);
    expect(evaluateCondition('HOGAR', 'not_in', ['EMPLEADO'])).toBe(true);
    expect(evaluateCondition('EMPLEADO', 'not_in', ['EMPLEADO'])).toBe(false);
  });

  it('includes_any / includes_all / includes_none work on lists', () => {
    const documents = ['BANK_STATEMENTS', 'EMPLOYMENT_CERTIFICATE'];
    expect(
      evaluateCondition(documents, 'includes_any', [
        'TAX_RETURN',
        'BANK_STATEMENTS',
      ]),
    ).toBe(true);
    expect(evaluateCondition(documents, 'includes_any', ['TAX_RETURN'])).toBe(
      false,
    );
    expect(
      evaluateCondition(documents, 'includes_all', [
        'BANK_STATEMENTS',
        'EMPLOYMENT_CERTIFICATE',
      ]),
    ).toBe(true);
    expect(
      evaluateCondition(documents, 'includes_all', [
        'BANK_STATEMENTS',
        'TAX_RETURN',
      ]),
    ).toBe(false);
    expect(evaluateCondition(documents, 'includes_none', ['TAX_RETURN'])).toBe(
      true,
    );
    expect(
      evaluateCondition(documents, 'includes_none', ['BANK_STATEMENTS']),
    ).toBe(false);
    // An empty list is a known fact: the person uploaded nothing.
    expect(evaluateCondition([], 'includes_any', ['TAX_RETURN'])).toBe(false);
    expect(evaluateCondition([], 'includes_none', ['TAX_RETURN'])).toBe(true);
  });

  it('cannot decide on an unknown fact, a wrong type or a malformed value', () => {
    for (const operator of OPERATORS) {
      expect(evaluateCondition(null, operator, 1)).toBeNull();
      expect(evaluateCondition(undefined, operator, 1)).toBeNull();
    }
    expect(evaluateCondition('abc', 'gte', 10)).toBeNull();
    expect(evaluateCondition(10, 'gte', '10')).toBeNull();
    expect(evaluateCondition(10, 'between', [20, 5])).toBeNull();
    expect(evaluateCondition(10, 'between', [5])).toBeNull();
    expect(evaluateCondition(10, 'in', [])).toBeNull();
    expect(evaluateCondition(10, 'eq', 'diez')).toBeNull();
    expect(evaluateCondition(['A'], 'eq', 'A')).toBeNull();
    expect(evaluateCondition('A', 'includes_any', ['A'])).toBeNull();
    expect(evaluateCondition(10, 'starts_with', 1)).toBeNull();
  });
});

describe('rule engine · policy evaluation', () => {
  it('is ELEGIBLE with 100% when every rule is satisfied', () => {
    const result = evaluatePolicy(facts, [
      rule({ field: 'monthlyIncomeCOP', operator: 'gte', value: 2_000_000 }),
      rule({ field: 'score', operator: 'gte', value: 600 }),
      rule({
        field: 'currentArrears',
        kind: 'EXCLUSION',
        operator: 'eq',
        value: true,
      }),
    ]);
    expect(result.status).toBe('ELEGIBLE');
    expect(result.fitPercent).toBe(100);
    expect(result.presentable).toBe(true);
    expect(result.gaps).toHaveLength(0);
    expect(result.passed).toHaveLength(3);
  });

  it('reports a gap with what is missing when a requirement is not met', () => {
    const result = evaluatePolicy(facts, [
      rule({ field: 'monthlyIncomeCOP', operator: 'gte', value: 4_000_000 }),
      rule({ field: 'score', operator: 'gte', value: 600 }),
    ]);
    expect(result.status).toBe('CON_BRECHAS');
    expect(result.fitPercent).toBe(50);
    expect(result.presentable).toBe(false);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      outcome: 'NO_CUMPLE',
      blocking: true,
      field: 'monthlyIncomeCOP',
      expected: 4_000_000,
      actual: 2_500_000,
    });
    const [gap] = explain(result, 'user').gaps;
    expect(gap.message).toContain('$4.000.000');
    expect(gap.message).toContain('$2.500.000');
  });

  it('never counts an unknown fact as met: it becomes a "dato faltante" gap', () => {
    const requirement = evaluatePolicy(facts, [
      rule({ field: 'ageYears', operator: 'between', value: [18, 28] }),
    ]);
    expect(requirement.status).toBe('CON_BRECHAS');
    expect(requirement.fitPercent).toBe(0);
    expect(requirement.gaps[0]).toMatchObject({
      outcome: 'DATO_FALTANTE',
      blocking: true,
      actual: null,
    });
    expect(requirement.totals.missingData).toBe(1);
    const [gap] = explain(requirement, 'user').gaps;
    expect(gap.message).toContain('Dato faltante: Edad');
    expect(gap.completeHref).toBe('/app/oportunidades/datos');

    // Unknown facts also block exclusions: they cannot be ruled out…
    const exclusion = evaluatePolicy({}, [
      rule({ field: 'currentArrears', kind: 'EXCLUSION', value: true }),
    ]);
    expect(exclusion.status).toBe('CON_BRECHAS');
    expect(exclusion.gaps[0].outcome).toBe('DATO_FALTANTE');
    // …and negated operators do not turn "unknown" into "met".
    const negated = evaluatePolicy({}, [
      rule({ field: 'city', operator: 'neq', value: 'Leticia' }),
      rule({ field: 'city', operator: 'not_in', value: ['Leticia'] }),
      rule({
        field: 'documentsUploaded',
        operator: 'includes_none',
        value: ['TAX_RETURN'],
      }),
    ]);
    expect(negated.passed).toHaveLength(0);
    expect(negated.totals.missingData).toBe(3);
  });

  it('treats a field outside the catalog as missing data', () => {
    const result = evaluatePolicy(facts, [
      rule({ field: 'shoeSize', operator: 'gte', value: 40 }),
    ]);
    expect(result.status).toBe('CON_BRECHAS');
    expect(result.gaps[0].outcome).toBe('DATO_FALTANTE');
  });

  it('excludes when an exclusion applies, whatever else is met', () => {
    const result = evaluatePolicy({ ...facts, currentArrears: true }, [
      rule({ field: 'score', operator: 'gte', value: 600 }),
      rule({
        field: 'currentArrears',
        kind: 'EXCLUSION',
        value: true,
        label: 'Mora vigente',
      }),
    ]);
    expect(result.status).toBe('EXCLUIDO');
    expect(result.fitPercent).toBe(0);
    expect(result.presentable).toBe(false);
    expect(result.exclusions).toHaveLength(1);
    expect(result.exclusions[0]).toMatchObject({
      outcome: 'EXCLUYE',
      blocking: true,
      label: 'Mora vigente',
    });
    expect(headline(result.status, false)).not.toMatch(/aprob/i);
  });

  it('weights preferences in the fit without blocking eligibility', () => {
    const rules = [
      rule({ field: 'score', operator: 'gte', value: 600, weight: 2 }),
      rule({
        field: 'stratum',
        kind: 'PREFERENCIA',
        operator: 'gte',
        value: 4,
        weight: 3,
      }),
      rule({
        field: 'contractType',
        kind: 'PREFERENCIA',
        operator: 'eq',
        value: 'LABORAL',
        weight: 5,
      }),
    ];
    const result = evaluatePolicy(facts, rules);
    expect(result.status).toBe('ELEGIBLE');
    expect(result.totals.weightTotal).toBe(10);
    expect(result.totals.weightMet).toBe(7);
    expect(result.fitPercent).toBe(70);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      kind: 'PREFERENCIA',
      blocking: false,
    });
    // An unknown preference lowers the fit but does not block either.
    const unknown = evaluatePolicy(facts, [
      rule({ field: 'score', operator: 'gte', value: 600, weight: 1 }),
      rule({
        field: 'ageYears',
        kind: 'PREFERENCIA',
        operator: 'lte',
        value: 30,
        weight: 1,
      }),
    ]);
    expect(unknown.status).toBe('ELEGIBLE');
    expect(unknown.fitPercent).toBe(50);
  });

  it('allows presenting a gap only when every blocking gap admits exception', () => {
    const exception = evaluatePolicy(facts, [
      rule({
        field: 'score',
        operator: 'gte',
        value: 700,
        exceptionAllowed: true,
        exceptionApprovalLevel: 'SUPERADMIN',
      }),
    ]);
    expect(exception.status).toBe('CON_BRECHAS');
    expect(exception.presentable).toBe(true);
    expect(exception.requiresException).toBe(true);
    expect(exception.exceptionApprovalLevels).toEqual(['SUPERADMIN']);

    const mixed = evaluatePolicy(facts, [
      rule({
        field: 'score',
        operator: 'gte',
        value: 700,
        exceptionAllowed: true,
      }),
      rule({ field: 'monthlyIncomeCOP', operator: 'gte', value: 9_000_000 }),
    ]);
    expect(mixed.presentable).toBe(false);

    // Missing data is never an exception: the person must complete it.
    const missing = evaluatePolicy(facts, [
      rule({
        field: 'ageYears',
        operator: 'gte',
        value: 18,
        exceptionAllowed: true,
      }),
    ]);
    expect(missing.presentable).toBe(false);
    expect(missing.requiresException).toBe(false);
  });

  it('is deterministic and independent of rule order in the input', () => {
    const rules = [
      rule({ field: 'score', operator: 'gte', value: 600, weight: 4 }),
      rule({ field: 'monthlyIncomeCOP', operator: 'gte', value: 3_000_000 }),
      rule({ field: 'currentArrears', kind: 'EXCLUSION', value: true }),
      rule({ field: 'ageYears', operator: 'gte', value: 18 }),
    ];
    const first = evaluatePolicy(facts, rules);
    const second = evaluatePolicy(facts, [...rules].reverse());
    expect(second).toEqual(first);
    expect(evaluatePolicy(facts, rules)).toEqual(first);
  });

  it('reproduces the stored result from the snapshot and the rule copy', () => {
    const rules = [
      rule({ field: 'score', operator: 'gte', value: 600, weight: 4 }),
      rule({ field: 'city', operator: 'in', value: ['Bogotá', 'Cali'] }),
      rule({
        field: 'documentsUploaded',
        operator: 'includes_all',
        value: ['BANK_STATEMENTS'],
      }),
      rule({ field: 'ageYears', operator: 'gte', value: 18 }),
    ];
    const original = evaluatePolicy(facts, rules);
    const stored = storedExplanation(original);
    // What the database keeps: canonical facts and a JSON copy of the rules.
    const snapshot = JSON.parse(canonicalJson({ facts })) as { facts: Facts };
    const rulesCopy = rulesFromSnapshot(JSON.parse(JSON.stringify(rules)));
    const replay = evaluatePolicy(snapshot.facts, rulesCopy);
    expect(replay.status).toBe(original.status);
    expect(replay.fitPercent).toBe(original.fitPercent);
    expect(canonicalJson(storedExplanation(replay))).toBe(
      canonicalJson(stored),
    );
  });

  it('keeps history stable when the policy changes afterwards', () => {
    const versionOne = [rule({ field: 'score', operator: 'gte', value: 600 })];
    const recorded = evaluatePolicy(facts, versionOne);
    const copy = rulesFromSnapshot(JSON.parse(JSON.stringify(versionOne)));
    // A stricter version comes into force later.
    const versionTwo = [rule({ field: 'score', operator: 'gte', value: 750 })];
    expect(evaluatePolicy(facts, versionTwo).status).toBe('CON_BRECHAS');
    // The historical result is still explained by the rules it used.
    expect(evaluatePolicy(facts, copy)).toEqual(recorded);
  });

  it('returns a neutral result for a policy without rules', () => {
    const result = evaluatePolicy(facts, []);
    expect(result).toMatchObject({ status: 'ELEGIBLE', fitPercent: 100 });
    expect(result.totals.rules).toBe(0);
  });
});

describe('rule engine · explanations', () => {
  const rules = [
    rule({ field: 'monthlyIncomeCOP', operator: 'gte', value: 4_000_000 }),
    rule({
      field: 'score',
      operator: 'gte',
      value: 720,
      internal: true,
      label: 'Puntaje mínimo interno',
    }),
    rule({
      field: 'maxDaysPastDue',
      kind: 'EXCLUSION',
      operator: 'gt',
      value: 30,
      internal: true,
      label: 'Mora superior a 30 días',
    }),
  ];
  const evaluation = evaluatePolicy(facts, rules);

  it('never stores the values of the person', () => {
    const stored = storedExplanation(evaluation);
    const json = JSON.stringify(stored);
    expect(json).not.toContain('2500000');
    expect(json).not.toContain('"actual"');
    expect(stored.gaps).toHaveLength(2);
    expect(stored.totals).toEqual(evaluation.totals);
  });

  it('hides internal rules from the person', () => {
    const view = explain(evaluation, 'user');
    const internal = [...view.gaps, ...view.passed].filter(
      (item) => item.internal,
    );
    expect(internal).toHaveLength(2);
    for (const item of internal) {
      expect(item.label).toBe(INTERNAL_RULE_LABEL);
      expect(item.field).toBeNull();
      expect(item.operator).toBeNull();
      expect(item.expected).toBeNull();
      expect(item.actual).toBeNull();
      expect(item.message).toMatch(/criterio interno/i);
    }
    const json = JSON.stringify(view);
    expect(json).not.toContain('720');
    expect(json).not.toContain('Puntaje mínimo interno');
    expect(json).not.toContain('Mora superior a 30 días');
    // The public rule keeps its detail and the person's own value.
    const open = view.gaps.find((item) => !item.internal);
    expect(open).toMatchObject({
      field: 'monthlyIncomeCOP',
      fieldLabel: 'Ingresos mensuales',
      actual: 2_500_000,
      expected: 4_000_000,
    });
  });

  it('gives staff the rule detail but not the values of the person', () => {
    const view = explain(storedExplanation(evaluation), 'staff');
    const gap = view.gaps.find((item) => item.field === 'score');
    expect(gap).toMatchObject({
      label: 'Puntaje mínimo interno',
      expected: 720,
      actual: null,
      actualText: null,
      weight: 1,
    });
    expect(JSON.stringify(view)).not.toContain('640');
  });

  it('never promises an approval or a score', () => {
    const texts = [
      headline('ELEGIBLE', false),
      headline('CON_BRECHAS', false),
      headline('CON_BRECHAS', true),
      headline('EXCLUIDO', false),
      ...explain(evaluation, 'user').gaps.map((item) => item.message),
    ].join(' ');
    expect(texts).not.toMatch(/garantiza(mos)? (la|tu) aprobaci[oó]n/i);
    expect(texts).not.toMatch(
      /ser[aá]s aprobad|te aprobar[aá]n|aprobaci[oó]n segura/i,
    );
    expect(texts).not.toMatch(/subir[aá] tu puntaje|aumentar[aá] tu puntaje/i);
    expect(headline('ELEGIBLE', false)).toContain(
      'La decisión final es de la entidad',
    );
  });

  it('has a label for every catalog field used in explanations', () => {
    for (const field of FACT_FIELDS) {
      const [item] = explain(
        evaluatePolicy({}, [rule({ field: field.key })]),
        'user',
      ).gaps;
      expect(item.fieldLabel).toBe(field.label);
      expect(item.outcome).toBe('DATO_FALTANTE');
    }
  });
});
