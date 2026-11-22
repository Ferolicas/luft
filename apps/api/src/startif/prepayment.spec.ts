import { geometricSchedule } from './credit-calculator';
import {
  outstandingPrincipal,
  planPrepayment,
  planPrepaymentReversal,
  toPlanRow,
  type PlanRow,
} from './prepayment';

const NOW = new Date('2026-11-22T15:00:00Z');
const TERMS = { monthlyRate: 0.01, geometricDecrease: 0.2 };

/** Crédito de $600.000 activado el 22 de agosto: cuotas 1 y 2 ya pagadas. */
const loan = (paid = 2): PlanRow[] =>
  geometricSchedule(600_000, 6, 0.01, 0.2, '2026-08-22').map((row, index) => ({
    ...row,
    id: `cuota-${row.sequence}`,
    paidCOP: index < paid ? row.amountCOP : 0,
    status: index < paid ? 'PAID' : 'PENDING',
    paidAt: index < paid ? '2026-09-20T15:00:00.000Z' : null,
  }));

const applied = (installments: PlanRow[], prepaymentCOP: number) => {
  const plan = planPrepayment({
    installments,
    prepaymentCOP,
    now: NOW,
    ...TERMS,
  });
  if (plan.outcome !== 'APPLIED') throw new Error(plan.outcome);
  return plan;
};

/** Estado del préstamo después de escribir un plan nuevo. */
const write = (installments: PlanRow[], rows: PlanRow[]) =>
  installments.map((row) => rows.find((item) => item.id === row.id) ?? row);

describe('planPrepayment', () => {
  it('aplica el abono a capital y recalcula solo las cuotas pendientes', () => {
    const installments = loan();
    const plan = applied(installments, 100_000);
    expect(plan.balanceBeforeCOP).toBe(309_211);
    expect(plan.balanceAfterCOP).toBe(209_211);
    expect(plan.appliedCOP).toBe(100_000);
    expect(plan.excessCOP).toBe(0);
    expect(plan.closesLoan).toBe(false);
    expect(plan.previousPlan.map((row) => row.id)).toEqual([
      'cuota-3',
      'cuota-4',
      'cuota-5',
      'cuota-6',
    ]);
    expect(plan.newPlan.map((row) => row.id)).toEqual(
      plan.previousPlan.map((row) => row.id),
    );
    plan.newPlan.forEach((row, index) => {
      const before = plan.previousPlan[index];
      expect(row.amountCOP).toBeLessThan(before.amountCOP);
      expect(row.dueDate).toBe(before.dueDate);
      expect(row.sequence).toBe(before.sequence);
      expect(row.status).toBe('PENDING');
      expect(row.paidCOP).toBe(0);
      expect(row.paidAt).toBeNull();
    });
    expect(outstandingPrincipal(write(installments, plan.newPlan))).toBe(
      209_211,
    );
  });

  it('guarda el plan anterior completo para poder revertirlo', () => {
    const installments = loan();
    const plan = applied(installments, 100_000);
    expect(plan.previousPlan).toEqual(installments.slice(2));
  });

  it('conserva el estado vencido de una cuota al recalcular', () => {
    const installments = loan();
    installments[2].status = 'OVERDUE';
    const plan = applied(installments, 50_000);
    expect(plan.newPlan[0].status).toBe('OVERDUE');
    expect(plan.newPlan[1].status).toBe('PENDING');
  });

  it('cierra el crédito si el abono cubre todo el saldo', () => {
    const installments = loan();
    const plan = applied(installments, 309_211);
    expect(plan.closesLoan).toBe(true);
    expect(plan.balanceAfterCOP).toBe(0);
    for (const row of plan.newPlan) {
      expect(row.status).toBe('PAID');
      expect(row.interestCOP).toBe(0);
      expect(row.paidCOP).toBe(row.amountCOP);
      expect(row.paidAt).toBe(NOW.toISOString());
    }
    expect(plan.newPlan.reduce((sum, row) => sum + row.paidCOP, 0)).toBe(
      309_211,
    );
    expect(outstandingPrincipal(write(installments, plan.newPlan))).toBe(0);
  });

  it('no aplica más que el saldo: el exceso va a conciliación', () => {
    const plan = applied(loan(), 350_000);
    expect(plan.appliedCOP).toBe(309_211);
    expect(plan.excessCOP).toBe(40_789);
    expect(plan.closesLoan).toBe(true);
  });

  it('no aplica nada si el crédito ya no tiene saldo', () => {
    expect(
      planPrepayment({
        installments: loan(6),
        prepaymentCOP: 10_000,
        now: NOW,
        ...TERMS,
      }),
    ).toEqual({ outcome: 'NO_BALANCE' });
    expect(
      planPrepayment({
        installments: [],
        prepaymentCOP: 10_000,
        now: NOW,
        ...TERMS,
      }),
    ).toEqual({ outcome: 'NO_BALANCE' });
  });

  it('no recalcula si una cuota tiene un pago parcial', () => {
    const installments = loan();
    installments[2] = {
      ...installments[2],
      paidCOP: 20_000,
      status: 'PARTIALLY_PAID',
    };
    expect(
      planPrepayment({
        installments,
        prepaymentCOP: 10_000,
        now: NOW,
        ...TERMS,
      }),
    ).toEqual({ outcome: 'PARTIAL_INSTALLMENT' });
  });

  it('dos abonos seguidos mantienen el plan coherente', () => {
    let installments = loan();
    const first = applied(installments, 100_000);
    installments = write(installments, first.newPlan);
    const second = applied(installments, 50_000);
    installments = write(installments, second.newPlan);
    expect(second.balanceBeforeCOP).toBe(209_211);
    expect(outstandingPrincipal(installments)).toBe(159_211);
    const open = installments.slice(2);
    expect(open.at(-1)?.closingBalanceCOP).toBe(0);
    for (let index = 1; index < open.length; index += 1)
      expect(open[index].amountCOP).toBeLessThan(open[index - 1].amountCOP);
  });
});

describe('planPrepaymentReversal (reembolso de un abono)', () => {
  const reverse = (
    plan: ReturnType<typeof applied>,
    current: PlanRow[],
    extra: { laterPrepayments?: number; today?: string } = {},
  ) =>
    planPrepaymentReversal({
      previousPlan: plan.previousPlan,
      newPlan: plan.newPlan,
      current,
      appliedCOP: plan.appliedCOP,
      laterPrepayments: extra.laterPrepayments ?? 0,
      today: extra.today ?? '2026-11-01',
      ...TERMS,
    });

  it('repone el plan anterior exacto si nada cambió desde el abono', () => {
    const original = loan();
    const plan = applied(original, 100_000);
    const reversal = reverse(plan, write(original, plan.newPlan));
    expect(reversal.mode).toBe('RESTORED');
    expect(write(write(original, plan.newPlan), reversal.installments)).toEqual(
      original,
    );
  });

  it('reabre un crédito que el abono había cerrado', () => {
    const original = loan();
    const plan = applied(original, 309_211);
    const reversal = reverse(plan, write(original, plan.newPlan));
    expect(reversal.mode).toBe('RESTORED');
    const restored = write(
      write(original, plan.newPlan),
      reversal.installments,
    );
    expect(restored).toEqual(original);
    expect(outstandingPrincipal(restored)).toBe(309_211);
  });

  it('al reponer, marca vencidas las cuotas cuyo plazo ya pasó', () => {
    const original = loan();
    const plan = applied(original, 100_000);
    const reversal = reverse(plan, write(original, plan.newPlan), {
      today: '2026-12-01',
    });
    // La cuota 3 venció el 22 de noviembre.
    expect(reversal.installments.map((row) => row.status)).toEqual([
      'OVERDUE',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    expect(reversal.installments.map((row) => row.amountCOP)).toEqual(
      original.slice(2).map((row) => row.amountCOP),
    );
  });

  it('si después se pagó una cuota, devuelve el capital y recalcula lo abierto', () => {
    const original = loan();
    const plan = applied(original, 100_000);
    const current = write(original, plan.newPlan);
    // La cuota 3 se pagó con el plan nuevo (más bajo).
    current[2] = {
      ...current[2],
      status: 'PAID',
      paidCOP: current[2].amountCOP,
      paidAt: '2026-11-22T16:00:00.000Z',
    };
    const balance = outstandingPrincipal(current);
    const reversal = reverse(plan, current);
    expect(reversal.mode).toBe('RECALCULATED');
    expect(reversal.installments.map((row) => row.id)).toEqual([
      'cuota-4',
      'cuota-5',
      'cuota-6',
    ]);
    const after = write(current, reversal.installments);
    // Lo ya recaudado no se toca; el capital reembolsado vuelve al saldo.
    expect(after[2]).toEqual(current[2]);
    expect(outstandingPrincipal(after)).toBe(balance + 100_000);
    expect(after.at(-1)?.closingBalanceCOP).toBe(0);
    reversal.installments.forEach((row) => {
      const before = current.find((item) => item.id === row.id) as PlanRow;
      expect(row.amountCOP).toBeGreaterThan(before.amountCOP);
      expect(row.dueDate).toBe(before.dueDate);
      expect(row.paidCOP).toBe(0);
    });
  });

  it('si hubo un abono posterior, recalcula en lugar de reponer', () => {
    const original = loan();
    const first = applied(original, 100_000);
    let current = write(original, first.newPlan);
    const second = applied(current, 50_000);
    current = write(current, second.newPlan);
    const reversal = reverse(first, current, { laterPrepayments: 1 });
    expect(reversal.mode).toBe('RECALCULATED');
    const after = write(current, reversal.installments);
    // Queda solo el segundo abono aplicado: 309.211 − 50.000.
    expect(outstandingPrincipal(after)).toBe(259_211);
  });

  it('revertir el abono más reciente repone su plan anterior', () => {
    const original = loan();
    const first = applied(original, 100_000);
    const afterFirst = write(original, first.newPlan);
    const second = applied(afterFirst, 50_000);
    const reversal = reverse(second, write(afterFirst, second.newPlan));
    expect(reversal.mode).toBe('RESTORED');
    expect(
      write(write(afterFirst, second.newPlan), reversal.installments),
    ).toEqual(afterFirst);
  });

  it('pide revisión manual si ya no quedan cuotas abiertas', () => {
    const original = loan();
    const plan = applied(original, 100_000);
    const current = write(original, plan.newPlan).map((row) => ({
      ...row,
      status: 'PAID',
      paidCOP: row.amountCOP,
      paidAt: row.paidAt ?? '2026-11-22T16:00:00.000Z',
    }));
    expect(reverse(plan, current)).toEqual({
      mode: 'MANUAL_REVIEW',
      installments: [],
    });
  });

  it('pide revisión manual si una cuota abierta tiene pago parcial', () => {
    const original = loan();
    const plan = applied(original, 100_000);
    const current = write(original, plan.newPlan);
    current[2] = { ...current[2], status: 'PARTIALLY_PAID', paidCOP: 10_000 };
    expect(reverse(plan, current).mode).toBe('MANUAL_REVIEW');
  });
});

describe('toPlanRow', () => {
  it('convierte una cuota de la base de datos a valores simples', () => {
    expect(
      toPlanRow({
        id: 'a',
        sequence: 3,
        dueDate: new Date('2026-11-22T00:00:00Z'),
        openingBalanceCOP: 309_211n,
        amountCOP: 107_085n,
        principalCOP: 103_993n,
        interestCOP: 3_092n,
        closingBalanceCOP: 205_218n,
        paidCOP: 0n,
        status: 'PENDING',
        paidAt: null,
      }),
    ).toEqual({
      id: 'a',
      sequence: 3,
      dueDate: '2026-11-22',
      openingBalanceCOP: 309_211,
      amountCOP: 107_085,
      principalCOP: 103_993,
      interestCOP: 3_092,
      closingBalanceCOP: 205_218,
      paidCOP: 0,
      status: 'PENDING',
      paidAt: null,
    });
  });
});
