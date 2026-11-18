import type { SessionUser } from "@/components/app-shell";

export interface DashboardData {
  user: SessionUser;
  profile: { currentScore: number | null; archetype: string | null; completionPercent: number; existingHistory?: boolean | null };
  streak: { currentDays: number; longestDays: number };
  goals: Array<{ id: string; title: string; kind: string; targetCOP?: string; progress: number }>;
  learning: Array<{ id: string; slug: string; title: string; description: string; durationMin: number; lessons: Array<{ key: string; title: string }>; completedLessons: number }>;
  scoreHistory: Array<{ id: string; status: string; score: number | null; requestedAt: string }>;
  credit: CreditData | null;
  openPqr: number;
  integrations: Record<string, boolean>;
  journey: JourneySummary;
  progress: ProgressData;
}

export interface CreditData {
  id: string; status: string; amountCOP: string; termMonths: number;
  kycProcesses?: Array<{ id: string; status: string; verificationUrl?: string }>;
  signatures?: Array<{ id: string; status: string; signedAt?: string }>;
  createdAt?: string;
  loan?: { id: string; termMonths?: number; disbursedAt?: string | null; status?: string; outstandingBalanceCOP: string; principalCOP: string; virtualCard?: { last4: string; fixedLimitCOP: string; status: string }; installments: Array<{ id: string; sequence: number; dueDate: string; amountCOP: string; paidCOP: string; status: string; paidAt?: string | null }> };
}

export type SectionKey = "employment" | "income" | "assets" | "debts" | "recurring";
export type DocumentKind = "TAX_RETURN" | "BANK_STATEMENTS" | "SOCIAL_SECURITY" | "EMPLOYMENT_CERTIFICATE";
export interface StoredDocument { id: string; kind: DocumentKind; fileName: string; mimeType: string; sizeBytes: number; sha256: string; uploadedAt: string }
export interface JourneySummary {
  classification: { goal: "IMPROVE_SCORE" | "START" | "GUIDE_YOUTH"; creditExperience: "UP_TO_DATE" | "LATE" | "NONE"; answeredAt: string } | null;
  sections: Partial<Record<SectionKey, string>>;
  documents: StoredDocument[];
  blocks: { work: boolean; wealth: boolean; habits: boolean; documents: boolean };
  completed: number; total: number; percent: number;
  taxReturn: { taxYear: number; status: "DRAFT" | "CONFIGURATION_REQUIRED"; answers?: { incomes: string[]; holdings: string[]; deductions: string[] }; requestedAt?: string } | null;
}
export interface FinancialContext {
  employment?: { situation: string; contractType: string; occupation: string; company: string };
  income?: { sources: Array<{ kind: string; monthlyCOP: number }>; withholding: boolean | null };
  assets?: { items: Array<{ kind: string; valueCOP: number }> };
  debts?: { cardSpendMonthlyCOP: number; totalDebtCOP: number; fixedExpensesMonthlyCOP: number; expenseKinds: string[] };
  recurring?: { paysRent: boolean; rentMonthlyCOP: number; socialSecurity: string; otherPayments: string[] };
}
export interface TaxCheck { taxYear: number; uvtCOP: number; ready: boolean; mayHaveToFile: boolean; criteria: Array<{ key: string; label: string; valueCOP: number; limitCOP: number; limitUvt: number; exceeds: boolean }> }
export interface FinancialProfileData extends JourneySummary { context: FinancialContext; taxCheck: TaxCheck }
export interface ProgressData {
  xp: number; level: number; floorXp: number; nextLevelXp: number; toNext: number; title: string; streakDays: number; paymentStreak: number;
  installmentsPaid: number; installmentsTotal: number; badgesEarned: number;
  badges: Array<{ key: string; title: string; hint: string; earned: boolean; tone: "blue" | "green" | "gold" | "violet"; progress?: string }>;
  missions: Array<{ key: string; title: string; xp: number; done: boolean; detail?: string; href: string }>;
}
