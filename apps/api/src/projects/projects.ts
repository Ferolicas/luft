import { z } from 'zod';
import { PROJECT_KINDS, type ProjectKind } from '../catalog/catalog-rules';
import { formatCOP } from '../luft/journey';

/**
 * Pure rules for life projects (education, mobility, housing, business or
 * other). Each project is a new turn of the continuous cycle:
 * aprender → demostrar → acceder → volver a crecer.
 */

export const PROJECT_STATUSES = [
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CYCLE_STAGES = [
  'APRENDER',
  'DEMOSTRAR',
  'ACCEDER',
  'VOLVER_A_CRECER',
] as const;
export type CycleStage = (typeof CYCLE_STAGES)[number];

export const CYCLE_LABELS: Record<CycleStage, string> = {
  APRENDER: 'Aprender',
  DEMOSTRAR: 'Demostrar',
  ACCEDER: 'Acceder',
  VOLVER_A_CRECER: 'Volver a crecer',
};

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  EDUCACION: 'Educación',
  MOVILIDAD: 'Movilidad',
  VIVIENDA: 'Vivienda',
  EMPRENDIMIENTO: 'Emprendimiento',
  OTRO: 'Otro proyecto',
};

const cop = z.coerce.number().int().min(0).max(100_000_000_000);

export const projectInputSchema = z
  .object({
    kind: z.enum(PROJECT_KINDS),
    title: z.string().trim().min(3).max(160),
    targetCOP: cop.min(1),
    savedCOP: cop.default(0),
    monthlyCapacityCOP: cop.optional(),
    targetDate: z.coerce.date(),
    openRoute: z.boolean().default(false),
  })
  .strict();

export const projectUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    targetCOP: cop.min(1),
    savedCOP: cop,
    monthlyCapacityCOP: cop.nullable(),
    targetDate: z.coerce.date(),
    status: z.enum(PROJECT_STATUSES),
  })
  .partial()
  .strict();

/** Modules of the academy that prepare each kind of project (by slug). */
export const MODULES_BY_KIND: Record<ProjectKind, string[]> = {
  EDUCACION: ['habitos-que-suman', 'tu-primer-credito'],
  MOVILIDAD: ['tu-primer-credito', 'habitos-que-suman'],
  VIVIENDA: ['conoce-tu-historial', 'habitos-que-suman', 'tu-primer-credito'],
  EMPRENDIMIENTO: ['habitos-que-suman', 'conoce-tu-historial'],
  OTRO: ['habitos-que-suman'],
};

export function monthsUntil(target: Date, today: Date) {
  const months =
    (target.getUTCFullYear() - today.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - today.getUTCMonth());
  return target.getUTCDate() < today.getUTCDate() ? months - 1 : months;
}

export interface ProjectFacts {
  kind: ProjectKind;
  status: ProjectStatus;
  targetCOP: number;
  savedCOP: number;
  targetDate: Date;
  /** Capacity declared for the project; when absent the profile capacity is used. */
  monthlyCapacityCOP: number | null;
  profileCapacityCOP: number | null;
  recommendedModules: Array<{
    slug: string;
    title: string;
    completed: boolean;
  }>;
  /** Hard facts of the route: on-time credit behaviour and final profile. */
  creditHistoryDemonstrated: boolean;
  matchingAvailable: boolean;
}

/** Savings plan: required monthly saving against the declared capacity. */
export function projectPlan(facts: ProjectFacts, today: Date) {
  const remainingCOP = Math.max(0, facts.targetCOP - facts.savedCOP);
  const months = Math.max(0, monthsUntil(facts.targetDate, today));
  const overdue = facts.targetDate.getTime() < today.getTime();
  const requiredMonthlyCOP =
    remainingCOP === 0 ? 0 : Math.ceil(remainingCOP / Math.max(1, months));
  const capacityCOP = facts.monthlyCapacityCOP ?? facts.profileCapacityCOP;
  const capacitySource =
    facts.monthlyCapacityCOP !== null
      ? 'PROJECT'
      : facts.profileCapacityCOP !== null
        ? 'PROFILE'
        : null;
  const gapCOP =
    capacityCOP === null ? null : Math.max(0, requiredMonthlyCOP - capacityCOP);
  const feasible =
    remainingCOP === 0
      ? true
      : capacityCOP === null
        ? null
        : !overdue && capacityCOP >= requiredMonthlyCOP;
  const monthsAtCapacity =
    capacityCOP && capacityCOP > 0
      ? Math.ceil(remainingCOP / capacityCOP)
      : null;
  const suggested =
    feasible === false && monthsAtCapacity !== null
      ? new Date(
          Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth() + monthsAtCapacity,
            1,
          ),
        )
          .toISOString()
          .slice(0, 10)
      : null;
  const percent =
    facts.targetCOP > 0
      ? Math.min(100, Math.round((facts.savedCOP / facts.targetCOP) * 100))
      : 0;
  return {
    remainingCOP,
    monthsRemaining: months,
    requiredMonthlySavingCOP: requiredMonthlyCOP,
    declaredCapacityCOP: capacityCOP,
    capacitySource,
    monthlyGapCOP: gapCOP,
    feasible,
    suggestedTargetDate: suggested,
    progressPercent: percent,
    message:
      remainingCOP === 0
        ? 'Ya reuniste la meta de este proyecto.'
        : capacityCOP === null
          ? 'Declara cuánto puedes ahorrar al mes (o completa ingresos y gastos en tu perfil) para saber si el plan es alcanzable.'
          : feasible
            ? `Necesitas ahorrar ${formatCOP(requiredMonthlyCOP)} al mes y tu capacidad declarada lo cubre.`
            : overdue
              ? 'La fecha de este proyecto ya pasó. Ajusta la fecha para recalcular el plan.'
              : `Necesitas ahorrar ${formatCOP(requiredMonthlyCOP)} al mes y tu capacidad declarada es menor. Ajusta la fecha, la meta o tu capacidad.`,
  };
}

/** Stage of the continuous cycle, derived from facts and not from a manual switch. */
export function cycleStage(facts: ProjectFacts): CycleStage {
  if (facts.status === 'COMPLETED') return 'VOLVER_A_CRECER';
  const learned =
    facts.recommendedModules.length === 0 ||
    facts.recommendedModules.every((module) => module.completed);
  if (!learned) return 'APRENDER';
  const funded = facts.targetCOP > 0 && facts.savedCOP >= facts.targetCOP;
  if (funded || (facts.creditHistoryDemonstrated && facts.matchingAvailable))
    return 'ACCEDER';
  return 'DEMOSTRAR';
}

export function cycleView(stage: CycleStage) {
  return CYCLE_STAGES.map((key) => ({
    key,
    label: CYCLE_LABELS[key],
    status:
      CYCLE_STAGES.indexOf(key) < CYCLE_STAGES.indexOf(stage)
        ? 'DONE'
        : key === stage
          ? 'CURRENT'
          : 'PENDING',
  }));
}
