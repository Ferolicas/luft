import { z } from 'zod';
import { DOCUMENT_KINDS } from '../luft/journey';

/**
 * Pure rules for the administrable catalogs: service categories (commercial
 * segment) and subscription plans (purchase modality).
 */

export const PROJECT_KINDS = [
  'EDUCACION',
  'MOVILIDAD',
  'VIVIENDA',
  'EMPRENDIMIENTO',
  'OTRO',
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** Validated shape of ServiceCategory.config. Staff edit it without a deploy. */
export const categoryConfigSchema = z
  .object({
    onboarding: z
      .object({
        headline: z.string().trim().min(3).max(160),
        steps: z.array(z.string().trim().min(3).max(200)).min(1).max(8),
      })
      .strict(),
    modules: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[a-z0-9-]{2,80}$/),
      )
      .max(30),
    requiredDocuments: z.array(z.enum(DOCUMENT_KINDS)).max(4),
    messages: z
      .object({
        welcome: z.string().trim().min(3).max(400),
        nextStep: z.string().trim().min(3).max(400),
        matching: z.string().trim().min(3).max(400),
      })
      .strict(),
    projectKinds: z.array(z.enum(PROJECT_KINDS)).max(5).default([]),
  })
  .strict();
export type CategoryConfig = z.infer<typeof categoryConfigSchema>;

export const EMPTY_CATEGORY_CONFIG: CategoryConfig = {
  onboarding: { headline: 'Tu ruta LUFT', steps: ['Conócete'] },
  modules: [],
  requiredDocuments: [],
  messages: {
    welcome: 'Construye tu identidad financiera paso a paso.',
    nextStep: 'Sigue con el siguiente paso de tu ruta.',
    matching: 'Cuando tu perfil esté listo te mostraremos oportunidades.',
  },
  projectKinds: [],
};

export function readCategoryConfig(value: unknown): CategoryConfig {
  const parsed = categoryConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_CATEGORY_CONFIG;
}

export const CATEGORY_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/);

/** Category suggested from the two classification questions. */
export const CATEGORY_BY_GOAL: Record<string, string> = {
  START: 'JOVEN',
  IMPROVE_SCORE: 'ADULTO',
  GUIDE_YOUTH: 'FAMILIA',
};
export const DEFAULT_CATEGORY_CODE = 'JOVEN';

export function suggestCategory(goal?: string | null): string {
  return (goal && CATEGORY_BY_GOAL[goal]) || DEFAULT_CATEGORY_CODE;
}

export const PLAN_CODES = ['INDIVIDUAL', 'DUO', 'FAMILIA'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanDefinition {
  code: string;
  name: string;
  description: string;
  minSeats: number;
  maxSeats: number;
  basePriceCOP: number;
  discountPercent: number;
}

/** Price per identity after the plan discount, rounded to the nearest peso. */
export function pricePerSeat(basePriceCOP: number, discountPercent: number) {
  return Math.round((basePriceCOP * (100 - discountPercent)) / 100);
}

export function planView(plan: PlanDefinition) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    minSeats: plan.minSeats,
    maxSeats: plan.maxSeats,
    basePriceCOP: plan.basePriceCOP,
    discountPercent: plan.discountPercent,
    pricePerSeatCOP: pricePerSeat(plan.basePriceCOP, plan.discountPercent),
  };
}

/** Quote for a purchase: seats must respect the plan limits. */
export function quoteSubscription(plan: PlanDefinition, seats: number) {
  if (
    !Number.isInteger(seats) ||
    seats < plan.minSeats ||
    seats > plan.maxSeats
  )
    return {
      ok: false as const,
      reason:
        plan.minSeats === plan.maxSeats
          ? `El plan ${plan.name} incluye ${plan.minSeats} ${plan.minSeats === 1 ? 'identidad' : 'identidades'}.`
          : `El plan ${plan.name} admite entre ${plan.minSeats} y ${plan.maxSeats} identidades.`,
    };
  const perSeat = pricePerSeat(plan.basePriceCOP, plan.discountPercent);
  return {
    ok: true as const,
    seats,
    basePriceCOP: plan.basePriceCOP,
    discountPercent: plan.discountPercent,
    pricePerSeatCOP: perSeat,
    totalCOP: perSeat * seats,
  };
}
