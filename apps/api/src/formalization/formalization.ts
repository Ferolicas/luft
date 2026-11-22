import { z } from 'zod';

/**
 * Pure state machine of the assisted tax formalization case:
 * sin_evaluar → no_requiere → posible_obligación →
 * documento_cargado | preparación_guiada → revisión → presentado → verificado.
 * The diagnosis is an alert; only a professional review produces evidence.
 */

export const FORMALIZATION_STATUSES = [
  'SIN_EVALUAR',
  'NO_REQUIERE',
  'POSIBLE_OBLIGACION',
  'DOCUMENTO_CARGADO',
  'PREPARACION_GUIADA',
  'REVISION',
  'PRESENTADO',
  'VERIFICADO',
] as const;
export type FormalizationStatus = (typeof FORMALIZATION_STATUSES)[number];

export const FORMALIZATION_LABELS: Record<FormalizationStatus, string> = {
  SIN_EVALUAR: 'Sin evaluar',
  NO_REQUIERE: 'No requiere declarar',
  POSIBLE_OBLIGACION: 'Posible obligación',
  DOCUMENTO_CARGADO: 'Declaración cargada',
  PREPARACION_GUIADA: 'Preparación guiada',
  REVISION: 'En revisión profesional',
  PRESENTADO: 'Presentada',
  VERIFICADO: 'Verificada',
};

const TRANSITIONS: Record<FormalizationStatus, FormalizationStatus[]> = {
  SIN_EVALUAR: ['NO_REQUIERE', 'POSIBLE_OBLIGACION'],
  NO_REQUIERE: [
    'POSIBLE_OBLIGACION',
    'DOCUMENTO_CARGADO',
    'PREPARACION_GUIADA',
  ],
  POSIBLE_OBLIGACION: [
    'NO_REQUIERE',
    'DOCUMENTO_CARGADO',
    'PREPARACION_GUIADA',
  ],
  DOCUMENTO_CARGADO: ['REVISION', 'PREPARACION_GUIADA', 'POSIBLE_OBLIGACION'],
  PREPARACION_GUIADA: ['REVISION', 'DOCUMENTO_CARGADO'],
  REVISION: ['PRESENTADO', 'DOCUMENTO_CARGADO', 'PREPARACION_GUIADA'],
  PRESENTADO: ['VERIFICADO', 'REVISION'],
  VERIFICADO: [],
};

export function canTransition(
  from: FormalizationStatus,
  to: FormalizationStatus,
) {
  return TRANSITIONS[from].includes(to);
}

export function isFormalizationStatus(
  value: unknown,
): value is FormalizationStatus {
  return FORMALIZATION_STATUSES.includes(value as FormalizationStatus);
}

/**
 * The four moments the product must tell apart: a draft owned by the user, the
 * professional review, the signature/filing, and the verified evidence.
 */
export type FormalizationPhase =
  | 'DIAGNOSIS'
  | 'DRAFT'
  | 'REVIEW'
  | 'SIGNATURE_AND_FILING'
  | 'VERIFIED_EVIDENCE';

export function phaseOf(
  status: FormalizationStatus,
  reviewApproved: boolean,
): FormalizationPhase {
  if (status === 'VERIFICADO') return 'VERIFIED_EVIDENCE';
  if (status === 'PRESENTADO') return 'SIGNATURE_AND_FILING';
  if (status === 'REVISION')
    return reviewApproved ? 'SIGNATURE_AND_FILING' : 'REVIEW';
  if (['DOCUMENTO_CARGADO', 'PREPARACION_GUIADA'].includes(status))
    return 'DRAFT';
  return 'DIAGNOSIS';
}

/** A fresh diagnosis only moves cases that the user has not started working on. */
export function statusAfterDiagnosis(
  current: FormalizationStatus,
  check: { ready: boolean; available: boolean; mayHaveToFile: boolean },
): FormalizationStatus {
  if (!['SIN_EVALUAR', 'NO_REQUIERE', 'POSIBLE_OBLIGACION'].includes(current))
    return current;
  if (!check.available || !check.ready) return current;
  return check.mayHaveToFile ? 'POSIBLE_OBLIGACION' : 'NO_REQUIERE';
}

/** The formalization step of the route is settled in these states. */
export function formalizationSettled(status: FormalizationStatus) {
  return status === 'NO_REQUIERE' || status === 'VERIFICADO';
}

export const taxAnswersSchema = z.object({
  incomes: z
    .array(z.enum(['SALARIO', 'HONORARIOS', 'ARRIENDOS', 'INTERESES']))
    .max(4),
  holdings: z
    .array(z.enum(['VIVIENDA', 'VEHICULO', 'INVERSIONES', 'HIPOTECA']))
    .max(4),
  deductions: z
    .array(
      z.enum([
        'PERSONAS_A_CARGO',
        'PREPAGADA',
        'PENSION_VOLUNTARIA',
        'CUENTA_AFC',
      ]),
    )
    .max(4),
});
export type TaxAnswers = z.infer<typeof taxAnswersSchema>;

export type UserAction =
  | 'DIAGNOSE'
  | 'ANSWER_FILED'
  | 'UPLOAD_DECLARATION'
  | 'UPLOAD_SUPPORT'
  | 'SAVE_PREPARATION'
  | 'SUBMIT_FOR_REVIEW'
  | 'DELETE_DOCUMENT';

export interface CaseFacts {
  status: FormalizationStatus;
  hasConsent: boolean;
  declarationDocuments: number;
  preparationReady: boolean;
}

/** What the user may do next; the interface renders exactly these actions. */
export function userActions(facts: CaseFacts): UserAction[] {
  const { status } = facts;
  if (status === 'SIN_EVALUAR') return ['DIAGNOSE'];
  const actions: UserAction[] = [];
  if (['NO_REQUIERE', 'POSIBLE_OBLIGACION'].includes(status))
    actions.push('DIAGNOSE', 'ANSWER_FILED');
  if (
    [
      'NO_REQUIERE',
      'POSIBLE_OBLIGACION',
      'DOCUMENTO_CARGADO',
      'PREPARACION_GUIADA',
    ].includes(status)
  ) {
    if (facts.hasConsent) actions.push('UPLOAD_DECLARATION', 'UPLOAD_SUPPORT');
    actions.push('SAVE_PREPARATION');
  }
  if (['DOCUMENTO_CARGADO', 'PREPARACION_GUIADA'].includes(status))
    actions.push('DELETE_DOCUMENT');
  if (
    facts.hasConsent &&
    ((status === 'DOCUMENTO_CARGADO' && facts.declarationDocuments > 0) ||
      (status === 'PREPARACION_GUIADA' && facts.preparationReady))
  )
    actions.push('SUBMIT_FOR_REVIEW');
  return actions;
}

export type StaffAction = 'OBSERVE' | 'APPROVE' | 'MARK_FILED' | 'VERIFY';

/** Queue actions for LEGAL / FINANCE / SUPERADMIN. */
export function staffActions(
  status: FormalizationStatus,
  reviewApproved: boolean,
): StaffAction[] {
  if (status === 'REVISION')
    return reviewApproved ? ['OBSERVE', 'MARK_FILED'] : ['OBSERVE', 'APPROVE'];
  if (status === 'PRESENTADO') return ['OBSERVE', 'VERIFY'];
  return [];
}

/** Where an observed case goes back to, so the user can fix it. */
export function statusAfterObservation(
  status: FormalizationStatus,
  path: string | null,
): FormalizationStatus {
  if (status === 'PRESENTADO') return 'REVISION';
  return path === 'UPLOAD' ? 'DOCUMENTO_CARGADO' : 'PREPARACION_GUIADA';
}

export function preparationReady(preparation: unknown): boolean {
  const parsed = taxAnswersSchema.safeParse(preparation);
  return parsed.success && parsed.data.incomes.length > 0;
}

export const taxRuleInputSchema = z
  .object({
    taxYear: z.coerce.number().int().min(2020).max(2100),
    uvtCOP: z.coerce.number().int().min(1_000).max(1_000_000),
    wealthUvt: z.coerce.number().int().min(1).max(1_000_000),
    incomeUvt: z.coerce.number().int().min(1).max(1_000_000),
    cardSpendUvt: z.coerce.number().int().min(1).max(1_000_000),
    purchasesUvt: z.coerce.number().int().min(1).max(1_000_000),
    depositsUvt: z.coerce.number().int().min(1).max(1_000_000),
    sourceDocument: z.string().trim().min(10).max(2_000),
    sourceUrl: z.string().url().max(500).optional(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional(),
    notes: z.string().trim().max(2_000).optional(),
  })
  .refine(
    (rule) => !rule.effectiveTo || rule.effectiveTo >= rule.effectiveFrom,
    {
      path: ['effectiveTo'],
      message: 'La fecha final debe ser posterior a la inicial.',
    },
  );

export const TAX_RULE_STATUSES = [
  'DRAFT',
  'APPROVED',
  'ACTIVE',
  'SUPERSEDED',
] as const;
export type TaxRuleStatus = (typeof TAX_RULE_STATUSES)[number];
