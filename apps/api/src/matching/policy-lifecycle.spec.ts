import {
  catalogView,
  describeCondition,
  FACT_FIELDS,
  OPERATORS_BY_TYPE,
  ruleIssues,
} from './fact-catalog';
import {
  allowedTransitions,
  approvalCheck,
  canTransition,
  isEditable,
  isInForce,
  POLICY_STATUSES,
  submissionIssues,
  transitionAction,
  type PolicyStatusName,
} from './policy-lifecycle';
import { productSchema, ruleSchema, transitionSchema } from './schemas';

describe('policy lifecycle', () => {
  it('follows borrador → revisión → aprobada → vigente → sustituida | suspendida', () => {
    expect(canTransition('BORRADOR', 'REVISION')).toBe(true);
    expect(canTransition('REVISION', 'APROBADA')).toBe(true);
    expect(canTransition('APROBADA', 'VIGENTE')).toBe(true);
    expect(canTransition('VIGENTE', 'SUSPENDIDA')).toBe(true);
    expect(canTransition('VIGENTE', 'SUSTITUIDA', { system: true })).toBe(true);
  });

  it('allows returning to draft and reactivating a suspended version', () => {
    expect(canTransition('REVISION', 'BORRADOR')).toBe(true);
    expect(canTransition('APROBADA', 'BORRADOR')).toBe(true);
    expect(canTransition('SUSPENDIDA', 'VIGENTE')).toBe(true);
  });

  it('rejects every transition that is not in the lifecycle', () => {
    const allowed = new Set([
      'BORRADOR>REVISION',
      'REVISION>BORRADOR',
      'REVISION>APROBADA',
      'APROBADA>VIGENTE',
      'APROBADA>BORRADOR',
      'VIGENTE>SUSPENDIDA',
      'SUSPENDIDA>VIGENTE',
    ]);
    for (const from of POLICY_STATUSES)
      for (const to of POLICY_STATUSES)
        expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
    // Skipping review or approval is impossible.
    expect(canTransition('BORRADOR', 'VIGENTE')).toBe(false);
    expect(canTransition('BORRADOR', 'APROBADA')).toBe(false);
    expect(canTransition('REVISION', 'VIGENTE')).toBe(false);
  });

  it('only the system supersedes, and a superseded version is final', () => {
    expect(canTransition('VIGENTE', 'SUSTITUIDA')).toBe(false);
    expect(canTransition('APROBADA', 'SUSTITUIDA', { system: true })).toBe(
      false,
    );
    expect(allowedTransitions('SUSTITUIDA')).toEqual([]);
    for (const to of POLICY_STATUSES)
      expect(canTransition('SUSTITUIDA', to, { system: true })).toBe(false);
  });

  it('lets rules change only while the version is a draft', () => {
    const editable = POLICY_STATUSES.filter((status) => isEditable(status));
    expect(editable).toEqual(['BORRADOR']);
  });

  it('names each transition for the history', () => {
    expect(transitionAction('BORRADOR', 'REVISION')).toBe('submitted');
    expect(transitionAction('REVISION', 'APROBADA')).toBe('approved');
    expect(transitionAction('APROBADA', 'VIGENTE')).toBe('activated');
    expect(transitionAction('VIGENTE', 'SUSTITUIDA')).toBe('superseded');
    expect(transitionAction('VIGENTE', 'SUSPENDIDA')).toBe('suspended');
  });

  it('requires a documentary source and valid rules before review', () => {
    const good = { field: 'score', operator: 'gte', value: 600 };
    expect(submissionIssues({ sourceDocument: 'Manual v3' }, [good])).toEqual(
      [],
    );
    expect(submissionIssues({ sourceDocument: ' ' }, [good])).toHaveLength(1);
    expect(submissionIssues({ sourceDocument: 'Manual v3' }, [])).toEqual([
      'Agrega al menos una regla.',
    ]);
    const issues = submissionIssues({ sourceDocument: 'Manual v3' }, [
      good,
      { field: 'score', operator: 'includes_any', value: [1] },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^Regla 2:/);
  });

  describe('independent approval', () => {
    const base = {
      authorIds: ['author'],
      authorRole: 'RISK',
      otherApproversAvailable: true,
    };
    it('accepts another person and records whether the role differs', () => {
      expect(
        approvalCheck({
          ...base,
          approverId: 'boss',
          approverRole: 'SUPERADMIN',
        }),
      ).toEqual({ allowed: true, independence: 'OTRO_ROL' });
      expect(
        approvalCheck({ ...base, approverId: 'peer', approverRole: 'RISK' }),
      ).toEqual({ allowed: true, independence: 'OTRA_PERSONA' });
    });
    it('blocks the author while someone else can approve', () => {
      expect(
        approvalCheck({ ...base, approverId: 'author', approverRole: 'RISK' }),
      ).toEqual({ allowed: false, independence: 'MISMA_PERSONA' });
      // The last editor counts as an author too.
      expect(
        approvalCheck({
          ...base,
          authorIds: ['author', 'editor'],
          approverId: 'editor',
          approverRole: 'SUPERADMIN',
        }).allowed,
      ).toBe(false);
    });
    it('allows self-approval only when nobody else exists, and flags it', () => {
      expect(
        approvalCheck({
          ...base,
          otherApproversAvailable: false,
          approverId: 'author',
          approverRole: 'RISK',
        }),
      ).toEqual({ allowed: true, independence: 'MISMA_PERSONA' });
    });
  });

  it('applies a version only while VIGENTE and inside its validity window', () => {
    const version = (
      status: PolicyStatusName,
      from: string | null,
      to: string | null,
    ) => ({ status, effectiveFrom: from, effectiveTo: to });
    expect(
      isInForce(version('VIGENTE', '2026-11-01', null), '2026-11-22'),
    ).toBe(true);
    expect(
      isInForce(version('VIGENTE', '2026-11-01', '2026-11-22'), '2026-11-22'),
    ).toBe(true);
    expect(
      isInForce(version('VIGENTE', '2026-11-01', '2026-11-21'), '2026-11-22'),
    ).toBe(false);
    expect(
      isInForce(version('VIGENTE', '2026-12-01', null), '2026-11-22'),
    ).toBe(false);
    expect(isInForce(version('VIGENTE', null, null), '2026-11-22')).toBe(false);
    for (const status of POLICY_STATUSES.filter((item) => item !== 'VIGENTE'))
      expect(isInForce(version(status, '2026-11-01', null), '2026-11-22')).toBe(
        false,
      );
    expect(
      isInForce(
        {
          status: 'VIGENTE',
          effectiveFrom: new Date('2026-11-01T00:00:00Z'),
          effectiveTo: null,
        },
        '2026-11-01',
      ),
    ).toBe(true);
  });
});

describe('fact catalog', () => {
  it('exposes the fields the specification asks for', () => {
    const keys = FACT_FIELDS.map((field) => field.key);
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
      'onTimeInstallments',
      'currentArrears',
      'debtToIncomeRatio',
      'availableCapacityCOP',
      'requestedAmountCOP',
      'requestedTermMonths',
      'documentsUploaded',
      'taxFormalization',
    ])
      expect(keys).toContain(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every field operators of its own type and options when closed', () => {
    for (const field of FACT_FIELDS) {
      expect(field.operators).toEqual(OPERATORS_BY_TYPE[field.type]);
      expect(field.label.length).toBeGreaterThan(2);
      if (field.type === 'enum' || field.type === 'list')
        expect(field.options.length).toBeGreaterThan(0);
    }
    const view = catalogView();
    expect(view.fields).toHaveLength(FACT_FIELDS.length);
    expect(view.operators.map((item) => item.key)).toContain('between');
    expect(view.ruleKinds.map((item) => item.key)).toEqual([
      'REQUISITO',
      'EXCLUSION',
      'PREFERENCIA',
    ]);
  });

  it('validates rules against the field type and the operator shape', () => {
    expect(ruleIssues({ field: 'score', operator: 'gte', value: 600 })).toEqual(
      [],
    );
    expect(
      ruleIssues({ field: 'ageYears', operator: 'between', value: [18, 28] }),
    ).toEqual([]);
    expect(
      ruleIssues({
        field: 'employmentSituation',
        operator: 'in',
        value: ['EMPLEADO', 'INDEPENDIENTE'],
      }),
    ).toEqual([]);
    expect(
      ruleIssues({ field: 'currentArrears', operator: 'eq', value: true }),
    ).toEqual([]);
    expect(
      ruleIssues({ field: 'city', operator: 'in', value: ['Bogotá'] }),
    ).toEqual([]);

    const invalid = [
      { field: 'unknown', operator: 'eq', value: 1 },
      { field: 'score', operator: 'includes_any', value: [1] },
      { field: 'score', operator: 'gte', value: '600' },
      { field: 'ageYears', operator: 'between', value: [28, 18] },
      { field: 'ageYears', operator: 'between', value: 18 },
      { field: 'employmentSituation', operator: 'eq', value: 'ASTRONAUTA' },
      { field: 'employmentSituation', operator: 'in', value: [] },
      { field: 'currentArrears', operator: 'eq', value: 'true' },
      { field: 'documentsUploaded', operator: 'includes_all', value: ['X'] },
    ];
    for (const rule of invalid)
      expect(ruleIssues(rule).length).toBeGreaterThan(0);
  });

  it('describes a condition in plain Spanish', () => {
    expect(
      describeCondition({
        field: 'monthlyIncomeCOP',
        operator: 'gte',
        value: 2_000_000,
      }),
    ).toBe('Ingresos mensuales mayor o igual a $2.000.000');
    expect(
      describeCondition({
        field: 'ageYears',
        operator: 'between',
        value: [18, 28],
      }),
    ).toBe('Edad entre 18 años y 28 años');
    expect(
      describeCondition({
        field: 'debtToIncomeRatio',
        operator: 'lte',
        value: 0.4,
      }),
    ).toBe('Endeudamiento (deuda / ingreso anual) menor o igual a 40%');
  });
});

describe('policy schemas', () => {
  it('fills the label and the exception level of a rule', () => {
    const rule = ruleSchema.parse({
      field: 'score',
      operator: 'gte',
      value: 600,
      kind: 'REQUISITO',
      exceptionAllowed: true,
    });
    expect(rule).toMatchObject({
      weight: 1,
      internal: false,
      label: 'Puntaje de crédito mayor o igual a 600 puntos',
      exceptionApprovalLevel: 'RISK',
    });
    const plain = ruleSchema.parse({
      field: 'score',
      operator: 'gte',
      value: 600,
      kind: 'PREFERENCIA',
      weight: 5,
      exceptionApprovalLevel: 'SUPERADMIN',
    });
    expect(plain.exceptionApprovalLevel).toBeNull();
    expect(plain.weight).toBe(5);
  });

  it('rejects malformed rules', () => {
    const base = {
      field: 'score',
      operator: 'gte',
      value: 600,
      kind: 'REQUISITO',
    };
    expect(ruleSchema.safeParse({ ...base, value: 'alto' }).success).toBe(
      false,
    );
    expect(ruleSchema.safeParse({ ...base, field: 'salary' }).success).toBe(
      false,
    );
    expect(ruleSchema.safeParse({ ...base, weight: 0 }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, kind: 'OPCIONAL' }).success).toBe(
      false,
    );
    // Only a requirement can admit an exception.
    expect(
      ruleSchema.safeParse({
        ...base,
        kind: 'EXCLUSION',
        exceptionAllowed: true,
      }).success,
    ).toBe(false);
  });

  it('validates product ranges and transition bodies', () => {
    const product = {
      institutionId: '0b8f7a52-6c1d-4a5e-9d3c-2f4e6a8b0c1d',
      name: 'Libre inversión joven',
      kind: 'LIBRE_INVERSION',
      minAmountCOP: 1_000_000,
      maxAmountCOP: 20_000_000,
      minTermMonths: 6,
      maxTermMonths: 60,
      referenceRateEA: 0.285,
    };
    expect(productSchema.safeParse(product).success).toBe(true);
    expect(
      productSchema.safeParse({ ...product, maxAmountCOP: 500_000 }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({ ...product, maxTermMonths: 3 }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({ ...product, kind: 'LEASING' }).success,
    ).toBe(false);
    expect(transitionSchema.safeParse({ to: 'VIGENTE' }).success).toBe(true);
    expect(transitionSchema.safeParse({ to: 'PUBLICADA' }).success).toBe(false);
    expect(
      transitionSchema.safeParse({ to: 'VIGENTE', effectiveFrom: '2026-02-30' })
        .success,
    ).toBe(false);
  });
});
