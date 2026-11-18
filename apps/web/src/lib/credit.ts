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
