import {
  CREDIT_PURPOSES,
  evaluateSecondCredit,
  financialSnapshot,
  normalizePurpose,
  readSecondCreditPolicy,
  secondCreditPolicySchema,
  type SecondCreditInput,
} from './second-credit';

const TODAY = '2026-11-22';

const paidOnTime = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    return {
      status: 'PAID',
      dueDate: `2026-${month}-15`,
      paidOn: `2026-${month}-10`,
    };
  });

/** Persona que cumple todo: base de cada caso. */
const eligible = (): SecondCreditInput => ({
  product: { principalCOP: 1_000_000, highestInstallmentCOP: 280_000 },
  policy: secondCreditPolicySchema.parse({ maxDebtToMonthlyIncome: 4 }),
  firstCredit: { status: 'COMPLETED', installments: paidOnTime(6) },
  purpose: normalizePurpose('EDUCACION'),
  finances: {
    consent: true,
    monthlyIncomeCOP: 2_000_000,
    monthlyExpensesCOP: 1_200_000,
    totalDebtCOP: 500_000,
  },
  otherStatuses: ['COMPLETED'],
  today: TODAY,
});

const find = (input: SecondCreditInput, code: string) => {
  const result = evaluateSecondCredit(input);
  const requirement = result.requirements.find((item) => item.code === code);
  if (!requirement) throw new Error(`Falta el requisito ${code}`);
  return { result, requirement };
};

describe('evaluateSecondCredit', () => {
  it('aprueba cuando se cumplen todos los requisitos y los explica', () => {
    const result = evaluateSecondCredit(eligible());
    expect(result.eligible).toBe(true);
    expect(result.requirements.map((item) => item.code)).toEqual([
      'PRODUCT_AVAILABLE',
      'FIRST_CREDIT_BEHAVIOR',
      'VALID_PURPOSE',
      'AVAILABLE_CAPACITY',
      'NO_OVERINDEBTEDNESS',
      'NO_CREDIT_IN_PROGRESS',
    ]);
    for (const item of result.requirements) {
      expect(item.met).toBe(true);
      expect(item.label.length).toBeGreaterThan(5);
    }
  });

  it('es elegible solo si todos los requisitos listados se cumplen', () => {
    const result = evaluateSecondCredit({ ...eligible(), product: null });
    expect(result.eligible).toBe(result.requirements.every((item) => item.met));
    expect(result.eligible).toBe(false);
  });

  describe('producto 2 vigente', () => {
    it('bloquea si el producto no está vigente', () => {
      const { result, requirement } = find(
        { ...eligible(), product: null },
        'PRODUCT_AVAILABLE',
      );
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('no está disponible');
      expect(result.eligible).toBe(false);
    });
  });

  describe('comportamiento del crédito 1', () => {
    const behavior = (input: Partial<SecondCreditInput>) =>
      find({ ...eligible(), ...input }, 'FIRST_CREDIT_BEHAVIOR');

    it('exige haber tenido el crédito 1', () => {
      const { result, requirement } = behavior({ firstCredit: null });
      expect(requirement.met).toBe(false);
      expect(result.eligible).toBe(false);
    });

    it('por defecto exige el crédito 1 totalmente pagado', () => {
      const { requirement } = behavior({
        firstCredit: {
          status: 'ACTIVE',
          installments: [
            ...paidOnTime(4),
            { status: 'PENDING', dueDate: '2026-12-15' },
            { status: 'PENDING', dueDate: '2027-01-15' },
          ],
        },
      });
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('te faltan 2 cuotas');
    });

    it('bloquea con cuotas en mora', () => {
      const { requirement } = behavior({
        firstCredit: {
          status: 'ACTIVE',
          installments: [
            ...paidOnTime(4),
            { status: 'OVERDUE', dueDate: '2026-11-01' },
          ],
        },
      });
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('1 cuota en mora');
    });

    it('detecta la mora por fecha aunque la cuota siga como pendiente', () => {
      const { requirement } = behavior({
        policy: secondCreditPolicySchema.parse({
          firstCreditMustBePaid: false,
          maxDebtToMonthlyIncome: 4,
        }),
        firstCredit: {
          status: 'ACTIVE',
          installments: [{ status: 'PENDING', dueDate: '2026-11-21' }],
        },
      });
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('en mora');
    });

    it.each(['DEFAULTED', 'WRITTEN_OFF'])(
      'bloquea si el crédito 1 está %s',
      (status) => {
        const { requirement } = behavior({
          firstCredit: { status, installments: paidOnTime(3) },
        });
        expect(requirement.met).toBe(false);
      },
    );

    it('permite como máximo un pago tardío', () => {
      const late = (count: number) =>
        paidOnTime(6).map((row, index) =>
          index < count
            ? {
                ...row,
                paidOn: `2026-${String(index + 1).padStart(2, '0')}-16`,
              }
            : row,
        );
      const one = behavior({
        firstCredit: { status: 'COMPLETED', installments: late(1) },
      });
      expect(one.requirement.met).toBe(true);
      expect(one.requirement.detail).toContain('1 tardía');
      const two = behavior({
        firstCredit: { status: 'COMPLETED', installments: late(2) },
      });
      expect(two.requirement.met).toBe(false);
      expect(two.requirement.detail).toContain('2 pagos tardíos');
      expect(two.result.eligible).toBe(false);
    });

    it('pagar el mismo día del vencimiento no es tardío', () => {
      const { requirement } = behavior({
        firstCredit: {
          status: 'COMPLETED',
          installments: paidOnTime(6).map((row) => ({
            ...row,
            paidOn: row.dueDate,
          })),
        },
      });
      expect(requirement.met).toBe(true);
      expect(requirement.detail).toContain('0 tardías');
    });

    it('el máximo de pagos tardíos es configurable', () => {
      const installments = paidOnTime(6).map((row) => ({
        ...row,
        paidOn: '2026-12-31',
      }));
      const strict = behavior({
        policy: secondCreditPolicySchema.parse({
          maxLatePayments: 0,
          maxDebtToMonthlyIncome: 4,
        }),
        firstCredit: {
          status: 'COMPLETED',
          installments: [installments[0], ...paidOnTime(6).slice(1)],
        },
      });
      expect(strict.requirement.met).toBe(false);
      const lax = behavior({
        policy: secondCreditPolicySchema.parse({
          maxLatePayments: 6,
          maxDebtToMonthlyIncome: 4,
        }),
        firstCredit: { status: 'COMPLETED', installments },
      });
      expect(lax.requirement.met).toBe(true);
    });

    it('si la política no exige crédito pagado, basta ir al día', () => {
      const { requirement } = behavior({
        policy: secondCreditPolicySchema.parse({
          firstCreditMustBePaid: false,
          maxDebtToMonthlyIncome: 4,
        }),
        firstCredit: {
          status: 'ACTIVE',
          installments: [
            ...paidOnTime(3),
            { status: 'PENDING', dueDate: '2026-12-15' },
          ],
        },
      });
      expect(requirement.met).toBe(true);
    });
  });

  describe('finalidad válida', () => {
    const purpose = (text?: string, description?: string) =>
      find(
        { ...eligible(), purpose: normalizePurpose(text, description) },
        'VALID_PURPOSE',
      );

    it.each(CREDIT_PURPOSES.filter((item) => item.code !== 'OTRO'))(
      'acepta $code',
      ({ code }) => {
        expect(purpose(code).requirement.met).toBe(true);
      },
    );

    it('acepta la etiqueta en lugar del código', () => {
      expect(purpose('Consolidación de deudas').requirement.met).toBe(true);
      expect(purpose('educación').requirement.met).toBe(true);
      expect(normalizePurpose('Vivienda').code).toBe('VIVIENDA');
      expect(normalizePurpose('negocio').code).toBe('EMPRENDIMIENTO');
    });

    it('exige elegir una finalidad', () => {
      const { result, requirement } = purpose();
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('Elige una finalidad');
      expect(result.eligible).toBe(false);
    });

    it('rechaza finalidades fuera de la lista cerrada', () => {
      expect(purpose('VACACIONES').requirement.met).toBe(false);
      expect(purpose('lo que sea').requirement.met).toBe(false);
    });

    it.each([
      'subir el puntaje',
      'SUBIR_PUNTAJE',
      'mejorar mi score',
      'construir historial crediticio',
    ])('"%s" no es una finalidad válida', (text) => {
      const { result, requirement } = purpose(text);
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('solo para subir el puntaje');
      expect(result.eligible).toBe(false);
    });

    it('"otro" exige descripción', () => {
      expect(purpose('OTRO').requirement.met).toBe(false);
      expect(purpose('OTRO', 'corto').requirement.met).toBe(false);
      const ok = purpose('OTRO', 'Reparar el techo de la casa de mi mamá');
      expect(ok.requirement.met).toBe(true);
      expect(ok.requirement.detail).toContain('Reparar el techo');
    });

    it('"otro" acepta la descripción en el mismo campo', () => {
      const normalized = normalizePurpose('OTRO: tratamiento odontológico');
      expect(normalized).toEqual({
        code: 'OTRO',
        description: 'tratamiento odontológico',
        raw: 'OTRO: tratamiento odontológico',
      });
    });

    it('"otro" no puede describir solo la subida del puntaje', () => {
      const { requirement } = purpose(
        'OTRO',
        'Quiero subir mi puntaje en Datacrédito',
      );
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('solo para subir el puntaje');
    });

    it('una consolidación exige deudas que consolidar', () => {
      const { requirement } = find(
        {
          ...eligible(),
          purpose: normalizePurpose('CONSOLIDACION_DEUDAS'),
          finances: { ...eligible().finances, totalDebtCOP: 0 },
        },
        'VALID_PURPOSE',
      );
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('no registra deudas');
    });

    it('no se evalúa si aún no se ha elegido (consulta previa)', () => {
      const result = evaluateSecondCredit({
        ...eligible(),
        purpose: undefined,
      });
      expect(
        result.requirements.some((item) => item.code === 'VALID_PURPOSE'),
      ).toBe(false);
      expect(result.eligible).toBe(true);
    });

    it('ningún texto promete un aumento de puntaje', () => {
      const texts = [
        purpose(),
        purpose('subir el puntaje'),
        purpose('EDUCACION'),
      ]
        .flatMap(({ result }) => result.requirements)
        .map((item) => `${item.label} ${item.detail ?? ''}`.toLowerCase());
      for (const text of texts) {
        expect(text).not.toMatch(
          /(subir[aá]s?|aumentar[aá]s?|mejorar[aá]s?) tu puntaje/,
        );
        expect(text).not.toContain('garantiza');
      }
    });
  });

  describe('capacidad disponible', () => {
    const capacity = (finances: Partial<SecondCreditInput['finances']>) =>
      find(
        { ...eligible(), finances: { ...eligible().finances, ...finances } },
        'AVAILABLE_CAPACITY',
      );

    it('cumple si lo disponible cubre la cuota más alta', () => {
      const { requirement } = capacity({});
      expect(requirement.met).toBe(true);
      expect(requirement.detail).toContain('$800.000 disponibles');
      expect(requirement.detail).toContain('$280.000');
    });

    it('cumple en el límite exacto', () => {
      expect(capacity({ monthlyIncomeCOP: 1_480_000 }).requirement.met).toBe(
        true,
      );
      expect(capacity({ monthlyIncomeCOP: 1_479_999 }).requirement.met).toBe(
        false,
      );
    });

    it('bloquea si los gastos superan los ingresos', () => {
      const { result, requirement } = capacity({
        monthlyExpensesCOP: 2_500_000,
      });
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('no alcanza');
      expect(result.eligible).toBe(false);
    });

    it('la cobertura exigida es configurable', () => {
      const { requirement } = find(
        {
          ...eligible(),
          policy: secondCreditPolicySchema.parse({
            capacityCoverage: 3,
            maxDebtToMonthlyIncome: 4,
          }),
        },
        'AVAILABLE_CAPACITY',
      );
      // 800.000 disponibles < 3 × 280.000.
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('3 veces');
    });

    it('sin datos pide completar el perfil financiero', () => {
      for (const missing of [
        { monthlyIncomeCOP: null },
        { monthlyExpensesCOP: null },
      ]) {
        const { result, requirement } = capacity(missing);
        expect(requirement.met).toBe(false);
        expect(requirement.detail?.toLowerCase()).toContain(
          'completa tu perfil financiero',
        );
        expect(result.eligible).toBe(false);
      }
    });

    it('sin consentimiento no usa los datos y pide autorizarlos', () => {
      const { requirement } = capacity({ consent: false });
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('Autoriza compartir');
    });
  });

  describe('ausencia de sobreendeudamiento', () => {
    const debt = (input: Partial<SecondCreditInput>) =>
      find({ ...eligible(), ...input }, 'NO_OVERINDEBTEDNESS');

    it('suma el crédito nuevo a la deuda declarada', () => {
      // 500.000 + 1.000.000 = 1.500.000 ≤ 4 × 2.000.000.
      const { requirement } = debt({});
      expect(requirement.met).toBe(true);
      expect(requirement.detail).toContain('$1.500.000');
      expect(requirement.detail).toContain('$8.000.000');
    });

    it('bloquea si la deuda proyectada supera el tope', () => {
      const { result, requirement } = debt({
        finances: { ...eligible().finances, totalDebtCOP: 7_500_000 },
      });
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('Superarías');
      expect(result.eligible).toBe(false);
    });

    it('una consolidación reemplaza deuda en lugar de sumarla', () => {
      const finances = { ...eligible().finances, totalDebtCOP: 7_500_000 };
      const other = debt({ finances });
      const consolidation = debt({
        finances,
        purpose: normalizePurpose('CONSOLIDACION_DEUDAS'),
      });
      expect(other.requirement.met).toBe(false);
      expect(consolidation.requirement.met).toBe(true);
      expect(consolidation.requirement.detail).toContain('$7.500.000');
    });

    it('sin tope definido en el producto no se cumple', () => {
      const { requirement } = debt({
        policy: secondCreditPolicySchema.parse({}),
      });
      expect(requirement.met).toBe(false);
      expect(requirement.detail).toContain('aún no está definido');
    });

    it('sin ingresos no hay cómo medir el endeudamiento', () => {
      const { requirement } = debt({
        finances: { ...eligible().finances, monthlyIncomeCOP: 0 },
      });
      expect(requirement.met).toBe(false);
    });

    it('sin deudas declaradas pide completar el perfil financiero', () => {
      const { requirement } = debt({
        finances: { ...eligible().finances, totalDebtCOP: null },
      });
      expect(requirement.met).toBe(false);
      expect(requirement.detail?.toLowerCase()).toContain(
        'completa tu perfil financiero',
      );
    });
  });

  describe('sin otra solicitud o crédito en curso', () => {
    it.each([
      'PENDING_KYC',
      'PENDING_SIGNATURE',
      'PENDING_REVIEW',
      'APPROVED',
      'ACTIVE',
      'DEFAULTED',
      'WRITTEN_OFF',
    ])('bloquea con una solicitud %s', (status) => {
      const { result, requirement } = find(
        { ...eligible(), otherStatuses: ['COMPLETED', status] },
        'NO_CREDIT_IN_PROGRESS',
      );
      expect(requirement.met).toBe(false);
      expect(result.eligible).toBe(false);
    });

    it('los créditos pagados y las solicitudes rechazadas no bloquean', () => {
      const { requirement } = find(
        { ...eligible(), otherStatuses: ['COMPLETED', 'REJECTED'] },
        'NO_CREDIT_IN_PROGRESS',
      );
      expect(requirement.met).toBe(true);
    });
  });
});

describe('política del producto 2', () => {
  it('trae por defecto: crédito 1 pagado y máximo un pago tardío', () => {
    expect(readSecondCreditPolicy(null)).toEqual({
      firstCreditMustBePaid: true,
      maxLatePayments: 1,
      capacityCoverage: 1,
      maxDebtToMonthlyIncome: null,
    });
  });

  it('lee la política sembrada en la migración', () => {
    expect(
      readSecondCreditPolicy({
        firstCreditMustBePaid: true,
        maxLatePayments: 1,
        capacityCoverage: 1,
        maxDebtToMonthlyIncome: null,
      }).maxDebtToMonthlyIncome,
    ).toBeNull();
  });

  it('ante un JSON ilegible vuelve a los valores por defecto', () => {
    expect(readSecondCreditPolicy({ maxLatePayments: -4 })).toEqual(
      readSecondCreditPolicy(null),
    );
    expect(readSecondCreditPolicy('texto')).toEqual(
      readSecondCreditPolicy(null),
    );
  });

  it('valida los rangos', () => {
    expect(
      secondCreditPolicySchema.safeParse({ capacityCoverage: 0.5 }).success,
    ).toBe(false);
    expect(
      secondCreditPolicySchema.safeParse({ maxDebtToMonthlyIncome: 0 }).success,
    ).toBe(false);
    expect(
      secondCreditPolicySchema.safeParse({ maxLatePayments: 1.5 }).success,
    ).toBe(false);
  });
});

describe('financialSnapshot', () => {
  const context = {
    income: {
      sources: [
        { kind: 'SALARIO', monthlyCOP: 1_800_000 },
        { kind: 'VENTAS', monthlyCOP: 200_000 },
      ],
      withholding: null,
    },
    debts: {
      cardSpendMonthlyCOP: 300_000,
      totalDebtCOP: 500_000,
      fixedExpensesMonthlyCOP: 900_000,
      expenseKinds: ['VIVIENDA'],
    },
  };

  it('resume ingresos, gastos y deudas declarados', () => {
    expect(financialSnapshot(true, context)).toEqual({
      consent: true,
      monthlyIncomeCOP: 2_000_000,
      monthlyExpensesCOP: 1_200_000,
      totalDebtCOP: 500_000,
    });
  });

  it('sin consentimiento no devuelve ningún dato', () => {
    expect(financialSnapshot(false, context)).toEqual({
      consent: false,
      monthlyIncomeCOP: null,
      monthlyExpensesCOP: null,
      totalDebtCOP: null,
    });
  });

  it('deja en null lo que falte', () => {
    expect(financialSnapshot(true, { income: context.income })).toEqual({
      consent: true,
      monthlyIncomeCOP: 2_000_000,
      monthlyExpensesCOP: null,
      totalDebtCOP: null,
    });
    expect(financialSnapshot(true, null).monthlyIncomeCOP).toBeNull();
    expect(
      financialSnapshot(true, { income: 'x' }).monthlyIncomeCOP,
    ).toBeNull();
  });
});
