import {
  addMonthsToDate,
  geometricAmounts,
  geometricSchedule,
  recalculateAfterPrepayment,
  scheduleIsWellFormed,
  scheduleTotals,
  toIsoDate,
} from './credit-calculator';

const START = '2026-11-22';

describe('geometricSchedule: tabla del dueño del producto', () => {
  // $600.000, 6 meses, 1 % mensual vencido, gradiente decreciente del 20 %.
  const rows = geometricSchedule(600_000, 6, 0.01, 0.2, START);

  it('reproduce las seis cuotas en pesos exactos', () => {
    expect(rows.map((row) => row.amountCOP)).toEqual([
      167_320, 133_856, 107_085, 85_668, 68_534, 54_827,
    ]);
  });

  it('reproduce saldo inicial, interés, capital y saldo final de cada mes', () => {
    // [saldo inicial, interés, cuota, capital, saldo final]. La tabla del dueño
    // muestra decimales redondeados (121.603 y 54.285); en pesos enteros esos
    // acumulados quedan en 121.602 y 54.284, dentro del ±1 acordado.
    const expected = [
      [600_000, 6_000, 167_320, 161_320, 438_680],
      [438_680, 4_387, 133_856, 129_469, 309_211],
      [309_211, 3_092, 107_085, 103_993, 205_218],
      [205_218, 2_052, 85_668, 83_616, 121_603],
      [121_603, 1_216, 68_534, 67_318, 54_285],
      [54_285, 543, 54_827, 54_285, 0],
    ];
    const exactColumns = [
      [true, true, true, true, true],
      [true, true, true, true, true],
      [true, true, true, true, true],
      [true, true, true, true, false],
      [false, true, true, true, false],
      [false, true, true, false, true],
    ];
    rows.forEach((row, index) => {
      const actual = [
        row.openingBalanceCOP,
        row.interestCOP,
        row.amountCOP,
        row.principalCOP,
        row.closingBalanceCOP,
      ];
      actual.forEach((value, column) => {
        const target = expected[index][column];
        if (exactColumns[index][column]) expect(value).toBe(target);
        else expect(Math.abs(value - target)).toBeLessThanOrEqual(1);
      });
    });
  });

  it('cuadra los totales: intereses 17.290, pagado 617.290, capital 600.000', () => {
    const totals = scheduleTotals(rows);
    expect(totals.totalInterestCOP).toBe(17_290);
    expect(totals.totalCOP).toBe(617_290);
    expect(totals.totalPrincipalCOP).toBe(600_000);
    expect(totals.firstInstallmentCOP).toBe(167_320);
    expect(totals.lastInstallmentCOP).toBe(54_827);
    expect(rows.at(-1)?.closingBalanceCOP).toBe(0);
  });

  it('cada cuota es el 80 % de la anterior (C_t = C_1 · 0,80^(t−1))', () => {
    const first =
      600_000 /
      (0.8 ** 0 / 1.01 +
        0.8 / 1.01 ** 2 +
        0.8 ** 2 / 1.01 ** 3 +
        0.8 ** 3 / 1.01 ** 4 +
        0.8 ** 4 / 1.01 ** 5 +
        0.8 ** 5 / 1.01 ** 6);
    rows.slice(0, 5).forEach((row, index) => {
      expect(row.amountCOP).toBe(Math.round(first * 0.8 ** index));
    });
    // La última cuota absorbe el residuo de los redondeos.
    expect(Math.abs(rows[5].amountCOP - first * 0.8 ** 5)).toBeLessThanOrEqual(
      1,
    );
  });

  it('fija los vencimientos desde la fecha base, no desde el reloj', () => {
    expect(rows.map((row) => row.dueDate)).toEqual([
      '2026-12-22',
      '2027-01-22',
      '2027-02-22',
      '2027-03-22',
      '2027-04-22',
      '2027-05-22',
    ]);
    const other = geometricSchedule(
      600_000,
      6,
      0.01,
      0.2,
      new Date('2025-01-31T15:00:00Z'),
    );
    expect(other.map((row) => row.dueDate)).toEqual([
      '2025-02-28',
      '2025-03-31',
      '2025-04-30',
      '2025-05-31',
      '2025-06-30',
      '2025-07-31',
    ]);
    expect(other.map((row) => row.amountCOP)).toEqual(
      rows.map((row) => row.amountCOP),
    );
  });
});

describe('geometricSchedule: propiedades', () => {
  const grid = (monthOptions: number[]) => {
    const cases: Array<[number, number, number, number]> = [];
    for (const principal of [100_000, 350_000, 600_000, 1_234_567, 5_000_000])
      for (const months of monthOptions)
        for (const rate of [0, 0.005, 0.01, 0.02, 0.0275])
          for (const decrease of [0.05, 0.1, 0.2, 0.35])
            cases.push([principal, months, rate, decrease]);
    return cases;
  };
  // Dominio de producto: hasta 12 cuotas. El capital siempre cuadra, incluso
  // en plazos extremos donde el redondeo a pesos deforma las últimas cuotas.
  const cases = grid([1, 2, 3, 6, 12]);
  const extreme = grid([24, 60, 120]);

  it('amortiza exactamente el capital y termina en saldo 0', () => {
    for (const [principal, months, rate, decrease] of [...cases, ...extreme]) {
      const rows = geometricSchedule(principal, months, rate, decrease, START);
      expect(rows).toHaveLength(months);
      expect(rows.reduce((sum, row) => sum + row.principalCOP, 0)).toBe(
        principal,
      );
      expect(rows.at(-1)?.closingBalanceCOP).toBe(0);
      expect(rows[0].openingBalanceCOP).toBe(principal);
    }
  });

  it('cada fila cuadra: cuota = capital + interés y los saldos encadenan', () => {
    for (const [principal, months, rate, decrease] of cases) {
      const rows = geometricSchedule(principal, months, rate, decrease, START);
      rows.forEach((row, index) => {
        expect(row.amountCOP).toBe(row.principalCOP + row.interestCOP);
        expect(row.closingBalanceCOP).toBe(
          row.openingBalanceCOP - row.principalCOP,
        );
        expect(row.interestCOP).toBe(Math.round(row.openingBalanceCOP * rate));
        expect(row.principalCOP).toBeGreaterThan(0);
        expect(Number.isInteger(row.amountCOP)).toBe(true);
        if (index > 0)
          expect(row.openingBalanceCOP).toBe(rows[index - 1].closingBalanceCOP);
      });
    }
  });

  it('las cuotas son estrictamente decrecientes', () => {
    for (const [principal, months, rate, decrease] of cases) {
      const rows = geometricSchedule(principal, months, rate, decrease, START);
      for (let index = 1; index < rows.length; index += 1)
        expect(rows[index].amountCOP).toBeLessThan(rows[index - 1].amountCOP);
      expect(scheduleIsWellFormed(rows, decrease)).toBe(true);
    }
  });

  it('detecta los planes que el redondeo a pesos deforma', () => {
    // 24 cuotas con gradiente del 35 %: las últimas valen menos de 5 pesos.
    const rows = geometricAmounts(100_000, 24, 0.01, 0.35);
    expect(scheduleIsWellFormed(rows, 0.35)).toBe(false);
    expect(rows.reduce((sum, row) => sum + row.principalCOP, 0)).toBe(100_000);
    expect(scheduleIsWellFormed(geometricAmounts(600_000, 6, 0.01, 0), 0)).toBe(
      true,
    );
  });

  it('con gradiente 0 las cuotas son iguales (salvo el residuo final)', () => {
    const rows = geometricAmounts(600_000, 6, 0.01, 0);
    const amounts = rows.slice(0, 5).map((row) => row.amountCOP);
    expect(new Set(amounts).size).toBe(1);
    expect(Math.abs(rows[5].amountCOP - amounts[0])).toBeLessThanOrEqual(6);
  });

  it('sin interés, el total pagado es el capital', () => {
    const totals = scheduleTotals(geometricAmounts(600_000, 6, 0, 0.2));
    expect(totals.totalInterestCOP).toBe(0);
    expect(totals.totalCOP).toBe(600_000);
  });
});

describe('geometricSchedule: entradas inválidas', () => {
  it.each([
    [0, 'Capital inválido'],
    [-1, 'Capital inválido'],
    [600_000.5, 'Capital inválido'],
    [Number.NaN, 'Capital inválido'],
  ])('rechaza el capital %p', (principal, message) => {
    expect(() => geometricSchedule(principal, 6, 0.01, 0.2, START)).toThrow(
      message,
    );
  });

  it.each([0, -3, 2.5, 121])('rechaza el plazo %p', (months) => {
    expect(() => geometricSchedule(600_000, months, 0.01, 0.2, START)).toThrow(
      'Plazo inválido',
    );
  });

  it.each([-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rechaza la tasa %p',
    (rate) => {
      expect(() => geometricSchedule(600_000, 6, rate, 0.2, START)).toThrow(
        'Tasa inválida',
      );
    },
  );

  it.each([-0.2, 1, 1.5, Number.NaN])('rechaza el gradiente %p', (decrease) => {
    expect(() => geometricSchedule(600_000, 6, 0.01, decrease, START)).toThrow(
      'Gradiente inválido',
    );
  });

  it.each(['', 'ayer', '2026-02-30', '2026-13-01'])(
    'rechaza la fecha base %p',
    (date) => {
      expect(() => geometricSchedule(600_000, 6, 0.01, 0.2, date)).toThrow(
        'Fecha inválida',
      );
    },
  );

  it('rechaza una fecha base que no es fecha', () => {
    expect(() =>
      geometricSchedule(600_000, 6, 0.01, 0.2, new Date('nope')),
    ).toThrow('Fecha inválida');
  });
});

describe('fechas', () => {
  it('normaliza fechas a día calendario', () => {
    expect(toIsoDate('2026-11-22T23:59:59Z')).toBe('2026-11-22');
    expect(toIsoDate(new Date('2026-11-22T00:00:00Z'))).toBe('2026-11-22');
  });

  it('suma meses respetando el fin de mes', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsToDate('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsToDate('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('recalculateAfterPrepayment', () => {
  const plan = geometricSchedule(600_000, 6, 0.01, 0.2, START);
  // La persona ya pagó las cuotas 1 y 2: quedan 4 con saldo 309.211.
  const pending = plan.slice(2);

  it('reduce el capital y recalcula las mismas cuotas con menor valor', () => {
    const result = recalculateAfterPrepayment({
      prepaymentCOP: 100_000,
      monthlyRate: 0.01,
      geometricDecrease: 0.2,
      pending,
    });
    expect(result.balanceBeforeCOP).toBe(309_211);
    expect(result.appliedCOP).toBe(100_000);
    expect(result.excessCOP).toBe(0);
    expect(result.balanceAfterCOP).toBe(209_211);
    expect(result.closesLoan).toBe(false);
    expect(result.installments).toHaveLength(pending.length);
    expect(result.installments.map((row) => row.sequence)).toEqual([
      3, 4, 5, 6,
    ]);
    expect(result.installments.map((row) => row.dueDate)).toEqual(
      pending.map((row) => row.dueDate),
    );
    result.installments.forEach((row, index) => {
      expect(row.amountCOP).toBeLessThan(pending[index].amountCOP);
      if (index > 0)
        expect(row.amountCOP).toBeLessThan(
          result.installments[index - 1].amountCOP,
        );
    });
    expect(
      result.installments.reduce((sum, row) => sum + row.principalCOP, 0),
    ).toBe(209_211);
    expect(result.installments[0].openingBalanceCOP).toBe(209_211);
    expect(result.installments[0].interestCOP).toBe(2_092);
    expect(result.installments.at(-1)?.closingBalanceCOP).toBe(0);
  });

  it('conserva tasa y gradiente: es el plan geométrico del nuevo saldo', () => {
    const result = recalculateAfterPrepayment({
      prepaymentCOP: 100_000,
      monthlyRate: 0.01,
      geometricDecrease: 0.2,
      pending,
    });
    expect(result.installments.map((row) => row.amountCOP)).toEqual(
      geometricAmounts(209_211, 4, 0.01, 0.2).map((row) => row.amountCOP),
    );
  });

  it('un abono de $0 de diferencia no cambia el plan pendiente (mismo sistema)', () => {
    // La cola de un plan geométrico es el plan geométrico de su saldo.
    const tail = geometricAmounts(309_211, 4, 0.01, 0.2);
    tail.forEach((row, index) => {
      expect(
        Math.abs(row.amountCOP - pending[index].amountCOP),
      ).toBeLessThanOrEqual(1);
    });
  });

  it('cierra el crédito cuando el abono cubre todo el saldo', () => {
    const result = recalculateAfterPrepayment({
      prepaymentCOP: 309_211,
      monthlyRate: 0.01,
      geometricDecrease: 0.2,
      pending,
    });
    expect(result.closesLoan).toBe(true);
    expect(result.balanceAfterCOP).toBe(0);
    expect(result.appliedCOP).toBe(309_211);
    expect(result.excessCOP).toBe(0);
    // Cada cuota queda por su capital: no se cobran intereses futuros.
    expect(result.installments.every((row) => row.interestCOP === 0)).toBe(
      true,
    );
    expect(
      result.installments.reduce((sum, row) => sum + row.amountCOP, 0),
    ).toBe(309_211);
    expect(result.installments.at(-1)?.closingBalanceCOP).toBe(0);
  });

  it('nunca aplica más que el saldo y reporta el exceso', () => {
    const result = recalculateAfterPrepayment({
      prepaymentCOP: 400_000,
      monthlyRate: 0.01,
      geometricDecrease: 0.2,
      pending,
    });
    expect(result.appliedCOP).toBe(309_211);
    expect(result.excessCOP).toBe(90_789);
    expect(result.closesLoan).toBe(true);
  });

  it('funciona con una sola cuota pendiente', () => {
    const last = plan.slice(5);
    const result = recalculateAfterPrepayment({
      prepaymentCOP: 20_000,
      monthlyRate: 0.01,
      geometricDecrease: 0.2,
      pending: last,
    });
    expect(result.installments).toHaveLength(1);
    expect(result.installments[0].principalCOP).toBe(34_284);
    expect(result.installments[0].interestCOP).toBe(343);
    expect(result.installments[0].amountCOP).toBe(34_627);
  });

  it('rechaza entradas inválidas', () => {
    const base = { monthlyRate: 0.01, geometricDecrease: 0.2, pending };
    expect(() =>
      recalculateAfterPrepayment({ ...base, prepaymentCOP: 0 }),
    ).toThrow('Abono inválido');
    expect(() =>
      recalculateAfterPrepayment({ ...base, prepaymentCOP: 1_000.5 }),
    ).toThrow('Abono inválido');
    expect(() =>
      recalculateAfterPrepayment({
        ...base,
        prepaymentCOP: 1_000,
        pending: [],
      }),
    ).toThrow('No hay cuotas pendientes');
    expect(() =>
      recalculateAfterPrepayment({
        ...base,
        prepaymentCOP: 1_000,
        pending: [{ sequence: 1, dueDate: START, principalCOP: 0 }],
      }),
    ).toThrow('No hay saldo de capital');
  });
});
