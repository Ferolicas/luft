import {
  activePurchases,
  cardInputSchema,
  cardSummary,
  cardTips,
  guidanceEffectiveness,
  monthlyRate,
  nextDayOfMonth,
  purchasePlan,
  SCORE_DISCLAIMER,
  simulatePurchase,
  utilization,
  utilizationBand,
  type CardFacts,
  type PurchaseFacts,
} from './cards';

const today = new Date('2026-11-22T15:00:00Z');
const card = (overrides: Partial<CardFacts> = {}): CardFacts => ({
  id: 'card-1',
  issuer: 'Banco Uno',
  creditLimitCOP: 5_000_000,
  usedBalanceCOP: 1_200_000,
  statementDay: 15,
  paymentDay: 5,
  minimumPaymentCOP: null,
  annualEffectiveRate: 0.2682,
  ...overrides,
});
const purchase = (overrides: Partial<PurchaseFacts> = {}): PurchaseFacts => ({
  amountCOP: 600_000,
  installments: 6,
  purchasedAt: '2026-10-10',
  isCashAdvance: false,
  ...overrides,
});
const codes = (input: Partial<Parameters<typeof cardTips>[0]>) =>
  cardTips({
    card: card(),
    purchases: [],
    capacity: null,
    obligations: 1,
    today,
    ...input,
  }).map((tip) => tip.code);

describe('card engine', () => {
  it('computes current utilization and its band', () => {
    expect(utilization(1_200_000, 5_000_000)).toBe(24);
    expect(utilization(2_100_000, 5_000_000)).toBe(42);
    expect(utilization(100, 0)).toBe(0);
    expect(
      [24, 30, 42, 80, 95].map((percent) => utilizationBand(percent)),
    ).toEqual(['HEALTHY', 'HEALTHY', 'MODERATE', 'HIGH', 'CRITICAL']);
  });

  it('finds the next statement and payment dates, clamping short months', () => {
    expect(nextDayOfMonth(24, today)).toEqual({ date: '2026-11-24', days: 2 });
    expect(nextDayOfMonth(22, today)).toEqual({ date: '2026-11-22', days: 0 });
    expect(nextDayOfMonth(5, today)).toEqual({ date: '2026-12-05', days: 13 });
    expect(nextDayOfMonth(31, new Date('2027-02-10T00:00:00Z'))).toEqual({
      date: '2027-02-28',
      days: 18,
    });
  });

  it('prices a deferred purchase with fixed principal and interest on the balance', () => {
    const rate = monthlyRate(0.2682);
    expect(rate).toBeCloseTo(0.02, 3);
    const plan = purchasePlan(1_200_000, 6, 0.2682);
    expect(plan.rateKnown).toBe(true);
    expect(plan.firstInstallmentCOP).toBe(
      Math.round(200_000 + 1_200_000 * rate),
    );
    expect(plan.lastInstallmentCOP).toBe(Math.round(200_000 + 200_000 * rate));
    expect(plan.totalInterestCOP).toBe(Math.round((rate * 1_200_000 * 7) / 2));
    expect(plan.totalCOP).toBe(1_200_000 + (plan.totalInterestCOP ?? 0));
    // One installment paid in full carries no interest.
    expect(purchasePlan(500_000, 1, 0.3)).toMatchObject({
      totalInterestCOP: 0,
      totalCOP: 500_000,
    });
    // Without the card's rate the cost is not invented.
    expect(purchasePlan(500_000, 5, null)).toMatchObject({
      rateKnown: false,
      totalInterestCOP: null,
      totalCOP: null,
      firstInstallmentCOP: 100_000,
    });
  });

  it('simulates a purchase by amount and term', () => {
    const result = simulatePurchase({
      card: card(),
      purchases: [purchase()],
      capacity: {
        monthlyIncomeCOP: 3_000_000,
        monthlyCommitmentsCOP: 1_800_000,
      },
      amountCOP: 900_000,
      installments: 3,
      isCashAdvance: false,
      today,
    });
    expect(result.utilizationBeforePercent).toBe(24);
    expect(result.utilizationAfterPercent).toBe(42);
    expect(result.bandAfter).toBe('MODERATE');
    expect(result.exceedsLimit).toBe(false);
    expect(result.availableAfterCOP).toBe(2_900_000);
    expect(result.simultaneousDeferredPurchases).toBe(2);
    expect(result.capacity).toEqual({
      monthlyIncomeCOP: 3_000_000,
      monthlyCommitmentsCOP: 1_800_000,
      cardInstallmentsCOP: 100_000,
      availableCOP: 1_100_000,
    });
    expect(result.installmentShareOfCapacityPercent).toBe(
      Math.round((result.firstInstallmentCOP / 1_100_000) * 100),
    );
    expect(result.statement).toEqual({ date: '2026-12-15', days: 23 });
    expect(result.payment).toEqual({ date: '2026-12-05', days: 13 });
    expect(result.trajectory.impact).toBe('FAVORABLE');
    expect(result.warnings.join(' ')).toContain('24% a 42%');
    expect(result.disclaimer).toBe(SCORE_DISCLAIMER);
  });

  it('flags purchases that exceed the limit or the declared capacity', () => {
    const over = simulatePurchase({
      card: card(),
      purchases: [],
      capacity: {
        monthlyIncomeCOP: 1_500_000,
        monthlyCommitmentsCOP: 1_400_000,
      },
      amountCOP: 4_500_000,
      installments: 12,
      isCashAdvance: true,
      today,
    });
    expect(over.exceedsLimit).toBe(true);
    expect(over.availableAfterCOP).toBe(0);
    expect(over.trajectory.impact).toBe('RISK');
    expect(over.warnings).toEqual(
      expect.arrayContaining([
        'Esta compra supera tu cupo disponible.',
        expect.stringContaining('capacidad mensual'),
        expect.stringContaining('avances'),
      ]),
    );
    const unknown = simulatePurchase({
      card: card({ annualEffectiveRate: null }),
      purchases: [],
      capacity: null,
      amountCOP: 300_000,
      installments: 6,
      isCashAdvance: false,
      today,
    });
    expect(unknown.totalInterestCOP).toBeNull();
    expect(unknown.monthlyRatePercent).toBeNull();
    expect(unknown.capacity).toBeNull();
    expect(unknown.warnings.join(' ')).toContain('tasa efectiva anual');
  });

  it('tracks deferred purchases that still have installments left', () => {
    const purchases = [
      purchase(),
      purchase({ purchasedAt: '2026-01-10', installments: 3 }),
      purchase({ installments: 1, purchasedAt: '2026-11-20' }),
      purchase({ installments: 24, isCashAdvance: true }),
    ];
    expect(
      activePurchases(purchases, today).map((row) => row.remainingInstallments),
    ).toEqual([5, 1, 23]);
    expect(cardSummary(card(), purchases, today)).toMatchObject({
      utilizationPercent: 24,
      band: 'HEALTHY',
      availableCOP: 3_800_000,
      deferredPurchases: 2,
      cashAdvances: 1,
      longestTermMonths: 24,
      monthlyInstallmentsCOP: 125_000,
    });
  });

  it('gives contextual tips, never universal ones', () => {
    // A card with no balance and nothing pending gets no advice at all.
    expect(codes({ card: card({ usedBalanceCOP: 0 }) })).toEqual([]);
    expect(codes({})).toEqual(['UTILIZATION_HEALTHY']);
    expect(codes({ card: card({ usedBalanceCOP: 2_100_000 }) })).toEqual([
      'UTILIZATION_MODERATE',
    ]);
    expect(
      codes({ card: card({ usedBalanceCOP: 4_600_000, statementDay: 24 }) }),
    ).toEqual(['UTILIZATION_CRITICAL', 'STATEMENT_SOON']);
    expect(
      codes({
        card: card({
          usedBalanceCOP: 3_000_000,
          paymentDay: 23,
          minimumPaymentCOP: 150_000,
          annualEffectiveRate: null,
        }),
      }),
    ).toEqual([
      'UTILIZATION_HIGH',
      'PAYMENT_DUE_SOON',
      'MINIMUM_PAYMENT',
      'MISSING_RATE',
    ]);
    expect(
      codes({
        purchases: [
          purchase(),
          purchase(),
          purchase({ installments: 18, isCashAdvance: true }),
        ],
        capacity: {
          monthlyIncomeCOP: 2_000_000,
          monthlyCommitmentsCOP: 1_500_000,
        },
        obligations: 4,
      }),
    ).toEqual([
      'UTILIZATION_HEALTHY',
      'TOO_MANY_DEFERRED',
      'LONG_TERMS',
      'CASH_ADVANCE',
      'LOW_CAPACITY',
      'MULTIPLE_OBLIGATIONS',
    ]);
  });

  it('carries the variables used and the no-guarantee warning in every tip', () => {
    const tips = cardTips({
      card: card({ usedBalanceCOP: 4_000_000, minimumPaymentCOP: 200_000 }),
      purchases: [purchase(), purchase(), purchase()],
      capacity: {
        monthlyIncomeCOP: 2_000_000,
        monthlyCommitmentsCOP: 1_500_000,
      },
      obligations: 3,
      today,
    });
    expect(tips.length).toBeGreaterThan(3);
    for (const tip of tips) {
      expect(tip.disclaimer).toBe(SCORE_DISCLAIMER);
      expect(tip.variables).toMatchObject({
        utilizationPercent: 80,
        creditLimitCOP: 5_000_000,
        availableCOP: 1_000_000,
      });
      expect(`${tip.title} ${tip.body}`).not.toMatch(
        /subir(á|a) tu puntaje|aumentar(á|a) tu puntaje|garantiza/i,
      );
    }
    expect(SCORE_DISCLAIMER).toContain('múltiples factores');
    expect(SCORE_DISCLAIMER).toContain('no garantiza');
    const high = tips.find((tip) => tip.code === 'UTILIZATION_HIGH');
    expect(high?.variables.suggestedPaymentCOP).toBe(2_500_000);
    const minimum = tips.find((tip) => tip.code === 'MINIMUM_PAYMENT');
    expect(minimum?.variables.estimatedMonthlyInterestCOP).toBe(
      Math.round(3_800_000 * monthlyRate(0.2682)),
    );
  });

  it('measures effectiveness by comparing utilization later', () => {
    expect(guidanceEffectiveness(60, 41)).toBe('IMPROVED');
    expect(guidanceEffectiveness(60, 61)).toBe('UNCHANGED');
    expect(guidanceEffectiveness(60, 75)).toBe('WORSENED');
  });

  it('validates a declared card', () => {
    const valid = {
      issuer: 'Banco Uno',
      creditLimitCOP: 5_000_000,
      usedBalanceCOP: 0,
      statementDay: 15,
      paymentDay: 5,
    };
    expect(cardInputSchema.safeParse(valid).success).toBe(true);
    expect(
      cardInputSchema.safeParse({ ...valid, last4: '12345' }).success,
    ).toBe(false);
    expect(
      cardInputSchema.safeParse({ ...valid, statementDay: 32 }).success,
    ).toBe(false);
    expect(
      cardInputSchema.safeParse({ ...valid, creditLimitCOP: 0 }).success,
    ).toBe(false);
    // The full card number is never accepted.
    expect(
      cardInputSchema.safeParse({ ...valid, number: '4111111111111111' })
        .success,
    ).toBe(false);
  });
});
