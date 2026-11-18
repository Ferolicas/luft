import {
  levelFor,
  profileBlocks,
  progressSummary,
  sectionSchemas,
  sniffMime,
  taxCheck,
  type StoredDocument,
} from './journey';

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
    const below = taxCheck(base);
    expect(below.ready).toBe(true);
    expect(below.mayHaveToFile).toBe(false);
    const above = taxCheck({
      ...base,
      income: {
        sources: [{ kind: 'SALARIO', monthlyCOP: 6_000_000 }],
        withholding: null,
      },
    });
    expect(above.mayHaveToFile).toBe(true);
    expect(above.criteria.find((row) => row.key === 'income')?.limitCOP).toBe(
      69_718_600,
    );
    expect(taxCheck({}).ready).toBe(false);
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

  it('rewards on-time payments and tracks the payment streak', () => {
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
    expect(summary.xp).toBe(20 + 50 + 100);
    expect(summary.paymentStreak).toBe(2);
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
