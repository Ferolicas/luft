jest.mock('../common/audit.service', () => ({ AuditService: class {} }));
jest.mock('../common/crypto.service', () => ({ CryptoService: class {} }));
jest.mock('../database/database.service', () => ({
  DatabaseService: class {},
}));

import { geometricSchedule } from './credit-calculator';
import { bogotaDate, daysOverdue } from './credit-lifecycle';
import { StartifService } from './startif.service';

/**
 * Idempotencia financiera del webhook de pagos, con el servicio real y una
 * base de datos en memoria. El proveedor de pagos es un doble de prueba: solo
 * devuelve el recurso que el test declara.
 */

type Row = Record<string, any>;

const LOAN = 'loan-1';
const APPLICATION = 'application-1';
const USER = 'user-1';

function memoryDatabase(options: { startDate?: string } = {}) {
  const start = options.startDate ?? bogotaDate(new Date());
  const installments: Row[] = geometricSchedule(
    600_000,
    6,
    0.01,
    0.2,
    start,
  ).map((row) => ({
    id: `installment-${row.sequence}`,
    loanId: LOAN,
    sequence: row.sequence,
    dueDate: new Date(`${row.dueDate}T00:00:00Z`),
    openingBalanceCOP: BigInt(row.openingBalanceCOP),
    amountCOP: BigInt(row.amountCOP),
    principalCOP: BigInt(row.principalCOP),
    interestCOP: BigInt(row.interestCOP),
    closingBalanceCOP: BigInt(row.closingBalanceCOP),
    paidCOP: 0n,
    status: 'PENDING',
    paidAt: null,
  }));
  const loan: Row = {
    id: LOAN,
    applicationId: APPLICATION,
    userId: USER,
    monthlyRate: '0.010000',
    geometricDecrease: '0.200000',
    defaultAfterDays: 30,
    status: 'ACTIVE',
    outstandingBalanceCOP: 600_000n,
    closedAt: null,
    defaultedAt: null,
  };
  const application: Row = { id: APPLICATION, status: 'ACTIVE' };
  const payments: Row[] = [];
  const prepayments: Row[] = [];
  const scoreInquiries: Row[] = [];
  const byId = (rows: Row[], id: string) => {
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error(`No existe ${id}`);
    return row;
  };
  const assign = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data))
      if (value !== undefined) row[key] = value;
    return row;
  };
  const statusMatches = (row: Row, filter: any) => {
    if (filter === undefined) return true;
    if (typeof filter === 'string') return row.status === filter;
    if (filter.notIn) return !filter.notIn.includes(row.status);
    if (filter.in) return filter.in.includes(row.status);
    return true;
  };
  const startif = {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    payment: {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          payments.find((row) =>
            where.OR.some((clause: Row) =>
              Object.entries(clause).every(
                ([key, value]) => row[key] === value,
              ),
            ),
          ) ?? null,
        ),
      findUniqueOrThrow: ({ where }: any) =>
        Promise.resolve({ ...byId(payments, where.id) }),
      updateMany: ({ where, data }: any) => {
        const row = byId(payments, where.id);
        if (!statusMatches(row, where.status))
          return Promise.resolve({ count: 0 });
        assign(row, data);
        return Promise.resolve({ count: 1 });
      },
      update: ({ where, data }: any) =>
        Promise.resolve(assign(byId(payments, where.id), data)),
    },
    installment: {
      findUniqueOrThrow: ({ where }: any) =>
        Promise.resolve({ ...byId(installments, where.id) }),
      update: ({ where, data }: any) =>
        Promise.resolve(assign(byId(installments, where.id), data)),
    },
    loan: {
      findUniqueOrThrow: () =>
        Promise.resolve({
          ...loan,
          installments: installments.map((row) => ({ ...row })),
        }),
      update: ({ data }: any) => Promise.resolve(assign(loan, data)),
    },
    creditApplication: {
      update: ({ data }: any) => Promise.resolve(assign(application, data)),
    },
    loanPrepayment: {
      create: ({ data }: any) => {
        if (prepayments.some((row) => row.paymentId === data.paymentId))
          throw new Error('paymentId duplicado');
        const row = {
          id: `prepayment-${prepayments.length + 1}`,
          reversedAt: null,
          reversalMode: null,
          ...data,
        };
        prepayments.push(row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: any) =>
        Promise.resolve(
          prepayments.find((row) => row.paymentId === where.paymentId) ?? null,
        ),
      count: ({ where }: any) =>
        Promise.resolve(
          prepayments.filter(
            (row) =>
              row.reversedAt === null &&
              row.id !== where.id.not &&
              row.appliedAt >= where.appliedAt.gte,
          ).length,
        ),
      update: ({ where, data }: any) =>
        Promise.resolve(assign(byId(prepayments, where.id), data)),
    },
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(startif),
  };
  const luft = {
    scoreInquiry: {
      findFirst: () => Promise.resolve(scoreInquiries[0] ?? null),
      create: ({ data }: any) => {
        const row = { id: 'inquiry-1', ...data };
        scoreInquiries.push(row);
        return Promise.resolve(row);
      },
    },
  };
  return {
    db: { startif, luft },
    installments,
    loan,
    application,
    payments,
    prepayments,
    scoreInquiries,
  };
}

function harness(options: { startDate?: string } = {}) {
  const store = memoryDatabase(options);
  const resources = new Map<string, unknown>();
  const integrations = {
    validateMercadoPagoWebhook: jest.fn(),
    getMercadoPagoResource: jest.fn((id: string) =>
      Promise.resolve(resources.get(id)),
    ),
    triggerAutomation: jest.fn(() => Promise.resolve()),
  };
  const queues = { add: jest.fn(() => Promise.resolve()) };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const realtime = { toUser: jest.fn(), toRole: jest.fn() };
  const crypto = { hash: (value: string) => `hash:${value.length}` };
  const service = new StartifService(
    store.db as any,
    crypto as any,
    audit as any,
    integrations as any,
    queues as any,
    realtime as any,
    {} as any,
  );
  let counter = 0;
  const createPayment = (data: Row) => {
    counter += 1;
    const payment = {
      id: `payment-${counter}`,
      userId: USER,
      kind: 'INSTALLMENT',
      installmentId: null,
      loanId: LOAN,
      externalId: `ORDER-${counter}`,
      idempotencyKey: `key-${counter}`,
      status: 'ACTION_REQUIRED',
      creditedCOP: 0n,
      statusDetail: null,
      ...data,
    };
    store.payments.push(payment);
    return payment;
  };
  const notify = (payment: Row, status: string, amount?: number) => {
    resources.set(payment.externalId, {
      id: payment.externalId,
      status,
      external_reference: payment.idempotencyKey,
      transactions: {
        payments: [
          { status, amount: String(amount ?? Number(payment.amountCOP)) },
        ],
      },
    });
    return service.webhookMercadoPago(
      {},
      { type: 'order', data: { id: payment.externalId } },
      payment.externalId,
    );
  };
  const amounts = () => store.installments.map((row) => Number(row.amountCOP));
  const jobs = (name: string) =>
    queues.add.mock.calls.filter((call: unknown[]) => call[1] === name);
  return {
    ...store,
    service,
    integrations,
    queues,
    audit,
    createPayment,
    notify,
    amounts,
    jobs,
  };
}

const OWNER_TABLE = [167_320, 133_856, 107_085, 85_668, 68_534, 54_827];

describe('webhook de pagos: cuotas', () => {
  it('aplica una cuota aprobada una sola vez', async () => {
    const h = harness();
    const payment = h.createPayment({
      installmentId: 'installment-1',
      amountCOP: 167_320n,
    });
    expect(await h.notify(payment, 'approved')).toEqual({
      accepted: true,
      matched: true,
    });
    expect(await h.notify(payment, 'approved')).toEqual({
      accepted: true,
      matched: true,
      idempotent: true,
    });
    expect(h.installments[0].status).toBe('PAID');
    expect(h.installments[0].paidCOP).toBe(167_320n);
    expect(h.payments[0].creditedCOP).toBe(167_320n);
    expect(h.loan.outstandingBalanceCOP).toBe(438_680n);
    expect(h.loan.status).toBe('ACTIVE');
    expect(h.jobs('report-payment')).toHaveLength(1);
    expect(h.audit.record).toHaveBeenCalledTimes(1);
  });

  it('rechaza un monto distinto al esperado sin tocar nada', async () => {
    const h = harness();
    const payment = h.createPayment({
      installmentId: 'installment-1',
      amountCOP: 167_320n,
    });
    await expect(h.notify(payment, 'approved', 100_000)).rejects.toMatchObject({
      response: { code: 'payment_amount_mismatch' },
    });
    expect(payment.status).toBe('ACTION_REQUIRED');
    expect(h.installments[0].paidCOP).toBe(0n);
    expect(h.loan.outstandingBalanceCOP).toBe(600_000n);
  });

  it('un segundo pago de la misma cuota va a conciliación y su reembolso no la reabre', async () => {
    const h = harness();
    const first = h.createPayment({
      installmentId: 'installment-1',
      amountCOP: 167_320n,
    });
    const duplicate = h.createPayment({
      installmentId: 'installment-1',
      amountCOP: 167_320n,
    });
    await h.notify(first, 'approved');
    await h.notify(duplicate, 'approved');
    expect(duplicate.statusDetail).toBe(
      'DUPLICATE_PAYMENT_REQUIRES_RECONCILIATION',
    );
    expect(duplicate.creditedCOP).toBe(0n);
    expect(h.installments[0].paidCOP).toBe(167_320n);
    expect(h.integrations.triggerAutomation).toHaveBeenCalledWith(
      'luft-payment-reconciliation',
      expect.objectContaining({ event: 'payment.reconciliation_required' }),
    );
    await h.notify(duplicate, 'refunded');
    expect(h.installments[0].status).toBe('PAID');
    expect(h.installments[0].paidCOP).toBe(167_320n);
    expect(h.loan.outstandingBalanceCOP).toBe(438_680n);
    // El reembolso del pago que sí se aplicó reabre la cuota.
    await h.notify(first, 'refunded');
    expect(h.installments[0].status).toBe('PENDING');
    expect(h.installments[0].paidCOP).toBe(0n);
    expect(h.installments[0].paidAt).toBeNull();
    expect(first.creditedCOP).toBe(0n);
    expect(h.loan.outstandingBalanceCOP).toBe(600_000n);
  });

  it('un pago reembolsado es final: una aprobación tardía no vuelve a aplicar', async () => {
    const h = harness();
    const payment = h.createPayment({
      installmentId: 'installment-1',
      amountCOP: 167_320n,
    });
    await h.notify(payment, 'approved');
    await h.notify(payment, 'refunded');
    expect(await h.notify(payment, 'approved')).toEqual({
      accepted: true,
      matched: true,
      idempotent: true,
    });
    expect(payment.status).toBe('REFUNDED');
    expect(h.installments[0].paidCOP).toBe(0n);
  });

  it('pagar la última cuota cierra el crédito y pide el puntaje final una vez', async () => {
    const h = harness();
    for (const row of h.installments) {
      const payment = h.createPayment({
        installmentId: row.id,
        amountCOP: row.amountCOP,
      });
      await h.notify(payment, 'approved');
    }
    expect(h.loan.status).toBe('COMPLETED');
    expect(h.loan.outstandingBalanceCOP).toBe(0n);
    expect(h.loan.closedAt).toBeInstanceOf(Date);
    expect(h.application.status).toBe('COMPLETED');
    expect(h.scoreInquiries).toHaveLength(1);
    expect(h.jobs('query-score')).toHaveLength(1);
  });

  it('ponerse al día saca el crédito de mora', async () => {
    // Activado hace 75 días: la cuota 1 venció hace ~45 días y la 2 hace ~14.
    const today = bogotaDate(new Date());
    const past = new Date(Date.now() - 75 * 86_400_000);
    const h = harness({ startDate: bogotaDate(past) });
    h.loan.status = 'DEFAULTED';
    h.loan.defaultedAt = new Date();
    h.application.status = 'DEFAULTED';
    const overdue = h.installments.filter(
      (row) => daysOverdue(row.dueDate, today) > 0,
    );
    expect(overdue).toHaveLength(2);
    for (const row of overdue) row.status = 'OVERDUE';
    for (const [index, row] of overdue.entries()) {
      await h.notify(
        h.createPayment({ installmentId: row.id, amountCOP: row.amountCOP }),
        'approved',
      );
      // Mientras quede una cuota vencida sigue en mora.
      expect(h.loan.status).toBe(
        index === overdue.length - 1 ? 'ACTIVE' : 'DEFAULTED',
      );
    }
    expect(h.loan.defaultedAt).toBeNull();
    expect(h.application.status).toBe('ACTIVE');
  });
});

describe('webhook de pagos: abonos anticipados', () => {
  const prepay = (h: ReturnType<typeof harness>, amountCOP: number) =>
    h.createPayment({ kind: 'PREPAYMENT', amountCOP: BigInt(amountCOP) });

  it('aplica el abono a capital y recalcula las cuotas una sola vez', async () => {
    const h = harness();
    await h.notify(
      h.createPayment({ installmentId: 'installment-1', amountCOP: 167_320n }),
      'approved',
    );
    const payment = prepay(h, 100_000);
    await h.notify(payment, 'approved');
    const once = h.amounts();
    expect(await h.notify(payment, 'approved')).toEqual({
      accepted: true,
      matched: true,
      idempotent: true,
    });
    expect(h.amounts()).toEqual(once);
    expect(h.prepayments).toHaveLength(1);
    expect(once[0]).toBe(OWNER_TABLE[0]);
    once.slice(1).forEach((amount, index) => {
      expect(amount).toBeLessThan(OWNER_TABLE[index + 1]);
    });
    expect(h.loan.outstandingBalanceCOP).toBe(338_680n);
    expect(payment.creditedCOP).toBe(100_000n);
    expect(h.prepayments[0]).toMatchObject({
      paymentId: payment.id,
      appliedCOP: 100_000n,
      balanceBeforeCOP: 438_680n,
      balanceAfterCOP: 338_680n,
      closedLoan: false,
    });
    expect(
      h.prepayments[0].previousPlan.map((row: Row) => row.amountCOP),
    ).toEqual(OWNER_TABLE.slice(1));
    expect(h.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'payment.prepayment.applied' }),
    );
    expect(h.jobs('report-payment')).toHaveLength(2);
  });

  it('el reembolso de un abono repone el plan anterior exacto', async () => {
    const h = harness();
    const payment = prepay(h, 150_000);
    await h.notify(payment, 'approved');
    expect(h.amounts()).not.toEqual(OWNER_TABLE);
    await h.notify(payment, 'refunded');
    expect(h.amounts()).toEqual(OWNER_TABLE);
    expect(h.loan.outstandingBalanceCOP).toBe(600_000n);
    expect(h.loan.status).toBe('ACTIVE');
    expect(payment.creditedCOP).toBe(0n);
    expect(h.prepayments[0].reversalMode).toBe('RESTORED');
    expect(h.prepayments[0].reversedAt).toBeInstanceOf(Date);
    expect(h.integrations.triggerAutomation).toHaveBeenCalledWith(
      'luft-payment-reconciliation',
      expect.objectContaining({
        event: 'payment.refunded',
        reversal: 'RESTORED',
      }),
    );
    // Reembolso repetido: no hace nada.
    expect(await h.notify(payment, 'refunded')).toEqual({
      accepted: true,
      matched: true,
      idempotent: true,
    });
    expect(h.amounts()).toEqual(OWNER_TABLE);
  });

  it('un abono que cubre el saldo cierra el crédito; su reembolso lo reabre', async () => {
    const h = harness();
    const payment = prepay(h, 600_000);
    await h.notify(payment, 'approved');
    expect(h.loan.status).toBe('COMPLETED');
    expect(h.application.status).toBe('COMPLETED');
    expect(h.loan.outstandingBalanceCOP).toBe(0n);
    expect(h.installments.every((row) => row.status === 'PAID')).toBe(true);
    expect(
      h.installments.reduce((sum, row) => sum + Number(row.paidCOP), 0),
    ).toBe(600_000);
    expect(h.scoreInquiries).toHaveLength(1);
    await h.notify(payment, 'refunded');
    expect(h.loan.status).toBe('ACTIVE');
    expect(h.loan.closedAt).toBeNull();
    expect(h.application.status).toBe('ACTIVE');
    expect(h.amounts()).toEqual(OWNER_TABLE);
    expect(h.installments.every((row) => row.paidCOP === 0n)).toBe(true);
    expect(h.loan.outstandingBalanceCOP).toBe(600_000n);
  });

  it('si hubo un pago posterior, el reembolso recalcula sin tocar lo recaudado', async () => {
    const h = harness();
    const payment = prepay(h, 100_000);
    await h.notify(payment, 'approved');
    const first = h.installments[0];
    await h.notify(
      h.createPayment({ installmentId: first.id, amountCOP: first.amountCOP }),
      'approved',
    );
    const paid = first.paidCOP;
    const balance = h.loan.outstandingBalanceCOP;
    await h.notify(payment, 'refunded');
    expect(h.prepayments[0].reversalMode).toBe('RECALCULATED');
    expect(first.status).toBe('PAID');
    expect(first.paidCOP).toBe(paid);
    expect(h.loan.outstandingBalanceCOP).toBe(balance + 100_000n);
    expect(h.installments.at(-1)?.closingBalanceCOP).toBe(0n);
  });

  it('un abono sobre un crédito ya pagado va a conciliación, no se aplica', async () => {
    const h = harness();
    await h.notify(prepay(h, 600_000), 'approved');
    const late = prepay(h, 50_000);
    await h.notify(late, 'approved');
    expect(late.creditedCOP).toBe(0n);
    expect(late.statusDetail).toBe(
      'PREPAYMENT_WITHOUT_BALANCE_REQUIRES_RECONCILIATION',
    );
    expect(h.prepayments).toHaveLength(1);
    expect(h.jobs('report-payment')).toHaveLength(1);
    // Reembolsarlo no reabre el crédito.
    await h.notify(late, 'refunded');
    expect(h.loan.status).toBe('COMPLETED');
  });

  it('un abono mayor que el saldo aplica el saldo y marca el exceso', async () => {
    const h = harness();
    await h.notify(prepay(h, 500_000), 'approved');
    const excess = prepay(h, 150_000);
    await h.notify(excess, 'approved');
    expect(excess.creditedCOP).toBe(100_000n);
    expect(excess.statusDetail).toBe(
      'PREPAYMENT_EXCESS_REQUIRES_RECONCILIATION',
    );
    expect(h.loan.status).toBe('COMPLETED');
  });

  it('no recalcula sobre una cuota con pago parcial', async () => {
    const h = harness();
    h.installments[0].paidCOP = 50_000n;
    h.installments[0].status = 'PARTIALLY_PAID';
    const payment = prepay(h, 100_000);
    await h.notify(payment, 'approved');
    expect(payment.creditedCOP).toBe(0n);
    expect(payment.statusDetail).toBe(
      'PREPAYMENT_ON_PARTIAL_INSTALLMENT_REQUIRES_RECONCILIATION',
    );
    expect(h.amounts()).toEqual(OWNER_TABLE);
    expect(h.prepayments).toHaveLength(0);
  });

  it('un pago rechazado no cambia el crédito', async () => {
    const h = harness();
    const payment = prepay(h, 100_000);
    await h.notify(payment, 'rejected');
    expect(payment.status).toBe('REJECTED');
    expect(h.amounts()).toEqual(OWNER_TABLE);
    expect(h.loan.outstandingBalanceCOP).toBe(600_000n);
    expect(h.queues.add).not.toHaveBeenCalled();
  });
});
