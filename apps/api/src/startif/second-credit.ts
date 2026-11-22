/**
 * Motor puro de elegibilidad del crédito constructor 2.
 *
 * El segundo crédito solo se origina después de verificar el comportamiento
 * del crédito 1, una finalidad válida, la capacidad disponible y la ausencia
 * de sobreendeudamiento. Nunca se aprueba solo para subir el puntaje.
 * Cada requisito se devuelve explicado; la decisión final es del rol RISK.
 */
import { z } from 'zod';
import { toIsoDate } from './credit-calculator';
import { daysOverdue, isInProgress, isSettled } from './credit-lifecycle';

export const CREDIT_PURPOSES = [
  { code: 'CONSOLIDACION_DEUDAS', label: 'Consolidación de deudas' },
  { code: 'EDUCACION', label: 'Educación' },
  { code: 'MOVILIDAD', label: 'Movilidad' },
  { code: 'VIVIENDA', label: 'Vivienda' },
  { code: 'EMPRENDIMIENTO', label: 'Emprendimiento' },
  { code: 'OTRO', label: 'Otro (descríbelo)' },
] as const;
export type PurposeCode = (typeof CREDIT_PURPOSES)[number]['code'];

const policyFields = {
  /** El crédito 1 debe estar totalmente pagado. */
  firstCreditMustBePaid: z.boolean(),
  /** Máximo de cuotas del crédito 1 pagadas después de su vencimiento. */
  maxLatePayments: z.number().int().min(0).max(120),
  /** Veces que la capacidad disponible debe cubrir la cuota más alta. */
  capacityCoverage: z.number().min(1).max(10),
  /**
   * Tope de endeudamiento: deuda total proyectada / ingreso mensual.
   * Sin valor, el requisito no se cumple y el producto no puede activarse.
   */
  maxDebtToMonthlyIncome: z.number().positive().max(120).nullable(),
};

/** Política configurable del producto 2 (columna `CreditProduct.requirements`). */
export const secondCreditPolicySchema = z.object({
  firstCreditMustBePaid: policyFields.firstCreditMustBePaid.default(true),
  maxLatePayments: policyFields.maxLatePayments.default(1),
  capacityCoverage: policyFields.capacityCoverage.default(1),
  maxDebtToMonthlyIncome: policyFields.maxDebtToMonthlyIncome.default(null),
});
export type SecondCreditPolicy = z.infer<typeof secondCreditPolicySchema>;

/** Cambios parciales a la política: lo que no se envía conserva su valor. */
export const secondCreditPolicyPatchSchema = z
  .object(policyFields)
  .partial()
  .strict();

/** Lee la política guardada; si es ilegible aplica los valores por defecto. */
export function readSecondCreditPolicy(value: unknown): SecondCreditPolicy {
  const parsed = secondCreditPolicySchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : secondCreditPolicySchema.parse({});
}

export interface Requirement {
  code: string;
  label: string;
  met: boolean;
  detail?: string;
}

export interface NormalizedPurpose {
  code: PurposeCode | null;
  description: string | null;
  /** Texto recibido, para explicar por qué no es válido. */
  raw: string;
}

const plain = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const PURPOSE_ALIASES: Record<string, PurposeCode> = {
  CONSOLIDACION: 'CONSOLIDACION_DEUDAS',
  CONSOLIDACION_DE_DEUDAS: 'CONSOLIDACION_DEUDAS',
  CONSOLIDAR_DEUDAS: 'CONSOLIDACION_DEUDAS',
  ESTUDIO: 'EDUCACION',
  ESTUDIOS: 'EDUCACION',
  CARRO: 'MOVILIDAD',
  MOTO: 'MOVILIDAD',
  VEHICULO: 'MOVILIDAD',
  TRANSPORTE: 'MOVILIDAD',
  CASA: 'VIVIENDA',
  NEGOCIO: 'EMPRENDIMIENTO',
  OTRA: 'OTRO',
  OTROS: 'OTRO',
};

/**
 * Convierte lo que envía la interfaz en una finalidad de la lista cerrada.
 * Acepta el código, la etiqueta o `OTRO: descripción`.
 */
export function normalizePurpose(
  purpose?: string | null,
  description?: string | null,
): NormalizedPurpose {
  const text = (purpose ?? '').trim();
  const extra = (description ?? '').trim();
  if (!text) return { code: null, description: extra || null, raw: '' };
  const [head, ...rest] = text.split(':');
  const inline = rest.join(':').trim();
  const key = plain(head);
  const code =
    CREDIT_PURPOSES.find(
      (item) => item.code === key || plain(item.label) === key,
    )?.code ??
    PURPOSE_ALIASES[key] ??
    null;
  return { code, description: extra || inline || null, raw: text };
}

/** Descripciones cuyo único propósito es el puntaje o el historial crediticio. */
const SCORE_ONLY =
  /(puntaje|score|scoring|calificaci[oó]n crediticia|historial crediticio|vida crediticia|datacr[eé]dito|centrales? de riesgo)/i;

export const OTHER_PURPOSE_MIN_LENGTH = 10;

function purposeRequirement(
  purpose: NormalizedPurpose,
  finances: FinancialSnapshot,
): Requirement {
  const label = 'Finalidad válida del crédito';
  const options = CREDIT_PURPOSES.map((item) => item.label.toLowerCase()).join(
    ', ',
  );
  const scoreOnly = {
    code: 'VALID_PURPOSE',
    label,
    met: false,
    detail:
      'Un segundo crédito no se aprueba solo para subir el puntaje. Cuéntanos la necesidad real que vas a cubrir.',
  };
  if (!purpose.code)
    return SCORE_ONLY.test(purpose.raw)
      ? scoreOnly
      : {
          code: 'VALID_PURPOSE',
          label,
          met: false,
          detail: `Elige una finalidad: ${options}.`,
        };
  if (purpose.code === 'OTRO') {
    // En "otro", la descripción es la finalidad.
    if (SCORE_ONLY.test(purpose.description ?? '')) return scoreOnly;
    if ((purpose.description ?? '').length < OTHER_PURPOSE_MIN_LENGTH)
      return {
        code: 'VALID_PURPOSE',
        label,
        met: false,
        detail: 'Describe para qué usarás el crédito.',
      };
  }
  if (
    purpose.code === 'CONSOLIDACION_DEUDAS' &&
    finances.consent &&
    finances.totalDebtCOP === 0
  )
    return {
      code: 'VALID_PURPOSE',
      label,
      met: false,
      detail:
        'Tu perfil financiero no registra deudas para consolidar. Actualízalo o elige otra finalidad.',
    };
  const chosen = CREDIT_PURPOSES.find((item) => item.code === purpose.code);
  return {
    code: 'VALID_PURPOSE',
    label,
    met: true,
    detail:
      purpose.code === 'OTRO'
        ? `Otro: ${purpose.description}`
        : (chosen?.label ?? purpose.code),
  };
}

export interface FirstCreditSnapshot {
  status: string;
  installments: Array<{
    status: string;
    dueDate: Date | string;
    /** Fecha calendario (Colombia) en la que quedó pagada la cuota. */
    paidOn?: string | null;
  }>;
}

export interface FinancialSnapshot {
  /** Consentimiento SCORE_SHARE_WITH_STARTIF vigente. */
  consent: boolean;
  monthlyIncomeCOP: number | null;
  monthlyExpensesCOP: number | null;
  totalDebtCOP: number | null;
}

export interface SecondCreditInput {
  /** Producto 2 vigente; `null` si no hay versión activa. */
  product: {
    principalCOP: number;
    /** Cuota más alta del plan (la primera). */
    highestInstallmentCOP: number;
  } | null;
  policy: SecondCreditPolicy;
  firstCredit: FirstCreditSnapshot | null;
  /** `undefined`: la finalidad aún no se ha elegido y no se evalúa. */
  purpose?: NormalizedPurpose;
  finances: FinancialSnapshot;
  /** Estados de las demás solicitudes o créditos de la persona. */
  otherStatuses: string[];
  today: Date | string;
}

const money = (value: number) =>
  `$${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function behaviorRequirement(input: SecondCreditInput): Requirement {
  const label = 'Buen comportamiento en tu primer crédito';
  const code = 'FIRST_CREDIT_BEHAVIOR';
  const first = input.firstCredit;
  if (!first)
    return {
      code,
      label,
      met: false,
      detail: 'Primero debes tener y pagar tu crédito Servicio LUFT.',
    };
  if (first.status === 'WRITTEN_OFF' || first.status === 'DEFAULTED')
    return {
      code,
      label,
      met: false,
      detail: 'Tu primer crédito está en mora.',
    };
  const today = toIsoDate(input.today);
  const open = first.installments.filter((row) => !isSettled(row.status));
  const overdue = open.filter(
    (row) => row.status === 'OVERDUE' || daysOverdue(row.dueDate, today) > 0,
  );
  if (overdue.length)
    return {
      code,
      label,
      met: false,
      detail: `Tienes ${plural(overdue.length, 'cuota en mora', 'cuotas en mora')}. Ponte al día para continuar.`,
    };
  if (
    input.policy.firstCreditMustBePaid &&
    (first.status !== 'COMPLETED' || open.length > 0)
  )
    return {
      code,
      label,
      met: false,
      detail: open.length
        ? `Termina de pagar tu primer crédito: te ${open.length === 1 ? 'falta' : 'faltan'} ${plural(open.length, 'cuota', 'cuotas')}.`
        : 'Tu primer crédito aún no está cerrado.',
    };
  if (!['ACTIVE', 'COMPLETED'].includes(first.status))
    return {
      code,
      label,
      met: false,
      detail: 'Tu primer crédito aún no está vigente.',
    };
  const paid = first.installments.filter((row) => row.status === 'PAID');
  const late = paid.filter(
    (row) => !row.paidOn || toIsoDate(row.paidOn) > toIsoDate(row.dueDate),
  );
  if (late.length > input.policy.maxLatePayments)
    return {
      code,
      label,
      met: false,
      detail: `Tuviste ${plural(late.length, 'pago tardío', 'pagos tardíos')}; el máximo permitido es ${input.policy.maxLatePayments}.`,
    };
  return {
    code,
    label,
    met: true,
    detail: `${plural(paid.length, 'cuota pagada', 'cuotas pagadas')}, ${plural(late.length, 'tardía', 'tardías')}, ninguna en mora.`,
  };
}

const PROFILE_DETAIL =
  'Completa tu perfil financiero (ingresos, gastos y deudas).';
const CONSENT_DETAIL =
  'Autoriza compartir tu perfil financiero con StartIF para evaluar tu capacidad.';
const PRODUCT_DETAIL = 'Se evalúa cuando el producto esté disponible.';

function capacityRequirement(input: SecondCreditInput): Requirement {
  const code = 'AVAILABLE_CAPACITY';
  const label = 'Capacidad de pago disponible';
  const { finances, product, policy } = input;
  if (!finances.consent)
    return { code, label, met: false, detail: CONSENT_DETAIL };
  if (
    finances.monthlyIncomeCOP === null ||
    finances.monthlyExpensesCOP === null
  )
    return { code, label, met: false, detail: PROFILE_DETAIL };
  if (!product) return { code, label, met: false, detail: PRODUCT_DETAIL };
  const available = finances.monthlyIncomeCOP - finances.monthlyExpensesCOP;
  const needed = Math.ceil(
    product.highestInstallmentCOP * policy.capacityCoverage,
  );
  const summary = `Ingresos ${money(finances.monthlyIncomeCOP)} − gastos ${money(finances.monthlyExpensesCOP)} = ${money(available)} disponibles al mes; la cuota más alta es ${money(product.highestInstallmentCOP)}`;
  return {
    code,
    label,
    met: available >= needed,
    detail:
      available >= needed
        ? `${summary}.`
        : `${summary}${policy.capacityCoverage > 1 ? ` y debes cubrirla ${policy.capacityCoverage} veces` : ''}. Tu capacidad disponible no alcanza.`,
  };
}

function indebtednessRequirement(input: SecondCreditInput): Requirement {
  const code = 'NO_OVERINDEBTEDNESS';
  const label = 'Sin sobreendeudamiento';
  const { finances, product, policy } = input;
  if (!finances.consent)
    return { code, label, met: false, detail: CONSENT_DETAIL };
  if (finances.monthlyIncomeCOP === null || finances.totalDebtCOP === null)
    return { code, label, met: false, detail: PROFILE_DETAIL };
  if (!product) return { code, label, met: false, detail: PRODUCT_DETAIL };
  if (policy.maxDebtToMonthlyIncome === null)
    return {
      code,
      label,
      met: false,
      detail: 'El tope de endeudamiento del producto aún no está definido.',
    };
  if (finances.monthlyIncomeCOP <= 0)
    return {
      code,
      label,
      met: false,
      detail: 'Tu perfil financiero no registra ingresos.',
    };
  // Una consolidación reemplaza deuda existente; cualquier otra finalidad suma.
  const projected =
    input.purpose?.code === 'CONSOLIDACION_DEUDAS'
      ? Math.max(finances.totalDebtCOP, product.principalCOP)
      : finances.totalDebtCOP + product.principalCOP;
  const limit = Math.floor(
    finances.monthlyIncomeCOP * policy.maxDebtToMonthlyIncome,
  );
  const met = projected <= limit;
  return {
    code,
    label,
    met,
    detail: `Con este crédito tu deuda total sería ${money(projected)}; el tope para tus ingresos es ${money(limit)}.${met ? '' : ' Superarías el nivel de endeudamiento permitido.'}`,
  };
}

/**
 * Evalúa todos los requisitos del crédito 2. `eligible` solo es verdadero si
 * todos los requisitos listados se cumplen.
 */
export function evaluateSecondCredit(input: SecondCreditInput): {
  eligible: boolean;
  requirements: Requirement[];
} {
  const busy = input.otherStatuses.filter(isInProgress);
  const requirements: Requirement[] = [
    {
      code: 'PRODUCT_AVAILABLE',
      label: 'Crédito 2 disponible',
      met: Boolean(input.product),
      detail: input.product
        ? undefined
        : 'El segundo crédito aún no está disponible.',
    },
    behaviorRequirement(input),
    ...(input.purpose
      ? [purposeRequirement(input.purpose, input.finances)]
      : []),
    capacityRequirement(input),
    indebtednessRequirement(input),
    {
      code: 'NO_CREDIT_IN_PROGRESS',
      label: 'Sin otra solicitud o crédito en curso',
      met: busy.length === 0,
      detail: busy.length
        ? 'Tienes una solicitud o un crédito en curso. Termínalo antes de pedir otro.'
        : undefined,
    },
  ];
  return {
    eligible: requirements.every((item) => item.met),
    requirements,
  };
}

/** Lo mínimo que StartIF lee del perfil financiero de LUFT (ya descifrado). */
const financialContextSchema = z
  .object({
    income: z
      .object({
        sources: z.array(
          z.object({ monthlyCOP: z.number().finite().min(0) }).passthrough(),
        ),
      })
      .passthrough()
      .optional(),
    debts: z
      .object({
        cardSpendMonthlyCOP: z.number().finite().min(0),
        totalDebtCOP: z.number().finite().min(0),
        fixedExpensesMonthlyCOP: z.number().finite().min(0),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * Resume ingresos, gastos y deudas declarados. Los gastos son los gastos fijos
 * más el consumo mensual con tarjeta. Lo que falte queda en `null`.
 */
export function financialSnapshot(
  consent: boolean,
  context: unknown,
): FinancialSnapshot {
  const empty: FinancialSnapshot = {
    consent,
    monthlyIncomeCOP: null,
    monthlyExpensesCOP: null,
    totalDebtCOP: null,
  };
  if (!consent) return empty;
  const parsed = financialContextSchema.safeParse(context ?? {});
  if (!parsed.success) return empty;
  const { income, debts } = parsed.data;
  return {
    consent,
    monthlyIncomeCOP: income
      ? income.sources.reduce((total, row) => total + row.monthlyCOP, 0)
      : null,
    monthlyExpensesCOP: debts
      ? debts.fixedExpensesMonthlyCOP + debts.cardSpendMonthlyCOP
      : null,
    totalDebtCOP: debts ? debts.totalDebtCOP : null,
  };
}
