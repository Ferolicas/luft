/**
 * Calculadora pura del crédito StartIF: sistema de amortización por gradiente
 * geométrico decreciente con tasa mensual vencida.
 *
 *   C_t = C_1 · (1 − g)^(t−1)        C_1 = P / Σ_{t=1..n} (1 − g)^(t−1) / (1 + i)^t
 *
 * Todo se liquida en pesos enteros: el interés de cada mes se redondea sobre el
 * saldo entero y la última cuota absorbe el residuo, de modo que la suma del
 * capital es exactamente el capital prestado y el saldo final es 0.
 * Nada aquí toca la base de datos ni el reloj: la fecha base siempre se recibe.
 */

export interface ScheduleRow {
  sequence: number;
  amountCOP: number;
  principalCOP: number;
  interestCOP: number;
  openingBalanceCOP: number;
  closingBalanceCOP: number;
  dueDate: string;
}

export type ScheduleAmounts = Omit<ScheduleRow, 'dueDate'>;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Normaliza una fecha a `YYYY-MM-DD` (día calendario en UTC). */
export function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    const text = value.slice(0, 10);
    const match = ISO_DATE.exec(text);
    if (match) {
      const date = new Date(`${text}T00:00:00Z`);
      if (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === text
      )
        return text;
    }
    throw new Error('Fecha inválida');
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new Error('Fecha inválida');
  return value.toISOString().slice(0, 10);
}

/**
 * Suma meses calendario a una fecha `YYYY-MM-DD`. Si el día no existe en el mes
 * destino (31 → febrero) usa el último día de ese mes.
 */
export function addMonthsToDate(date: Date | string, months: number): string {
  const [year, month, day] = toIsoDate(date).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function assertTerms(
  principal: number,
  months: number,
  monthlyRate: number,
  decrease: number,
) {
  if (!Number.isSafeInteger(principal) || principal <= 0)
    throw new Error('Capital inválido');
  if (!Number.isInteger(months) || months < 1 || months > 120)
    throw new Error('Plazo inválido');
  if (!Number.isFinite(monthlyRate) || monthlyRate < 0 || monthlyRate > 1)
    throw new Error('Tasa inválida');
  if (!Number.isFinite(decrease) || decrease < 0 || decrease >= 1)
    throw new Error('Gradiente inválido');
}

/** Cuotas del gradiente geométrico decreciente, sin fechas. */
export function geometricAmounts(
  principal: number,
  months: number,
  monthlyRate: number,
  decrease: number,
): ScheduleAmounts[] {
  assertTerms(principal, months, monthlyRate, decrease);
  const q = 1 - decrease;
  let denominator = 0;
  for (let index = 0; index < months; index += 1)
    denominator += Math.pow(q, index) / Math.pow(1 + monthlyRate, index + 1);
  const firstPayment = principal / denominator;
  let balance = principal;
  const rows: ScheduleAmounts[] = [];
  for (let index = 0; index < months; index += 1) {
    const last = index === months - 1;
    const interest = Math.round(balance * monthlyRate);
    const scheduled = Math.round(firstPayment * Math.pow(q, index));
    const principalPart = last
      ? balance
      : Math.min(balance, Math.max(0, scheduled - interest));
    const amount = last ? balance + interest : scheduled;
    const opening = balance;
    balance -= principalPart;
    rows.push({
      sequence: index + 1,
      amountCOP: amount,
      principalCOP: principalPart,
      interestCOP: interest,
      openingBalanceCOP: opening,
      closingBalanceCOP: balance,
    });
  }
  return rows;
}

/**
 * Un plan sano abona capital en todas las cuotas y, con gradiente mayor que
 * cero, cada cuota es menor que la anterior. Con montos muy pequeños o plazos
 * muy largos el redondeo a pesos puede romperlo: esos productos no se activan.
 */
export function scheduleIsWellFormed(
  rows: Array<Pick<ScheduleRow, 'amountCOP' | 'principalCOP'>>,
  decrease: number,
): boolean {
  return rows.every(
    (row, index) =>
      row.principalCOP > 0 &&
      (index === 0 ||
        (decrease > 0
          ? row.amountCOP < rows[index - 1].amountCOP
          : row.amountCOP <= rows[index - 1].amountCOP + rows.length)),
  );
}

/**
 * Plan de cuotas completo. La cuota `t` vence `t` meses después de `startDate`
 * (fecha de activación o desembolso).
 */
export function geometricSchedule(
  principal: number,
  months: number,
  monthlyRate: number,
  decrease: number,
  startDate: Date | string,
): ScheduleRow[] {
  const base = toIsoDate(startDate);
  return geometricAmounts(principal, months, monthlyRate, decrease).map(
    (row) => ({ ...row, dueDate: addMonthsToDate(base, row.sequence) }),
  );
}

export function scheduleTotals(
  rows: Array<Pick<ScheduleRow, 'amountCOP' | 'interestCOP' | 'principalCOP'>>,
) {
  const sum = (key: 'amountCOP' | 'interestCOP' | 'principalCOP') =>
    rows.reduce((total, row) => total + row[key], 0);
  return {
    firstInstallmentCOP: rows[0]?.amountCOP ?? 0,
    lastInstallmentCOP: rows.at(-1)?.amountCOP ?? 0,
    totalCOP: sum('amountCOP'),
    totalInterestCOP: sum('interestCOP'),
    totalPrincipalCOP: sum('principalCOP'),
  };
}

export interface PendingInstallment {
  sequence: number;
  dueDate: string;
  /** Capital programado de la cuota antes del abono. */
  principalCOP: number;
}

export interface PrepaymentRecalculation {
  appliedCOP: number;
  /** Parte del abono que supera el saldo de capital (no se aplica). */
  excessCOP: number;
  balanceBeforeCOP: number;
  balanceAfterCOP: number;
  closesLoan: boolean;
  installments: ScheduleRow[];
}

/**
 * Abono anticipado a capital. El abono reduce el saldo y las cuotas pendientes
 * se recalculan con la misma tasa y el mismo gradiente: misma cantidad de
 * cuotas y mismas fechas, menor valor. Si el abono cubre todo el saldo, cada
 * cuota pendiente queda por su capital (sin intereses) y el crédito se cierra.
 */
export function recalculateAfterPrepayment(input: {
  prepaymentCOP: number;
  monthlyRate: number;
  geometricDecrease: number;
  pending: PendingInstallment[];
}): PrepaymentRecalculation {
  const { prepaymentCOP, monthlyRate, geometricDecrease } = input;
  if (!Number.isSafeInteger(prepaymentCOP) || prepaymentCOP <= 0)
    throw new Error('Abono inválido');
  const pending = [...input.pending].sort((a, b) => a.sequence - b.sequence);
  if (!pending.length) throw new Error('No hay cuotas pendientes');
  if (
    pending.some(
      (row) => !Number.isSafeInteger(row.principalCOP) || row.principalCOP < 0,
    )
  )
    throw new Error('Capital inválido');
  const balance = pending.reduce((total, row) => total + row.principalCOP, 0);
  if (balance <= 0) throw new Error('No hay saldo de capital');
  const applied = Math.min(prepaymentCOP, balance);
  const after = balance - applied;
  if (after === 0) {
    let running = balance;
    const installments = pending.map((row) => {
      const opening = running;
      running -= row.principalCOP;
      return {
        sequence: row.sequence,
        amountCOP: row.principalCOP,
        principalCOP: row.principalCOP,
        interestCOP: 0,
        openingBalanceCOP: opening,
        closingBalanceCOP: running,
        dueDate: toIsoDate(row.dueDate),
      };
    });
    return {
      appliedCOP: applied,
      excessCOP: prepaymentCOP - applied,
      balanceBeforeCOP: balance,
      balanceAfterCOP: 0,
      closesLoan: true,
      installments,
    };
  }
  const amounts = geometricAmounts(
    after,
    pending.length,
    monthlyRate,
    geometricDecrease,
  );
  return {
    appliedCOP: applied,
    excessCOP: 0,
    balanceBeforeCOP: balance,
    balanceAfterCOP: after,
    closesLoan: false,
    installments: amounts.map((row, index) => ({
      ...row,
      sequence: pending[index].sequence,
      dueDate: toIsoDate(pending[index].dueDate),
    })),
  };
}
