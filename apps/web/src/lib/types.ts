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
}

export interface CreditData {
  id: string; status: string; amountCOP: string; termMonths: number;
  kycProcesses?: Array<{ id: string; status: string; verificationUrl?: string }>;
  signatures?: Array<{ id: string; status: string; signedAt?: string }>;
  loan?: { id: string; outstandingBalanceCOP: string; principalCOP: string; virtualCard?: { last4: string; fixedLimitCOP: string; status: string }; installments: Array<{ id: string; sequence: number; dueDate: string; amountCOP: string; paidCOP: string; status: string }> };
}
