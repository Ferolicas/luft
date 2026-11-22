import {
  describeCondition,
  EXCEPTION_LEVEL_LABELS,
  factField,
  formatFactValue,
  MATCH_ENGINE_VERSION,
  OPERATORS,
  textKey,
  type ExceptionLevel,
  type Facts,
  type FactValue,
  type Operator,
  type RuleKindName,
} from './fact-catalog';

/**
 * Pure policy engine: facts + rules → deterministic, explainable result.
 * It never reads the clock, the database or any provider, so evaluating the
 * same fact snapshot with the same rule copy always returns the same result.
 */

export interface EngineRule {
  id: string;
  position: number;
  field: string;
  operator: string;
  value: unknown;
  kind: RuleKindName;
  weight: number;
  label: string;
  internal: boolean;
  exceptionAllowed: boolean;
  exceptionApprovalLevel: string | null;
}

export type RuleOutcome = 'CUMPLE' | 'NO_CUMPLE' | 'DATO_FALTANTE' | 'EXCLUYE';
export type MatchStatusName = 'ELEGIBLE' | 'CON_BRECHAS' | 'EXCLUIDO';

export interface RuleEvaluation {
  ruleId: string;
  position: number;
  kind: RuleKindName;
  field: string;
  operator: string;
  expected: unknown;
  /** Value of the fact when the rule was evaluated; `null` when unknown. */
  actual: FactValue;
  outcome: RuleOutcome;
  /** A blocking gap keeps the product from being ELEGIBLE. */
  blocking: boolean;
  weight: number;
  label: string;
  internal: boolean;
  exceptionAllowed: boolean;
  exceptionApprovalLevel: string | null;
}

export interface MatchEvaluation {
  engineVersion: string;
  status: MatchStatusName;
  fitPercent: number;
  /** The person may authorize presenting this result to the institution. */
  presentable: boolean;
  requiresException: boolean;
  exceptionApprovalLevels: string[];
  totals: {
    rules: number;
    passed: number;
    gaps: number;
    blockingGaps: number;
    missingData: number;
    exclusions: number;
    weightTotal: number;
    weightMet: number;
  };
  passed: RuleEvaluation[];
  gaps: RuleEvaluation[];
  exclusions: RuleEvaluation[];
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Comparable key of a scalar: numbers and booleans as they are, text normalized. */
function scalarKey(value: unknown): string | number | boolean | null {
  if (isNumber(value) || typeof value === 'boolean') return value;
  return textKey(value);
}

function listKeys(value: unknown): Array<string | number | boolean> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const keys = value.map(scalarKey);
  return keys.some((key) => key === null)
    ? null
    : (keys as Array<string | number | boolean>);
}

/**
 * Evaluates one condition. Returns `null` when it cannot be decided: unknown
 * fact, unsupported operator or a malformed value. `null` never counts as met.
 */
export function evaluateCondition(
  fact: FactValue | undefined,
  operator: string,
  expected: unknown,
): boolean | null {
  if (fact === null || fact === undefined) return null;
  if (!OPERATORS.includes(operator as Operator)) return null;
  switch (operator as Operator) {
    case 'eq':
    case 'neq': {
      if (Array.isArray(fact)) return null;
      const left = scalarKey(fact);
      const right = scalarKey(expected);
      if (left === null || right === null || typeof left !== typeof right)
        return null;
      return operator === 'eq' ? left === right : left !== right;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (!isNumber(fact) || !isNumber(expected)) return null;
      if (operator === 'gt') return fact > expected;
      if (operator === 'gte') return fact >= expected;
      if (operator === 'lt') return fact < expected;
      return fact <= expected;
    }
    case 'between': {
      if (!isNumber(fact) || !Array.isArray(expected) || expected.length !== 2)
        return null;
      const [min, max] = expected as unknown[];
      if (!isNumber(min) || !isNumber(max) || min > max) return null;
      return fact >= min && fact <= max;
    }
    case 'in':
    case 'not_in': {
      if (Array.isArray(fact)) return null;
      const left = scalarKey(fact);
      const keys = listKeys(expected);
      if (left === null || !keys) return null;
      const found = keys.includes(left);
      return operator === 'in' ? found : !found;
    }
    case 'includes_any':
    case 'includes_all':
    case 'includes_none': {
      if (!Array.isArray(fact)) return null;
      const keys = listKeys(expected);
      if (!keys) return null;
      const present = new Set(fact.map(scalarKey));
      if (operator === 'includes_all')
        return keys.every((key) => present.has(key));
      const any = keys.some((key) => present.has(key));
      return operator === 'includes_any' ? any : !any;
    }
  }
}

function evaluateRule(facts: Facts, rule: EngineRule): RuleEvaluation {
  const known = facts[rule.field];
  const actual: FactValue = known === undefined ? null : known;
  const condition = evaluateCondition(actual, rule.operator, rule.value);
  let outcome: RuleOutcome;
  if (condition === null) outcome = 'DATO_FALTANTE';
  else if (rule.kind === 'EXCLUSION')
    outcome = condition ? 'EXCLUYE' : 'CUMPLE';
  else outcome = condition ? 'CUMPLE' : 'NO_CUMPLE';
  const blocking =
    outcome === 'EXCLUYE' ||
    ((outcome === 'NO_CUMPLE' || outcome === 'DATO_FALTANTE') &&
      rule.kind !== 'PREFERENCIA');
  return {
    ruleId: rule.id,
    position: rule.position,
    kind: rule.kind,
    field: rule.field,
    operator: rule.operator,
    expected: rule.value,
    actual,
    outcome,
    blocking,
    weight: rule.weight,
    label: rule.label,
    internal: rule.internal,
    exceptionAllowed: rule.exceptionAllowed,
    exceptionApprovalLevel: rule.exceptionApprovalLevel,
  };
}

/**
 * Evaluates a whole policy.
 *
 * - REQUISITO: must hold. Not met or unknown fact → blocking gap.
 * - EXCLUSION: describes the rejection cause. Holds → EXCLUIDO; unknown fact →
 *   blocking gap (it cannot be ruled out).
 * - PREFERENCIA: adds its weight to the fit when met; never blocks.
 *
 * Fit = weight of satisfied rules / weight of all rules (an exclusion is
 * satisfied when it is ruled out). An excluded product always has fit 0.
 */
export function evaluatePolicy(
  facts: Facts,
  rules: readonly EngineRule[],
): MatchEvaluation {
  const ordered = [...rules].sort(
    (a, b) =>
      a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const evaluations = ordered.map((rule) => evaluateRule(facts, rule));
  const passed = evaluations.filter((item) => item.outcome === 'CUMPLE');
  const exclusions = evaluations.filter((item) => item.outcome === 'EXCLUYE');
  const gaps = evaluations.filter(
    (item) => item.outcome === 'NO_CUMPLE' || item.outcome === 'DATO_FALTANTE',
  );
  const blockingGaps = gaps.filter((item) => item.blocking);
  const status: MatchStatusName = exclusions.length
    ? 'EXCLUIDO'
    : blockingGaps.length
      ? 'CON_BRECHAS'
      : 'ELEGIBLE';
  const weightTotal = evaluations.reduce((sum, item) => sum + item.weight, 0);
  const weightMet = passed.reduce((sum, item) => sum + item.weight, 0);
  const fitPercent =
    status === 'EXCLUIDO'
      ? 0
      : weightTotal === 0
        ? 100
        : Math.round((weightMet * 100) / weightTotal);
  const exceptionOnly =
    status === 'CON_BRECHAS' &&
    blockingGaps.every(
      (item) => item.outcome === 'NO_CUMPLE' && item.exceptionAllowed,
    );
  return {
    engineVersion: MATCH_ENGINE_VERSION,
    status,
    fitPercent,
    presentable: status === 'ELEGIBLE' || exceptionOnly,
    requiresException: exceptionOnly,
    exceptionApprovalLevels: exceptionOnly
      ? [
          ...new Set(
            blockingGaps.map((item) => item.exceptionApprovalLevel ?? 'RISK'),
          ),
        ].sort()
      : [],
    totals: {
      rules: evaluations.length,
      passed: passed.length,
      gaps: gaps.length,
      blockingGaps: blockingGaps.length,
      missingData: gaps.filter((item) => item.outcome === 'DATO_FALTANTE')
        .length,
      exclusions: exclusions.length,
      weightTotal,
      weightMet,
    },
    passed,
    gaps,
    exclusions,
  };
}

export type StoredRuleEvaluation = Omit<RuleEvaluation, 'actual'>;
export interface StoredExplanation {
  totals: MatchEvaluation['totals'];
  requiresException: boolean;
  exceptionApprovalLevels: string[];
  passed: StoredRuleEvaluation[];
  gaps: StoredRuleEvaluation[];
  exclusions: StoredRuleEvaluation[];
}

/**
 * What is persisted with a result: the structured explanation WITHOUT the
 * person's values. Those stay only inside the encrypted fact snapshot.
 */
export function storedExplanation(
  evaluation: MatchEvaluation,
): StoredExplanation {
  const strip = (item: RuleEvaluation): StoredRuleEvaluation => {
    const { actual: _actual, ...rest } = item;
    void _actual;
    return rest;
  };
  return {
    totals: evaluation.totals,
    requiresException: evaluation.requiresException,
    exceptionApprovalLevels: evaluation.exceptionApprovalLevels,
    passed: evaluation.passed.map(strip),
    gaps: evaluation.gaps.map(strip),
    exclusions: evaluation.exclusions.map(strip),
  };
}

export const INTERNAL_RULE_LABEL = 'Criterio interno de la entidad';

export interface ExplainedRule {
  ruleId: string;
  kind: RuleKindName;
  outcome: RuleOutcome;
  blocking: boolean;
  internal: boolean;
  label: string;
  message: string;
  field: string | null;
  fieldLabel: string | null;
  operator: string | null;
  expected: unknown;
  expectedText: string | null;
  actual: FactValue;
  actualText: string | null;
  weight: number | null;
  exceptionAllowed: boolean;
  exceptionApprovalLevel: string | null;
  completeHref: string | null;
}

type Explainable = StoredRuleEvaluation & { actual?: FactValue };

function message(item: Explainable, withActual: boolean): string {
  const definition = factField(item.field);
  const condition = describeCondition({
    field: item.field,
    operator: item.operator,
    value: item.expected,
  });
  const fieldLabel = definition?.label ?? item.field;
  const actualText =
    withActual && definition && item.actual !== undefined
      ? formatFactValue(definition, item.actual)
      : null;
  if (item.outcome === 'DATO_FALTANTE')
    return `Dato faltante: ${fieldLabel}. Sin este dato no es posible evaluar el criterio.`;
  if (item.kind === 'EXCLUSION')
    return item.outcome === 'EXCLUYE'
      ? `Causal de exclusión de la entidad: ${condition}.`
      : `No aplica la causal de exclusión: ${condition}.`;
  if (item.outcome === 'CUMPLE') return `Cumple: ${condition}.`;
  const base = `No cumple: se requiere ${condition}`;
  const suffix = actualText ? `; el dato registrado es ${actualText}.` : '.';
  const exception =
    item.kind === 'REQUISITO' && item.exceptionAllowed
      ? ` La entidad admite excepción (aprueba: ${
          EXCEPTION_LEVEL_LABELS[
            (item.exceptionApprovalLevel ?? 'RISK') as ExceptionLevel
          ] ?? item.exceptionApprovalLevel
        }).`
      : '';
  return `${base}${suffix}${exception}`;
}

/**
 * Turns an evaluation into the explanation shown to a given audience.
 *
 * - `user`: rules marked `internal` keep only their outcome; field, operator,
 *   threshold and value are hidden behind "Criterio interno de la entidad".
 * - `staff`: full rule detail, but never the person's values (`actual`).
 */
export function explainRule(
  item: Explainable,
  audience: 'user' | 'staff',
): ExplainedRule {
  const definition = factField(item.field);
  const hidden = audience === 'user' && item.internal;
  const withActual = audience === 'user' && !hidden;
  if (hidden)
    return {
      ruleId: item.ruleId,
      kind: item.kind,
      outcome: item.outcome,
      blocking: item.blocking,
      internal: true,
      label: INTERNAL_RULE_LABEL,
      message:
        item.outcome === 'CUMPLE'
          ? 'Cumples un criterio interno de la entidad.'
          : item.outcome === 'EXCLUYE'
            ? 'La entidad aplica un criterio interno que descarta este producto.'
            : 'Hay un criterio interno de la entidad que no se pudo dar por cumplido.',
      field: null,
      fieldLabel: null,
      operator: null,
      expected: null,
      expectedText: null,
      actual: null,
      actualText: null,
      weight: null,
      exceptionAllowed: false,
      exceptionApprovalLevel: null,
      completeHref: null,
    };
  const actual = withActual ? (item.actual ?? null) : null;
  return {
    ruleId: item.ruleId,
    kind: item.kind,
    outcome: item.outcome,
    blocking: item.blocking,
    internal: item.internal,
    label: item.label,
    message: message(item, withActual),
    field: item.field,
    fieldLabel: definition?.label ?? item.field,
    operator: item.operator,
    expected: item.expected,
    expectedText: definition
      ? formatFactValue(definition, item.expected)
      : null,
    actual,
    actualText:
      withActual && definition ? formatFactValue(definition, actual) : null,
    weight: audience === 'staff' ? item.weight : null,
    exceptionAllowed: item.exceptionAllowed,
    exceptionApprovalLevel: item.exceptionApprovalLevel,
    completeHref:
      item.outcome === 'DATO_FALTANTE'
        ? (definition?.completeHref ?? null)
        : null,
  };
}

export function explain(
  source: {
    passed: Explainable[];
    gaps: Explainable[];
    exclusions: Explainable[];
  },
  audience: 'user' | 'staff',
) {
  return {
    passed: source.passed.map((item) => explainRule(item, audience)),
    gaps: source.gaps.map((item) => explainRule(item, audience)),
    exclusions: source.exclusions.map((item) => explainRule(item, audience)),
  };
}

/** One-line reading of a result. Never promises an approval. */
export function headline(
  status: MatchStatusName,
  requiresException: boolean,
): string {
  if (status === 'ELEGIBLE')
    return 'Cumples los criterios que la entidad publicó para este producto. La decisión final es de la entidad.';
  if (status === 'EXCLUIDO')
    return 'La política vigente de la entidad descarta este producto para tu perfil actual.';
  return requiresException
    ? 'Hay criterios que no cumples, pero la entidad admite estudiarlos como excepción.'
    : 'Aún hay criterios por cumplir o datos por completar para este producto.';
}

/** Parses the rule copy stored with a result or a backtest. */
export function rulesFromSnapshot(value: unknown): EngineRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) =>
    item && typeof item === 'object' && typeof item.field === 'string'
      ? [
          {
            id: String(item.id ?? ''),
            position: Number(item.position ?? 0),
            field: item.field as string,
            operator: String(item.operator ?? ''),
            value: item.value as unknown,
            kind: (['REQUISITO', 'EXCLUSION', 'PREFERENCIA'].includes(item.kind)
              ? item.kind
              : 'REQUISITO') as RuleKindName,
            weight: Number.isInteger(item.weight) ? (item.weight as number) : 1,
            label: String(item.label ?? ''),
            internal: Boolean(item.internal),
            exceptionAllowed: Boolean(item.exceptionAllowed),
            exceptionApprovalLevel:
              typeof item.exceptionApprovalLevel === 'string'
                ? (item.exceptionApprovalLevel as string)
                : null,
          },
        ]
      : [],
  );
}
