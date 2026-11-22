/** Formas reales de `/api/admin/matching/*`, `/api/institution/*` y `/api/ally/*`. */

export type PolicyStatus = "BORRADOR" | "REVISION" | "APROBADA" | "VIGENTE" | "SUSTITUIDA" | "SUSPENDIDA";
export type FieldType = "number" | "money" | "text" | "enum" | "boolean" | "list";
export type ValueShape = "scalar" | "range" | "list";
export type RuleValue = number | string | boolean | Array<number | string> | null;

export interface Option { key: string; label: string }
export interface FactField {
  key: string;
  label: string;
  group: string;
  description: string;
  type: FieldType;
  unit: string | null;
  operators: string[];
  options: Array<{ value: string; label: string }>;
  source: string;
  availability: "DISPONIBLE" | "DECLARADO" | "EXTENSION";
  completeHref: string | null;
}
export interface MatchingCatalog {
  engineVersion: string;
  fields: FactField[];
  operators: Array<{ key: string; label: string; valueShape: ValueShape }>;
  ruleKinds: Option[];
  exceptionLevels: Option[];
  institutionKinds: Option[];
  productKinds: Option[];
  policyStatuses: Array<{ key: PolicyStatus; label: string; next: PolicyStatus[] }>;
}

export interface Institution {
  id: string;
  name: string;
  kind: string;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
  productsCount: number;
  usersCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  institutionId: string;
  institution: { id: string; name: string; active: boolean };
  name: string;
  kind: string;
  description: string | null;
  minAmountCOP: number | null;
  maxAmountCOP: number | null;
  minTermMonths: number | null;
  maxTermMonths: number | null;
  referenceRateEA: number | null;
  guarantees: string[];
  requiredDocuments: string[];
  channel: string | null;
  commissionPercent: number | null;
  commissionNotes: string | null;
  agreementReference: string | null;
  active: boolean;
  versionsCount: number;
  currentVersion: { id: string; version: number; effectiveFrom: string | null } | null;
  createdAt: string;
  updatedAt: string;
  versions?: Version[];
}

export interface Version {
  id: string;
  productId: string;
  version: number;
  status: PolicyStatus;
  statusLabel: string;
  editable: boolean;
  allowedTransitions: PolicyStatus[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceDocument: string;
  sourceUrl: string | null;
  notes: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedByRole: string | null;
  approvedAt: string | null;
  approvalIndependence: "OTRO_ROL" | "OTRA_PERSONA" | "MISMA_PERSONA" | null;
  activatedByName: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  suspendedByName: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  clonedFromId: string | null;
  rulesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Rule {
  id: string;
  position: number;
  field: string;
  fieldLabel: string;
  operator: string;
  operatorLabel: string;
  value: RuleValue;
  kind: "REQUISITO" | "EXCLUSION" | "PREFERENCIA";
  weight: number;
  label: string;
  summary: string;
  internal: boolean;
  exceptionAllowed: boolean;
  exceptionApprovalLevel: string | null;
}
export interface RuleInput {
  field: string;
  operator: string;
  value: RuleValue;
  kind: "REQUISITO" | "EXCLUSION" | "PREFERENCIA";
  weight: number;
  label?: string;
  internal: boolean;
  exceptionAllowed: boolean;
  exceptionApprovalLevel?: string | null;
}

export interface PolicyEvent { id: string; action: string; fromStatus: string | null; toStatus: string | null; actorName: string | null; actorRole: string | null; note: string | null; metadata: unknown; createdAt: string }

export interface VersionDetail extends Version {
  product: { id: string; name: string; kind: string; institutionId: string; institutionName: string };
  rules: Rule[];
  submissionIssues: string[];
  history: PolicyEvent[];
}

export interface ExplainedRule {
  ruleId: string;
  kind: "REQUISITO" | "EXCLUSION" | "PREFERENCIA";
  outcome: "CUMPLE" | "NO_CUMPLE" | "DATO_FALTANTE" | "EXCLUYE";
  blocking: boolean;
  internal: boolean;
  label: string;
  message: string;
  field: string | null;
  fieldLabel: string | null;
  operator: string | null;
  expectedText: string | null;
  actualText: string | null;
  weight: number | null;
  exceptionAllowed: boolean;
  exceptionApprovalLevel: string | null;
}
export interface Explanation { passed: ExplainedRule[]; gaps: ExplainedRule[]; exclusions: ExplainedRule[] }
export interface Totals { rules: number; passed: number; gaps: number; blockingGaps: number; missingData: number; exclusions: number }

export interface Simulation {
  policyVersionId: string;
  version: number;
  engineVersion: string;
  status: "ELEGIBLE" | "CON_BRECHAS" | "EXCLUIDO";
  fitPercent: number;
  presentable: boolean;
  requiresException: boolean;
  exceptionApprovalLevels: string[];
  totals: Totals;
  explanation: Explanation;
}

export type PresentationStatus = "AUTORIZADA" | "REVOCADA" | "PRESENTADA" | "APROBADA" | "RECHAZADA" | "DESISTIDA";
export interface StaffPresentation {
  id: string;
  resultId: string;
  status: PresentationStatus;
  statusLabel: string;
  institution: { id: string; name: string };
  product: { id: string; name: string; kind: string };
  policy: { versionId: string; version: number; effectiveFrom: string | null };
  match: { status: string; fitPercent: number; evaluatedAt: string };
  requiresException: boolean;
  exceptionLevels: string[];
  exceptionApprovedRole: string | null;
  authorizedAt: string;
  revokedAt: string | null;
  presentedAt: string | null;
  presentationChannel: string | null;
  decidedAt: string | null;
  decidedByRole: string | null;
  approvedAmountCOP: number | null;
  approvedRateEA: number | null;
  approvedTermMonths: number | null;
  finalProductName: string | null;
  decisionReason: string | null;
  allowedActions: Array<"present" | "decide">;
  user: { id: string; fullName: string };
}
export interface SharedFact { key: string; label: string; value: unknown; display: string }
export interface StaffPresentationDetail extends StaffPresentation {
  presentedByName: string | null;
  decidedByName: string | null;
  exceptionApprovedByName: string | null;
  exceptionNote: string | null;
  presentationNote: string | null;
  authorization: { version: string; text: string; textHash: string; scope: { identity: Array<{ key: string; label: string }>; facts: Array<{ key: string; label: string }>; match: Array<{ key: string; label: string }> }; authorizedAt: string };
  shared: { applicant: Applicant; facts: SharedFact[]; match: { status: string; fitPercent: number; policyVersion: number; evaluatedAt: string; requiresException: boolean } } | null;
  explanation: Explanation;
}
export interface Applicant { fullName: string; document: string; phone: string; email: string }

export interface InstPresentation {
  id: string;
  status: PresentationStatus;
  statusLabel: string;
  product: { id: string; name: string; kind: string };
  policy: { version: number; effectiveFrom: string | null };
  match: { status: string; fitPercent: number; evaluatedAt: string };
  requiresException: boolean;
  presentedAt: string | null;
  presentationChannel: string | null;
  decidedAt: string | null;
  decidedByRole: string | null;
  approvedAmountCOP: number | null;
  approvedRateEA: number | null;
  approvedTermMonths: number | null;
  finalProductName: string | null;
  decisionReason: string | null;
  canDecide: boolean;
  dataAvailable: boolean;
  applicantName: string | null;
}
export interface InstPresentationDetail extends InstPresentation {
  applicant: Applicant | null;
  facts: SharedFact[];
  authorization: { version: string; authorizedAt: string; text: string };
}

export type DecisionBody =
  | { decision: "APROBADA"; approvedAmountCOP: number; approvedRateEA: number; approvedTermMonths: number; finalProductName?: string; reason?: string }
  | { decision: "RECHAZADA" | "DESISTIDA"; reason: string };

export interface RunRow { id: string; userId: string; createdAt: string; engineVersion: string; trigger: string; productsEvaluated: number; eligibleCount: number }
export interface RunResult {
  id: string;
  institutionId: string;
  institutionName: string;
  productId: string;
  productName: string;
  productKind: string;
  policyVersionId: string;
  policyVersion: number;
  policyEffectiveFrom: string | null;
  status: string;
  fitPercent: number;
  presentable: boolean;
  totals: Totals;
  explanation: Explanation;
}
export interface RunDetail extends Omit<RunRow, "eligibleCount"> { factsHash: string; results: RunResult[] }
export interface RunVerification {
  runId: string;
  engineVersion: string;
  currentEngineVersion: string;
  sameEngineVersion: boolean;
  factsHashValid: boolean;
  reproducible: boolean;
  results: Array<{ resultId: string; productName: string; policyVersion: number; reproducible: boolean; stored: { status: string; fitPercent: number }; recomputed: { status: string; fitPercent: number } | null }>;
}

export interface Ally {
  id: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  referralCode: string;
  active: boolean;
  usersCount: number;
  referralsCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface PartnerLink { id: string; userId: string; fullName: string; email: string; role: string; status: string; createdAt: string }
export interface Referral { id: string; userId: string; fullName: string; email: string; source: string; createdAt: string }

export const POLICY_FLOW: PolicyStatus[] = ["BORRADOR", "REVISION", "APROBADA", "VIGENTE"];
export const PRESENTATION_STATUSES: Array<{ value: PresentationStatus; label: string }> = [
  { value: "AUTORIZADA", label: "Autorizada (por presentar)" },
  { value: "PRESENTADA", label: "Presentada (en estudio)" },
  { value: "APROBADA", label: "Aprobada" },
  { value: "RECHAZADA", label: "Rechazada" },
  { value: "DESISTIDA", label: "Desistida" },
  { value: "REVOCADA", label: "Revocada" },
];

export const optionLabel = (options: Option[] | undefined, key: string | null | undefined) => (key ? (options?.find((item) => item.key === key)?.label ?? key) : "—");
