import {
  levelFor,
  pickDashboardCredit,
  profileBlocks,
  progressSummary,
  sectionSchemas,
  sniffMime,
  targetTaxYear,
  taxCheck,
  type StoredDocument,
  type TaxRule,
} from './journey';

/** Mirror of the 2025 version seeded by the migration. */
const rule2025: TaxRule = {
  id: '23000000-0000-4000-8000-000000000001',
  taxYear: 2025,
  version: 1,
  uvtCOP: 49_799,
  wealthUvt: 4_500,
  incomeUvt: 1_400,
  cardSpendUvt: 1_400,
  purchasesUvt: 1_400,
  depositsUvt: 1_400,
  sourceDocument: 'Referencia 2025',
  effectiveFrom: '2025-01-01',
};

const document = (kind: StoredDocument['kind']): StoredDocument => ({
  id: kind,
  kind,
  fileName: 'a.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 10,
  sha256: 'x',
  uploadedAt: '2026-11-01T00:00:00.000Z',
});

describe('journey rules', () => {
  it('weighs each profile block at 25%', () => {
    const now = '2026-11-01';
    expect(profileBlocks({}, []).percent).toBe(0);
    expect(profileBlocks({ employment: now }, []).percent).toBe(0);
    expect(profileBlocks({ employment: now, income: now }, []).percent).toBe(
      25,
    );
    const all = profileBlocks(
      { employment: now, income: now, assets: now, debts: now, recurring: now },
      [
        document('TAX_RETURN'),
        document('BANK_STATEMENTS'),
        document('SOCIAL_SECURITY'),
        document('EMPLOYMENT_CERTIFICATE'),
      ],
    );
    expect(all.percent).toBe(100);
  });

  it('flags a possible filing obligation only above the reference thresholds', () => {
    const base = {
      income: {
        sources: [{ kind: 'SALARIO' as const, monthlyCOP: 3_650_000 }],
        withholding: null,
      },
      assets: { items: [{ kind: 'AHORROS' as const, valueCOP: 24_500_000 }] },
      debts: {
        cardSpendMonthlyCOP: 700_000,
        totalDebtCOP: 0,
        fixedExpensesMonthlyCOP: 1_600_000,
        expenseKinds: [],
      },
    };
    const below = taxCheck(base, rule2025);
    expect(below.ready).toBe(true);
    expect(below.mayHaveToFile).toBe(false);
    expect(below.reasons).toEqual([]);
    const above = taxCheck(
      {
        ...base,
        income: {
          sources: [{ kind: 'SALARIO', monthlyCOP: 6_000_000 }],
          withholding: null,
        },
      },
      rule2025,
    );
    expect(above.mayHaveToFile).toBe(true);
    expect(above.criteria.find((row) => row.key === 'income')?.limitCOP).toBe(
      69_718_600,
    );
    expect(taxCheck({}, rule2025).ready).toBe(false);
  });

  it('explains why a review is suggested with criterion, value, limit, UVT and rule version', () => {
    const check = taxCheck(
      {
        income: {
          sources: [{ kind: 'SALARIO', monthlyCOP: 6_000_000 }],
          withholding: null,
        },
        assets: { items: [] },
        debts: {
          cardSpendMonthlyCOP: 0,
          totalDebtCOP: 0,
          fixedExpensesMonthlyCOP: 0,
          expenseKinds: [],
        },
      },
      rule2025,
    );
    expect(check.rule).toMatchObject({ taxYear: 2025, version: 1 });
    expect(check.reasons).toHaveLength(2);
    expect(check.reasons[0]).toContain('$72.000.000');
    expect(check.reasons[0]).toContain('1.400 UVT');
    expect(check.reasons[0]).toContain('$69.718.600');
    expect(check.reasons[0]).toContain('$49.799');
    expect(check.summary).toContain('regla v1');
    expect(check.disclaimer).toContain('No es una determinación definitiva');
  });

  it('evaluates nothing when the year has no approved rule', () => {
    const check = taxCheck({}, null, 2026);
    expect(check).toMatchObject({
      taxYear: 2026,
      available: false,
      ready: false,
      mayHaveToFile: false,
      rule: null,
    });
    expect(check.summary).toContain('2026');
    expect(targetTaxYear(new Date('2026-11-22T12:00:00Z'))).toBe(2025);
  });

  it('applies the thresholds of the rule version it receives', () => {
    const stricter = taxCheck(
      {
        income: {
          sources: [{ kind: 'SALARIO', monthlyCOP: 3_000_000 }],
          withholding: null,
        },
        assets: { items: [] },
        debts: {
          cardSpendMonthlyCOP: 0,
          totalDebtCOP: 0,
          fixedExpensesMonthlyCOP: 0,
          expenseKinds: [],
        },
      },
      { ...rule2025, taxYear: 2026, version: 3, incomeUvt: 500 },
    );
    expect(stricter.taxYear).toBe(2026);
    expect(stricter.mayHaveToFile).toBe(true);
    expect(
      stricter.criteria.find((row) => row.key === 'income')?.limitUvt,
    ).toBe(500);
  });

  it('computes levels from XP', () => {
    expect(levelFor(0)).toMatchObject({
      level: 1,
      nextLevelXp: 200,
      toNext: 200,
    });
    expect(levelFor(220)).toMatchObject({ level: 2, nextLevelXp: 500 });
    expect(levelFor(500)).toMatchObject({ level: 3, nextLevelXp: 900 });
  });

  it('gives XP only for lessons and modules; payments and profile keep badges without XP', () => {
    const summary = progressSummary({
      completedLessons: 1,
      completedModules: 0,
      lessonsThisWeek: 1,
      streakDays: 2,
      creditActive: true,
      installments: [
        {
          sequence: 1,
          status: 'PAID',
          dueDate: '2026-09-15',
          paidAt: '2026-09-14T15:00:00Z',
        },
        {
          sequence: 2,
          status: 'PAID',
          dueDate: '2026-10-15',
          paidAt: '2026-10-13T15:00:00Z',
        },
        { sequence: 3, status: 'PENDING', dueDate: '2026-11-15' },
      ],
      profileBlocksCompleted: 0,
      documentsUploaded: 0,
    });
    expect(summary.xp).toBe(20);
    expect(summary.paymentStreak).toBe(2);
    expect(summary.badges.find((row) => row.key === 'first-step')?.earned).toBe(
      true,
    );
    expect(summary.badges.find((row) => row.key === 'on-time')?.earned).toBe(
      true,
    );
    expect(summary.missions.find((row) => row.key === 'lesson')?.xp).toBe(20);
    expect(
      summary.missions
        .filter((row) => row.key !== 'lesson')
        .every((row) => row.xp === 0),
    ).toBe(true);
    expect(summary.badges.find((row) => row.key === 'streak-2')?.earned).toBe(
      true,
    );
    expect(summary.badges.find((row) => row.key === 'constancy')?.earned).toBe(
      false,
    );
    expect(summary.missions.some((row) => row.key === 'installment')).toBe(
      true,
    );
  });

  it('adds module XP and never counts a complete profile or an active credit', () => {
    const summary = progressSummary({
      completedLessons: 3,
      completedModules: 1,
      lessonsThisWeek: 0,
      streakDays: 0,
      creditActive: true,
      installments: [],
      profileBlocksCompleted: 4,
      documentsUploaded: 4,
    });
    expect(summary.xp).toBe(3 * 20 + 30);
    expect(summary.badges.find((row) => row.key === 'profile')?.earned).toBe(
      true,
    );
  });

  it('shows on the dashboard the loan with unpaid installments, else the latest application', () => {
    const paid = {
      id: 'paid',
      createdAt: '2026-01-10',
      loan: { installments: [{ status: 'PAID' }, { status: 'WAIVED' }] },
    };
    const open = {
      id: 'open',
      createdAt: '2026-03-10',
      loan: { installments: [{ status: 'PAID' }, { status: 'PENDING' }] },
    };
    const draft = { id: 'draft', createdAt: '2026-06-01', loan: null };
    expect(pickDashboardCredit([draft, open, paid])?.id).toBe('open');
    expect(pickDashboardCredit([paid, draft])?.id).toBe('draft');
    expect(pickDashboardCredit([paid])?.id).toBe('paid');
    expect(pickDashboardCredit([])).toBeNull();
  });

  it('validates sections and sniffs real file types', () => {
    expect(() => sectionSchemas.income.parse({ sources: [] })).toThrow();
    expect(
      sectionSchemas.recurring.parse({
        paysRent: false,
        socialSecurity: 'NO_COTIZO',
      }).otherPayments,
    ).toEqual([]);
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<html>'))).toBeNull();
  });
});
