import {
  canContactNow,
  colombianHolidays,
  contactHours,
  negativeReportAllowedFrom,
  noticesForCurrentDelinquency,
  priorNoticeDue,
  priorNoticeText,
  reminderDue,
  textToHtml,
} from './collection';

/** Hora de Colombia → instante UTC. */
const bogota = (day: string, time: string) =>
  new Date(`${day}T${time}:00-05:00`);

describe('calendario de contacto (Ley 2300 de 2023)', () => {
  it('conoce los festivos de Colombia de 2026', () => {
    expect([...colombianHolidays(2026)].sort()).toEqual([
      '2026-01-01',
      '2026-01-12',
      '2026-03-23',
      '2026-04-02',
      '2026-04-03',
      '2026-05-01',
      '2026-05-18',
      '2026-06-08',
      '2026-06-15',
      '2026-06-29',
      '2026-07-20',
      '2026-08-07',
      '2026-08-17',
      '2026-10-12',
      '2026-11-02',
      '2026-11-16',
      '2026-12-08',
      '2026-12-25',
    ]);
  });

  it('permite de lunes a viernes de 7 a 19 y sábados de 8 a 15', () => {
    expect(contactHours('2026-11-24')).toEqual({ from: 7, to: 19 });
    expect(contactHours('2026-11-28')).toEqual({ from: 8, to: 15 });
    expect(canContactNow(bogota('2026-11-24', '09:00'))).toBe(true);
    expect(canContactNow(bogota('2026-11-24', '06:59'))).toBe(false);
    expect(canContactNow(bogota('2026-11-24', '19:00'))).toBe(false);
    expect(canContactNow(bogota('2026-11-28', '07:30'))).toBe(false);
    expect(canContactNow(bogota('2026-11-28', '14:59'))).toBe(true);
    expect(canContactNow(bogota('2026-11-28', '15:00'))).toBe(false);
  });

  it('nunca permite domingos ni festivos', () => {
    expect(contactHours('2026-11-29')).toBeNull();
    expect(contactHours('2026-11-16')).toBeNull();
    expect(canContactNow(bogota('2026-11-29', '10:00'))).toBe(false);
    expect(canContactNow(bogota('2026-12-25', '10:00'))).toBe(false);
  });
});

describe('aviso previo al reporte negativo (Ley 1266, art. 12)', () => {
  it('envía dos avisos en días distintos', () => {
    expect(priorNoticeDue([], '2026-12-02')).toBe(1);
    const first = [{ sequence: 1, sentOn: '2026-12-02' }];
    expect(priorNoticeDue(first, '2026-12-02')).toBeNull();
    expect(priorNoticeDue(first, '2026-12-03')).toBe(2);
    expect(
      priorNoticeDue(
        [...first, { sequence: 2, sentOn: '2026-12-03' }],
        '2026-12-04',
      ),
    ).toBeNull();
  });

  it('solo permite reportar pasados 20 días completos desde el último aviso', () => {
    expect(negativeReportAllowedFrom([])).toBeNull();
    expect(
      negativeReportAllowedFrom([{ sequence: 1, sentOn: '2026-12-02' }]),
    ).toBeNull();
    expect(
      negativeReportAllowedFrom([
        { sequence: 1, sentOn: '2026-12-02' },
        { sequence: 2, sentOn: '2026-12-03' },
      ]),
    ).toBe('2026-12-24');
  });

  it('no reutiliza avisos de una mora anterior ya saldada', () => {
    const old = [
      { sequence: 1, sentOn: '2026-08-03' },
      { sequence: 2, sentOn: '2026-08-04' },
    ];
    expect(noticesForCurrentDelinquency(old, '2026-12-01')).toEqual([]);
    expect(
      noticesForCurrentDelinquency(
        [...old, { sequence: 1, sentOn: '2026-12-02' }],
        '2026-12-01',
      ),
    ).toEqual([{ sequence: 1, sentOn: '2026-12-02' }]);
  });

  it('dice cuánto se debe, la fecha límite y cómo pagar o controvertir', () => {
    const notice = priorNoticeText({
      firstName: 'Ana',
      sequence: 1,
      loanReference: 'ABC123',
      overdue: [{ sequence: 2, dueDate: '2026-12-01', pendingCOP: 133856 }],
      sentOn: '2026-12-02',
      host: 'luft.com.co',
    });
    expect(notice.subject).toBe(
      'Aviso previo a reporte en centrales de riesgo',
    );
    expect(notice.text).toContain('$133.856');
    expect(notice.text).toContain('después del 22 de diciembre de 2026');
    expect(notice.text).toContain('DataCrédito Experian y TransUnion');
    expect(notice.text).toContain('https://luft.com.co/app/pagar');
    expect(notice.text).toContain('https://luft.com.co/app/pqr');
    expect(textToHtml('a <b>\n\nc')).toContain('a &lt;b&gt;');
  });
});

describe('recordatorios de pago', () => {
  it('escribe el día del vencimiento, al día siguiente y cada cinco días', () => {
    expect(reminderDue({ dueToday: true, maxDaysOverdue: 0 })).toBe(true);
    expect(reminderDue({ dueToday: false, maxDaysOverdue: 0 })).toBe(false);
    expect(reminderDue({ dueToday: false, maxDaysOverdue: 1 })).toBe(true);
    expect(reminderDue({ dueToday: false, maxDaysOverdue: 2 })).toBe(false);
    expect(reminderDue({ dueToday: false, maxDaysOverdue: 5 })).toBe(true);
    expect(reminderDue({ dueToday: false, maxDaysOverdue: 30 })).toBe(true);
  });
});
