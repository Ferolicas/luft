import {
  FACT_FIELDS,
  factField,
  formatFactValue,
  type Facts,
  type FactValue,
} from './fact-catalog';
import type { EngineRule, MatchStatusName } from './rule-engine';

/**
 * Pure rules for presenting a person to a financial institution: what the
 * person authorizes, what the institution may see, who may move a
 * presentation and the aggregated ally funnel.
 */

export const AUTHORIZATION_VERSION = '2026-11-22';

export const PRESENTATION_STATUSES = [
  'AUTORIZADA',
  'REVOCADA',
  'PRESENTADA',
  'APROBADA',
  'RECHAZADA',
  'DESISTIDA',
] as const;
export type PresentationStatusName = (typeof PRESENTATION_STATUSES)[number];

export const PRESENTATION_STATUS_LABELS: Record<
  PresentationStatusName,
  string
> = {
  AUTORIZADA: 'Autorizada',
  REVOCADA: 'Autorización revocada',
  PRESENTADA: 'Presentada a la entidad',
  APROBADA: 'Aprobada por la entidad',
  RECHAZADA: 'Rechazada por la entidad',
  DESISTIDA: 'Desistida',
};

export const IDENTITY_SCOPE = [
  { key: 'fullName', label: 'Nombre completo' },
  { key: 'document', label: 'Número de documento de identidad' },
  { key: 'phone', label: 'Teléfono de contacto' },
  { key: 'email', label: 'Correo electrónico' },
] as const;

export interface AuthorizationScope {
  identity: Array<{ key: string; label: string }>;
  facts: Array<{ key: string; label: string }>;
  match: Array<{ key: string; label: string }>;
}

/**
 * The data shared with the institution is limited to contact data, the facts
 * the policy of THAT product evaluates and the match outcome. Nothing else
 * from the profile leaves LUFT.
 */
export function authorizationScope(
  rules: ReadonlyArray<Pick<EngineRule, 'field'>>,
): AuthorizationScope {
  const used = new Set(rules.map((rule) => rule.field));
  return {
    identity: IDENTITY_SCOPE.map((item) => ({ ...item })),
    facts: FACT_FIELDS.filter((item) => used.has(item.key)).map((item) => ({
      key: item.key,
      label: item.label,
    })),
    match: [
      {
        key: 'fit',
        label: 'Resultado del encaje con la política de la entidad',
      },
    ],
  };
}

export function authorizationText(input: {
  institutionName: string;
  productName: string;
  scope: AuthorizationScope;
}): string {
  const data = [
    ...input.scope.identity,
    ...input.scope.facts,
    ...input.scope.match,
  ]
    .map((item) => item.label.toLowerCase())
    .join('; ');
  return [
    `Autorizo de manera previa, expresa e informada a Tureporte S.A.S., responsable de LUFT, para presentar ante ${input.institutionName} mi interés en el producto «${input.productName}» y compartirle únicamente estos datos: ${data}.`,
    `La finalidad exclusiva es que ${input.institutionName} evalúe ese producto para mí. No se compartirá ningún otro dato de mi perfil ni se usará para otra finalidad.`,
    'Entiendo que esta autorización no es una aprobación ni garantiza un resultado: la decisión corresponde únicamente a la entidad.',
    'Puedo revocar esta autorización mientras mis datos no hayan sido presentados y, después de presentados, puedo desistir del proceso. El tratamiento de mis datos se rige por la política publicada en https://restaurar.co/privacy.',
  ].join(' ');
}

export interface SharedData {
  applicant: {
    fullName: string;
    document: string;
    phone: string;
    email: string;
  };
  facts: Array<{
    key: string;
    label: string;
    value: FactValue;
    display: string;
  }>;
  match: {
    status: MatchStatusName;
    fitPercent: number;
    policyVersion: number;
    evaluatedAt: string;
    requiresException: boolean;
  };
}

/** Builds exactly the authorized payload — nothing outside the scope. */
export function sharedData(input: {
  scope: AuthorizationScope;
  applicant: SharedData['applicant'];
  facts: Facts;
  match: SharedData['match'];
}): SharedData {
  return {
    applicant: {
      fullName: input.applicant.fullName,
      document: input.applicant.document,
      phone: input.applicant.phone,
      email: input.applicant.email,
    },
    facts: input.scope.facts.map((item) => {
      const definition = factField(item.key);
      const value = input.facts[item.key] ?? null;
      return {
        key: item.key,
        label: item.label,
        value,
        display: definition ? formatFactValue(definition, value) : 'sin dato',
      };
    }),
    match: input.match,
  };
}

export type PresentationAction = 'revoke' | 'present' | 'decide';
export type PresentationActor = 'USER' | 'STAFF' | 'INSTITUTION';

/**
 * `AUTORIZADA → PRESENTADA → APROBADA | RECHAZADA | DESISTIDA`.
 * The person can revoke before presentation (→ REVOCADA) and withdraw
 * afterwards (→ DESISTIDA). "Presentada" is always marked by LUFT staff: no
 * banking integration is simulated.
 */
export function nextPresentationStatus(input: {
  from: PresentationStatusName;
  action: PresentationAction;
  actor: PresentationActor;
  decision?: 'APROBADA' | 'RECHAZADA' | 'DESISTIDA';
}): PresentationStatusName | null {
  const { from, action, actor } = input;
  if (action === 'revoke') {
    if (actor !== 'USER') return null;
    if (from === 'AUTORIZADA') return 'REVOCADA';
    return from === 'PRESENTADA' ? 'DESISTIDA' : null;
  }
  if (action === 'present')
    return actor === 'STAFF' && from === 'AUTORIZADA' ? 'PRESENTADA' : null;
  if (actor === 'USER' || from !== 'PRESENTADA' || !input.decision) return null;
  return input.decision;
}

/** Statuses an institution can see: only what LUFT already presented to it. */
export const INSTITUTION_VISIBLE_STATUSES: PresentationStatusName[] = [
  'PRESENTADA',
  'APROBADA',
  'RECHAZADA',
  'DESISTIDA',
];

/** Personal data stays visible only while the institution needs it. */
export function institutionCanSeeApplicant(
  status: PresentationStatusName,
): boolean {
  return status === 'PRESENTADA' || status === 'APROBADA';
}

export function institutionCanAccess(input: {
  presentationInstitutionId: string;
  linkInstitutionId: string | null;
  status: PresentationStatusName;
}): boolean {
  return (
    input.linkInstitutionId !== null &&
    input.linkInstitutionId === input.presentationInstitutionId &&
    INSTITUTION_VISIBLE_STATUSES.includes(input.status)
  );
}

const LEVEL_RANK: Record<string, number> = { RISK: 1, SUPERADMIN: 2 };

/**
 * Internal exception approval. `INSTITUTION` level means the entity decides
 * the exception in its own decision, so no internal approval is needed.
 */
export function canApproveException(
  actorRole: string,
  levels: readonly string[],
): boolean {
  const required = Math.max(
    0,
    ...levels.map((level) => LEVEL_RANK[level] ?? 0),
  );
  return required === 0 || (LEVEL_RANK[actorRole] ?? 0) >= required;
}

export const ALLY_FUNNEL_STAGES = [
  { key: 'referred', label: 'Personas referidas' },
  { key: 'verified', label: 'Cuenta verificada' },
  { key: 'diagnosed', label: 'Diagnóstico inicial' },
  { key: 'profileCompleted', label: 'Perfil financiero completo' },
  { key: 'creditApplied', label: 'Solicitud de crédito constructor' },
  { key: 'creditActive', label: 'Crédito constructor activo o terminado' },
  { key: 'matched', label: 'Matching ejecutado' },
  { key: 'authorized', label: 'Presentación autorizada' },
  { key: 'presented', label: 'Presentada a una entidad' },
  { key: 'approved', label: 'Aprobada por una entidad' },
] as const;
export type AllyFunnelKey = (typeof ALLY_FUNNEL_STAGES)[number]['key'];

/** Below this many referrals the breakdown could single out a person. */
export const ALLY_FUNNEL_MIN_GROUP = 5;

/**
 * Aggregated funnel for an ally: counts only, never identifiers. With fewer
 * than `ALLY_FUNNEL_MIN_GROUP` referrals only the total is shown.
 */
export function allyFunnelView(counts: Record<AllyFunnelKey, number>) {
  const suppressed = counts.referred < ALLY_FUNNEL_MIN_GROUP;
  return {
    suppressed,
    minimumGroup: ALLY_FUNNEL_MIN_GROUP,
    stages: ALLY_FUNNEL_STAGES.map((stage) => ({
      key: stage.key,
      label: stage.label,
      count:
        suppressed && stage.key !== 'referred'
          ? null
          : Math.min(counts[stage.key], counts.referred),
    })),
    note: suppressed
      ? `El detalle del embudo se muestra a partir de ${ALLY_FUNNEL_MIN_GROUP} personas referidas para proteger su privacidad.`
      : 'Cifras agregadas. No incluyen datos personales de las personas referidas.',
  };
}
