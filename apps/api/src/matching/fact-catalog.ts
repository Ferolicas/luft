/**
 * Catalog of facts a policy rule can evaluate. Policies live in the database;
 * this file only declares WHICH facts exist, their type and the operators each
 * one accepts, so the console can build parameterized forms from the API.
 * Pure data: nothing here touches the database or any third party.
 */

export const MATCH_ENGINE_VERSION = 'match-engine-2026.11';

export const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'not_in',
  'includes_any',
  'includes_all',
  'includes_none',
] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'igual a',
  neq: 'distinto de',
  gt: 'mayor que',
  gte: 'mayor o igual a',
  lt: 'menor que',
  lte: 'menor o igual a',
  between: 'entre',
  in: 'uno de',
  not_in: 'ninguno de',
  includes_any: 'incluye alguno de',
  includes_all: 'incluye todos',
  includes_none: 'no incluye ninguno de',
};

/** Shape of the `value` each operator expects. */
export const OPERATOR_VALUE_SHAPE: Record<
  Operator,
  'scalar' | 'range' | 'list'
> = {
  eq: 'scalar',
  neq: 'scalar',
  gt: 'scalar',
  gte: 'scalar',
  lt: 'scalar',
  lte: 'scalar',
  between: 'range',
  in: 'list',
  not_in: 'list',
  includes_any: 'list',
  includes_all: 'list',
  includes_none: 'list',
};

export type FactType =
  'number' | 'money' | 'text' | 'enum' | 'boolean' | 'list';
export type FactValue = number | string | boolean | string[] | null;
export type Facts = Record<string, FactValue | undefined>;

const NUMERIC: Operator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'not_in',
];
const TEXTUAL: Operator[] = ['eq', 'neq', 'in', 'not_in'];
const BOOLEAN: Operator[] = ['eq', 'neq'];
const LISTED: Operator[] = ['includes_any', 'includes_all', 'includes_none'];

export const OPERATORS_BY_TYPE: Record<FactType, readonly Operator[]> = {
  number: NUMERIC,
  money: NUMERIC,
  text: TEXTUAL,
  enum: TEXTUAL,
  boolean: BOOLEAN,
  list: LISTED,
};

export interface FactOption {
  value: string;
  label: string;
}

export interface FactField {
  key: string;
  label: string;
  group: string;
  description: string;
  type: FactType;
  unit: 'COP' | 'años' | 'meses' | 'días' | 'puntos' | 'razón' | null;
  operators: readonly Operator[];
  /** Closed list for `enum`/`list`; suggestions for `text`. */
  options: FactOption[];
  /** Where the fact comes from today. */
  source: string;
  /**
   * DISPONIBLE: derived from data LUFT already holds.
   * DECLARADO: the person declares it in "datos para matching".
   * EXTENSION: resolved by the profile source; unknown until the catalog exists.
   */
  availability: 'DISPONIBLE' | 'DECLARADO' | 'EXTENSION';
  /** Screen where the person can complete the fact when it is missing. */
  completeHref: string | null;
}

const options = (pairs: Record<string, string>): FactOption[] =>
  Object.entries(pairs).map(([value, label]) => ({ value, label }));

const INCOME_SOURCES = options({
  SALARIO: 'Salario',
  VENTAS: 'Ventas o negocio propio',
  ARRIENDOS: 'Arriendos',
  PENSION: 'Pensión',
  HONORARIOS: 'Honorarios',
  INTERESES: 'Intereses o rendimientos',
  OTROS: 'Otros ingresos',
});

export const DOCUMENT_LABELS: Record<string, string> = {
  TAX_RETURN: 'Declaración de renta',
  BANK_STATEMENTS: 'Extractos bancarios',
  SOCIAL_SECURITY: 'Planilla de seguridad social',
  EMPLOYMENT_CERTIFICATE: 'Certificado laboral',
};

const field = (
  key: string,
  group: string,
  label: string,
  type: FactType,
  description: string,
  extra: Partial<
    Pick<FactField, 'unit' | 'options' | 'availability' | 'completeHref'>
  > & { source: string },
): FactField => ({
  key,
  label,
  group,
  description,
  type,
  unit: extra.unit ?? null,
  operators: OPERATORS_BY_TYPE[type],
  options: extra.options ?? [],
  source: extra.source,
  availability: extra.availability ?? 'DISPONIBLE',
  completeHref: extra.completeHref ?? null,
});

const PROFILE = '/app/perfil/financiero';
const DECLARED = '/app/matching/datos';

export const FACT_FIELDS: readonly FactField[] = [
  field(
    'category',
    'Segmento',
    'Categoría',
    'text',
    'Categoría de servicio de la persona (segmento y propuesta comercial).',
    {
      options: options({
        JOVEN: 'Joven · LUFT Impulso',
        ADULTO: 'Adulto · LUFT Avanza',
        FAMILIA: 'Familia · LUFT Juntos',
      }),
      source: 'Catálogo de categorías de LUFT (fuente de perfil).',
      availability: 'EXTENSION',
    },
  ),
  field(
    'archetype',
    'Segmento',
    'Arquetipo',
    'text',
    'Perfil conductual vigente de la persona dentro de su categoría.',
    { source: 'Perfil financiero LUFT.', completeHref: '/app' },
  ),
  field(
    'primaryGoal',
    'Segmento',
    'Objetivo principal',
    'enum',
    'Objetivo que la persona declaró al iniciar su ruta.',
    {
      options: options({
        IMPROVE_SCORE: 'Mejorar su puntaje',
        START: 'Empezar su vida crediticia',
        GUIDE_YOUTH: 'Acompañar a un joven',
      }),
      source: 'Clasificación inicial de LUFT.',
      completeHref: '/app',
    },
  ),
  field(
    'ageYears',
    'Persona',
    'Edad',
    'number',
    'Edad en años cumplidos a la fecha de la evaluación.',
    {
      unit: 'años',
      source: 'Fecha de nacimiento declarada por la persona.',
      availability: 'DECLARADO',
      completeHref: DECLARED,
    },
  ),
  field(
    'city',
    'Persona',
    'Ciudad',
    'text',
    'Ciudad o municipio de residencia. Se compara sin tildes ni mayúsculas.',
    {
      source: 'Declarada por la persona.',
      availability: 'DECLARADO',
      completeHref: DECLARED,
    },
  ),
  field(
    'department',
    'Persona',
    'Departamento',
    'text',
    'Departamento de residencia. Se compara sin tildes ni mayúsculas.',
    {
      source: 'Declarado por la persona.',
      availability: 'DECLARADO',
      completeHref: DECLARED,
    },
  ),
  field(
    'stratum',
    'Persona',
    'Estrato',
    'number',
    'Estrato socioeconómico registrado (1 a 6).',
    { source: 'Registro de la cuenta.' },
  ),
  field(
    'monthlyIncomeCOP',
    'Ingresos',
    'Ingresos mensuales',
    'money',
    'Suma de los ingresos mensuales declarados en el perfil financiero.',
    {
      unit: 'COP',
      source: 'Perfil financiero · ingresos.',
      completeHref: `${PROFILE}/trabajo`,
    },
  ),
  field(
    'incomeSources',
    'Ingresos',
    'Fuentes de ingreso',
    'list',
    'Todas las fuentes de ingreso con valor mayor que cero.',
    {
      options: INCOME_SOURCES,
      source: 'Perfil financiero · ingresos.',
      completeHref: `${PROFILE}/trabajo`,
    },
  ),
  field(
    'primaryIncomeSource',
    'Ingresos',
    'Fuente principal de ingreso',
    'enum',
    'Fuente con el mayor ingreso mensual declarado.',
    {
      options: INCOME_SOURCES,
      source: 'Perfil financiero · ingresos.',
      completeHref: `${PROFILE}/trabajo`,
    },
  ),
  field(
    'employmentSituation',
    'Trabajo',
    'Situación laboral',
    'enum',
    'Situación laboral declarada.',
    {
      options: options({
        EMPLEADO: 'Empleado',
        INDEPENDIENTE: 'Independiente',
        ESTUDIANTE: 'Estudiante',
        PENSIONADO: 'Pensionado',
        HOGAR: 'Hogar',
        SIN_EMPLEO: 'Sin empleo',
      }),
      source: 'Perfil financiero · trabajo.',
      completeHref: `${PROFILE}/trabajo`,
    },
  ),
  field(
    'contractType',
    'Trabajo',
    'Tipo de contrato',
    'enum',
    'Tipo de vinculación declarada.',
    {
      options: options({
        LABORAL: 'Contrato laboral',
        PRESTACION_SERVICIOS: 'Prestación de servicios',
        OBRA_LABOR: 'Obra o labor',
        APRENDIZAJE: 'Aprendizaje',
        NO_APLICA: 'No aplica',
      }),
      source: 'Perfil financiero · trabajo.',
      completeHref: `${PROFILE}/trabajo`,
    },
  ),
  field(
    'tenureMonths',
    'Trabajo',
    'Antigüedad laboral o comercial',
    'number',
    'Meses completos desde el inicio del empleo o de la actividad actual.',
    {
      unit: 'meses',
      source: 'Fecha de inicio declarada por la persona.',
      availability: 'DECLARADO',
      completeHref: DECLARED,
    },
  ),
  field(
    'score',
    'Historial',
    'Puntaje de crédito',
    'number',
    'Puntaje de la consulta más reciente ante el operador de información.',
    {
      unit: 'puntos',
      source: 'Consulta autorizada a centrales de riesgo.',
      completeHref: '/app/puntaje',
    },
  ),
  field(
    'hasCreditHistory',
    'Historial',
    'Tiene historial crediticio',
    'boolean',
    'Existencia de historial según la consulta más reciente.',
    {
      source: 'Consulta autorizada a centrales de riesgo.',
      completeHref: '/app/puntaje',
    },
  ),
  field(
    'onTimeInstallments',
    'Historial',
    'Cuotas pagadas a tiempo en LUFT',
    'number',
    'Cuotas del crédito constructor pagadas en la fecha de vencimiento o antes.',
    { source: 'Cartera STARTIF.' },
  ),
  field(
    'currentArrears',
    'Historial',
    'Mora actual en LUFT',
    'boolean',
    'Tiene al menos una cuota vencida sin pagar a la fecha de la evaluación.',
    { source: 'Cartera STARTIF.' },
  ),
  field(
    'maxDaysPastDue',
    'Historial',
    'Días de mora actual',
    'number',
    'Días transcurridos desde la cuota vencida más antigua sin pagar (0 si está al día).',
    { unit: 'días', source: 'Cartera STARTIF.' },
  ),
  field(
    'debtToIncomeRatio',
    'Capacidad',
    'Endeudamiento (deuda / ingreso anual)',
    'number',
    'Deuda total declarada dividida entre el ingreso de doce meses. 0,40 equivale a 40%.',
    {
      unit: 'razón',
      source: 'Perfil financiero · ingresos y deudas.',
      completeHref: `${PROFILE}/patrimonio`,
    },
  ),
  field(
    'availableCapacityCOP',
    'Capacidad',
    'Capacidad mensual disponible',
    'money',
    'Ingreso mensual menos gastos fijos y consumo mensual con tarjeta declarados.',
    {
      unit: 'COP',
      source: 'Perfil financiero · ingresos y deudas.',
      completeHref: `${PROFILE}/patrimonio`,
    },
  ),
  field(
    'requestedAmountCOP',
    'Solicitud',
    'Monto solicitado',
    'money',
    'Monto que la persona indica al ejecutar el matching.',
    { unit: 'COP', source: 'Solicitud de matching.' },
  ),
  field(
    'requestedTermMonths',
    'Solicitud',
    'Plazo solicitado',
    'number',
    'Plazo en meses que la persona indica al ejecutar el matching.',
    { unit: 'meses', source: 'Solicitud de matching.' },
  ),
  field(
    'documentsUploaded',
    'Documentos',
    'Documentos cargados',
    'list',
    'Tipos de documento que la persona ya cargó en su perfil.',
    {
      options: options(DOCUMENT_LABELS),
      source: 'Perfil financiero · documentos.',
      completeHref: `${PROFILE}/documentos`,
    },
  ),
  field(
    'taxFormalization',
    'Formalización',
    'Formalización tributaria',
    'enum',
    'Orientación tributaria de LUFT; no es una determinación de la autoridad.',
    {
      options: options({
        SIN_ALERTA: 'Sin alerta de posible obligación',
        DECLARACION_CARGADA: 'Declaración de renta cargada',
        ALERTA_SIN_SOPORTE: 'Posible obligación sin declaración cargada',
      }),
      source: 'Diagnóstico tributario de LUFT y documentos cargados.',
      completeHref: '/app/renta',
    },
  ),
  field(
    'socialSecurity',
    'Formalización',
    'Cotización a seguridad social',
    'enum',
    'Forma en que la persona cotiza a seguridad social.',
    {
      options: options({
        EMPLEADO: 'Como empleado',
        INDEPENDIENTE: 'Como independiente',
        NO_COTIZO: 'No cotiza',
      }),
      source: 'Perfil financiero · hábitos de pago.',
      completeHref: `${PROFILE}/habitos`,
    },
  ),
];

const BY_KEY = new Map(FACT_FIELDS.map((item) => [item.key, item]));

export function factField(key: string): FactField | undefined {
  return BY_KEY.get(key);
}

export const FACT_KEYS = FACT_FIELDS.map((item) => item.key);

export const RULE_KINDS = ['REQUISITO', 'EXCLUSION', 'PREFERENCIA'] as const;
export type RuleKindName = (typeof RULE_KINDS)[number];

export const RULE_KIND_LABELS: Record<RuleKindName, string> = {
  REQUISITO: 'Requisito',
  EXCLUSION: 'Exclusión (causal de rechazo)',
  PREFERENCIA: 'Preferencia',
};

/** Who must approve an exception to a rule that allows one. */
export const EXCEPTION_LEVELS = ['RISK', 'SUPERADMIN', 'INSTITUTION'] as const;
export type ExceptionLevel = (typeof EXCEPTION_LEVELS)[number];

export const EXCEPTION_LEVEL_LABELS: Record<ExceptionLevel, string> = {
  RISK: 'Riesgo LUFT',
  SUPERADMIN: 'Dirección LUFT',
  INSTITUTION: 'La entidad financiera',
};

const normalizeText = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** Comparison key for text facts: no accents, no case, no outer spaces. */
export function textKey(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? normalizeText(value)
    : null;
}

export interface RuleShape {
  field: string;
  operator: string;
  value: unknown;
}

/**
 * Checks a rule against the catalog. Returns human-readable problems; an empty
 * list means the rule can be stored.
 */
export function ruleIssues(rule: RuleShape): string[] {
  const definition = factField(rule.field);
  if (!definition)
    return [`El campo «${rule.field}» no existe en el catálogo.`];
  if (!definition.operators.includes(rule.operator as Operator))
    return [
      `El operador «${rule.operator}» no aplica al campo «${definition.label}».`,
    ];
  const operator = rule.operator as Operator;
  const scalarOk = (value: unknown) => {
    if (definition.type === 'number' || definition.type === 'money')
      return typeof value === 'number' && Number.isFinite(value);
    if (definition.type === 'boolean') return typeof value === 'boolean';
    if (typeof value !== 'string' || !value.trim()) return false;
    return definition.type === 'text'
      ? value.length <= 120
      : definition.options.some((option) => option.value === value);
  };
  const shape = OPERATOR_VALUE_SHAPE[operator];
  if (shape === 'scalar')
    return scalarOk(rule.value)
      ? []
      : [`El valor no es válido para «${definition.label}».`];
  if (!Array.isArray(rule.value))
    return [
      `El operador «${OPERATOR_LABELS[operator]}» necesita una lista de valores.`,
    ];
  if (shape === 'range') {
    const [min, max] = rule.value as unknown[];
    return rule.value.length === 2 &&
      scalarOk(min) &&
      scalarOk(max) &&
      (min as number) <= (max as number)
      ? []
      : ['El rango necesita un mínimo y un máximo, con mínimo ≤ máximo.'];
  }
  if (rule.value.length < 1 || rule.value.length > 50)
    return ['La lista debe tener entre 1 y 50 valores.'];
  return rule.value.every(scalarOk)
    ? []
    : [`La lista contiene valores no válidos para «${definition.label}».`];
}

const money = (value: number) =>
  `$${Math.round(value).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

/** Formats one scalar of a field for people. */
export function formatFactScalar(
  definition: FactField,
  value: unknown,
): string {
  if (value === null || value === undefined) return 'sin dato';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (typeof value === 'number') {
    if (definition.type === 'money') return money(value);
    if (definition.unit === 'razón')
      return `${(value * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`;
    const text = value.toLocaleString('es-CO', { maximumFractionDigits: 2 });
    return definition.unit ? `${text} ${definition.unit}` : text;
  }
  const text = String(value);
  return (
    definition.options.find((option) => option.value === text)?.label ?? text
  );
}

/** Formats a fact value or a rule value (scalar, range or list). */
export function formatFactValue(definition: FactField, value: unknown): string {
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => formatFactScalar(definition, item)).join(', ')
      : 'ninguno';
  return formatFactScalar(definition, value);
}

/** "Ingresos mensuales mayor o igual a $2.000.000". */
export function describeCondition(rule: RuleShape): string {
  const definition = factField(rule.field);
  if (!definition) return `Criterio sobre «${rule.field}»`;
  const operator = rule.operator as Operator;
  const label = OPERATOR_LABELS[operator] ?? rule.operator;
  if (operator === 'between' && Array.isArray(rule.value))
    return `${definition.label} entre ${formatFactScalar(definition, rule.value[0])} y ${formatFactScalar(definition, rule.value[1])}`;
  return `${definition.label} ${label} ${formatFactValue(definition, rule.value)}`;
}

/** Payload of `GET /admin/matching/catalog`. */
export function catalogView() {
  return {
    engineVersion: MATCH_ENGINE_VERSION,
    fields: FACT_FIELDS,
    operators: OPERATORS.map((key) => ({
      key,
      label: OPERATOR_LABELS[key],
      valueShape: OPERATOR_VALUE_SHAPE[key],
    })),
    ruleKinds: RULE_KINDS.map((key) => ({ key, label: RULE_KIND_LABELS[key] })),
    exceptionLevels: EXCEPTION_LEVELS.map((key) => ({
      key,
      label: EXCEPTION_LEVEL_LABELS[key],
    })),
  };
}
