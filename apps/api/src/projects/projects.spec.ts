import {
  cycleStage,
  cycleView,
  monthsUntil,
  projectInputSchema,
  projectPlan,
  type ProjectFacts,
} from './projects';

const today = new Date('2026-11-22T12:00:00Z');
const facts = (overrides: Partial<ProjectFacts> = {}): ProjectFacts => ({
  kind: 'MOVILIDAD',
  status: 'ACTIVE',
  targetCOP: 18_000_000,
  savedCOP: 0,
  targetDate: new Date('2028-05-22'),
  monthlyCapacityCOP: null,
  profileCapacityCOP: null,
  recommendedModules: [],
  creditHistoryDemonstrated: false,
  matchingAvailable: false,
  ...overrides,
});

describe('life projects', () => {
  it('counts whole months until the target date', () => {
    expect(monthsUntil(new Date('2028-05-22'), today)).toBe(18);
    expect(monthsUntil(new Date('2028-05-21'), today)).toBe(17);
    expect(monthsUntil(new Date('2026-11-30'), today)).toBe(0);
  });

  it('compares the required monthly saving with the declared capacity', () => {
    const feasible = projectPlan(
      facts({ monthlyCapacityCOP: 1_200_000, profileCapacityCOP: 300_000 }),
      today,
    );
    expect(feasible).toMatchObject({
      remainingCOP: 18_000_000,
      monthsRemaining: 18,
      requiredMonthlySavingCOP: 1_000_000,
      declaredCapacityCOP: 1_200_000,
      capacitySource: 'PROJECT',
      monthlyGapCOP: 0,
      feasible: true,
      suggestedTargetDate: null,
      progressPercent: 0,
    });
    const short = projectPlan(
      facts({ savedCOP: 3_600_000, profileCapacityCOP: 600_000 }),
      today,
    );
    expect(short).toMatchObject({
      remainingCOP: 14_400_000,
      requiredMonthlySavingCOP: 800_000,
      declaredCapacityCOP: 600_000,
      capacitySource: 'PROFILE',
      monthlyGapCOP: 200_000,
      feasible: false,
      // 24 months at the declared capacity.
      suggestedTargetDate: '2028-11-01',
      progressPercent: 20,
    });
    expect(short.message).toContain('$800.000');
  });

  it('does not judge feasibility without a declared capacity', () => {
    const plan = projectPlan(facts(), today);
    expect(plan).toMatchObject({
      declaredCapacityCOP: null,
      capacitySource: null,
      monthlyGapCOP: null,
      feasible: null,
    });
    expect(projectPlan(facts({ savedCOP: 18_000_000 }), today)).toMatchObject({
      remainingCOP: 0,
      requiredMonthlySavingCOP: 0,
      feasible: true,
      progressPercent: 100,
    });
    expect(
      projectPlan(
        facts({
          targetDate: new Date('2026-01-01'),
          monthlyCapacityCOP: 50_000_000,
        }),
        today,
      ).feasible,
    ).toBe(false);
  });

  it('places the project in the cycle aprender → demostrar → acceder → volver a crecer', () => {
    const modules = [
      { slug: 'habitos-que-suman', title: 'Hábitos', completed: true },
      { slug: 'tu-primer-credito', title: 'Crédito', completed: false },
    ];
    expect(cycleStage(facts({ recommendedModules: modules }))).toBe('APRENDER');
    const learned = modules.map((module) => ({ ...module, completed: true }));
    expect(cycleStage(facts({ recommendedModules: learned }))).toBe(
      'DEMOSTRAR',
    );
    expect(
      cycleStage(
        facts({
          recommendedModules: learned,
          creditHistoryDemonstrated: true,
        }),
      ),
    ).toBe('DEMOSTRAR');
    expect(
      cycleStage(
        facts({
          recommendedModules: learned,
          creditHistoryDemonstrated: true,
          matchingAvailable: true,
        }),
      ),
    ).toBe('ACCEDER');
    expect(
      cycleStage(facts({ recommendedModules: learned, savedCOP: 18_000_000 })),
    ).toBe('ACCEDER');
    expect(cycleStage(facts({ status: 'COMPLETED' }))).toBe('VOLVER_A_CRECER');
    expect(cycleView('ACCEDER').map((step) => step.status)).toEqual([
      'DONE',
      'DONE',
      'CURRENT',
      'PENDING',
    ]);
  });

  it('validates the project a user declares', () => {
    const valid = {
      kind: 'VIVIENDA',
      title: 'Mi primera vivienda',
      targetCOP: 40_000_000,
      targetDate: '2029-01-01',
    };
    expect(projectInputSchema.parse(valid)).toMatchObject({
      savedCOP: 0,
      openRoute: false,
    });
    expect(
      projectInputSchema.safeParse({ ...valid, kind: 'VIAJE' }).success,
    ).toBe(false);
    expect(
      projectInputSchema.safeParse({ ...valid, targetCOP: 0 }).success,
    ).toBe(false);
  });
});
