import { geometricSchedule } from './credit-calculator';
import { PROMISSORY_NOTE_VERSION, promissoryNoteText } from './promissory-note';

const note = (extra: Partial<Parameters<typeof promissoryNoteText>[0]> = {}) =>
  promissoryNoteText({
    applicationId: '11111111-1111-4111-8111-111111111111',
    product: { code: 'BUILDER_1', name: 'Servicio LUFT', version: 1 },
    purpose: 'SERVICIO_LUFT',
    principalCOP: 600_000,
    termMonths: 6,
    monthlyRate: 0.01,
    geometricDecrease: 0.2,
    quotedOn: '2026-11-22',
    installments: geometricSchedule(600_000, 6, 0.01, 0.2, '2026-11-22'),
    ...extra,
  });

describe('promissoryNoteText', () => {
  it('incluye producto, capital, tasa y gradiente', () => {
    const text = note();
    expect(text).toContain(
      'PAGARÉ STARTIF 11111111-1111-4111-8111-111111111111',
    );
    expect(text).toContain(`Versión del documento: ${PROMISSORY_NOTE_VERSION}`);
    expect(text).toContain('Producto: Servicio LUFT (BUILDER_1, versión 1)');
    expect(text).toContain('Finalidad: SERVICIO_LUFT');
    expect(text).toContain('Capital: $600.000 COP');
    expect(text).toContain('Plazo: 6 cuotas mensuales');
    expect(text).toContain('Tasa de interés: 1 % mensual vencida');
    expect(text).toContain('gradiente geométrico decreciente del 20 % mensual');
  });

  it('incluye el plan de cuotas cotizado completo', () => {
    const text = note();
    expect(text).toContain('Plan de cuotas cotizado el 2026-11-22:');
    expect(text).toContain(
      '1. Vence 2026-12-22 · Cuota $167.320 · Capital $161.320 · Interés $6.000 · Saldo $438.680',
    );
    expect(text).toContain(
      '6. Vence 2027-05-22 · Cuota $54.827 · Capital $54.284 · Interés $543 · Saldo $0',
    );
    expect(text.match(/^\d\. Vence /gm)).toHaveLength(6);
    expect(text).toContain('Total de intereses: $17.290 COP');
    expect(text).toContain('Total a pagar: $617.290 COP');
  });

  it('describe la finalidad del segundo crédito', () => {
    const text = note({
      product: { code: 'BUILDER_2', name: 'Consolidación', version: 3 },
      purpose: 'OTRO',
      purposeDescription: 'Reparar el techo de la casa',
      monthlyRate: 0.0125,
    });
    expect(text).toContain('Producto: Consolidación (BUILDER_2, versión 3)');
    expect(text).toContain('Finalidad: OTRO — Reparar el techo de la casa');
    expect(text).toContain('Tasa de interés: 1,25 % mensual vencida');
  });

  it('es determinista: el mismo insumo produce el mismo documento', () => {
    expect(note()).toBe(note());
    expect(note({ monthlyRate: 0.011 })).not.toBe(note());
  });

  it('no promete ningún efecto sobre el puntaje', () => {
    expect(note().toLowerCase()).not.toContain('puntaje');
  });
});
