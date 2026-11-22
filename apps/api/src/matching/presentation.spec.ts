import type { Facts } from './fact-catalog';
import {
  ALLY_FUNNEL_MIN_GROUP,
  allyFunnelView,
  authorizationScope,
  authorizationText,
  canApproveException,
  INSTITUTION_VISIBLE_STATUSES,
  institutionCanAccess,
  institutionCanSeeApplicant,
  nextPresentationStatus,
  PRESENTATION_STATUSES,
  sharedData,
  type AllyFunnelKey,
} from './presentation';

const rules = [
  { field: 'score' },
  { field: 'monthlyIncomeCOP' },
  { field: 'score' },
  { field: 'currentArrears' },
];

const facts: Facts = {
  score: 640,
  monthlyIncomeCOP: 2_500_000,
  currentArrears: false,
  city: 'Bogotá',
  ageYears: 24,
  debtToIncomeRatio: 0.2,
  documentsUploaded: ['BANK_STATEMENTS'],
};

describe('presentation authorization', () => {
  const scope = authorizationScope(rules);

  it('limits the scope to contact data and the facts of that policy', () => {
    expect(scope.identity.map((item) => item.key)).toEqual([
      'fullName',
      'document',
      'phone',
      'email',
    ]);
    expect(scope.facts.map((item) => item.key).sort()).toEqual([
      'currentArrears',
      'monthlyIncomeCOP',
      'score',
    ]);
    expect(scope.facts.every((item) => item.label.length > 0)).toBe(true);
  });

  it('names the institution, the product and every shared datum', () => {
    const text = authorizationText({
      institutionName: 'Banco Ejemplo',
      productName: 'Libre inversión joven',
      scope,
    });
    expect(text).toContain('Banco Ejemplo');
    expect(text).toContain('«Libre inversión joven»');
    expect(text).toContain('Tureporte S.A.S.');
    expect(text).toContain('https://restaurar.co/privacy');
    for (const item of [...scope.identity, ...scope.facts])
      expect(text).toContain(item.label.toLowerCase());
    expect(text).toMatch(/no es una aprobación ni garantiza un resultado/);
    expect(text).toMatch(/revocar/);
    // The same inputs always give the same text (its hash is the evidence).
    expect(
      authorizationText({
        institutionName: 'Banco Ejemplo',
        productName: 'Libre inversión joven',
        scope: authorizationScope(rules),
      }),
    ).toBe(text);
  });

  it('shares only authorized data: nothing else from the profile leaves', () => {
    const shared = sharedData({
      scope,
      applicant: {
        fullName: 'Ana Pérez',
        document: '1020304050',
        phone: '+573001112233',
        email: 'ana@example.com',
      },
      facts,
      match: {
        status: 'ELEGIBLE',
        fitPercent: 100,
        policyVersion: 3,
        evaluatedAt: '2026-11-22T15:00:00.000Z',
        requiresException: false,
      },
    });
    expect(shared.facts.map((item) => item.key).sort()).toEqual([
      'currentArrears',
      'monthlyIncomeCOP',
      'score',
    ]);
    const json = JSON.stringify(shared);
    expect(json).not.toContain('Bogotá');
    expect(json).not.toContain('ageYears');
    expect(json).not.toContain('debtToIncomeRatio');
    expect(json).not.toContain('BANK_STATEMENTS');
    expect(
      shared.facts.find((item) => item.key === 'monthlyIncomeCOP'),
    ).toEqual({
      key: 'monthlyIncomeCOP',
      label: 'Ingresos mensuales',
      value: 2_500_000,
      display: '$2.500.000',
    });
    expect(Object.keys(shared.applicant).sort()).toEqual([
      'document',
      'email',
      'fullName',
      'phone',
    ]);
  });
});

describe('presentation lifecycle', () => {
  it('follows autorizada → presentada → aprobada | rechazada | desistida', () => {
    expect(
      nextPresentationStatus({
        from: 'AUTORIZADA',
        action: 'present',
        actor: 'STAFF',
      }),
    ).toBe('PRESENTADA');
    for (const decision of ['APROBADA', 'RECHAZADA', 'DESISTIDA'] as const)
      for (const actor of ['STAFF', 'INSTITUTION'] as const)
        expect(
          nextPresentationStatus({
            from: 'PRESENTADA',
            action: 'decide',
            actor,
            decision,
          }),
        ).toBe(decision);
  });

  it('lets the person revoke before presentation and withdraw afterwards', () => {
    expect(
      nextPresentationStatus({
        from: 'AUTORIZADA',
        action: 'revoke',
        actor: 'USER',
      }),
    ).toBe('REVOCADA');
    expect(
      nextPresentationStatus({
        from: 'PRESENTADA',
        action: 'revoke',
        actor: 'USER',
      }),
    ).toBe('DESISTIDA');
    for (const from of [
      'REVOCADA',
      'APROBADA',
      'RECHAZADA',
      'DESISTIDA',
    ] as const)
      expect(
        nextPresentationStatus({ from, action: 'revoke', actor: 'USER' }),
      ).toBeNull();
  });

  it('only LUFT staff marks a case as presented: nothing is sent automatically', () => {
    for (const actor of ['USER', 'INSTITUTION'] as const)
      expect(
        nextPresentationStatus({
          from: 'AUTORIZADA',
          action: 'present',
          actor,
        }),
      ).toBeNull();
    for (const from of PRESENTATION_STATUSES.filter(
      (status) => status !== 'AUTORIZADA',
    ))
      expect(
        nextPresentationStatus({ from, action: 'present', actor: 'STAFF' }),
      ).toBeNull();
  });

  it('rejects decisions out of order or by the wrong actor', () => {
    for (const from of PRESENTATION_STATUSES.filter(
      (status) => status !== 'PRESENTADA',
    ))
      expect(
        nextPresentationStatus({
          from,
          action: 'decide',
          actor: 'INSTITUTION',
          decision: 'APROBADA',
        }),
      ).toBeNull();
    expect(
      nextPresentationStatus({
        from: 'PRESENTADA',
        action: 'decide',
        actor: 'USER',
        decision: 'APROBADA',
      }),
    ).toBeNull();
    expect(
      nextPresentationStatus({
        from: 'PRESENTADA',
        action: 'decide',
        actor: 'STAFF',
      }),
    ).toBeNull();
    expect(
      nextPresentationStatus({
        from: 'AUTORIZADA',
        action: 'revoke',
        actor: 'STAFF',
      }),
    ).toBeNull();
  });
});

describe('institution visibility', () => {
  it('never shows a case before LUFT presents it, nor a revoked one', () => {
    expect(INSTITUTION_VISIBLE_STATUSES).not.toContain('AUTORIZADA');
    expect(INSTITUTION_VISIBLE_STATUSES).not.toContain('REVOCADA');
    for (const status of ['AUTORIZADA', 'REVOCADA'] as const)
      expect(
        institutionCanAccess({
          presentationInstitutionId: 'bank-a',
          linkInstitutionId: 'bank-a',
          status,
        }),
      ).toBe(false);
  });

  it('never shows the case of another institution or to an unlinked account', () => {
    for (const status of PRESENTATION_STATUSES) {
      expect(
        institutionCanAccess({
          presentationInstitutionId: 'bank-a',
          linkInstitutionId: 'bank-b',
          status,
        }),
      ).toBe(false);
      expect(
        institutionCanAccess({
          presentationInstitutionId: 'bank-a',
          linkInstitutionId: null,
          status,
        }),
      ).toBe(false);
    }
    expect(
      institutionCanAccess({
        presentationInstitutionId: 'bank-a',
        linkInstitutionId: 'bank-a',
        status: 'PRESENTADA',
      }),
    ).toBe(true);
  });

  it('keeps personal data only while the case is open or approved', () => {
    expect(institutionCanSeeApplicant('PRESENTADA')).toBe(true);
    expect(institutionCanSeeApplicant('APROBADA')).toBe(true);
    for (const status of [
      'AUTORIZADA',
      'REVOCADA',
      'RECHAZADA',
      'DESISTIDA',
    ] as const)
      expect(institutionCanSeeApplicant(status)).toBe(false);
  });
});

describe('exception approval', () => {
  it('requires the level of the rule or a higher one', () => {
    expect(canApproveException('RISK', ['RISK'])).toBe(true);
    expect(canApproveException('SUPERADMIN', ['RISK'])).toBe(true);
    expect(canApproveException('RISK', ['SUPERADMIN'])).toBe(false);
    expect(canApproveException('COMMERCIAL', ['RISK'])).toBe(false);
    expect(canApproveException('SUPERADMIN', ['RISK', 'SUPERADMIN'])).toBe(
      true,
    );
    expect(canApproveException('RISK', ['RISK', 'SUPERADMIN'])).toBe(false);
  });

  it('leaves an INSTITUTION-level exception to the entity itself', () => {
    expect(canApproveException('COMMERCIAL', ['INSTITUTION'])).toBe(true);
    expect(canApproveException('COMMERCIAL', [])).toBe(true);
    expect(canApproveException('COMMERCIAL', ['INSTITUTION', 'RISK'])).toBe(
      false,
    );
  });
});

describe('ally funnel', () => {
  const counts = (referred: number): Record<AllyFunnelKey, number> => ({
    referred,
    verified: Math.min(referred, 4),
    diagnosed: 3,
    profileCompleted: 2,
    creditApplied: 2,
    creditActive: 1,
    matched: 1,
    authorized: 1,
    presented: 1,
    approved: 0,
  });

  it('returns counts only, in funnel order', () => {
    const view = allyFunnelView(counts(12));
    expect(view.suppressed).toBe(false);
    expect(view.stages.map((stage) => stage.key)).toEqual([
      'referred',
      'verified',
      'diagnosed',
      'profileCompleted',
      'creditApplied',
      'creditActive',
      'matched',
      'authorized',
      'presented',
      'approved',
    ]);
    expect(view.stages[0].count).toBe(12);
    for (const stage of view.stages)
      expect(Object.keys(stage).sort()).toEqual(['count', 'key', 'label']);
    expect(JSON.stringify(view)).not.toMatch(/userId|fullName|email|document/);
  });

  it('hides the breakdown for small groups that could single someone out', () => {
    const view = allyFunnelView(counts(ALLY_FUNNEL_MIN_GROUP - 1));
    expect(view.suppressed).toBe(true);
    expect(view.stages[0].count).toBe(ALLY_FUNNEL_MIN_GROUP - 1);
    for (const stage of view.stages.slice(1)) expect(stage.count).toBeNull();
    expect(allyFunnelView(counts(ALLY_FUNNEL_MIN_GROUP)).suppressed).toBe(
      false,
    );
  });

  it('is a valid empty structure without referrals', () => {
    const view = allyFunnelView({
      referred: 0,
      verified: 0,
      diagnosed: 0,
      profileCompleted: 0,
      creditApplied: 0,
      creditActive: 0,
      matched: 0,
      authorized: 0,
      presented: 0,
      approved: 0,
    });
    expect(view.stages).toHaveLength(10);
    expect(view.stages[0].count).toBe(0);
  });
});
