/** Formas reales de `/api/admin/*` del dominio de crédito STARTIF. */

export interface CreditProduct {
  id: string;
  code: "BUILDER_1" | "BUILDER_2" | string;
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
  disbursementMode: "SERVICE_FINANCING" | "TRANSFER" | string;
  defaultAfterDays: number;
  requirements: SecondCreditRequirements | null;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "SUPERSEDED";
  description: string | null;
  activationIssues: string[];
  statusReason: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string | null;
  activatedBy: string | null;
  suspendedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecondCreditRequirements {
  firstCreditMustBePaid: boolean;
  maxLatePayments: number;
  capacityCoverage: number;
  maxDebtToMonthlyIncome: number | null;
}

export interface Disbursement {
  id: string;
  applicationId: string;
  loanId: string | null;
  userId: string;
  productCode: string;
  kind: "SERVICE_FINANCING" | "TRANSFER" | string;
  purpose: string;
  amountCOP: string;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  reference: string | null;
  channel: string | null;
  note: string | null;
  disbursedAt: string | null;
  createdBy: string | null;
  registeredBy: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Application {
  id: string;
  userId: string;
  productId: string | null;
  productCode: string;
  productVersion: number | null;
  productName: string | null;
  amountCOP: string;
  termMonths: number;
  requestedRateMonthly: string | null;
  approvedRateMonthly: string | null;
  geometricDecrease: string | null;
  purpose: string;
  purposeDescription: string | null;
  status: string;
  stage: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  disbursement: Disbursement | null;
  kycProcesses: Array<{ id: string; status: string; completedAt: string | null; failureReason: string | null }>;
  signatures: Array<{ id: string; status: string; documentVersion: string | null; documentSnapshot: string | null; signedAt?: string | null; createdAt?: string }>;
  loan: { id: string; status: string; principalCOP: string; outstandingBalanceCOP: string; disbursedAt: string | null } | null;
  /** Condiciones cotizadas antes (solo informativo); la API lo incluye cuando existe. */
  previousTerms?: Record<string, unknown> | null;
}

export interface Eligibility {
  applicationId: string;
  eligible: boolean;
  requirements: Array<{ code: string; label: string; met: boolean; detail?: string }>;
}

export interface Loan {
  id: string;
  applicationId: string;
  userId: string;
  productCode: string;
  productVersion: number | null;
  purpose: string;
  principalCOP: string;
  outstandingBalanceCOP: string;
  monthlyRate: string;
  termMonths: number;
  geometricDecrease: string;
  defaultAfterDays: number | null;
  status: "ACTIVE" | "DEFAULTED" | "COMPLETED" | "WRITTEN_OFF";
  disbursedAt: string | null;
  defaultedAt: string | null;
  writtenOffAt: string | null;
  writtenOffReason: string | null;
  createdAt: string;
  installmentsTotal: number;
  installmentsPaid: number;
  overdueInstallments: number;
  overdueCOP: string;
  daysOverdue: number;
}

export interface Pqr {
  id: string;
  userId: string;
  type: string;
  subject: string;
  status: string;
  assignedRole: string | null;
  dueAt: string;
  resolvedAt: string | null;
  createdAt: string;
  message: string;
  resolution: string | null;
}

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  payload: Record<string, unknown> | null;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
}

export const PRODUCT_CODE_LABEL: Record<string, string> = {
  BUILDER_1: "Crédito constructor 1",
  BUILDER_2: "Crédito constructor 2",
};
