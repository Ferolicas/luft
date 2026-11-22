import { z } from 'zod';

/**
 * Pure archetype engine. An archetype is a dynamic, versioned behavioural
 * profile inside a service category. Rules are explainable JSON evaluated over
 * facts the app really collects; nothing here touches the database.
 */

export const FACT_CATALOG = {
  goal: { label: 'Objetivo que elegiste al clasificarte', type: 'text' },
  creditExperience: { label: 'Experiencia previa con crédito', type: 'text' },
  employmentSituation: { label: 'Situación laboral', type: 'text' },
  contractType: { label: 'Tipo de contrato', type: 'text' },
  incomeKinds: { label: 'Fuentes de ingreso', type: 'list' },
  incomeSourceCount: { label: 'Número de fuentes de ingreso', type: 'number' },
  monthlyIncomeCOP: { label: 'Ingreso mensual declarado', type: 'number' },
  hasWithholding: { label: 'Te practican retención', type: 'boolean' },
  assetKinds: { label: 'Tipos de patrimonio', type: 'list' },
  totalAssetsCOP: { label: 'Patrimonio declarado', type: 'number' },
  totalDebtCOP: { label: 'Deuda total declarada', type: 'number' },
  paysRent: { label: 'Pagas arriendo', type: 'boolean' },
  socialSecurity: { label: 'Cotización a seguridad social', type: 'text' },
  existingHistory: { label: 'Historial crediticio previo', type: 'boolean' },
  currentScore: { label: 'Puntaje consultado', type: 'number' },
  lessonsCompleted: { label: 'Lecciones completadas', type: 'number' },
  modulesCompleted: { label: 'Módulos completados', type: 'number' },
  creditActive: { label: 'Crédito constructor activo', type: 'boolean' },
  onTimeInstallments: { label: 'Cuotas pagadas a tiempo', type: 'number' },
  householdRole: { label: 'Rol en tu hogar LUFT', type: 'text' },
  householdBeneficiaries: {
    label: 'Integrantes con ruta en tu hogar',
    type: 'number',
  },
  householdSupportMembers: {
    label: 'Integrantes de apoyo en tu hogar',
    type: 'number',
  },
  sharedGoals: { label: 'Metas compartidas activas', type: 'number' },
  lifeProjects: { label: 'Proyectos de vida activos', type: 'number' },
  lifeProjectKinds: { label: 'Tipos de proyecto de vida', type: 'list' },
} as const;

export type FactKey = keyof typeof FACT_CATALOG;
export const FACT_KEYS = Object.keys(FACT_CATALOG) as [FactKey, ...FactKey[]];
export type FactValue = string | number | boolean | string[] | null | undefined;
export type ArchetypeFacts = Partial<Record<FactKey, FactValue>>;

export const RULE_OPERATORS = [
  'eq',
  'neq',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'includes',
  'includesAny',
  'isTrue',
  'isFalse',
  'exists',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface RuleCondition {
  fact: FactKey;
  op: RuleOperator;
  value?: string | number | boolean | string[];
  label: string;
}
export type RuleNode =
  RuleCondition | { all: RuleNode[] } | { any: RuleNode[] };
export type ArchetypeRules = { all: RuleNode[] } | { any: RuleNode[] };

const conditionSchema = z
  .object({
    fact: z.enum(FACT_KEYS),
    op: z.enum(RULE_OPERATORS),
    value: z
      .union([
        z.string().max(80),
        z.number(),
        z.boolean(),
        z.array(z.string().max(80)).min(1).max(20),
      ])
      .optional(),
    label: z.string().trim().min(3).max(160),
  })
  .strict()
  .superRefine((condition, context) => {
    const needsList = ['in', 'nin', 'includesAny'].includes(condition.op);
    const needsNumber = ['gt', 'gte', 'lt', 'lte'].includes(condition.op);
    const noValue = ['isTrue', 'isFalse', 'exists'].includes(condition.op);
    const message = needsList
      ? 'requiere una lista de valores'
      : needsNumber
        ? 'requiere un número'
        : noValue
          ? 'no admite valor'
          : 'requiere un valor';
    const valid = needsList
      ? Array.isArray(condition.value)
      : needsNumber
        ? typeof condition.value === 'number'
        : noValue
          ? condition.value === undefined
          : condition.value !== undefined && !Array.isArray(condition.value);
    if (!valid)
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: `El operador ${condition.op} ${message}.`,
      });
  });

const ruleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({ all: z.array(ruleNodeSchema).max(12) }).strict(),
    z.object({ any: z.array(ruleNodeSchema).min(1).max(12) }).strict(),
  ]),
);

/** The root is always a group, so an archetype reads as "all of" or "any of". */
export const archetypeRulesSchema: z.ZodType<ArchetypeRules> = z.union([
  z.object({ all: z.array(ruleNodeSchema).max(12) }).strict(),
  z.object({ any: z.array(ruleNodeSchema).min(1).max(12) }).strict(),
]);

export interface RuleHit {
  fact: FactKey;
  factLabel: string;
  label: string;
  value: string;
}

function display(value: FactValue): string {
  if (value === null || value === undefined) return 'sin dato';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'ninguno';
  return String(value);
}

function test(condition: RuleCondition, facts: ArchetypeFacts): boolean {
  const actual = facts[condition.fact];
  const expected = condition.value;
  const known = actual !== null && actual !== undefined;
  switch (condition.op) {
    case 'exists':
      return known && (!Array.isArray(actual) || actual.length > 0);
    case 'isTrue':
      return actual === true;
    case 'isFalse':
      return actual === false;
    case 'eq':
      return known && actual === expected;
    case 'neq':
      return known && actual !== expected;
    case 'in':
      return (
        known &&
        Array.isArray(expected) &&
        !Array.isArray(actual) &&
        expected.includes(String(actual))
      );
    case 'nin':
      return (
        known &&
        Array.isArray(expected) &&
        !Array.isArray(actual) &&
        !expected.includes(String(actual))
      );
    case 'includes':
      return Array.isArray(actual) && actual.includes(String(expected));
    case 'includesAny':
      return (
        Array.isArray(actual) &&
        Array.isArray(expected) &&
        expected.some((item) => actual.includes(item))
      );
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || typeof expected !== 'number')
        return false;
      if (condition.op === 'gt') return actual > expected;
      if (condition.op === 'gte') return actual >= expected;
      if (condition.op === 'lt') return actual < expected;
      return actual <= expected;
    }
  }
}

/** Evaluates a rule tree and returns the conditions that made it true. */
export function evaluateRules(
  node: RuleNode,
  facts: ArchetypeFacts,
): { matched: boolean; hits: RuleHit[] } {
  if ('all' in node) {
    const results = node.all.map((child) => evaluateRules(child, facts));
    const matched = results.every((result) => result.matched);
    return {
      matched,
      hits: matched ? results.flatMap((result) => result.hits) : [],
    };
  }
  if ('any' in node) {
    const results = node.any
      .map((child) => evaluateRules(child, facts))
      .filter((result) => result.matched);
    return {
      matched: results.length > 0,
      hits: results.flatMap((result) => result.hits),
    };
  }
  const matched = test(node, facts);
  return {
    matched,
    hits: matched
      ? [
          {
            fact: node.fact,
            factLabel: FACT_CATALOG[node.fact].label,
            label: node.label,
            value: display(facts[node.fact]),
          },
        ]
      : [],
  };
}

export interface ArchetypeDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
  rules: unknown;
  priority: number;
  version: number;
  isDefault: boolean;
  active: boolean;
}

/**
 * Documented equivalence for the archetype codes used before V2. A legacy code
 * only decides while the profile has no facts that match a rule; as soon as a
 * rule matches, the rule wins. Conservative on purpose: when the old label has
 * no clear counterpart, it maps to the base archetype of the category.
 */
export const LEGACY_ARCHETYPE_EQUIVALENCE: Record<
  string,
  Record<string, string>
> = {
  INICIADOR: {
    JOVEN: 'EXPLORADOR_CONSCIENTE',
    ADULTO: 'PROFESIONAL_SIN_HISTORIAL',
    FAMILIA: 'FAMILIA_IMPULSORA',
  },
  EXPLORADOR: {
    JOVEN: 'EXPLORADOR_CONSCIENTE',
    ADULTO: 'PROFESIONAL_SIN_HISTORIAL',
    FAMILIA: 'FAMILIA_IMPULSORA',
  },
  CONSTRUCTOR: {
    JOVEN: 'EXPLORADOR_CONSCIENTE',
    ADULTO: 'INDEPENDIENTE_EN_CONSOLIDACION',
    FAMILIA: 'HOGAR_PLANIFICADOR',
  },
  ESTRATEGA: {
    JOVEN: 'EXPLORADOR_CONSCIENTE',
    ADULTO: 'PROFESIONAL_SIN_HISTORIAL',
    FAMILIA: 'HOGAR_PLANIFICADOR',
  },
};
export const LEGACY_ARCHETYPE_CODES = Object.keys(LEGACY_ARCHETYPE_EQUIVALENCE);

export type AssignmentBasis = 'RULES' | 'LEGACY_EQUIVALENCE' | 'DEFAULT';

export interface ArchetypeExplanation {
  basis: AssignmentBasis;
  summary: string;
  matched: RuleHit[];
  evaluated: Array<{
    code: string;
    name: string;
    priority: number;
    matched: boolean;
  }>;
  legacyCode?: string;
}

export interface ArchetypeDecision {
  archetype: ArchetypeDefinition;
  explanation: ArchetypeExplanation;
}

function parseRules(rules: unknown): ArchetypeRules | null {
  const parsed = archetypeRulesSchema.safeParse(rules);
  return parsed.success ? parsed.data : null;
}

/**
 * Picks the archetype for a category. Order: the matching rule set with the
 * highest priority (ties: more matched conditions, then code); otherwise the
 * documented legacy equivalence; otherwise the default archetype.
 */
export function assignArchetype(
  definitions: ArchetypeDefinition[],
  facts: ArchetypeFacts,
  options: { categoryCode: string; legacyCode?: string | null },
): ArchetypeDecision | null {
  const active = definitions.filter((item) => item.active);
  if (!active.length) return null;
  const results = active.map((definition) => {
    const rules = parseRules(definition.rules);
    const outcome = rules
      ? evaluateRules(rules, facts)
      : { matched: false, hits: [] as RuleHit[] };
    return { definition, ...outcome };
  });
  const evaluated = results
    .map(({ definition, matched, hits }) => ({
      code: definition.code,
      name: definition.name,
      priority: definition.priority,
      matched: matched && hits.length > 0,
    }))
    .sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
  const byRules = results
    .filter((result) => result.matched && result.hits.length > 0)
    .sort(
      (a, b) =>
        b.definition.priority - a.definition.priority ||
        b.hits.length - a.hits.length ||
        a.definition.code.localeCompare(b.definition.code),
    )[0];
  if (byRules)
    return {
      archetype: byRules.definition,
      explanation: {
        basis: 'RULES',
        summary: `Te ubicamos como ${byRules.definition.name} porque: ${byRules.hits
          .map((hit) => hit.label.toLowerCase())
          .join('; ')}.`,
        matched: byRules.hits,
        evaluated,
      },
    };
  const legacyCode = options.legacyCode?.toUpperCase();
  const equivalent = legacyCode
    ? LEGACY_ARCHETYPE_EQUIVALENCE[legacyCode]?.[options.categoryCode]
    : undefined;
  const byLegacy = equivalent
    ? active.find((item) => item.code === equivalent)
    : undefined;
  if (byLegacy && legacyCode)
    return {
      archetype: byLegacy,
      explanation: {
        basis: 'LEGACY_EQUIVALENCE',
        summary: `Conservamos tu perfil anterior (${legacyCode}) con su equivalente actual, ${byLegacy.name}. Se actualizará cuando completes más datos de tu perfil.`,
        matched: [],
        evaluated,
        legacyCode,
      },
    };
  const fallback =
    active.find((item) => item.isDefault) ??
    [...active].sort(
      (a, b) => a.priority - b.priority || a.code.localeCompare(b.code),
    )[0];
  return {
    archetype: fallback,
    explanation: {
      basis: 'DEFAULT',
      summary: `${fallback.name} es el punto de partida de tu categoría. Cambiará cuando tu perfil y tus evidencias muestren algo distinto.`,
      matched: [],
      evaluated,
    },
  };
}

/** Stable fingerprint of a decision: a new assignment is stored only when it changes. */
export function decisionFingerprint(decision: ArchetypeDecision): string {
  return JSON.stringify([
    decision.archetype.id,
    decision.archetype.version,
    decision.explanation.basis,
    decision.explanation.matched.map((hit) => [hit.fact, hit.label, hit.value]),
  ]);
}
