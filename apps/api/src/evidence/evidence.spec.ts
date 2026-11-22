import { consentView, isActive } from '../consents/consent-catalog';
import { notificationFor } from '../notifications/notification-catalog';
import {
  buildEvidence,
  countVerified,
  effectiveStatus,
  stableStringify,
  type EvidenceFacts,
} from './evidence';

const facts = (overrides: Partial<EvidenceFacts> = {}): EvidenceFacts => ({
  kyc: [],
  inquiries: [],
  sections: {},
  documents: [],
  modules: [
    {
      id: 'm1',
      title: 'Conoce tu historial',
      lessons: [
        { key: 'score', title: 'Tu puntaje no te define' },
        { key: 'report', title: 'Lee tu reporte' },
      ],
    },
  ],
  lessons: [],
  installments: [],
  taxCase: null,
  ...overrides,
});

describe('evidence from real facts', () => {
  it('creates nothing without facts', () => {
    expect(buildEvidence(facts())).toEqual([]);
  });

  it('derives each evidence with its source, date, status and consent', () => {
    const drafts = buildEvidence(
      facts({
        kyc: [
          {
            id: 'k1',
            provider: 'TRUORA',
            status: 'COMPLETED',
            completedAt: new Date('2026-03-01'),
          },
          { id: 'k2', provider: 'TRUORA', status: 'FAILED', completedAt: null },
        ],
        inquiries: [
          {
            id: 'q1',
            type: 'INITIAL',
            provider: 'DATACREDITO',
            status: 'COMPLETED',
            score: 668,
            existingHistory: true,
            completedAt: new Date('2026-02-01'),
          },
          {
            id: 'q2',
            type: 'FINAL',
            provider: 'DATACREDITO',
            status: 'CONFIGURATION_REQUIRED',
            score: null,
            existingHistory: null,
            completedAt: new Date('2026-09-01'),
          },
        ],
        sections: { income: '2026-02-10T00:00:00.000Z' },
        documents: [
          {
            id: 'd1',
            kind: 'BANK_STATEMENTS',
            fileName: 'extracto.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 10,
            sha256: 'abc',
            uploadedAt: '2026-02-11T00:00:00.000Z',
          },
        ],
        lessons: [
          {
            moduleId: 'm1',
            lessonKey: 'score',
            completedAt: new Date('2026-02-12'),
          },
          {
            moduleId: 'm1',
            lessonKey: 'report',
            completedAt: new Date('2026-02-14'),
          },
          {
            moduleId: 'gone',
            lessonKey: 'x',
            completedAt: new Date('2026-02-15'),
          },
        ],
        installments: [
          {
            id: 'i1',
            sequence: 1,
            status: 'PAID',
            dueDate: new Date('2026-04-15'),
            paidAt: new Date('2026-04-14T20:00:00Z'),
          },
          {
            id: 'i2',
            sequence: 2,
            status: 'PAID',
            dueDate: new Date('2026-05-15'),
            paidAt: new Date('2026-05-20T10:00:00Z'),
          },
          {
            id: 'i3',
            sequence: 3,
            status: 'PENDING',
            dueDate: new Date('2026-06-15'),
            paidAt: null,
          },
        ],
        taxCase: {
          id: 't1',
          taxYear: 2025,
          status: 'VERIFICADO',
          verifiedAt: new Date('2026-08-01'),
          verifiedBy: 'staff-1',
        },
      }),
    );
    const byRef = new Map(drafts.map((draft) => [draft.sourceRef, draft]));
    expect([...byRef.keys()].sort()).toEqual(
      [
        'kyc:k1',
        'inquiry:q1',
        'section:income',
        'document:d1',
        'lesson:m1:score',
        'lesson:m1:report',
        'module:m1',
        'installment:i1',
        'tax-case:t1',
      ].sort(),
    );
    expect(byRef.get('kyc:k1')).toMatchObject({
      type: 'IDENTITY_VERIFIED',
      sourceKind: 'KYC_PROVIDER',
      status: 'VERIFIED',
      validatedBy: 'TRUORA',
      consentKind: 'STARTIF_CREDIT',
    });
    // The bureau result is sensitive (stored encrypted) and expires.
    expect(byRef.get('inquiry:q1')).toMatchObject({
      type: 'BUREAU_INQUIRY',
      status: 'VERIFIED',
      sensitive: true,
      consentKind: 'BUREAU_QUERY',
      value: { score: 668 },
      validUntil: new Date('2026-07-31'),
    });
    // What the user declares or uploads is not "verified" until someone validates it.
    expect(byRef.get('section:income')?.status).toBe('DECLARED');
    expect(byRef.get('document:d1')).toMatchObject({
      status: 'PENDING',
      sourceKind: 'USER_DOCUMENT',
    });
    expect(byRef.get('module:m1')).toMatchObject({
      type: 'MODULE_COMPLETED',
      occurredAt: new Date('2026-02-14'),
    });
    expect(byRef.get('installment:i1')?.label).toBe('Cuota 1 pagada a tiempo');
    expect(byRef.get('tax-case:t1')).toMatchObject({
      sourceKind: 'PROFESSIONAL_REVIEW',
      validatedBy: 'staff-1',
      consentKind: 'TAX_ASSISTANCE',
    });
  });

  it('is deterministic, so syncing twice changes nothing', () => {
    const input = facts({
      sections: { income: '2026-02-10T00:00:00.000Z' },
      lessons: [
        {
          moduleId: 'm1',
          lessonKey: 'score',
          completedAt: new Date('2026-02-12'),
        },
      ],
    });
    expect(buildEvidence(input)).toEqual(buildEvidence(input));
    expect(buildEvidence(input).map((draft) => draft.sourceRef)).toEqual([
      'section:income',
      'lesson:m1:score',
    ]);
  });

  it('does not treat an unverified tax case as evidence', () => {
    for (const status of ['REVISION', 'PRESENTADO'])
      expect(
        buildEvidence(
          facts({
            taxCase: {
              id: 't1',
              taxYear: 2025,
              status,
              verifiedAt: null,
              verifiedBy: null,
            },
          }),
        ),
      ).toEqual([]);
  });

  it('counts as verified only what is validated and still in force', () => {
    const now = new Date('2026-11-22');
    const rows = [
      { status: 'VERIFIED', validUntil: null },
      { status: 'VERIFIED', validUntil: new Date('2026-12-31') },
      { status: 'VERIFIED', validUntil: new Date('2026-06-30') },
      { status: 'DECLARED', validUntil: null },
      { status: 'PENDING', validUntil: null },
      { status: 'WITHDRAWN', validUntil: new Date('2026-01-01') },
    ];
    expect(countVerified(rows, now)).toBe(2);
    expect(effectiveStatus(rows[2], now)).toBe('EXPIRED');
    expect(effectiveStatus(rows[5], now)).toBe('WITHDRAWN');
  });

  it('hashes equal profile content equally regardless of key order', () => {
    expect(
      stableStringify({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }),
    ).toBe(stableStringify({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }));
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('notifications catalog', () => {
  it('turns whitelisted events into Spanish notifications with a link', () => {
    expect(
      notificationFor('payment:status', {
        paymentId: 'p1',
        status: 'APPROVED',
      }),
    ).toEqual({
      kind: 'payment',
      title: 'Recibimos tu pago',
      body: 'Tu pago fue confirmado y ya se refleja en tu plan.',
      href: '/app/historial',
      dedupeKey: 'payment:p1:APPROVED',
    });
    expect(
      notificationFor('credit:decision', {
        applicationId: 'a1',
        status: 'REJECTED',
      })?.href,
    ).toBe('/app/credito');
    expect(
      notificationFor('score:status', { id: 's1', status: 'COMPLETED' })?.kind,
    ).toBe('score');
    expect(
      notificationFor('kyc:status', { id: 'k1', status: 'COMPLETED' })?.title,
    ).toBe('Validamos tu identidad');
    expect(
      notificationFor('pqr:status', { id: 'q1', status: 'RESOLVED' })?.href,
    ).toBe('/app/pqr');
    expect(
      notificationFor('household:invitation', {
        status: 'ACCEPTED',
        invitationId: 'i1',
        memberName: 'Laura',
        role: 'BENEFICIARY',
      }),
    ).toMatchObject({
      kind: 'household',
      title: 'Laura aceptó tu invitación',
      href: '/app/familia',
    });
    expect(
      notificationFor('household:contribution', {
        status: 'DECLARED',
        contributionId: 'c1',
        goalTitle: 'Semestre 2027-1',
        contributorName: 'Ana',
      })?.body,
    ).toContain('Ana declaró un aporte a Semestre 2027-1');
    expect(
      notificationFor('formalization:status', {
        caseId: 'f1',
        eventId: 'e1',
        status: 'VERIFICADO',
      }),
    ).toMatchObject({ kind: 'formalization', href: '/app/formalizacion' });
    expect(
      notificationFor('cards:guidance', {
        guidanceId: 'g1',
        title: 'Tu tarjeta está al 80% del cupo',
        body: 'Abona antes del corte.',
      }),
    ).toMatchObject({ kind: 'guidance', dedupeKey: 'guidance:guidance:g1' });
  });

  it('ignores other events and statuses that are not news', () => {
    expect(notificationFor('profile:updated', { archetype: 'X' })).toBeNull();
    expect(notificationFor('route:updated', { stage: 'FORMACION' })).toBeNull();
    expect(
      notificationFor('score:status', { id: 's1', status: 'PENDING' }),
    ).toBeNull();
    expect(
      notificationFor('kyc:status', { id: 'k1', status: 'PROCESSING' }),
    ).toBeNull();
    expect(
      notificationFor('payment:status', { paymentId: 'p1', status: 'CREATED' }),
    ).toBeNull();
    expect(
      notificationFor('formalization:status', {
        caseId: 'f1',
        status: 'NO_REQUIERE',
      }),
    ).toBeNull();
  });

  it('never promises a score increase', () => {
    const samples = [
      notificationFor('score:status', { id: 's', status: 'COMPLETED' }),
      notificationFor('credit:decision', { id: 'a', status: 'ACTIVE' }),
      notificationFor('payment:status', { id: 'p', status: 'APPROVED' }),
    ];
    for (const sample of samples)
      expect(`${sample?.title} ${sample?.body}`).not.toMatch(
        /subir|aumentar|mejorar(á|a) tu puntaje/i,
      );
  });
});

describe('consents (habeas data)', () => {
  const record = (
    id: string,
    kind: string,
    acceptedAt: string,
    extra: { revokedAt?: string; expiresAt?: string } = {},
  ) => ({
    id,
    kind,
    version: '2026-09-01',
    acceptedAt: new Date(acceptedAt),
    revokedAt: extra.revokedAt ? new Date(extra.revokedAt) : null,
    expiresAt: extra.expiresAt ? new Date(extra.expiresAt) : null,
    scope: null,
  });
  const now = new Date('2026-11-22');

  it('lists current and historical consents with purpose, scope and status', () => {
    const view = consentView(
      [
        record('c1', 'DATA_PROCESSING', '2026-01-01'),
        record('c2', 'BUREAU_QUERY', '2026-01-02', { revokedAt: '2026-03-01' }),
        record('c3', 'BUREAU_QUERY', '2026-04-01'),
        record('c4', 'BUREAU_QUERY', '2026-05-01'),
        record('c5', 'OPEN_FINANCE', '2026-06-01', { expiresAt: '2026-09-01' }),
      ],
      now,
    );
    const status = Object.fromEntries(view.map((row) => [row.id, row.status]));
    expect(status).toEqual({
      c1: 'ACTIVE',
      c2: 'REVOKED',
      c3: 'SUPERSEDED',
      c4: 'ACTIVE',
      c5: 'EXPIRED',
    });
    expect(view[0].id).toBe('c5');
    const bureau = view.find((row) => row.id === 'c4');
    expect(bureau).toMatchObject({
      title: 'Consulta en centrales de riesgo',
      revocable: true,
      version: '2026-09-01',
    });
    expect(bureau?.purpose).toContain('operadores de información');
    expect(bureau?.scope.length).toBeGreaterThan(0);
    expect(bureau?.revokeEffect).toContain('No haremos nuevas consultas');
  });

  it('does not allow revoking basic data processing outside account closure', () => {
    const [basic] = consentView(
      [record('c1', 'DATA_PROCESSING', '2026-01-01')],
      now,
    );
    expect(basic.revocable).toBe(false);
    expect(basic.revokeEffect).toContain('cerrar tu cuenta');
  });

  it('treats revoked or expired consents as not in force', () => {
    expect(isActive(record('a', 'BUREAU_QUERY', '2026-01-01'), now)).toBe(true);
    expect(
      isActive(
        record('a', 'BUREAU_QUERY', '2026-01-01', { revokedAt: '2026-02-01' }),
        now,
      ),
    ).toBe(false);
    expect(
      isActive(
        record('a', 'OPEN_FINANCE', '2026-01-01', { expiresAt: '2026-02-01' }),
        now,
      ),
    ).toBe(false);
  });
});
