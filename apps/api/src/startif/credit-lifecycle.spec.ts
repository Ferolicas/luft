import {
  assertTransition,
  bogotaDate,
  canTransition,
  colombiaDateInput,
  CREDIT_STAGES,
  CREDIT_STATUSES,
  creditStage,
  daysOverdue,
  isInProgress,
  isResumable,
  openInstallmentStatus,
  resolveLoanStatus,
} from './credit-lifecycle';

describe('transiciones del crédito', () => {
  it.each([
    ['DRAFT', 'PENDING_KYC'],
    ['PENDING_KYC', 'PENDING_SIGNATURE'],
    ['PENDING_KYC', 'CONFIGURATION_REQUIRED'],
    ['CONFIGURATION_REQUIRED', 'PENDING_KYC'],
    ['PENDING_SIGNATURE', 'PENDING_REVIEW'],
    ['PENDING_REVIEW', 'ACTIVE'],
    ['PENDING_REVIEW', 'APPROVED'],
    ['PENDING_REVIEW', 'REJECTED'],
    ['APPROVED', 'ACTIVE'],
    ['APPROVED', 'REJECTED'],
    ['ACTIVE', 'COMPLETED'],
    ['ACTIVE', 'DEFAULTED'],
    ['DEFAULTED', 'ACTIVE'],
    ['DEFAULTED', 'COMPLETED'],
    ['DEFAULTED', 'WRITTEN_OFF'],
    ['WRITTEN_OFF', 'COMPLETED'],
    ['COMPLETED', 'ACTIVE'],
  ])('permite %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ['DRAFT', 'ACTIVE'],
    ['PENDING_KYC', 'PENDING_REVIEW'],
    ['PENDING_KYC', 'ACTIVE'],
    ['PENDING_SIGNATURE', 'ACTIVE'],
    ['PENDING_REVIEW', 'COMPLETED'],
    ['REJECTED', 'ACTIVE'],
    ['REJECTED', 'PENDING_REVIEW'],
    ['ACTIVE', 'WRITTEN_OFF'],
    ['ACTIVE', 'APPROVED'],
    ['ACTIVE', 'PENDING_SIGNATURE'],
    ['COMPLETED', 'WRITTEN_OFF'],
    ['WRITTEN_OFF', 'ACTIVE'],
    ['WRITTEN_OFF', 'DEFAULTED'],
    ['INVENTADO', 'ACTIVE'],
    ['ACTIVE', 'INVENTADO'],
  ])('bloquea %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(
      `Transición de estado inválida: ${from} → ${to}`,
    );
  });

  it('el castigo solo se alcanza desde la mora', () => {
    const sources = CREDIT_STATUSES.filter((status) =>
      canTransition(status, 'WRITTEN_OFF'),
    );
    expect(sources).toEqual(['DEFAULTED']);
  });

  it('un rechazo es definitivo', () => {
    expect(CREDIT_STATUSES.some((to) => canTransition('REJECTED', to))).toBe(
      false,
    );
  });
});

describe('etapas de la especificación', () => {
  it.each([
    ['DRAFT', 'borrador'],
    ['PENDING_CONSENT', 'solicitado'],
    ['PENDING_KYC', 'solicitado'],
    ['CONFIGURATION_REQUIRED', 'solicitado'],
    ['PENDING_SIGNATURE', 'solicitado'],
    ['PENDING_REVIEW', 'en_estudio'],
    ['REJECTED', 'rechazado'],
    ['ACTIVE', 'vigente'],
    ['COMPLETED', 'pagado'],
    ['DEFAULTED', 'mora'],
    ['WRITTEN_OFF', 'castigado'],
  ])('%s → %s', (status, stage) => {
    expect(creditStage({ status })).toBe(stage);
  });

  it('distingue aprobado, firmado y desembolsado', () => {
    expect(creditStage({ status: 'APPROVED', signed: false })).toBe('aprobado');
    expect(creditStage({ status: 'APPROVED', signed: true })).toBe('firmado');
    expect(
      creditStage({ status: 'APPROVED', signed: true, disbursed: true }),
    ).toBe('desembolsado');
  });

  it('todo estado técnico tiene una etapa de la especificación', () => {
    for (const status of CREDIT_STATUSES)
      expect(CREDIT_STAGES).toContain(creditStage({ status }));
    expect(() => creditStage({ status: 'INVENTADO' })).toThrow(
      'Estado de crédito desconocido',
    );
  });
});

describe('solicitudes en curso', () => {
  it('cuenta como en curso todo lo que no terminó', () => {
    expect(
      CREDIT_STATUSES.filter((status) => !isInProgress(status)).sort(),
    ).toEqual(['COMPLETED', 'REJECTED']);
  });

  it('solo se retoma una solicitud que aún no llega a estudio', () => {
    expect(CREDIT_STATUSES.filter(isResumable).sort()).toEqual([
      'CONFIGURATION_REQUIRED',
      'DRAFT',
      'PENDING_CONSENT',
      'PENDING_KYC',
      'PENDING_SIGNATURE',
    ]);
  });
});

describe('fechas de Colombia', () => {
  it('usa el día calendario de Colombia (UTC−5)', () => {
    expect(bogotaDate(new Date('2026-11-23T04:59:59Z'))).toBe('2026-11-22');
    expect(bogotaDate(new Date('2026-11-23T05:00:00Z'))).toBe('2026-11-23');
  });

  it('cuenta los días de mora', () => {
    expect(daysOverdue('2026-11-22', '2026-11-22')).toBe(0);
    expect(daysOverdue('2026-11-22', '2026-11-21')).toBe(0);
    expect(daysOverdue('2026-11-22', '2026-11-23')).toBe(1);
    expect(daysOverdue(new Date('2026-10-22T12:00:00Z'), '2026-11-22')).toBe(
      31,
    );
  });

  it('interpreta la fecha que escribe finanzas', () => {
    const day = colombiaDateInput('2026-11-20');
    expect(day.date).toBe('2026-11-20');
    expect(day.instant.toISOString()).toBe('2026-11-20T17:00:00.000Z');
    const instant = colombiaDateInput('2026-11-21T02:30:00Z');
    expect(instant.date).toBe('2026-11-20');
    expect(() => colombiaDateInput('mañana')).toThrow('Fecha inválida');
    expect(() => colombiaDateInput('2026-02-31')).toThrow('Fecha inválida');
  });
});

describe('estado de una cuota abierta', () => {
  const today = '2026-11-22';
  it.each([
    ['2026-12-22', 0, 'PENDING'],
    ['2026-11-22', 0, 'DUE'],
    ['2026-11-21', 0, 'OVERDUE'],
    ['2026-12-22', 5_000, 'PARTIALLY_PAID'],
    ['2026-11-21', 5_000, 'OVERDUE'],
  ])('vence %s con %p pagado → %s', (dueDate, paidCOP, expected) => {
    expect(openInstallmentStatus({ dueDate, paidCOP, today })).toBe(expected);
  });

  it('acepta montos BigInt', () => {
    expect(
      openInstallmentStatus({ dueDate: '2026-12-22', paidCOP: 1n, today }),
    ).toBe('PARTIALLY_PAID');
  });
});

describe('resolveLoanStatus: mora automática', () => {
  const today = '2026-11-22';
  const plan = (statuses: string[], dueDates: string[]) =>
    statuses.map((status, index) => ({ status, dueDate: dueDates[index] }));
  const base = { today, defaultAfterDays: 30 };

  it('sigue vigente si no hay cuotas vencidas', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'ACTIVE',
        installments: plan(['PAID', 'PENDING'], ['2026-10-22', '2026-12-22']),
      }),
    ).toBe('ACTIVE');
  });

  it('una cuota vencida hace menos de defaultAfterDays no es mora todavía', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'ACTIVE',
        installments: plan(
          ['OVERDUE', 'PENDING'],
          ['2026-10-24', '2026-12-22'],
        ),
      }),
    ).toBe('ACTIVE');
  });

  it('entra en mora justo al cumplir defaultAfterDays', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'ACTIVE',
        installments: plan(
          ['OVERDUE', 'PENDING'],
          ['2026-10-23', '2026-12-22'],
        ),
      }),
    ).toBe('DEFAULTED');
  });

  it('mide la mora por la fecha, aunque la cuota aún no esté marcada', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'ACTIVE',
        installments: plan(['PENDING'], ['2026-09-01']),
      }),
    ).toBe('DEFAULTED');
  });

  it('respeta el plazo configurado en el préstamo', () => {
    const installments = plan(['OVERDUE'], ['2026-11-12']);
    expect(
      resolveLoanStatus({
        today,
        current: 'ACTIVE',
        installments,
        defaultAfterDays: 10,
      }),
    ).toBe('DEFAULTED');
    expect(
      resolveLoanStatus({
        today,
        current: 'ACTIVE',
        installments,
        defaultAfterDays: 11,
      }),
    ).toBe('ACTIVE');
  });

  it('no sale de mora mientras quede alguna cuota vencida', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'DEFAULTED',
        installments: plan(['PAID', 'OVERDUE'], ['2026-10-01', '2026-11-20']),
      }),
    ).toBe('DEFAULTED');
  });

  it('vuelve a vigente al ponerse al día', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'DEFAULTED',
        installments: plan(
          ['PAID', 'PAID', 'PENDING'],
          ['2026-09-22', '2026-10-22', '2026-12-22'],
        ),
      }),
    ).toBe('ACTIVE');
  });

  it('queda pagado cuando todas las cuotas están saldadas', () => {
    for (const current of ['ACTIVE', 'DEFAULTED', 'WRITTEN_OFF'])
      expect(
        resolveLoanStatus({
          ...base,
          current,
          installments: plan(['PAID', 'WAIVED'], ['2026-09-22', '2026-10-22']),
        }),
      ).toBe('COMPLETED');
  });

  it('un crédito castigado sigue castigado hasta pagarse todo', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'WRITTEN_OFF',
        installments: plan(['PAID', 'PENDING'], ['2026-09-22', '2026-12-22']),
      }),
    ).toBe('WRITTEN_OFF');
  });

  it('un reembolso reabre un crédito pagado', () => {
    expect(
      resolveLoanStatus({
        ...base,
        current: 'COMPLETED',
        installments: plan(['PAID', 'PENDING'], ['2026-10-22', '2026-12-22']),
      }),
    ).toBe('ACTIVE');
    expect(
      resolveLoanStatus({
        ...base,
        current: 'COMPLETED',
        installments: plan(['PAID', 'OVERDUE'], ['2026-08-22', '2026-09-22']),
      }),
    ).toBe('DEFAULTED');
  });

  it('un préstamo sin cuotas no se da por pagado', () => {
    expect(
      resolveLoanStatus({ ...base, current: 'ACTIVE', installments: [] }),
    ).toBe('ACTIVE');
  });
});
