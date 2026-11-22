import { z } from 'zod';

/**
 * Pure credit-card guidance engine: utilization, purchase simulation and
 * contextual tips. Tips depend on the user's own numbers; none of them is a
 * universal rule and none promises a score change.
 */

export const SCORE_DISCLAIMER =
  'El puntaje en las centrales de riesgo depende de múltiples factores y LUFT no garantiza un aumento determinado.';

const cop = z.coerce.number().int().min(0).max(1_000_000_000_000);
const dayOfMonth = z.coerce.number().int().min(1).max(31);

export const cardInputSchema = z
  .object({
    issuer: z.string().trim().min(2).max(80),
    alias: z.string().trim().max(60).optional(),
    last4: z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .optional(),
    creditLimitCOP: cop.min(1),
    usedBalanceCOP: cop,
    statementDay: dayOfMonth,
    paymentDay: dayOfMonth,
    minimumPaymentCOP: cop.optional(),
    annualEffectiveRatePercent: z.coerce.number().min(0).max(100).optional(),
  })
  .strict();

export const cardUpdateSchema = z
  .object({
    issuer: z.string().trim().min(2).max(80),
    alias: z.string().trim().max(60).nullable(),
    last4: z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .nullable(),
    creditLimitCOP: cop.min(1),
    usedBalanceCOP: cop,
    statementDay: dayOfMonth,
    paymentDay: dayOfMonth,
    minimumPaymentCOP: cop.nullable(),
    annualEffectiveRatePercent: z.coerce.number().min(0).max(100).nullable(),
  })
  .partial()
  .strict();

export const purchaseInputSchema = z
  .object({
    amountCOP: cop.min(1),
    installments: z.coerce.number().int().min(1).max(60),
    purchasedAt: z.coerce.date(),
    description: z.string().trim().min(2).max(160),
    isCashAdvance: z.boolean().default(false),
    applyToBalance: z.boolean().default(true),
  })
  .strict();

export const simulationInputSchema = z
  .object({
    amountCOP: cop.min(1),
    installments: z.coerce.number().int().min(1).max(60),
    isCashAdvance: z.boolean().default(false),
  })
  .strict();

export interface CardFacts {
  id: string;
  issuer: string;
  creditLimitCOP: number;
  usedBalanceCOP: number;
  statementDay: number;
  paymentDay: number;
  minimumPaymentCOP: number | null;
  /** Effective annual rate as a fraction (0.285 = 28,5% E.A.); null when unknown. */
  annualEffectiveRate: number | null;
}

export interface PurchaseFacts {
  amountCOP: number;
  installments: number;
  purchasedAt: Date | string;
  isCashAdvance: boolean;
}

export interface CapacityFacts {
  monthlyIncomeCOP: number;
  monthlyCommitmentsCOP: number;
}

export function utilization(usedCOP: number, limitCOP: number) {
  if (limitCOP <= 0) return 0;
  return Math.round((usedCOP / limitCOP) * 1000) / 10;
}

export type UtilizationBand = 'HEALTHY' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export function utilizationBand(percent: number): UtilizationBand {
  if (percent <= 30) return 'HEALTHY';
  if (percent <= 50) return 'MODERATE';
  if (percent <= 80) return 'HIGH';
  return 'CRITICAL';
}

const utcDay = (value: Date) =>
  Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

/** Next occurrence of a day of the month (clamped to short months), today included. */
export function nextDayOfMonth(day: number, today: Date) {
  const build = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, last)));
  };
  let date = build(today.getUTCFullYear(), today.getUTCMonth());
  if (utcDay(date) < utcDay(today))
    date = build(today.getUTCFullYear(), today.getUTCMonth() + 1);
  return {
    date: date.toISOString().slice(0, 10),
    days: Math.round((utcDay(date) - utcDay(today)) / 86_400_000),
  };
}

export function monthlyRate(annualEffectiveRate: number) {
  return Math.pow(1 + annualEffectiveRate, 1 / 12) - 1;
}

/**
 * Deferred purchase with fixed principal per installment and interest on the
 * outstanding balance (how Colombian cards usually bill). One installment
 * paid in full by the due date carries no interest.
 */
export function purchasePlan(
  amountCOP: number,
  installments: number,
  annualEffectiveRate: number | null,
) {
  const principal = amountCOP / installments;
  if (installments === 1)
    return {
      firstInstallmentCOP: amountCOP,
      lastInstallmentCOP: amountCOP,
      averageInstallmentCOP: amountCOP,
      totalInterestCOP: 0,
      totalCOP: amountCOP,
      rateKnown: true,
    };
  if (annualEffectiveRate === null)
    return {
      firstInstallmentCOP: Math.round(principal),
      lastInstallmentCOP: Math.round(principal),
      averageInstallmentCOP: Math.round(principal),
      totalInterestCOP: null,
      totalCOP: null,
      rateKnown: false,
    };
  const rate = monthlyRate(annualEffectiveRate);
  const totalInterest = Math.round((rate * amountCOP * (installments + 1)) / 2);
  return {
    firstInstallmentCOP: Math.round(principal + amountCOP * rate),
    lastInstallmentCOP: Math.round(principal + principal * rate),
    averageInstallmentCOP: Math.round(
      (amountCOP + totalInterest) / installments,
    ),
    totalInterestCOP: totalInterest,
    totalCOP: amountCOP + totalInterest,
    rateKnown: true,
  };
}

/** Deferred purchases that still have installments left, as of today. */
export function activePurchases(purchases: PurchaseFacts[], today: Date) {
  return purchases
    .map((purchase) => {
      const start = new Date(purchase.purchasedAt);
      const elapsed = Math.max(
        0,
        (today.getUTCFullYear() - start.getUTCFullYear()) * 12 +
          (today.getUTCMonth() - start.getUTCMonth()),
      );
      return {
        ...purchase,
        remainingInstallments: Math.max(0, purchase.installments - elapsed),
      };
    })
    .filter((purchase) => purchase.remainingInstallments > 0);
}

export function monthlyCardInstallments(
  purchases: PurchaseFacts[],
  today: Date,
) {
  return Math.round(
    activePurchases(purchases, today)
      .filter((purchase) => purchase.installments > 1)
      .reduce(
        (total, purchase) => total + purchase.amountCOP / purchase.installments,
        0,
      ),
  );
}

export function capacityView(
  capacity: CapacityFacts | null,
  cardInstallmentsCOP: number,
) {
  if (!capacity) return null;
  const availableCOP = Math.max(
    0,
    capacity.monthlyIncomeCOP -
      capacity.monthlyCommitmentsCOP -
      cardInstallmentsCOP,
  );
  return {
    monthlyIncomeCOP: capacity.monthlyIncomeCOP,
    monthlyCommitmentsCOP: capacity.monthlyCommitmentsCOP,
    cardInstallmentsCOP,
    availableCOP,
  };
}

export function cardSummary(
  card: CardFacts,
  purchases: PurchaseFacts[],
  today: Date,
) {
  const percent = utilization(card.usedBalanceCOP, card.creditLimitCOP);
  const active = activePurchases(purchases, today);
  return {
    utilizationPercent: percent,
    band: utilizationBand(percent),
    availableCOP: Math.max(0, card.creditLimitCOP - card.usedBalanceCOP),
    statement: nextDayOfMonth(card.statementDay, today),
    payment: nextDayOfMonth(card.paymentDay, today),
    deferredPurchases: active.filter((purchase) => purchase.installments > 1)
      .length,
    cashAdvances: active.filter((purchase) => purchase.isCashAdvance).length,
    longestTermMonths: active.reduce(
      (longest, purchase) => Math.max(longest, purchase.installments),
      0,
    ),
    monthlyInstallmentsCOP: monthlyCardInstallments(purchases, today),
  };
}

export type Trajectory = 'FAVORABLE' | 'NEUTRAL' | 'RISK';

/** Simulates a purchase by amount and term before the user makes it. */
export function simulatePurchase(input: {
  card: CardFacts;
  purchases: PurchaseFacts[];
  capacity: CapacityFacts | null;
  amountCOP: number;
  installments: number;
  isCashAdvance: boolean;
  today: Date;
}) {
  const { card, today } = input;
  const before = utilization(card.usedBalanceCOP, card.creditLimitCOP);
  const after = utilization(
    card.usedBalanceCOP + input.amountCOP,
    card.creditLimitCOP,
  );
  const plan = purchasePlan(
    input.amountCOP,
    input.installments,
    card.annualEffectiveRate,
  );
  const active = activePurchases(input.purchases, today);
  const simultaneous =
    active.filter((purchase) => purchase.installments > 1).length +
    (input.installments > 1 ? 1 : 0);
  const currentInstallments = monthlyCardInstallments(input.purchases, today);
  const capacity = capacityView(input.capacity, currentInstallments);
  const exceedsLimit =
    card.usedBalanceCOP + input.amountCOP > card.creditLimitCOP;
  const installmentShare =
    capacity && capacity.availableCOP > 0
      ? Math.round((plan.firstInstallmentCOP / capacity.availableCOP) * 100)
      : null;
  const overCapacity = capacity
    ? plan.firstInstallmentCOP > capacity.availableCOP
    : false;
  const band = utilizationBand(after);
  const trajectory: Trajectory =
    exceedsLimit || overCapacity || band === 'CRITICAL'
      ? 'RISK'
      : band === 'HIGH' || simultaneous > 3 || input.isCashAdvance
        ? 'NEUTRAL'
        : 'FAVORABLE';
  const warnings: string[] = [];
  if (exceedsLimit) warnings.push('Esta compra supera tu cupo disponible.');
  if (!exceedsLimit && band !== 'HEALTHY')
    warnings.push(
      `Tu utilización pasaría de ${before}% a ${after}%. Un uso por encima del 30% del cupo suele leerse como mayor dependencia del crédito.`,
    );
  if (simultaneous > 3)
    warnings.push(
      `Quedarías con ${simultaneous} compras a plazos al mismo tiempo.`,
    );
  if (overCapacity)
    warnings.push(
      'La primera cuota supera la capacidad mensual que te queda según tu perfil financiero.',
    );
  if (!plan.rateKnown)
    warnings.push(
      'Agrega la tasa efectiva anual de tu tarjeta para estimar el costo de esta compra.',
    );
  if (input.isCashAdvance)
    warnings.push(
      'Los avances suelen cobrar intereses desde el primer día y una comisión por retiro.',
    );
  const statement = nextDayOfMonth(card.statementDay, today);
  const payment = nextDayOfMonth(card.paymentDay, today);
  return {
    amountCOP: input.amountCOP,
    installments: input.installments,
    isCashAdvance: input.isCashAdvance,
    utilizationBeforePercent: before,
    utilizationAfterPercent: after,
    bandAfter: band,
    exceedsLimit,
    availableAfterCOP: Math.max(
      0,
      card.creditLimitCOP - card.usedBalanceCOP - input.amountCOP,
    ),
    ...plan,
    monthlyRatePercent:
      card.annualEffectiveRate === null
        ? null
        : Math.round(monthlyRate(card.annualEffectiveRate) * 10_000) / 100,
    simultaneousDeferredPurchases: simultaneous,
    capacity,
    installmentShareOfCapacityPercent: installmentShare,
    statement,
    payment,
    trajectory: {
      impact: trajectory,
      explanation:
        trajectory === 'FAVORABLE'
          ? 'Con esta compra mantienes un uso moderado del cupo y cuotas que caben en tu capacidad, lo que favorece una trayectoria ordenada en tu ruta LUFT.'
          : trajectory === 'NEUTRAL'
            ? 'Esta compra es manejable, pero sube tu uso del cupo o tus compromisos simultáneos. Revisa el plazo antes de hacerla.'
            : 'Esta compra presiona tu cupo o tu capacidad de pago y puede dificultar que pagues a tiempo.',
    },
    warnings,
    disclaimer: SCORE_DISCLAIMER,
  };
}

export type TipSeverity = 'INFO' | 'WARNING' | 'ALERT';

export interface CardTip {
  code: string;
  cardId: string | null;
  severity: TipSeverity;
  title: string;
  body: string;
  variables: Record<string, string | number | boolean | null>;
  disclaimer: string;
}

const money = (value: number) =>
  `$${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/**
 * Contextual tips for one card. A tip only appears when the user's own
 * numbers trigger it, and it always carries the variables it used.
 */
export function cardTips(input: {
  card: CardFacts;
  purchases: PurchaseFacts[];
  capacity: CapacityFacts | null;
  obligations: number;
  today: Date;
}): CardTip[] {
  const { card, today } = input;
  const summary = cardSummary(card, input.purchases, today);
  const tips: CardTip[] = [];
  const tip = (
    code: string,
    severity: TipSeverity,
    title: string,
    body: string,
    variables: CardTip['variables'],
  ) =>
    tips.push({
      code,
      cardId: card.id,
      severity,
      title,
      body,
      variables: {
        utilizationPercent: summary.utilizationPercent,
        creditLimitCOP: card.creditLimitCOP,
        availableCOP: summary.availableCOP,
        ...variables,
      },
      disclaimer: SCORE_DISCLAIMER,
    });
  const percent = summary.utilizationPercent;
  const targetBalance = Math.round(card.creditLimitCOP * 0.3);
  const toTarget = Math.max(0, card.usedBalanceCOP - targetBalance);

  if (summary.band === 'CRITICAL')
    tip(
      'UTILIZATION_CRITICAL',
      'ALERT',
      `Tu tarjeta ${card.issuer} está al ${percent}% del cupo`,
      `Estás usando casi todo el cupo. Abonar ${money(toTarget)} te dejaría cerca del 30%. Evita nuevas compras con esta tarjeta mientras bajas el saldo.`,
      { suggestedPaymentCOP: toTarget },
    );
  else if (summary.band === 'HIGH')
    tip(
      'UTILIZATION_HIGH',
      'WARNING',
      `Tu tarjeta ${card.issuer} está al ${percent}% del cupo`,
      `No necesitas usar todo el cupo disponible. Si abonas ${money(toTarget)} quedarías cerca del 30%, un uso moderado.`,
      { suggestedPaymentCOP: toTarget },
    );
  else if (summary.band === 'MODERATE')
    tip(
      'UTILIZATION_MODERATE',
      'INFO',
      `Tu tarjeta ${card.issuer} está al ${percent}% del cupo`,
      `Vas en un uso intermedio. Con ${money(toTarget)} menos de saldo volverías a un uso moderado (30% o menos).`,
      { suggestedPaymentCOP: toTarget },
    );
  else if (card.usedBalanceCOP > 0)
    tip(
      'UTILIZATION_HEALTHY',
      'INFO',
      `Tu tarjeta ${card.issuer} está al ${percent}% del cupo`,
      'Mantienes un uso moderado. Conservarlo y pagar antes de la fecha límite ayuda a que tu comportamiento se vea ordenado.',
      {},
    );

  if (
    card.usedBalanceCOP > 0 &&
    summary.statement.days <= 5 &&
    summary.band !== 'HEALTHY'
  )
    tip(
      'STATEMENT_SOON',
      'WARNING',
      summary.statement.days === 0
        ? 'Tu corte es hoy'
        : `Tu corte es en ${summary.statement.days} ${summary.statement.days === 1 ? 'día' : 'días'}`,
      `El saldo que tengas el día de corte (${summary.statement.date}) es el que aparece en tu extracto. Un abono anticipado antes de esa fecha reduce el saldo facturado.`,
      {
        statementDate: summary.statement.date,
        daysToStatement: summary.statement.days,
      },
    );

  if (card.usedBalanceCOP > 0 && summary.payment.days <= 5)
    tip(
      'PAYMENT_DUE_SOON',
      'ALERT',
      `Tu fecha límite de pago es el ${summary.payment.date}`,
      `Te ${summary.payment.days === 0 ? 'vence hoy' : `quedan ${summary.payment.days} ${summary.payment.days === 1 ? 'día' : 'días'}`}. Pagar el total facturado antes de la fecha evita intereses de mora y reportes negativos.`,
      {
        paymentDate: summary.payment.date,
        daysToPayment: summary.payment.days,
      },
    );

  if (
    card.minimumPaymentCOP !== null &&
    card.minimumPaymentCOP > 0 &&
    card.usedBalanceCOP > card.minimumPaymentCOP
  ) {
    const interest =
      card.annualEffectiveRate === null
        ? null
        : Math.round(
            (card.usedBalanceCOP - card.minimumPaymentCOP) *
              monthlyRate(card.annualEffectiveRate),
          );
    tip(
      'MINIMUM_PAYMENT',
      'WARNING',
      'Pagar solo el mínimo sale caro',
      interest === null
        ? `Tu pago mínimo es ${money(card.minimumPaymentCOP)}, pero el saldo restante sigue generando intereses. Agrega la tasa de tu tarjeta para estimar cuánto.`
        : `Si pagas solo el mínimo (${money(card.minimumPaymentCOP)}), el saldo restante generaría cerca de ${money(interest)} de intereses el próximo mes. Pagar el total o abonar más lo reduce.`,
      {
        minimumPaymentCOP: card.minimumPaymentCOP,
        estimatedMonthlyInterestCOP: interest,
      },
    );
  }

  if (summary.deferredPurchases >= 3)
    tip(
      'TOO_MANY_DEFERRED',
      'WARNING',
      `Tienes ${summary.deferredPurchases} compras a plazos al mismo tiempo`,
      `Entre todas comprometen ${money(summary.monthlyInstallmentsCOP)} al mes solo en abonos a capital. Evita diferir una nueva compra hasta terminar alguna.`,
      {
        deferredPurchases: summary.deferredPurchases,
        monthlyInstallmentsCOP: summary.monthlyInstallmentsCOP,
      },
    );

  if (summary.longestTermMonths > 12)
    tip(
      'LONG_TERMS',
      'INFO',
      `Tienes una compra diferida a ${summary.longestTermMonths} meses`,
      'Los plazos largos bajan la cuota pero suben el costo total en intereses. Si puedes, abona a capital o elige plazos más cortos en tus próximas compras.',
      { longestTermMonths: summary.longestTermMonths },
    );

  if (summary.cashAdvances > 0)
    tip(
      'CASH_ADVANCE',
      'WARNING',
      'Tienes avances en efectivo vigentes',
      'Los avances suelen cobrar intereses desde el primer día y comisión por retiro. Priorizar su pago reduce el costo de tu tarjeta.',
      { cashAdvances: summary.cashAdvances },
    );

  if (card.annualEffectiveRate === null && card.usedBalanceCOP > 0)
    tip(
      'MISSING_RATE',
      'INFO',
      'Agrega la tasa de tu tarjeta',
      'Con la tasa efectiva anual podemos estimar el costo real de tus compras a plazos y de pagar solo el mínimo.',
      {},
    );

  const capacity = capacityView(input.capacity, summary.monthlyInstallmentsCOP);
  if (
    capacity &&
    summary.monthlyInstallmentsCOP > 0 &&
    capacity.monthlyIncomeCOP > 0 &&
    summary.monthlyInstallmentsCOP >
      (capacity.monthlyIncomeCOP - capacity.monthlyCommitmentsCOP) * 0.3
  )
    tip(
      'LOW_CAPACITY',
      'ALERT',
      'Tus cuotas de tarjeta pesan mucho en tu mes',
      `Tus compras a plazos suman ${money(summary.monthlyInstallmentsCOP)} al mes y te dejan ${money(capacity.availableCOP)} libres después de tus gastos fijos. Antes de una nueva compra, baja este compromiso.`,
      {
        monthlyInstallmentsCOP: summary.monthlyInstallmentsCOP,
        availableCapacityCOP: capacity.availableCOP,
      },
    );

  if (input.obligations >= 3)
    tip(
      'MULTIPLE_OBLIGATIONS',
      'INFO',
      `Tienes ${input.obligations} obligaciones al mismo tiempo`,
      'Varias obligaciones simultáneas aumentan el riesgo de olvidar una fecha. Programa recordatorios y evita abrir una nueva mientras pagas estas.',
      { obligations: input.obligations },
    );

  return tips;
}

/** Compares utilization after a recommendation was shown. */
export function guidanceEffectiveness(
  baselinePercent: number,
  currentPercent: number,
): 'IMPROVED' | 'UNCHANGED' | 'WORSENED' {
  const delta = currentPercent - baselinePercent;
  if (delta <= -2) return 'IMPROVED';
  if (delta >= 2) return 'WORSENED';
  return 'UNCHANGED';
}

export const GUIDANCE_MEASURE_AFTER_DAYS = 30;
