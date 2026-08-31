import { geometricSchedule } from './credit-calculator';

describe('geometricSchedule', () => {
  it('amortiza todo el capital en seis cuotas decrecientes', () => {
    const rows = geometricSchedule(500_000, 6, 0.02);
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)?.closingBalanceCOP).toBe(0);
    expect(rows.reduce((total, row) => total + row.principalCOP, 0)).toBe(
      500_000,
    );
    expect(rows[0].amountCOP).toBeGreaterThan(rows[1].amountCOP);
    expect(rows[1].amountCOP).toBeGreaterThan(rows[2].amountCOP);
  });

  it('rechaza entradas fuera de dominio', () => {
    expect(() => geometricSchedule(0, 6, 0.02)).toThrow('Capital inválido');
    expect(() => geometricSchedule(500_000, 0, 0.02)).toThrow('Plazo inválido');
    expect(() => geometricSchedule(500_000, 6, -0.1)).toThrow('Tasa inválida');
  });
});
