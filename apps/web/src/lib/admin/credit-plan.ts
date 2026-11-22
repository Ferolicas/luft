/**
 * Plan de cuotas del gradiente geométrico decreciente, para MOSTRAR en la
 * consola las condiciones de un producto o de una solicitud.
 *
 * Es el mismo cálculo de `apps/api/src/startif/credit-calculator.ts`
 * (C_t = C_1·(1−g)^(t−1), interés redondeado sobre saldo entero, la última
 * cuota absorbe el residuo). La API de administración no devuelve el plan de
 * una solicitud en estudio; el plan definitivo siempre lo genera la API al
 * aprobar o al registrar el desembolso.
 */
export interface PlanRow {
  sequence: number;
  amountCOP: number;
  principalCOP: number;
  interestCOP: number;
  openingBalanceCOP: number;
  closingBalanceCOP: number;
  dueDate: string | null;
}

export function geometricPlan(principal: number, months: number, monthlyRate: number, decrease: number, startDate?: string | null): PlanRow[] {
  if (!Number.isSafeInteger(principal) || principal <= 0) return [];
  if (!Number.isInteger(months) || months < 1 || months > 120) return [];
  if (!Number.isFinite(monthlyRate) || monthlyRate < 0 || monthlyRate > 1) return [];
  if (!Number.isFinite(decrease) || decrease < 0 || decrease >= 1) return [];
  const q = 1 - decrease;
  let denominator = 0;
  for (let index = 0; index < months; index += 1) denominator += Math.pow(q, index) / Math.pow(1 + monthlyRate, index + 1);
  const firstPayment = principal / denominator;
  let balance = principal;
  const rows: PlanRow[] = [];
  for (let index = 0; index < months; index += 1) {
    const last = index === months - 1;
    const interest = Math.round(balance * monthlyRate);
    const scheduled = Math.round(firstPayment * Math.pow(q, index));
    const principalPart = last ? balance : Math.min(balance, Math.max(0, scheduled - interest));
    const opening = balance;
    balance -= principalPart;
    rows.push({
      sequence: index + 1,
      amountCOP: last ? opening + interest : scheduled,
      principalCOP: principalPart,
      interestCOP: interest,
      openingBalanceCOP: opening,
      closingBalanceCOP: balance,
      dueDate: startDate ? addMonths(startDate, index + 1) : null,
    });
  }
  return rows;
}

/** Suma meses calendario a `YYYY-MM-DD`; si el día no existe usa el último del mes. */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function planTotals(rows: PlanRow[]) {
  return {
    totalCOP: rows.reduce((sum, row) => sum + row.amountCOP, 0),
    totalInterestCOP: rows.reduce((sum, row) => sum + row.interestCOP, 0),
    firstInstallmentCOP: rows[0]?.amountCOP ?? 0,
    lastInstallmentCOP: rows.at(-1)?.amountCOP ?? 0,
  };
}

/** Tasa efectiva anual equivalente a una tasa mensual vencida. */
export function annualEffective(monthlyRate: number) {
  return Math.pow(1 + monthlyRate, 12) - 1;
}
