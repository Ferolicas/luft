import {
  activationIssues,
  annualEffectiveRate,
  isComplete,
  PrincipalOutOfRangeError,
  productCodeSchema,
  productTerms,
  productVersionInputSchema,
  rateString,
  resolvePrincipal,
  type CompleteTerms,
  type ProductTerms,
} from './credit-product';

/** BUILDER_1 tal como lo siembra la migración. */
const builder1: ProductTerms = {
  code: 'BUILDER_1',
  version: 1,
  name: 'Servicio LUFT',
  purpose: 'SERVICIO_LUFT',
  sequence: 1,
  principalCOP: 600_000,
  minPrincipalCOP: null,
  maxPrincipalCOP: null,
  termMonths: 6,
  monthlyRate: 0.01,
  geometricDecrease: 0.2,
  disbursementMode: 'SERVICE_FINANCING',
  defaultAfterDays: 30,
  requirements: null,
  status: 'ACTIVE',
};

/** BUILDER_2 tal como lo siembra la migración: borrador, sin montos. */
const builder2Draft: ProductTerms = {
  code: 'BUILDER_2',
  version: 1,
  name: 'Consolidación',
  purpose: 'PROPOSITO_DEFINIDO',
  sequence: 2,
  principalCOP: null,
  minPrincipalCOP: null,
  maxPrincipalCOP: null,
  termMonths: null,
  monthlyRate: null,
  geometricDecrease: null,
  disbursementMode: 'TRANSFER',
  defaultAfterDays: 30,
  requirements: {
    firstCreditMustBePaid: true,
    maxLatePayments: 1,
    capacityCoverage: 1,
    maxDebtToMonthlyIncome: null,
  },
  status: 'DRAFT',
};

describe('productTerms', () => {
  it('convierte BigInt y Decimal de la base de datos a números', () => {
    const terms = productTerms({
      ...builder1,
      principalCOP: 600_000n,
      monthlyRate: { toString: () => '0.010000' },
      geometricDecrease: '0.200000',
    });
    expect(terms.principalCOP).toBe(600_000);
    expect(terms.monthlyRate).toBe(0.01);
    expect(terms.geometricDecrease).toBe(0.2);
    expect(terms.minPrincipalCOP).toBeNull();
  });
});

describe('activationIssues', () => {
  it('BUILDER_1 sembrado está completo', () => {
    expect(activationIssues(builder1)).toEqual([]);
    expect(isComplete(builder1)).toBe(true);
  });

  it('BUILDER_2 sembrado no puede activarse: no trae condiciones inventadas', () => {
    const issues = activationIssues(builder2Draft);
    expect(isComplete(builder2Draft)).toBe(false);
    expect(issues).toHaveLength(5);
    expect(issues.join(' ')).toContain('monto');
    expect(issues.join(' ')).toContain('plazo');
    expect(issues.join(' ')).toContain('tasa');
    expect(issues.join(' ')).toContain('gradiente');
    expect(issues.join(' ')).toContain('tope de endeudamiento');
  });

  it('BUILDER_2 se activa cuando el staff fija todas las condiciones', () => {
    const ready: ProductTerms = {
      ...builder2Draft,
      minPrincipalCOP: 800_000,
      maxPrincipalCOP: 2_000_000,
      termMonths: 12,
      monthlyRate: 0.015,
      geometricDecrease: 0.1,
      requirements: {
        ...(builder2Draft.requirements as object),
        maxDebtToMonthlyIncome: 4,
      },
    };
    expect(activationIssues(ready)).toEqual([]);
    expect(isComplete(ready)).toBe(true);
  });

  it('exige el tope de endeudamiento solo al crédito 2', () => {
    expect(activationIssues({ ...builder1, requirements: null })).toEqual([]);
    expect(
      activationIssues({
        ...builder2Draft,
        principalCOP: 1_000_000,
        termMonths: 6,
        monthlyRate: 0.01,
        geometricDecrease: 0.2,
      }),
    ).toEqual([
      'Falta el tope de endeudamiento (requirements.maxDebtToMonthlyIncome).',
    ]);
  });

  it('no acepta monto fijo y rango a la vez, ni un rango invertido', () => {
    expect(
      activationIssues({ ...builder1, minPrincipalCOP: 1, maxPrincipalCOP: 2 }),
    ).toEqual(['Define un monto fijo o un rango, no ambos.']);
    expect(
      activationIssues({
        ...builder1,
        principalCOP: null,
        minPrincipalCOP: 900_000,
        maxPrincipalCOP: 800_000,
      }),
    ).toEqual(['El monto mínimo no puede superar el máximo.']);
    expect(
      activationIssues({
        ...builder1,
        principalCOP: null,
        minPrincipalCOP: 900_000,
      }),
    ).toEqual(['Falta el monto: fijo (principalCOP) o rango mínimo y máximo.']);
  });

  it('rechaza condiciones cuyo plan degenera por el redondeo a pesos', () => {
    // 24 cuotas con gradiente del 35 %: las últimas cuotas valen centavos.
    const issues = activationIssues({
      ...builder1,
      principalCOP: 100_000,
      termMonths: 24,
      geometricDecrease: 0.35,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('el plan no es decreciente');
  });

  it('rechaza requisitos ilegibles en el crédito 2', () => {
    expect(
      activationIssues({
        ...builder2Draft,
        principalCOP: 1_000_000,
        termMonths: 6,
        monthlyRate: 0.01,
        geometricDecrease: 0.2,
        requirements: { maxLatePayments: -1 },
      }),
    ).toEqual(['Los requisitos del crédito 2 no son válidos.']);
  });
});

describe('resolvePrincipal', () => {
  const fixed = builder1 as CompleteTerms;
  const range = {
    ...builder1,
    principalCOP: null,
    minPrincipalCOP: 800_000,
    maxPrincipalCOP: 2_000_000,
  } as CompleteTerms;

  it('con monto fijo la persona no elige: siempre es el del producto', () => {
    expect(resolvePrincipal(fixed)).toBe(600_000);
    expect(resolvePrincipal(fixed, 2_000_000)).toBe(600_000);
  });

  it('con rango acepta un monto dentro del rango', () => {
    expect(resolvePrincipal(range, 800_000)).toBe(800_000);
    expect(resolvePrincipal(range, 1_500_000)).toBe(1_500_000);
    expect(resolvePrincipal(range, 2_000_000)).toBe(2_000_000);
  });

  it('con rango y sin monto toma el mínimo', () => {
    expect(resolvePrincipal(range)).toBe(800_000);
  });

  it.each([799_999, 2_000_001, 1_000_000.5, -5])(
    'rechaza %p fuera del rango',
    (amount) => {
      expect(() => resolvePrincipal(range, amount)).toThrow(
        PrincipalOutOfRangeError,
      );
    },
  );
});

describe('entrada de una versión nueva', () => {
  it('acepta las condiciones que fija el staff', () => {
    const input = productVersionInputSchema.parse({
      minPrincipalCOP: '800000',
      maxPrincipalCOP: 2_000_000,
      termMonths: 12,
      monthlyRate: 0.015,
      geometricDecrease: 0.1,
      defaultAfterDays: 30,
      requirements: { maxDebtToMonthlyIncome: 4 },
    });
    expect(input.minPrincipalCOP).toBe(800_000);
    expect(input.requirements).toEqual({ maxDebtToMonthlyIncome: 4 });
  });

  it('una versión vacía hereda todo de la anterior', () => {
    expect(productVersionInputSchema.parse({})).toEqual({});
  });

  it.each([
    { monthlyRate: 0.11 },
    { monthlyRate: -0.01 },
    { geometricDecrease: 1 },
    { termMonths: 0 },
    { termMonths: 121 },
    { principalCOP: 0 },
    { principalCOP: 100.5 },
    { defaultAfterDays: 0 },
    { requirements: { capacityCoverage: 0 } },
    { requirements: { otroCampo: 1 } },
    { status: 'ACTIVE' },
    { code: 'BUILDER_3' },
  ])('rechaza %p', (body) => {
    expect(productVersionInputSchema.safeParse(body).success).toBe(false);
  });

  it('solo existen los dos créditos constructores', () => {
    expect(productCodeSchema.safeParse('BUILDER_1').success).toBe(true);
    expect(productCodeSchema.safeParse('BUILDER_2').success).toBe(true);
    expect(productCodeSchema.safeParse('BUILDER_3').success).toBe(false);
  });
});

describe('tasas', () => {
  it('convierte la tasa mensual vencida a efectiva anual', () => {
    expect(annualEffectiveRate(0.01)).toBeCloseTo(0.126825, 6);
    expect(annualEffectiveRate(0)).toBe(0);
  });

  it('persiste las tasas como texto exacto de seis decimales', () => {
    expect(rateString(0.01)).toBe('0.010000');
    expect(rateString(0.2)).toBe('0.200000');
    expect(rateString(0.1 + 0.2)).toBe('0.300000');
  });
});
