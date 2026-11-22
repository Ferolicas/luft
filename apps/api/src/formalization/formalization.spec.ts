import {
  canTransition,
  FORMALIZATION_STATUSES,
  formalizationSettled,
  phaseOf,
  preparationReady,
  staffActions,
  statusAfterDiagnosis,
  statusAfterObservation,
  taxRuleInputSchema,
  userActions,
  type FormalizationStatus,
} from './formalization';

const check = (mayHaveToFile: boolean, ready = true, available = true) => ({
  ready,
  available,
  mayHaveToFile,
});

describe('formalization case', () => {
  it('follows the specified path through both branches', () => {
    const upload: FormalizationStatus[] = [
      'SIN_EVALUAR',
      'POSIBLE_OBLIGACION',
      'DOCUMENTO_CARGADO',
      'REVISION',
      'PRESENTADO',
      'VERIFICADO',
    ];
    const guided: FormalizationStatus[] = [
      'SIN_EVALUAR',
      'NO_REQUIERE',
      'POSIBLE_OBLIGACION',
      'PREPARACION_GUIADA',
      'REVISION',
      'PRESENTADO',
      'VERIFICADO',
    ];
    for (const path of [upload, guided])
      for (let index = 1; index < path.length; index += 1)
        expect(canTransition(path[index - 1], path[index])).toBe(true);
  });

  it('blocks shortcuts: nothing is verified without review and filing', () => {
    expect(canTransition('SIN_EVALUAR', 'VERIFICADO')).toBe(false);
    expect(canTransition('POSIBLE_OBLIGACION', 'REVISION')).toBe(false);
    expect(canTransition('DOCUMENTO_CARGADO', 'PRESENTADO')).toBe(false);
    expect(canTransition('DOCUMENTO_CARGADO', 'VERIFICADO')).toBe(false);
    expect(canTransition('REVISION', 'VERIFICADO')).toBe(false);
    for (const status of FORMALIZATION_STATUSES)
      expect(canTransition('VERIFICADO', status)).toBe(false);
  });

  it('treats the diagnosis as an alert that never overrides work in progress', () => {
    expect(statusAfterDiagnosis('SIN_EVALUAR', check(true))).toBe(
      'POSIBLE_OBLIGACION',
    );
    expect(statusAfterDiagnosis('SIN_EVALUAR', check(false))).toBe(
      'NO_REQUIERE',
    );
    expect(statusAfterDiagnosis('NO_REQUIERE', check(true))).toBe(
      'POSIBLE_OBLIGACION',
    );
    expect(statusAfterDiagnosis('POSIBLE_OBLIGACION', check(false))).toBe(
      'NO_REQUIERE',
    );
    // Incomplete profile or no approved rule for the year: nothing is decided.
    expect(statusAfterDiagnosis('SIN_EVALUAR', check(true, false))).toBe(
      'SIN_EVALUAR',
    );
    expect(statusAfterDiagnosis('SIN_EVALUAR', check(true, true, false))).toBe(
      'SIN_EVALUAR',
    );
    for (const status of [
      'DOCUMENTO_CARGADO',
      'PREPARACION_GUIADA',
      'REVISION',
      'PRESENTADO',
      'VERIFICADO',
    ] as const)
      expect(statusAfterDiagnosis(status, check(false))).toBe(status);
  });

  it('tells draft, review, signature/filing and verified evidence apart', () => {
    expect(phaseOf('POSIBLE_OBLIGACION', false)).toBe('DIAGNOSIS');
    expect(phaseOf('DOCUMENTO_CARGADO', false)).toBe('DRAFT');
    expect(phaseOf('PREPARACION_GUIADA', false)).toBe('DRAFT');
    expect(phaseOf('REVISION', false)).toBe('REVIEW');
    expect(phaseOf('REVISION', true)).toBe('SIGNATURE_AND_FILING');
    expect(phaseOf('PRESENTADO', true)).toBe('SIGNATURE_AND_FILING');
    expect(phaseOf('VERIFICADO', true)).toBe('VERIFIED_EVIDENCE');
    expect(formalizationSettled('NO_REQUIERE')).toBe(true);
    expect(formalizationSettled('VERIFICADO')).toBe(true);
    expect(formalizationSettled('PRESENTADO')).toBe(false);
  });

  it('offers the user only the actions valid for the case', () => {
    const facts = {
      hasConsent: true,
      declarationDocuments: 0,
      preparationReady: false,
    };
    expect(userActions({ ...facts, status: 'SIN_EVALUAR' })).toEqual([
      'DIAGNOSE',
    ]);
    expect(userActions({ ...facts, status: 'POSIBLE_OBLIGACION' })).toEqual([
      'DIAGNOSE',
      'ANSWER_FILED',
      'UPLOAD_DECLARATION',
      'UPLOAD_SUPPORT',
      'SAVE_PREPARATION',
    ]);
    // Without the authorization no document can be uploaded or sent to review.
    expect(
      userActions({
        ...facts,
        hasConsent: false,
        status: 'DOCUMENTO_CARGADO',
        declarationDocuments: 1,
      }),
    ).toEqual(['SAVE_PREPARATION', 'DELETE_DOCUMENT']);
    expect(
      userActions({ ...facts, status: 'DOCUMENTO_CARGADO' }),
    ).not.toContain('SUBMIT_FOR_REVIEW');
    expect(
      userActions({
        ...facts,
        status: 'DOCUMENTO_CARGADO',
        declarationDocuments: 1,
      }),
    ).toContain('SUBMIT_FOR_REVIEW');
    expect(
      userActions({ ...facts, status: 'PREPARACION_GUIADA' }),
    ).not.toContain('SUBMIT_FOR_REVIEW');
    expect(
      userActions({
        ...facts,
        status: 'PREPARACION_GUIADA',
        preparationReady: true,
      }),
    ).toContain('SUBMIT_FOR_REVIEW');
    for (const status of ['REVISION', 'PRESENTADO', 'VERIFICADO'] as const)
      expect(userActions({ ...facts, status })).toEqual([]);
  });

  it('gives the professional the review queue actions in order', () => {
    expect(staffActions('REVISION', false)).toEqual(['OBSERVE', 'APPROVE']);
    expect(staffActions('REVISION', true)).toEqual(['OBSERVE', 'MARK_FILED']);
    expect(staffActions('PRESENTADO', true)).toEqual(['OBSERVE', 'VERIFY']);
    expect(staffActions('DOCUMENTO_CARGADO', false)).toEqual([]);
    expect(staffActions('VERIFICADO', true)).toEqual([]);
    expect(statusAfterObservation('REVISION', 'UPLOAD')).toBe(
      'DOCUMENTO_CARGADO',
    );
    expect(statusAfterObservation('REVISION', 'GUIDED')).toBe(
      'PREPARACION_GUIADA',
    );
    expect(statusAfterObservation('PRESENTADO', 'UPLOAD')).toBe('REVISION');
    expect(
      canTransition('REVISION', statusAfterObservation('REVISION', null)),
    ).toBe(true);
  });

  it('requires at least the incomes to send a guided preparation', () => {
    expect(preparationReady(null)).toBe(false);
    expect(
      preparationReady({ incomes: [], holdings: [], deductions: [] }),
    ).toBe(false);
    expect(
      preparationReady({ incomes: ['SALARIO'], holdings: [], deductions: [] }),
    ).toBe(true);
    expect(preparationReady({ incomes: ['BITCOIN'] })).toBe(false);
  });

  it('validates a tax rule version before it can be stored', () => {
    const rule = {
      taxYear: 2026,
      uvtCOP: 52_000,
      wealthUvt: 4_500,
      incomeUvt: 1_400,
      cardSpendUvt: 1_400,
      purchasesUvt: 1_400,
      depositsUvt: 1_400,
      sourceDocument: 'Resolución de la DIAN que fija la UVT del año',
      effectiveFrom: '2026-01-01',
    };
    expect(taxRuleInputSchema.safeParse(rule).success).toBe(true);
    expect(taxRuleInputSchema.safeParse({ ...rule, uvtCOP: 0 }).success).toBe(
      false,
    );
    expect(
      taxRuleInputSchema.safeParse({ ...rule, sourceDocument: 'corta' })
        .success,
    ).toBe(false);
    expect(
      taxRuleInputSchema.safeParse({ ...rule, effectiveTo: '2025-12-31' })
        .success,
    ).toBe(false);
  });
});
