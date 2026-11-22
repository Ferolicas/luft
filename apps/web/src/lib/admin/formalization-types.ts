/** Formas reales de `/api/admin/tax-rules` y `/api/admin/formalization/*`. */

export interface TaxRule {
  id: string;
  taxYear: number;
  version: number;
  uvtCOP: number;
  wealthUvt: number;
  incomeUvt: number;
  cardSpendUvt: number;
  purchasesUvt: number;
  depositsUvt: number;
  sourceDocument: string;
  sourceUrl: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "DRAFT" | "APPROVED" | "ACTIVE" | "SUPERSEDED";
  notes: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export type CaseAction = "OBSERVE" | "APPROVE" | "MARK_FILED" | "VERIFY";

export interface CaseRow {
  id: string;
  userId: string;
  userName: string | null;
  taxYear: number;
  status: string;
  statusLabel: string;
  phase: string;
  path: "UPLOAD" | "GUIDED" | null;
  mayHaveToFile: boolean | null;
  reviewApproved: boolean;
  submittedAt: string | null;
  updatedAt: string;
  actions: CaseAction[];
}

export interface TaxCriterion { key: string; label: string; valueCOP: number; limitCOP: number; limitUvt: number; exceeds: boolean; explanation: string }

export interface CaseDetail {
  case: {
    id: string;
    taxYear: number;
    status: string;
    statusLabel: string;
    phase: string;
    mayHaveToFile: boolean | null;
    alreadyFiled: boolean | null;
    path: "UPLOAD" | "GUIDED" | null;
    preparation: { incomes: string[]; holdings: string[]; deductions: string[] } | null;
    diagnosedAt: string | null;
    submittedAt: string | null;
    reviewApproved: boolean;
    reviewApprovedAt: string | null;
    formNumber: string | null;
    filedAt: string | null;
    verifiedAt: string | null;
    updatedAt: string;
  };
  user: { id: string; fullName: string; email: string; phone: string } | null;
  rule: TaxRule | null;
  diagnosis: { taxYear: number; uvtCOP: number; ready: boolean; available: boolean; mayHaveToFile: boolean | null; criteria: TaxCriterion[]; reasons: string[]; summary: string; disclaimer: string } | null;
  documents: Array<{ id: string; purpose: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string; uploadedAt: string }>;
  history: Array<{ id: string; action: string; from: string | null; to: string | null; toLabel: string | null; note: string | null; actor: "USER" | "STAFF" | "SYSTEM"; at: string }>;
  actions: CaseAction[];
}

export const CASE_STATUSES = [
  { value: "", label: "Cola de revisión (en revisión y presentados)" },
  { value: "REVISION", label: "En revisión profesional" },
  { value: "PRESENTADO", label: "Presentada" },
  { value: "VERIFICADO", label: "Verificada" },
  { value: "POSIBLE_OBLIGACION", label: "Posible obligación" },
  { value: "DOCUMENTO_CARGADO", label: "Declaración cargada" },
  { value: "PREPARACION_GUIADA", label: "Preparación guiada" },
  { value: "NO_REQUIERE", label: "No requiere declarar" },
  { value: "SIN_EVALUAR", label: "Sin evaluar" },
];

export const PATH_LABEL: Record<string, string> = { UPLOAD: "Cargó su declaración", GUIDED: "Preparación guiada" };

export const HISTORY_LABEL: Record<string, string> = {
  DIAGNOSED: "Diagnóstico automático",
  ANSWERED_ALREADY_FILED: "Indicó que ya presentó la declaración",
  ANSWERED_NOT_FILED: "Indicó que no ha presentado la declaración",
  DECLARATION_UPLOADED: "Cargó la declaración",
  SUPPORT_UPLOADED: "Cargó un soporte",
  DOCUMENT_DELETED: "Eliminó un documento",
  PREPARATION_SAVED: "Guardó la preparación guiada",
  SUBMITTED_FOR_REVIEW: "Envió el caso a revisión",
  OBSERVED: "Revisión con observaciones",
  REVIEW_APPROVED: "Revisión aprobada",
  APPROVED: "Revisión aprobada",
  MARKED_FILED: "Presentación registrada",
  FILED: "Presentación registrada",
  VERIFIED: "Evidencia verificada",
};
export const ACTOR_LABEL: Record<string, string> = { USER: "La persona", STAFF: "Equipo LUFT", SYSTEM: "Sistema" };
