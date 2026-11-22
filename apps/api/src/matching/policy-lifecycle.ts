import { ruleIssues, type RuleShape } from './fact-catalog';

/**
 * Pure lifecycle rules of a policy version:
 * `BORRADOR → REVISION → APROBADA → VIGENTE → SUSTITUIDA | SUSPENDIDA`.
 */

export const POLICY_STATUSES = [
  'BORRADOR',
  'REVISION',
  'APROBADA',
  'VIGENTE',
  'SUSTITUIDA',
  'SUSPENDIDA',
] as const;
export type PolicyStatusName = (typeof POLICY_STATUSES)[number];

export const POLICY_STATUS_LABELS: Record<PolicyStatusName, string> = {
  BORRADOR: 'Borrador',
  REVISION: 'En revisión',
  APROBADA: 'Aprobada',
  VIGENTE: 'Vigente',
  SUSTITUIDA: 'Sustituida',
  SUSPENDIDA: 'Suspendida',
};

/** Transitions a person can request. SUSTITUIDA is only set by the system. */
const MANUAL_TRANSITIONS: Record<PolicyStatusName, PolicyStatusName[]> = {
  BORRADOR: ['REVISION'],
  REVISION: ['BORRADOR', 'APROBADA'],
  APROBADA: ['VIGENTE', 'BORRADOR'],
  VIGENTE: ['SUSPENDIDA'],
  SUSPENDIDA: ['VIGENTE'],
  SUSTITUIDA: [],
};

export function allowedTransitions(from: PolicyStatusName): PolicyStatusName[] {
  return MANUAL_TRANSITIONS[from] ?? [];
}

export function canTransition(
  from: PolicyStatusName,
  to: PolicyStatusName,
  options: { system?: boolean } = {},
): boolean {
  if (options.system && from === 'VIGENTE' && to === 'SUSTITUIDA') return true;
  return allowedTransitions(from).includes(to);
}

/** Rules and metadata can only change while the version is a draft. */
export function isEditable(status: PolicyStatusName): boolean {
  return status === 'BORRADOR';
}

export const TRANSITION_ACTIONS: Record<string, string> = {
  'BORRADOR>REVISION': 'submitted',
  'REVISION>BORRADOR': 'returned',
  'REVISION>APROBADA': 'approved',
  'APROBADA>VIGENTE': 'activated',
  'APROBADA>BORRADOR': 'reopened',
  'VIGENTE>SUSPENDIDA': 'suspended',
  'SUSPENDIDA>VIGENTE': 'reactivated',
  'VIGENTE>SUSTITUIDA': 'superseded',
};

export function transitionAction(
  from: PolicyStatusName,
  to: PolicyStatusName,
): string {
  return TRANSITION_ACTIONS[`${from}>${to}`] ?? 'changed';
}

/** What is still missing before a draft can be sent to review. */
export function submissionIssues(
  version: { sourceDocument: string | null },
  rules: readonly RuleShape[],
): string[] {
  const issues: string[] = [];
  if (!version.sourceDocument?.trim())
    issues.push('Registra la fuente documental de la política.');
  if (rules.length === 0) issues.push('Agrega al menos una regla.');
  rules.forEach((rule, index) => {
    for (const issue of ruleIssues(rule))
      issues.push(`Regla ${index + 1}: ${issue}`);
  });
  return issues;
}

export type ApprovalIndependence =
  'OTRO_ROL' | 'OTRA_PERSONA' | 'MISMA_PERSONA';

/**
 * Four-eyes rule. Whoever drafted or last edited a version should not approve
 * it. It is only waived when nobody else can approve, and that is recorded.
 */
export function approvalCheck(input: {
  authorIds: readonly string[];
  authorRole: string | null;
  approverId: string;
  approverRole: string;
  otherApproversAvailable: boolean;
}): { allowed: boolean; independence: ApprovalIndependence } {
  if (input.authorIds.includes(input.approverId))
    return {
      allowed: !input.otherApproversAvailable,
      independence: 'MISMA_PERSONA',
    };
  return {
    allowed: true,
    independence:
      input.authorRole && input.authorRole !== input.approverRole
        ? 'OTRO_ROL'
        : 'OTRA_PERSONA',
  };
}

const day = (value: Date | string) =>
  (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);

/** A version applies today only if it is VIGENTE and inside its validity window. */
export function isInForce(
  version: {
    status: string;
    effectiveFrom: Date | string | null;
    effectiveTo: Date | string | null;
  },
  today: Date | string,
): boolean {
  if (version.status !== 'VIGENTE' || !version.effectiveFrom) return false;
  const now = day(today);
  if (day(version.effectiveFrom) > now) return false;
  return !version.effectiveTo || day(version.effectiveTo) >= now;
}
