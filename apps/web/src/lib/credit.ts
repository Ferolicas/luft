import type { IconName } from "@/components/luft/icon-data";
import type { CreditData } from "./types";

export type Installment = NonNullable<CreditData["loan"]>["installments"][number];
export const isSettled = (row: Installment) => row.status === "PAID" || row.status === "WAIVED";
export const nextInstallment = (credit: CreditData | null) => credit?.loan?.installments.find((row) => !isSettled(row)) ?? null;
export const paidOnTime = (row: Installment) => row.status === "PAID" && Boolean(row.paidAt) && String(row.paidAt).slice(0, 10) <= String(row.dueDate).slice(0, 10);

const STATUS: Record<string, string> = {
  DRAFT: "Solicitud iniciada", PENDING_KYC: "Valida tu identidad", KYC_IN_PROGRESS: "Validando tu identidad", CONFIGURATION_REQUIRED: "Validación pendiente de habilitar",
  PENDING_SIGNATURE: "Firma tu pagaré", UNDER_REVIEW: "En revisión", IN_REVIEW: "En revisión", APPROVED: "Aprobado", REJECTED: "No aprobado", DISBURSED: "Desembolsado", ACTIVE: "Activo", CLOSED: "Completado", CANCELLED: "Cancelado",
  PENDING: "Pendiente", DUE: "Por pagar", PARTIALLY_PAID: "Pago parcial", PAID: "Pagada", OVERDUE: "En mora", WAIVED: "Condonada",
};
export const statusLabel = (status: string) => STATUS[status] ?? status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

/** "6 cuotas", "1 cuota". The plan length always comes from the API. */
export const installmentsLabel = (count: number) => `${count} cuota${count === 1 ? "" : "s"}`;

/**
 * Milestones of a payment plan, by installment number: the constancy badge
 * (three payments in a row), the progress review near the end and the goal.
 */
export function planMilestones(total: number) {
  const constancy = total >= 3 ? 3 : null;
  const review = total >= 5 ? total - 2 : null;
  return { constancy, review: review && review > (constancy ?? 0) ? review : null, goal: total };
}

export interface PlanStep { state?: "paid" | "now"; tone?: "amber" | "violet" | "green"; icon?: IconName }

/** One step per installment for the staircase; `current` is the 1-based installment the person is on. */
export function planSteps(total: number, paid: number, current: number | null): PlanStep[] {
  const { constancy, review, goal } = planMilestones(total);
  return Array.from({ length: total }, (_, index) => {
    const sequence = index + 1;
    const step: PlanStep = sequence === goal ? { tone: "green", icon: "flag" } : sequence === constancy ? { tone: "amber", icon: "workspace_premium" } : sequence === review ? { tone: "violet", icon: "verified_user" } : {};
    if (sequence <= paid) step.state = "paid";
    else if (sequence === current) step.state = "now";
    return step;
  });
}
