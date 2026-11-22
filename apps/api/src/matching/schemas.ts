import { z } from 'zod';
import {
  describeCondition,
  EXCEPTION_LEVELS,
  FACT_KEYS,
  OPERATORS,
  RULE_KINDS,
  ruleIssues,
} from './fact-catalog';
import { POLICY_STATUSES } from './policy-lifecycle';
import { copSchema, isRealDay, uuidSchema } from './validation';

/** zod schemas of the matching module (pure; no database access). */

export const INSTITUTION_KINDS = [
  'BANCO',
  'COMPANIA_FINANCIAMIENTO',
  'COOPERATIVA',
  'FINTECH',
  'MICROFINANCIERA',
  'FONDO_EMPLEADOS',
  'CAJA_COMPENSACION',
  'OTRA',
] as const;

export const PRODUCT_KINDS = [
  'LIBRE_INVERSION',
  'TARJETA_CREDITO',
  'VIVIENDA',
  'VEHICULO',
  'EDUCATIVO',
  'MICROCREDITO',
  'LIBRANZA',
  'OTRO',
] as const;

export const INSTITUTION_KIND_LABELS: Record<
  (typeof INSTITUTION_KINDS)[number],
  string
> = {
  BANCO: 'Banco',
  COMPANIA_FINANCIAMIENTO: 'Compañía de financiamiento',
  COOPERATIVA: 'Cooperativa',
  FINTECH: 'Fintech',
  MICROFINANCIERA: 'Microfinanciera',
  FONDO_EMPLEADOS: 'Fondo de empleados',
  CAJA_COMPENSACION: 'Caja de compensación',
  OTRA: 'Otra',
};

export const PRODUCT_KIND_LABELS: Record<
  (typeof PRODUCT_KINDS)[number],
  string
> = {
  LIBRE_INVERSION: 'Libre inversión',
  TARJETA_CREDITO: 'Tarjeta de crédito',
  VIVIENDA: 'Vivienda',
  VEHICULO: 'Vehículo',
  EDUCATIVO: 'Educativo',
  MICROCREDITO: 'Microcrédito',
  LIBRANZA: 'Libranza',
  OTRO: 'Otro',
};

/** Optional text: an empty string from a form means "no value". */
const optionalText = (max: number, min = 1) =>
  z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? null : value),
    z.string().trim().min(min).max(max).nullable().optional(),
  );
const optionalNumber = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    schema.nullable().optional(),
  );

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD.')
  .refine(isRealDay, 'La fecha no existe.');

const partnerContact = {
  taxId: z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? null : value),
    z
      .string()
      .trim()
      .regex(/^\d{6,12}(-\d)?$/, 'NIT inválido. Ejemplo: 900123456-7.')
      .nullable()
      .optional(),
  ),
  contactName: optionalText(160, 2),
  contactEmail: z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? null : value),
    z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  ),
  contactPhone: z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? null : value),
    z
      .string()
      .trim()
      .regex(/^\+?[0-9 ]{7,20}$/, 'Teléfono inválido.')
      .nullable()
      .optional(),
  ),
};

export const institutionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(INSTITUTION_KINDS),
  ...partnerContact,
  website: z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? null : value),
    z.string().trim().url().max(500).nullable().optional(),
  ),
  notes: optionalText(4_000),
  active: z.boolean().optional(),
});
export const institutionPatchSchema = institutionSchema.partial();

const stringList = (maxItems: number) =>
  z.array(z.string().trim().min(2).max(160)).max(maxItems);

const productFields = {
  name: z.string().trim().min(2).max(160),
  kind: z.enum(PRODUCT_KINDS),
  description: optionalText(4_000),
  minAmountCOP: optionalNumber(copSchema),
  maxAmountCOP: optionalNumber(copSchema),
  minTermMonths: optionalNumber(z.coerce.number().int().min(1).max(480)),
  maxTermMonths: optionalNumber(z.coerce.number().int().min(1).max(480)),
  /** Annual effective rate as a fraction: 0.285 = 28,5% E.A. */
  referenceRateEA: optionalNumber(z.coerce.number().min(0).max(5)),
  guarantees: stringList(20).optional(),
  requiredDocuments: stringList(30).optional(),
  channel: optionalText(80),
  /** Commission as a fraction of the disbursed amount: 0.02 = 2%. */
  commissionPercent: optionalNumber(z.coerce.number().min(0).max(1)),
  commissionNotes: optionalText(2_000),
  agreementReference: optionalText(160),
  active: z.boolean().optional(),
};

const rangesAreOrdered = (
  value: {
    minAmountCOP?: number | null;
    maxAmountCOP?: number | null;
    minTermMonths?: number | null;
    maxTermMonths?: number | null;
  },
  context: z.RefinementCtx,
) => {
  if (
    value.minAmountCOP != null &&
    value.maxAmountCOP != null &&
    value.minAmountCOP > value.maxAmountCOP
  )
    context.addIssue({
      code: 'custom',
      path: ['maxAmountCOP'],
      message: 'El monto máximo debe ser mayor o igual al mínimo.',
    });
  if (
    value.minTermMonths != null &&
    value.maxTermMonths != null &&
    value.minTermMonths > value.maxTermMonths
  )
    context.addIssue({
      code: 'custom',
      path: ['maxTermMonths'],
      message: 'El plazo máximo debe ser mayor o igual al mínimo.',
    });
};

export const productSchema = z
  .object({ institutionId: uuidSchema, ...productFields })
  .superRefine(rangesAreOrdered);
export const productPatchSchema = z.object(productFields).partial();

export const ruleSchema = z
  .object({
    field: z.enum(FACT_KEYS as [string, ...string[]]),
    operator: z.enum(OPERATORS),
    value: z.unknown(),
    kind: z.enum(RULE_KINDS),
    weight: z.coerce.number().int().min(1).max(100).default(1),
    label: optionalText(200, 3),
    internal: z.boolean().default(false),
    exceptionAllowed: z.boolean().default(false),
    exceptionApprovalLevel: z.enum(EXCEPTION_LEVELS).nullable().optional(),
  })
  .superRefine((rule, context) => {
    for (const message of ruleIssues(rule))
      context.addIssue({ code: 'custom', path: ['value'], message });
    if (rule.exceptionAllowed && rule.kind !== 'REQUISITO')
      context.addIssue({
        code: 'custom',
        path: ['exceptionAllowed'],
        message: 'Solo un requisito puede admitir excepción.',
      });
  })
  .transform((rule) => ({
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
    kind: rule.kind,
    weight: rule.weight,
    label: rule.label ?? describeCondition(rule).slice(0, 200),
    internal: rule.internal,
    exceptionAllowed: rule.exceptionAllowed,
    exceptionApprovalLevel: rule.exceptionAllowed
      ? (rule.exceptionApprovalLevel ?? 'RISK')
      : null,
  }));
export type RuleInput = z.infer<typeof ruleSchema>;

export const rulesSchema = z.object({
  rules: z.array(ruleSchema).max(60),
});

const versionFields = {
  sourceDocument: z.string().trim().min(3).max(2_000),
  sourceUrl: z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? null : value),
    z.string().trim().url().max(1_000).nullable().optional(),
  ),
  notes: optionalText(4_000),
  responsibleUserId: uuidSchema.optional(),
  effectiveTo: dayString.nullable().optional(),
};

export const versionSchema = z.object({
  ...versionFields,
  rules: z.array(ruleSchema).max(60).optional(),
});
export const versionPatchSchema = z.object(versionFields).partial();

export const transitionSchema = z.object({
  to: z.enum(POLICY_STATUSES),
  note: optionalText(1_000, 3),
  effectiveFrom: dayString.optional(),
  effectiveTo: dayString.nullable().optional(),
});

export const simulateSchema = z.object({
  facts: z.record(
    z.string(),
    z.union([
      z.number(),
      z.string(),
      z.boolean(),
      z.array(z.string()).max(50),
      z.null(),
    ]),
  ),
});

export const allySchema = z.object({
  name: z.string().trim().min(2).max(160),
  ...partnerContact,
  active: z.boolean().optional(),
});
export const allyPatchSchema = allySchema.partial();

/** A staff member links an existing account by id or by e-mail. */
export const linkUserSchema = z
  .object({
    userId: uuidSchema.optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.email), {
    message: 'Envía userId o email (solo uno).',
  });

export const runSchema = z.object({
  requestedAmountCOP: optionalNumber(copSchema.min(1)),
  requestedTermMonths: optionalNumber(z.coerce.number().int().min(1).max(480)),
  productKinds: z.array(z.enum(PRODUCT_KINDS)).max(8).optional(),
});

export const authorizeSchema = z.object({
  accepted: z.literal(true),
  version: z.string().trim().min(1).max(32),
  textHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const presentSchema = z.object({
  channel: z.string().trim().min(2).max(80),
  note: optionalText(2_000),
  exceptionNote: optionalText(2_000, 5),
});

export const decisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('APROBADA'),
    approvedAmountCOP: copSchema.min(1),
    /** Annual effective rate as a fraction: 0.285 = 28,5% E.A. */
    approvedRateEA: z.coerce.number().min(0).max(5),
    approvedTermMonths: z.coerce.number().int().min(1).max(480),
    finalProductName: optionalText(160, 2),
    reason: optionalText(2_000),
  }),
  z.object({
    decision: z.literal('RECHAZADA'),
    reason: z.string().trim().min(5).max(2_000),
  }),
  z.object({
    decision: z.literal('DESISTIDA'),
    reason: z.string().trim().min(5).max(2_000),
  }),
]);
export type DecisionInput = z.infer<typeof decisionSchema>;
