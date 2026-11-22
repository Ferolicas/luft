/**
 * Reglas puras del producto de crédito parametrizado y versionado.
 * Las condiciones económicas viven en `CreditProduct`; aquí solo hay
 * validación de entrada, conversión de tipos y verificaciones de activación.
 */
import { z } from 'zod';
import { geometricAmounts, scheduleIsWellFormed } from './credit-calculator';
import {
  secondCreditPolicyPatchSchema,
  secondCreditPolicySchema,
} from './second-credit';

export const PRODUCT_CODES = ['BUILDER_1', 'BUILDER_2'] as const;
export type ProductCode = (typeof PRODUCT_CODES)[number];
export const productCodeSchema = z.enum(PRODUCT_CODES);

export const DISBURSEMENT_MODES = ['SERVICE_FINANCING', 'TRANSFER'] as const;
export type DisbursementMode = (typeof DISBURSEMENT_MODES)[number];

const cop = z.coerce.number().int().positive().max(1_000_000_000);

/**
 * Cuerpo para crear una versión nueva. Lo que no se envía se hereda de la
 * versión más reciente del mismo código; `null` borra el valor.
 */
export const productVersionInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    principalCOP: cop.nullable().optional(),
    minPrincipalCOP: cop.nullable().optional(),
    maxPrincipalCOP: cop.nullable().optional(),
    termMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
    monthlyRate: z.coerce.number().min(0).max(0.1).nullable().optional(),
    geometricDecrease: z.coerce.number().min(0).max(0.95).nullable().optional(),
    defaultAfterDays: z.coerce.number().int().min(1).max(360).optional(),
    requirements: secondCreditPolicyPatchSchema.optional(),
  })
  .strict();
export type ProductVersionInput = z.infer<typeof productVersionInputSchema>;

/** Condiciones de un producto en tipos simples (sin BigInt ni Decimal). */
export interface ProductTerms {
  code: string;
  version: number;
  name: string;
  purpose: string;
  sequence: number;
  principalCOP: number | null;
  minPrincipalCOP: number | null;
  maxPrincipalCOP: number | null;
  termMonths: number | null;
  monthlyRate: number | null;
  geometricDecrease: number | null;
  disbursementMode: string;
  defaultAfterDays: number;
  requirements: unknown;
  status: string;
}

const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** Convierte una fila de `CreditProduct` a tipos simples. */
export function productTerms(row: {
  code: string;
  version: number;
  name: string;
  purpose: string;
  sequence: number;
  principalCOP: unknown;
  minPrincipalCOP: unknown;
  maxPrincipalCOP: unknown;
  termMonths: number | null;
  monthlyRate: unknown;
  geometricDecrease: unknown;
  disbursementMode: string;
  defaultAfterDays: number;
  requirements: unknown;
  status: string;
}): ProductTerms {
  return {
    code: row.code,
    version: row.version,
    name: row.name,
    purpose: row.purpose,
    sequence: row.sequence,
    principalCOP: numberOrNull(row.principalCOP),
    minPrincipalCOP: numberOrNull(row.minPrincipalCOP),
    maxPrincipalCOP: numberOrNull(row.maxPrincipalCOP),
    termMonths: row.termMonths,
    monthlyRate: numberOrNull(row.monthlyRate),
    geometricDecrease: numberOrNull(row.geometricDecrease),
    disbursementMode: row.disbursementMode,
    defaultAfterDays: row.defaultAfterDays,
    requirements: row.requirements,
    status: row.status,
  };
}

export interface CompleteTerms extends ProductTerms {
  termMonths: number;
  monthlyRate: number;
  geometricDecrease: number;
}

/**
 * Qué le falta a una versión para poder quedar vigente. Lista vacía = lista
 * para activar. Nunca se completa con valores supuestos.
 */
export function activationIssues(terms: ProductTerms): string[] {
  const issues: string[] = [];
  const fixed = terms.principalCOP !== null;
  const hasMin = terms.minPrincipalCOP !== null;
  const hasMax = terms.maxPrincipalCOP !== null;
  if (fixed && (hasMin || hasMax))
    issues.push('Define un monto fijo o un rango, no ambos.');
  else if (!fixed && !(hasMin && hasMax))
    issues.push('Falta el monto: fijo (principalCOP) o rango mínimo y máximo.');
  else if (
    !fixed &&
    (terms.minPrincipalCOP as number) > (terms.maxPrincipalCOP as number)
  )
    issues.push('El monto mínimo no puede superar el máximo.');
  if (terms.termMonths === null) issues.push('Falta el plazo en meses.');
  if (terms.monthlyRate === null) issues.push('Falta la tasa mensual.');
  if (terms.geometricDecrease === null)
    issues.push('Falta el gradiente geométrico.');
  if (terms.sequence === 2) {
    const policy = secondCreditPolicySchema.safeParse(terms.requirements ?? {});
    if (!policy.success)
      issues.push('Los requisitos del crédito 2 no son válidos.');
    else if (policy.data.maxDebtToMonthlyIncome === null)
      issues.push(
        'Falta el tope de endeudamiento (requirements.maxDebtToMonthlyIncome).',
      );
  }
  if (!issues.length && isComplete(terms)) {
    const amounts =
      terms.principalCOP !== null
        ? [terms.principalCOP]
        : [terms.minPrincipalCOP as number, terms.maxPrincipalCOP as number];
    const sound = amounts.every((principal) =>
      scheduleIsWellFormed(
        geometricAmounts(
          principal,
          terms.termMonths,
          terms.monthlyRate,
          terms.geometricDecrease,
        ),
        terms.geometricDecrease,
      ),
    );
    if (!sound)
      issues.push(
        'Con estas condiciones el plan no es decreciente o tiene cuotas que no abonan capital: revisa monto, plazo y gradiente.',
      );
  }
  return issues;
}

export function isComplete(terms: ProductTerms): terms is CompleteTerms {
  return (
    terms.termMonths !== null &&
    terms.monthlyRate !== null &&
    terms.geometricDecrease !== null &&
    (terms.principalCOP !== null ||
      (terms.minPrincipalCOP !== null && terms.maxPrincipalCOP !== null))
  );
}

export class PrincipalOutOfRangeError extends Error {
  constructor(
    readonly minCOP: number,
    readonly maxCOP: number,
  ) {
    super(`El monto debe estar entre ${minCOP} y ${maxCOP}.`);
  }
}

/**
 * Capital de la operación. Con monto fijo, ese es el capital. Con rango, el
 * solicitado debe estar dentro del rango; si no se envía se toma el mínimo.
 */
export function resolvePrincipal(
  terms: CompleteTerms,
  requestedCOP?: number,
): number {
  if (terms.principalCOP !== null) return terms.principalCOP;
  const min = terms.minPrincipalCOP as number;
  const max = terms.maxPrincipalCOP as number;
  if (requestedCOP === undefined) return min;
  if (
    !Number.isSafeInteger(requestedCOP) ||
    requestedCOP < min ||
    requestedCOP > max
  )
    throw new PrincipalOutOfRangeError(min, max);
  return requestedCOP;
}

/** Tasa efectiva anual equivalente a una tasa mensual vencida. */
export function annualEffectiveRate(monthlyRate: number): number {
  return Math.pow(1 + monthlyRate, 12) - 1;
}

/** Decimal(8,6) como texto exacto, para no persistir coma flotante. */
export function rateString(value: number): string {
  return value.toFixed(6);
}
