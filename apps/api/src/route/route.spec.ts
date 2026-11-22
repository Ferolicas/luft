import {
  archetypeFacts,
  capacityFacts,
  creditFact,
  routeFacts,
  splitCredits,
  type CreditApplicationFacts,
  type ProfileFactsInput,
} from './facts';
import {
  advance,
  canStartNewRoute,
  nextStep,
  NO_CREDIT,
  ROUTE_STAGES,
  routeProgress,
  stageReached,
  targetStage,
  visibleStages,
  type RouteFacts,
} from './route';

const base: RouteFacts = {
  classified: false,
  bureauRequested: false,
  bureauCompleted: false,
  archetypeAssigned: false,
  incomeDeclared: false,
  formalization: 'SIN_EVALUAR',
  requiredDocuments: 1,
  requiredDocumentsUploaded: 0,
  lessonsCompleted: 0,
  modulesCompleted: 0,
  credit1: NO_CREDIT,
  credit2: NO_CREDIT,
  finalScoreCompleted: false,
  matchingAvailable: false,
  lifeProjects: 0,
};
const facts = (overrides: Partial<RouteFacts>): RouteFacts => ({
  ...base,
  ...overrides,
});
const credit = (
  state: RouteFacts['credit1']['state'],
  paid = 0,
  total = 6,
) => ({
  state,
  installmentsPaid: paid,
  installmentsTotal: total,
  overdue: 0,
});

describe('route state machine', () => {
  it('walks the ten stages in order, only with real facts', () => {
    const diagnosed = { classified: true, bureauCompleted: true };
    const formalizing = { ...diagnosed, incomeDeclared: true };
    const learning = { ...formalizing, formalization: 'NO_REQUIERE' as const };
    const finalProfile = {
      ...learning,
      credit1: credit('COMPLETED', 6),
      finalScoreCompleted: true,
    };
    const journey: Array<[Partial<RouteFacts>, string]> = [
      [{}, 'REGISTRADO'],
      [{ classified: true }, 'REGISTRADO'],
      [diagnosed, 'DIAGNOSTICADO'],
      [formalizing, 'FORMALIZACION'],
      [
        { ...formalizing, formalization: 'POSIBLE_OBLIGACION' },
        'FORMALIZACION',
      ],
      [learning, 'FORMACION'],
      [{ ...learning, credit1: credit('IN_PROCESS') }, 'CREDITO_1'],
      [{ ...learning, credit1: credit('ACTIVE', 2) }, 'SEGUIMIENTO'],
      [{ ...learning, credit1: credit('COMPLETED', 6) }, 'CREDITO_2_OPCIONAL'],
      [finalProfile, 'PERFIL_FINAL'],
      [{ ...finalProfile, matchingAvailable: true }, 'MATCHING'],
      [
        { ...finalProfile, matchingAvailable: true, lifeProjects: 1 },
        'RELACION_CONTINUA',
      ],
    ];
    for (const [overrides, stage] of journey)
      expect(targetStage(facts(overrides))).toBe(stage);
  });

  it('keeps the final profile closed while a second credit is running', () => {
    const closed = facts({
      classified: true,
      bureauCompleted: true,
      credit1: credit('COMPLETED', 6),
      finalScoreCompleted: true,
    });
    expect(targetStage({ ...closed, credit2: credit('ACTIVE', 1) })).toBe(
      'CREDITO_2_OPCIONAL',
    );
    expect(targetStage({ ...closed, credit2: credit('COMPLETED', 6) })).toBe(
      'PERFIL_FINAL',
    );
    // A rejected first application does not count as credit history.
    expect(stageReached(facts({ credit1: credit('REJECTED') })).CREDITO_1).toBe(
      false,
    );
  });

  it('never goes back and records one transition per stage', () => {
    const active = facts({ credit1: credit('ACTIVE', 1) });
    const steps = advance('REGISTRADO', active);
    expect(steps.map((step) => step.to)).toEqual([
      'DIAGNOSTICADO',
      'FORMALIZACION',
      'FORMACION',
      'CREDITO_1',
      'SEGUIMIENTO',
    ]);
    // Earlier stages were not backed by their own facts: the credit pulled the route.
    expect(steps[0].reason).toBe('passed_by_later_evidence');
    expect(steps[4].reason).toBe('credit_1_active');
    expect(advance('SEGUIMIENTO', active)).toEqual([]);
    expect(advance('MATCHING', facts({}))).toEqual([]);
    expect(
      advance('REGISTRADO', facts({ classified: true, bureauCompleted: true })),
    ).toEqual([
      {
        from: 'REGISTRADO',
        to: 'DIAGNOSTICADO',
        reason: 'classification_and_bureau_completed',
      },
    ]);
  });

  it('shows the five visible stages with their status and checklist', () => {
    const stages = visibleStages(
      facts({
        classified: true,
        bureauCompleted: true,
        archetypeAssigned: true,
        incomeDeclared: true,
        formalization: 'POSIBLE_OBLIGACION',
      }),
    );
    expect(stages.map((stage) => stage.title)).toEqual([
      'Conócete',
      'Formalízate',
      'Prepárate',
      'Demuestra',
      'Avanza',
    ]);
    expect(stages.map((stage) => stage.status)).toEqual([
      'DONE',
      'CURRENT',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    expect(stages.flatMap((stage) => stage.machineStages)).toEqual([
      ...ROUTE_STAGES,
    ]);
    expect(nextStep(stages)).toMatchObject({
      key: 'tax-settled',
      stage: 'FORMALIZATE',
      href: '/app/formalizacion',
    });
    expect(routeProgress(stages)).toBe(Math.round((5 / 15) * 100));
  });

  it('recommends the first step the user can act on, skipping what waits on a third party', () => {
    const waiting = visibleStages(
      facts({
        classified: true,
        archetypeAssigned: true,
        bureauRequested: true,
      }),
    );
    expect(waiting[0].items.find((row) => row.key === 'bureau')).toMatchObject({
      done: false,
      waiting: true,
    });
    expect(nextStep(waiting)?.key).toBe('income');
    expect(nextStep(visibleStages(facts({})))?.key).toBe('classification');
    const optional = visibleStages(
      facts({ credit1: credit('COMPLETED', 6) }),
    )[3];
    expect(optional.items.find((row) => row.key === 'credit-2')).toMatchObject({
      optional: true,
      done: false,
    });
    expect(optional.status).not.toBe('PENDING');
    const done = visibleStages(
      facts({
        classified: true,
        bureauCompleted: true,
        archetypeAssigned: true,
        incomeDeclared: true,
        formalization: 'VERIFICADO',
        requiredDocumentsUploaded: 1,
        lessonsCompleted: 3,
        modulesCompleted: 1,
        credit1: credit('COMPLETED', 6),
        finalScoreCompleted: true,
        matchingAvailable: true,
        lifeProjects: 1,
      }),
    );
    expect(nextStep(done)).toBeNull();
    expect(routeProgress(done)).toBe(100);
  });

  it('opens a new route only after the final profile', () => {
    expect(canStartNewRoute('SEGUIMIENTO')).toBe(false);
    expect(canStartNewRoute('PERFIL_FINAL')).toBe(true);
    expect(canStartNewRoute('RELACION_CONTINUA')).toBe(true);
  });
});

const installment = (
  sequence: number,
  status: string,
  paidAt: string | null = null,
) => ({
  id: `i${sequence}`,
  sequence,
  status,
  dueDate: new Date(`2026-0${sequence}-15`),
  paidAt: paidAt ? new Date(paidAt) : null,
  amountCOP: 100_000n,
});
const application = (
  overrides: Partial<CreditApplicationFacts>,
): CreditApplicationFacts => ({
  id: 'a',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01'),
  loan: null,
  ...overrides,
});
const input = (overrides: Partial<ProfileFactsInput>): ProfileFactsInput => ({
  classification: null,
  context: {},
  sections: {},
  documents: [],
  currentScore: null,
  existingHistory: null,
  inquiries: [],
  modules: [{ id: 'm1', lessons: [{ key: 'a' }, { key: 'b' }] }],
  lessons: [],
  applications: [],
  formalizationStatus: null,
  household: null,
  projects: [],
  opportunities: 0,
  ...overrides,
});

describe('facts from stored data', () => {
  it('reads the credit state from the StartIF application and loan', () => {
    expect(creditFact(undefined).state).toBe('NONE');
    expect(creditFact(application({ status: 'PENDING_KYC' })).state).toBe(
      'IN_PROCESS',
    );
    expect(creditFact(application({ status: 'REJECTED' })).state).toBe(
      'REJECTED',
    );
    const active = creditFact(
      application({
        loan: {
          status: 'ACTIVE',
          closedAt: null,
          installments: [
            installment(1, 'PAID', '2026-01-10'),
            installment(2, 'OVERDUE'),
            installment(3, 'PENDING'),
          ],
        },
      }),
    );
    expect(active).toEqual({
      state: 'ACTIVE',
      installmentsPaid: 1,
      installmentsTotal: 3,
      overdue: 1,
    });
    for (const status of ['DEFAULTED', 'WRITTEN_OFF'])
      expect(
        creditFact(
          application({ loan: { status, closedAt: null, installments: [] } }),
        ).state,
      ).toBe('DEFAULTED');
  });

  it('tells builder credit 1 from builder credit 2', () => {
    const paid = {
      status: 'COMPLETED',
      closedAt: new Date('2026-07-01'),
      installments: [installment(1, 'PAID', '2026-01-10')],
    };
    const first = application({ id: 'one', loan: paid });
    const later = application({
      id: 'two',
      status: 'PENDING_KYC',
      createdAt: new Date('2026-08-01'),
    });
    expect(splitCredits([later, first])).toMatchObject({
      first: { id: 'one' },
      second: { id: 'two' },
    });
    // While credit 1 is running, a newer application is not a second credit.
    const running = application({
      id: 'one',
      loan: { ...paid, status: 'ACTIVE' },
    });
    expect(splitCredits([running, later]).second).toBeUndefined();
    // When StartIF labels the product, the label decides.
    expect(
      splitCredits([
        { ...later, productCode: 'BUILDER_2' },
        { ...first, productCode: 'BUILDER_1' },
      ]),
    ).toMatchObject({ first: { id: 'one' }, second: { id: 'two' } });
  });

  it('builds route facts and scopes a later route to what happened since it started', () => {
    const data = input({
      classification: { goal: 'START', creditExperience: 'NONE' },
      sections: { employment: '2026-01-01', income: '2026-01-01' },
      documents: [
        {
          id: 'd',
          kind: 'BANK_STATEMENTS',
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'x',
          uploadedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      inquiries: [
        { type: 'FINAL', status: 'PENDING' },
        { type: 'INITIAL', status: 'COMPLETED' },
      ],
      lessons: [
        { moduleId: 'm1', lessonKey: 'a', completedAt: new Date('2026-02-01') },
        { moduleId: 'm1', lessonKey: 'b', completedAt: new Date('2026-02-02') },
      ],
      applications: [application({ status: 'PENDING_KYC' })],
      formalizationStatus: 'NO_REQUIERE',
      projects: [
        { kind: 'VIVIENDA', status: 'ACTIVE' },
        { kind: 'OTRO', status: 'CANCELLED' },
      ],
      opportunities: 2,
    });
    const options = {
      archetypeAssigned: true,
      requiredDocuments: ['BANK_STATEMENTS', 'SOCIAL_SECURITY'] as Array<
        'BANK_STATEMENTS' | 'SOCIAL_SECURITY'
      >,
    };
    expect(routeFacts(data, options)).toMatchObject({
      classified: true,
      bureauCompleted: true,
      bureauRequested: false,
      incomeDeclared: true,
      formalization: 'NO_REQUIERE',
      requiredDocuments: 2,
      requiredDocumentsUploaded: 1,
      lessonsCompleted: 2,
      modulesCompleted: 1,
      credit1: { state: 'IN_PROCESS' },
      finalScoreCompleted: false,
      matchingAvailable: true,
      lifeProjects: 1,
    });
    expect(
      routeFacts(data, { ...options, since: new Date('2026-06-01') }),
    ).toMatchObject({
      lessonsCompleted: 0,
      modulesCompleted: 0,
      credit1: { state: 'NONE' },
    });
    expect(
      routeFacts(
        input({
          inquiries: [{ type: 'INITIAL', status: 'CONFIGURATION_REQUIRED' }],
        }),
        options,
      ),
    ).toMatchObject({ bureauRequested: true, bureauCompleted: false });
  });

  it('derives archetype facts and the declared monthly capacity', () => {
    const data = input({
      classification: { goal: 'IMPROVE_SCORE', creditExperience: 'LATE' },
      context: {
        employment: {
          situation: 'INDEPENDIENTE',
          contractType: 'PRESTACION_SERVICIOS',
          occupation: 'Diseño',
          company: '',
        },
        income: {
          sources: [
            { kind: 'HONORARIOS', monthlyCOP: 2_000_000 },
            { kind: 'VENTAS', monthlyCOP: 1_000_000 },
          ],
          withholding: true,
        },
        debts: {
          cardSpendMonthlyCOP: 300_000,
          totalDebtCOP: 5_000_000,
          fixedExpensesMonthlyCOP: 1_200_000,
          expenseKinds: [],
        },
      },
      applications: [
        application({
          loan: {
            status: 'ACTIVE',
            closedAt: null,
            installments: [
              installment(1, 'PAID', '2026-01-10'),
              installment(2, 'PENDING'),
            ],
          },
        }),
      ],
      household: {
        role: 'OWNER',
        beneficiaries: 2,
        support: 1,
        sharedGoals: 1,
      },
    });
    expect(archetypeFacts(data)).toMatchObject({
      goal: 'IMPROVE_SCORE',
      creditExperience: 'LATE',
      employmentSituation: 'INDEPENDIENTE',
      incomeKinds: ['HONORARIOS', 'VENTAS'],
      incomeSourceCount: 2,
      monthlyIncomeCOP: 3_000_000,
      hasWithholding: true,
      assetKinds: null,
      creditActive: true,
      onTimeInstallments: 1,
      householdRole: 'OWNER',
      householdSupportMembers: 1,
      sharedGoals: 1,
    });
    expect(capacityFacts(data)).toEqual({
      monthlyIncomeCOP: 3_000_000,
      monthlyCommitmentsCOP: 1_300_000,
    });
    expect(capacityFacts(input({}))).toBeNull();
  });
});
