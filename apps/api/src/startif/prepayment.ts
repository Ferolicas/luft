/**
 * Decisiones puras sobre abonos anticipados a capital y su reversión.
 * El servicio solo persiste lo que estas funciones devuelven, dentro de la
 * misma transacción del webhook de pagos.
 */
import {
  geometricAmounts,
  recalculateAfterPrepayment,
  toIsoDate,
} from './credit-calculator';
import { isSettled, openInstallmentStatus } from './credit-lifecycle';

/** Una cuota tal como queda guardada en el plan anterior/nuevo de un abono. */
export interface PlanRow {
  id: string;
  sequence: number;
  dueDate: string;
  openingBalanceCOP: number;
  amountCOP: number;
  principalCOP: number;
  interestCOP: number;
  closingBalanceCOP: number;
  paidCOP: number;
  status: string;
  paidAt: string | null;
}

export function toPlanRow(row: {
  id: string;
  sequence: number;
  dueDate: Date | string;
  openingBalanceCOP: bigint | number;
  amountCOP: bigint | number;
  principalCOP: bigint | number;
  interestCOP: bigint | number;
  closingBalanceCOP: bigint | number;
  paidCOP: bigint | number;
  status: string;
  paidAt?: Date | string | null;
}): PlanRow {
  return {
    id: row.id,
    sequence: row.sequence,
    dueDate: toIsoDate(row.dueDate),
    openingBalanceCOP: Number(row.openingBalanceCOP),
    amountCOP: Number(row.amountCOP),
    principalCOP: Number(row.principalCOP),
    interestCOP: Number(row.interestCOP),
    closingBalanceCOP: Number(row.closingBalanceCOP),
    paidCOP: Number(row.paidCOP),
    status: row.status,
    paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null,
  };
}

/** Saldo de capital: suma del capital de las cuotas sin pagar. */
export function outstandingPrincipal(
  rows: Array<{ status: string; principalCOP: bigint | number }>,
): number {
  return rows
    .filter((row) => !isSettled(row.status))
    .reduce((total, row) => total + Number(row.principalCOP), 0);
}

export type PrepaymentPlan =
  | {
      outcome: 'APPLIED';
      appliedCOP: number;
      excessCOP: number;
      balanceBeforeCOP: number;
      balanceAfterCOP: number;
      closesLoan: boolean;
      previousPlan: PlanRow[];
      newPlan: PlanRow[];
    }
  /** El crédito ya no tiene saldo: el dinero recibido requiere conciliación. */
  | { outcome: 'NO_BALANCE' }
  /** Hay una cuota con pago parcial: recalcular alteraría lo ya recaudado. */
  | { outcome: 'PARTIAL_INSTALLMENT' };

export function planPrepayment(input: {
  installments: PlanRow[];
  prepaymentCOP: number;
  monthlyRate: number;
  geometricDecrease: number;
  /** Instante en que el proveedor confirmó el abono. */
  now: Date;
}): PrepaymentPlan {
  const open = input.installments
    .filter((row) => !isSettled(row.status))
    .sort((a, b) => a.sequence - b.sequence);
  if (!open.length || outstandingPrincipal(open) <= 0)
    return { outcome: 'NO_BALANCE' };
  if (open.some((row) => row.paidCOP > 0))
    return { outcome: 'PARTIAL_INSTALLMENT' };
  const result = recalculateAfterPrepayment({
    prepaymentCOP: input.prepaymentCOP,
    monthlyRate: input.monthlyRate,
    geometricDecrease: input.geometricDecrease,
    pending: open,
  });
  const paidAt = input.now.toISOString();
  const newPlan = result.installments.map((row, index): PlanRow => {
    const before = open[index];
    return {
      ...row,
      id: before.id,
      paidCOP: result.closesLoan ? row.amountCOP : 0,
      status: result.closesLoan ? 'PAID' : before.status,
      paidAt: result.closesLoan ? paidAt : null,
    };
  });
  return {
    outcome: 'APPLIED',
    appliedCOP: result.appliedCOP,
    excessCOP: result.excessCOP,
    balanceBeforeCOP: result.balanceBeforeCOP,
    balanceAfterCOP: result.balanceAfterCOP,
    closesLoan: result.closesLoan,
    previousPlan: open,
    newPlan,
  };
}

export interface PrepaymentReversal {
  /**
   * RESTORED: nada cambió desde el abono; se repone el plan anterior exacto.
   * RECALCULATED: hubo pagos u otros abonos después; el capital reembolsado
   *   vuelve al saldo y las cuotas abiertas se recalculan.
   * MANUAL_REVIEW: no hay cuotas abiertas donde reponer la deuda (o tienen
   *   pagos parciales); el plan no se toca y un humano debe conciliar.
   */
  mode: 'RESTORED' | 'RECALCULATED' | 'MANUAL_REVIEW';
  installments: PlanRow[];
}

export function planPrepaymentReversal(input: {
  previousPlan: PlanRow[];
  newPlan: PlanRow[];
  current: PlanRow[];
  appliedCOP: number;
  /** Abonos posteriores a este que siguen aplicados. */
  laterPrepayments: number;
  monthlyRate: number;
  geometricDecrease: number;
  today: Date | string;
}): PrepaymentReversal {
  const byId = new Map(input.current.map((row) => [row.id, row]));
  const untouched =
    input.laterPrepayments === 0 &&
    input.newPlan.length === input.previousPlan.length &&
    input.newPlan.every((row) => {
      const now = byId.get(row.id);
      return (
        now !== undefined &&
        now.amountCOP === row.amountCOP &&
        now.principalCOP === row.principalCOP &&
        now.paidCOP === row.paidCOP &&
        isSettled(now.status) === isSettled(row.status)
      );
    });
  const reopen = (row: PlanRow): PlanRow => ({
    ...row,
    paidCOP: 0,
    paidAt: null,
    status: openInstallmentStatus({
      dueDate: row.dueDate,
      paidCOP: 0,
      today: input.today,
    }),
  });
  if (untouched)
    return { mode: 'RESTORED', installments: input.previousPlan.map(reopen) };
  const open = input.current
    .filter((row) => !isSettled(row.status))
    .sort((a, b) => a.sequence - b.sequence);
  if (!open.length || open.some((row) => row.paidCOP > 0))
    return { mode: 'MANUAL_REVIEW', installments: [] };
  const balance = outstandingPrincipal(open) + input.appliedCOP;
  const amounts = geometricAmounts(
    balance,
    open.length,
    input.monthlyRate,
    input.geometricDecrease,
  );
  return {
    mode: 'RECALCULATED',
    installments: amounts.map((row, index) =>
      reopen({
        ...open[index],
        openingBalanceCOP: row.openingBalanceCOP,
        amountCOP: row.amountCOP,
        principalCOP: row.principalCOP,
        interestCOP: row.interestCOP,
        closingBalanceCOP: row.closingBalanceCOP,
      }),
    ),
  };
}
