import {
  applicableLegalRates,
  LEGAL_RATE_CATEGORY,
  legalRateFromCertification,
} from './legal-rate';

const november = {
  resolucion: '1707',
  fecha_resolucion: '2026-10-30T00:00:00.000',
  vigencia_desde: '2026-11-01T00:00:00.000',
  vigencia_hasta: '2026-11-30T00:00:00.000',
  interes_bancario_corriente: '18.89%',
  modalidad: 'CONSUMO Y ORDINARIO',
};

describe('tasa máxima legal desde la certificación oficial', () => {
  it('calcula la usura como 1,5 veces el interés bancario corriente', () => {
    expect(legalRateFromCertification(november)).toEqual({
      category: LEGAL_RATE_CATEGORY,
      annualEffectiveRate: 0.2834,
      bankCurrentRate: 0.1889,
      effectiveFrom: '2026-11-01',
      effectiveTo: '2026-11-30',
      resolution: '1707',
      sourceUrl:
        'https://www.datos.gov.co/resource/pare-7x5i.json?resolucion=1707&modalidad=CONSUMO%20Y%20ORDINARIO',
    });
  });

  it('redondea como lo publica la Superintendencia', () => {
    const rate = (value: string) =>
      legalRateFromCertification({
        ...november,
        interes_bancario_corriente: value,
      })?.annualEffectiveRate;
    expect(rate('19.06%')).toBe(0.2859);
    expect(rate('18,9 %')).toBe(0.2835);
    expect(rate('20%')).toBe(0.3);
  });

  it('descarta otras modalidades y filas dudosas', () => {
    const invalid = [
      { ...november, modalidad: 'CONSUMO BAJO MONTO' },
      { ...november, interes_bancario_corriente: '1889' },
      { ...november, interes_bancario_corriente: '0.50%' },
      { ...november, interes_bancario_corriente: '75.00%' },
      { ...november, resolucion: 'pendiente' },
      { ...november, vigencia_hasta: '2026-10-01T00:00:00.000' },
      { ...november, vigencia_hasta: '2027-11-30T00:00:00.000' },
      { ...november, vigencia_desde: undefined },
    ];
    for (const row of invalid)
      expect(legalRateFromCertification(row)).toBeNull();
  });

  it('entrega la vigente y la siguiente, no las vencidas', () => {
    const rows = [
      {
        ...november,
        resolucion: '1950',
        vigencia_desde: '2026-12-01T00:00:00.000',
        vigencia_hasta: '2026-12-31T00:00:00.000',
        interes_bancario_corriente: '18.50%',
      },
      november,
      {
        ...november,
        resolucion: '1472',
        vigencia_desde: '2026-10-01T00:00:00.000',
        vigencia_hasta: '2026-10-31T00:00:00.000',
        interes_bancario_corriente: '19.06%',
      },
      { ...november, modalidad: 'CONSUMO BAJO MONTO' },
    ];
    expect(
      applicableLegalRates(rows, '2026-11-30').map(
        (rate) => rate.effectiveFrom,
      ),
    ).toEqual(['2026-11-01', '2026-12-01']);
    expect(applicableLegalRates(rows, '2027-01-01')).toEqual([]);
  });
});
