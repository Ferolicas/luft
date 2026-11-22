/* Contratos de la API V2 que consume la PWA (verificados contra la API en ejecución). */

// ───────── Ruta, categorías y arquetipos ─────────
export type StageKey = "CONOCETE" | "FORMALIZATE" | "PREPARATE" | "DEMUESTRA" | "AVANZA";
export type StageStatus = "DONE" | "CURRENT" | "PENDING";
export interface NextStep { key: string; stage: StageKey; title: string; description: string; href: string }
export interface ArchetypeMatch { fact: string; factLabel: string; label: string; value: string }
export type ArchetypeBasis = "RULES" | "LEGACY_EQUIVALENCE" | "DEFAULT";
export interface RouteStageItem { key: string; label: string; done: boolean; optional: boolean; waiting: boolean; detail: string | null; href: string }
export interface RouteStage { key: StageKey; title: string; description: string; status: StageStatus; machineStages: string[]; items: RouteStageItem[] }
export interface RouteOverview {
  route: { id: string; status: string; origin: "INITIAL" | "LIFE_STAGE" | "PROJECT"; title: string | null; stage: string; stageLabel: string; stageIndex: number; stageChangedAt: string; startedAt: string; progressPercent: number; categoryLocked: boolean; canStartNewRoute: boolean };
  category: { code: string; brand: string; label: string; description: string; chosenByUser: boolean; suggestedCode: string | null; onboarding: { headline: string; steps: string[] }; messages: { welcome: string; nextStep: string; matching: string }; modules: string[]; requiredDocuments: string[]; projectKinds: string[] };
  archetype: null | { code: string; name: string; description: string; version: number; assignedAt: string; basis: ArchetypeBasis; summary: string; matched: ArchetypeMatch[]; legacyCode: string | null };
  stages: RouteStage[];
  nextStep: NextStep | null;
  evidence: { verified: number; total: number };
  history: Array<{ from: string | null; to: string; toLabel: string; reason: string | null; at: string }>;
  previousRoutes: Array<{ id: string; categoryCode: string; categoryBrand: string; origin: string; title: string | null; stage: string; startedAt: string; closedAt: string | null }>;
}
export interface ArchetypeHistory { items: Array<{ id: string; categoryCode: string; code: string; name: string; version: number; assignedAt: string; basis: ArchetypeBasis; summary: string; matched: ArchetypeMatch[]; legacyCode: string | null; reason: string | null; current: boolean; supersededAt: string | null }> }
export interface Category { code: string; brand: string; label: string; description: string; position: number; archetypes: Array<{ code: string; name: string; description: string }> }
export interface EvidenceList { verified: number; total: number; items: Array<{ id: string; type: string; label: string; source: string; sourceLabel: string; status: "VERIFIED" | "DECLARED" | "PENDING" | "EXPIRED"; occurredAt: string; validUntil: string | null; validatedBy: string | null; validatedAt: string | null; consentId: string | null; sensitive: boolean }> }
/** `dashboard.route` (GET /luft/dashboard). */
export interface DashboardRoute { id: string; categoryCode: string; categoryBrand: string; categoryLabel: string; archetype: { code: string; name: string } | null; stage: string; stageLabel: string; visibleStage: { key: StageKey; title: string }; progressPercent: number; nextStep: NextStep | null; evidenceVerified: number }

// ───────── Planes y hogar ─────────
export type PlanCode = "INDIVIDUAL" | "DUO" | "FAMILIA";
export interface PlanView { code: PlanCode; name: string; description: string; minSeats: number; maxSeats: number; basePriceCOP: number; discountPercent: number; pricePerSeatCOP: number }
export interface Seats { total: number; used: number; available: number }
export interface SubscriptionView { subscription: null | { id: string; planCode: PlanCode; seats: number; basePriceCOP: number; discountPercent: number; pricePerSeatCOP: number; totalCOP: number; status: "SELECTED" | "ACTIVE"; activatedAt: string | null; createdAt: string }; plans: PlanView[]; seats: Seats; note: string }
export type Metric = "routeProgress" | "archetype" | "learning" | "credit" | "score";
export type ShareLevel = "NONE" | "BENEFICIARIES" | "ALL";
export type Permissions = Record<Metric, ShareLevel>;
export type MemberRole = "OWNER" | "BENEFICIARY" | "SUPPORT";
export interface MemberMetrics {
  routeProgress?: { percent: number; stage: string; stageLabel: string } | null;
  archetype?: { categoryCode: string; categoryBrand: string; archetypeName: string | null } | null;
  learning?: { lessonsCompleted: number; modulesCompleted: number } | null;
  credit?: { state: string; installmentsPaid: number; installmentsTotal: number; upToDate: boolean } | null;
  score?: { value: number } | null;
}
export interface HouseholdMember { memberId: string; firstName: string; role: MemberRole; seatAssigned: boolean; joinedAt: string; isSelf: boolean; visibleMetrics: Metric[]; metrics: MemberMetrics; permissions?: Permissions }
export interface HouseholdInvitation { id: string; role: "BENEFICIARY" | "SUPPORT"; seatAssigned: boolean; inviteeName: string | null; channel: "EMAIL" | "WHATSAPP" | "LINK"; status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"; expiresAt: string; createdAt: string }
export interface Contribution { id: string; amountCOP: number; note: string | null; status: "DECLARED" | "CONFIRMED" | "REJECTED"; declaredAt: string; resolvedAt: string | null; contributorName: string; isMine: boolean; hasSupport: boolean; canResolve: boolean }
export interface SharedGoal { id: string; title: string; kind: string | null; targetCOP: number; targetDate: string | null; status: "ACTIVE" | "COMPLETED"; ownerName: string; isMine: boolean; confirmedCOP: number; pendingCOP: number; percent: number; reached: boolean; contributions: Contribution[] }
export interface ConsentText { kind: string; version: string; text: string }
export interface HouseholdBoard {
  household: null | { id: string; name: string; createdAt: string; isOwner: boolean };
  me: null | { memberId: string; role: MemberRole; seatAssigned: boolean; permissions: Permissions };
  members: HouseholdMember[];
  board: null | { members: number; beneficiaries: number; support: number; routeProgress: null | { sharedBy: number; averagePercent: number }; learning: null | { sharedBy: number; lessonsCompleted: number; modulesCompleted: number }; credit: null | { sharedBy: number; upToDate: number } };
  seats: Seats | null;
  invitations: HouseholdInvitation[];
  goals: SharedGoal[];
  metricLabels: Record<Metric, string>;
  shareLevels: ShareLevel[];
  consent: ConsentText;
}
export type DeliveryStatus = "SENT" | "CONFIGURATION_REQUIRED" | "FAILED";
export interface InvitationCreated { invitation: HouseholdInvitation; link: string; delivery: Array<{ channel: string; status: DeliveryStatus }> }
export interface InvitationPreview { status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"; householdName: string; inviterFirstName: string; role: "BENEFICIARY" | "SUPPORT"; seatAssigned: boolean; expiresAt: string; consent: ConsentText; metricLabels: Record<Metric, string>; shareLevels: ShareLevel[] }
export interface VaultDocument { id: string; purpose: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string; uploadedAt: string }

// ───────── Formalización ─────────
export type CaseStatus = "SIN_EVALUAR" | "NO_REQUIERE" | "POSIBLE_OBLIGACION" | "DOCUMENTO_CARGADO" | "PREPARACION_GUIADA" | "REVISION" | "PRESENTADO" | "VERIFICADO";
export type CasePhase = "DIAGNOSIS" | "DRAFT" | "REVIEW" | "SIGNATURE_AND_FILING" | "VERIFIED_EVIDENCE";
export type FormalizationAction = "DIAGNOSE" | "ANSWER_FILED" | "UPLOAD_DECLARATION" | "UPLOAD_SUPPORT" | "SAVE_PREPARATION" | "SUBMIT_FOR_REVIEW" | "DELETE_DOCUMENT";
export interface TaxAnswers { incomes: string[]; holdings: string[]; deductions: string[] }
export interface TaxCriterion { key: string; label: string; valueCOP: number; limitCOP: number; limitUvt: number; exceeds: boolean; explanation: string }
export interface TaxDiagnosis { taxYear: number; uvtCOP: number; ready: boolean; available: boolean; mayHaveToFile: boolean; criteria: TaxCriterion[]; rule: { id: string; taxYear: number; version: number; uvtCOP: number; sourceDocument: string; effectiveFrom: string } | null; reasons: string[]; summary: string; disclaimer: string }
export interface ProviderNotice { available: boolean; status: string; message: string }
export interface FormalizationView {
  case: { id: string; taxYear: number; status: CaseStatus; statusLabel: string; phase: CasePhase; mayHaveToFile: boolean | null; alreadyFiled: boolean | null; path: "UPLOAD" | "GUIDED" | null; preparation: TaxAnswers | null; diagnosedAt: string | null; submittedAt: string | null; reviewApproved: boolean; reviewApprovedAt: string | null; formNumber: string | null; filedAt: string | null; verifiedAt: string | null; updatedAt: string };
  diagnosis: TaxDiagnosis;
  consent: ConsentText & { granted: boolean };
  documents: VaultDocument[];
  limits: { declarations: number; supports: number };
  history: Array<{ id: string; action: string; from: string | null; to: string; toLabel: string; note: string | null; actor: "USER" | "STAFF" | "SYSTEM"; at: string }>;
  actions: FormalizationAction[];
  extraction: ProviderNotice;
  dian: ProviderNotice;
}

// ───────── Tarjetas ─────────
export type Band = "HEALTHY" | "MODERATE" | "HIGH" | "CRITICAL";
export interface DateCountdown { date: string; days: number }
export interface CardPurchase { id: string; amountCOP: number; installments: number; remainingInstallments: number; purchasedAt: string; description: string; isCashAdvance: boolean }
export interface CardView {
  id: string; source: string; issuer: string; alias: string | null; last4: string | null; creditLimitCOP: number; usedBalanceCOP: number; statementDay: number; paymentDay: number; minimumPaymentCOP: number | null; annualEffectiveRatePercent: number | null; createdAt: string; updatedAt: string;
  summary: { utilizationPercent: number; band: Band; availableCOP: number; statement: DateCountdown; payment: DateCountdown; deferredPurchases: number; cashAdvances: number; longestTermMonths: number; monthlyInstallmentsCOP: number };
  purchases: CardPurchase[];
}
export interface Capacity { monthlyIncomeCOP: number; monthlyCommitmentsCOP: number; cardInstallmentsCOP: number; availableCOP: number }
export interface Guidance { id: string; cardId: string | null; code: string; severity: "INFO" | "WARNING" | "ALERT"; title: string; body: string; variables: Record<string, unknown>; status: "SHOWN" | "ACCEPTED" | "DISMISSED" | "RESOLVED"; shownAt: string; respondedAt: string | null; baselineUtilizationPercent: number | null; measuredUtilizationPercent: number | null; effectiveness: "IMPROVED" | "UNCHANGED" | "WORSENED" | null; measuredAt: string | null; disclaimer: string }
export interface CardsOverview {
  cards: CardView[];
  totals: null | { creditLimitCOP: number; usedBalanceCOP: number; availableCOP: number; utilizationPercent: number; band: Band; monthlyInstallmentsCOP: number };
  capacity: Capacity | null;
  obligations: number;
  recommendations: Guidance[];
  history: Guidance[];
  disclaimer: string;
}
export interface CardSimulation {
  amountCOP: number; installments: number; isCashAdvance: boolean; utilizationBeforePercent: number; utilizationAfterPercent: number; bandAfter: Band; exceedsLimit: boolean; availableAfterCOP: number;
  firstInstallmentCOP: number; lastInstallmentCOP: number; averageInstallmentCOP: number; totalInterestCOP: number | null; totalCOP: number | null; rateKnown: boolean; monthlyRatePercent: number | null;
  simultaneousDeferredPurchases: number; capacity: Capacity | null; installmentShareOfCapacityPercent: number | null; statement: DateCountdown; payment: DateCountdown;
  trajectory: { impact: "FAVORABLE" | "NEUTRAL" | "RISK"; explanation: string }; warnings: string[]; disclaimer: string;
}

// ───────── Proyectos de vida ─────────
export type ProjectKind = "EDUCACION" | "MOVILIDAD" | "VIVIENDA" | "EMPRENDIMIENTO" | "OTRO";
export type CycleStatus = "DONE" | "CURRENT" | "PENDING";
export interface LifeProject {
  id: string; kind: ProjectKind; kindLabel: string; title: string; targetCOP: number; savedCOP: number; monthlyCapacityCOP: number | null; targetDate: string; status: "ACTIVE" | "PAUSED" | "COMPLETED"; routeId: string | null; createdAt: string; completedAt: string | null;
  plan: { remainingCOP: number; monthsRemaining: number; requiredMonthlySavingCOP: number; declaredCapacityCOP: number | null; capacitySource: "PROJECT" | "PROFILE" | null; monthlyGapCOP: number | null; feasible: boolean | null; suggestedTargetDate: string | null; progressPercent: number; message: string };
  cycle: { stage: string; label: string; steps: Array<{ key: string; label: string; status: CycleStatus }> };
  recommendedModules: Array<{ slug: string; title: string; completed: boolean; href: string }>;
}
export interface ProjectsView { projects: LifeProject[]; kinds: Array<{ code: ProjectKind; label: string }>; profileCapacityCOP: number | null; cycle: Array<{ key: string; label: string }> }

// ───────── Open Finance ─────────
export interface OpenFinanceScope { code: string; label: string }
export interface OpenFinanceConnection { id: string; institution: string | null; status: "PENDING" | "CONFIGURATION_REQUIRED" | "AUTHORIZATION_PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED" | "FAILED"; scopes: OpenFinanceScope[]; consentId: string | null; requestedAt: string; expiresAt: string | null; activatedAt: string | null; revokedAt: string | null; lastSyncAt: string | null }
export interface OpenFinanceView { available: boolean; status: "ready" | "configuration_required"; message: string | null; notice: string; scopes: OpenFinanceScope[]; consent: ConsentText & { days: number }; connections: OpenFinanceConnection[] }

// ───────── Consentimientos ─────────
export interface ConsentItem { id: string; domain: "LUFT" | "STARTIF"; kind: string; title: string; purpose: string; scope: string[]; version: string; acceptedAt: string; expiresAt: string | null; revokedAt: string | null; status: "ACTIVE" | "REVOKED" | "EXPIRED" | "SUPERSEDED"; revocable: boolean; revokeEffect: string }
export interface ConsentsView { controller: string; policyUrl: string; items: ConsentItem[] }
export interface ConsentRevoked extends ConsentsView { revoked: { kind: string; title: string; count: number; at: string }; effect: string; effects: string[] }

// ───────── Créditos constructores (StartIF) ─────────
export interface CreditInstallment { id: string; sequence: number; dueDate: string; amountCOP: string | number; paidCOP: string | number; principalCOP?: string | number; interestCOP?: string | number; status: string; paidAt?: string | null }
export interface CreditView {
  id: string; status: string; amountCOP: string | number; termMonths: number; productCode: string; productName?: string; purpose?: string | null; purposeDescription?: string | null; stage?: string; createdAt?: string;
  disbursement?: { status: string; amountCOP?: string | number; disbursedAt?: string | null } | null;
  loan?: null | { id: string; status?: string; termMonths?: number; disbursedAt?: string | null; outstandingBalanceCOP: string | number; principalCOP: string | number; installments: CreditInstallment[] };
}
export interface SecondCredit {
  product: null | { code: string; name: string; purpose?: string; description?: string | null; version?: number; principalCOP?: number | null; minPrincipalCOP?: number | null; maxPrincipalCOP?: number | null; termMonths?: number | null; monthlyRate?: number | null };
  eligible: boolean;
  requirements: Array<{ code: string; label: string; met: boolean; detail?: string }>;
  purposes: Array<{ code: string; label: string }>;
}
export interface CreditsView { credits: CreditView[]; second: SecondCredit }

// ───────── Matching ─────────
export interface Declared { birthDate: string | null; city: string | null; department: string | null; activityStartDate: string | null; updatedAt: string | null }
export interface Readiness { ready: boolean; missing: Array<{ code: string; kind: "CONSENT" | "PROFILE"; label: string; href: string }>; declared: Declared }
export interface ExplainedRule { ruleId: string; kind: "REQUISITO" | "EXCLUSION" | "PREFERENCIA"; outcome: "CUMPLE" | "NO_CUMPLE" | "DATO_FALTANTE" | "EXCLUYE"; blocking: boolean; internal: boolean; label: string; message: string; field: string | null; fieldLabel: string | null; expectedText: string | null; actualText: string | null; weight: number | null; exceptionAllowed: boolean; completeHref: string | null }
export type PresentationStatus = "AUTORIZADA" | "REVOCADA" | "PRESENTADA" | "APROBADA" | "RECHAZADA" | "DESISTIDA";
export interface Presentation { id: string; resultId: string; status: PresentationStatus; statusLabel: string; requiresException: boolean; institution: { id: string; name: string }; product: { id: string; name: string }; authorizedAt: string; revokedAt: string | null; presentedAt: string | null; decidedAt: string | null; approvedAmountCOP: number | null; approvedRateEA: number | null; approvedTermMonths: number | null; finalProductName: string | null; decisionReason: string | null; canRevoke: boolean }
export interface MatchResult {
  id: string; status: "ELEGIBLE" | "CON_BRECHAS" | "EXCLUIDO"; fitPercent: number; presentable: boolean; requiresException: boolean; headline: string;
  institution: { id: string; name: string; kind: string };
  product: { id: string; name: string; kind: string; description: string | null; minAmountCOP: number | null; maxAmountCOP: number | null; minTermMonths: number | null; maxTermMonths: number | null; referenceRateEA: number | null; guarantees: string[]; requiredDocuments: string[]; channel: string | null };
  policy: { versionId: string; version: number; effectiveFrom: string | null };
  totals: { rules: number; passed: number; gaps: number; blockingGaps: number; missingData: number; exclusions: number };
  explanation: { passed: ExplainedRule[]; gaps: ExplainedRule[]; exclusions: ExplainedRule[] };
  presentation: Presentation | null;
  authorization: { allowed: boolean; blockedCode: string | null; blockedReason: string | null };
}
export interface MatchRun { id: string; createdAt: string; engineVersion: string; requestedAmountCOP: number | null; requestedTermMonths: number | null; productsEvaluated: number; summary: { eligible: number; withGaps: number; excluded: number } }
export interface RunView { run: MatchRun | null; results: MatchResult[]; disclaimer: string }
export interface MatchingView extends RunView { readiness: Readiness }
export interface MatchHistory { items: Array<Omit<MatchRun, never>>; page: number; pages: number; total: number }
export interface ScopeItem { key: string; label: string }
export interface AuthorizationPreview { resultId: string; allowed: boolean; blockedCode: string | null; blockedReason: string | null; version: string; text: string; textHash: string; scope: { identity: ScopeItem[]; facts: ScopeItem[]; match: ScopeItem[] }; institution: { id: string; name: string }; product: { id: string; name: string } }
