import type { ArchetypeFacts } from '../catalog/archetype-engine';
import type { CapacityFacts } from '../cards/cards';
import {
  isFormalizationStatus,
  type FormalizationStatus,
} from '../formalization/formalization';
import {
  profileBlocks,
  type DocumentKind,
  type FinancialContext,
  type SectionKey,
  type StoredDocument,
} from '../luft/journey';
import { NO_CREDIT, type CreditFact, type RouteFacts } from './route';

/**
 * Pure builders that turn what is stored about a person into the fact sets
 * used by the archetype engine, the route machine and the capacity checks.
 */

export interface CreditApplicationFacts {
  id: string;
  status: string;
  createdAt: Date;
  productCode?: string | null;
  loan: {
    status: string;
    closedAt: Date | null;
    installments: Array<{
      id: string;
      sequence: number;
      status: string;
      dueDate: Date;
      paidAt: Date | null;
      amountCOP: bigint | number;
    }>;
  } | null;
}

export interface ProfileFactsInput {
  classification: { goal: string; creditExperience: string } | null;
  context: FinancialContext;
  sections: Partial<Record<SectionKey, string>>;
  documents: StoredDocument[];
  currentScore: number | null;
  existingHistory: boolean | null;
  inquiries: Array<{ type: string; status: string }>;
  modules: Array<{ id: string; lessons: Array<{ key: string }> }>;
  lessons: Array<{ moduleId: string; lessonKey: string; completedAt: Date }>;
  applications: CreditApplicationFacts[];
  formalizationStatus: string | null;
  household: {
    role: string;
    beneficiaries: number;
    support: number;
    sharedGoals: number;
  } | null;
  projects: Array<{ kind: string; status: string }>;
  opportunities: number;
}

export function creditFact(
  application: CreditApplicationFacts | undefined,
): CreditFact {
  if (!application) return NO_CREDIT;
  const loan = application.loan;
  if (!loan)
    return {
      ...NO_CREDIT,
      state: application.status === 'REJECTED' ? 'REJECTED' : 'IN_PROCESS',
    };
  const paid = loan.installments.filter((row) =>
    ['PAID', 'WAIVED'].includes(row.status),
  ).length;
  return {
    state:
      loan.status === 'COMPLETED'
        ? 'COMPLETED'
        : ['DEFAULTED', 'WRITTEN_OFF'].includes(loan.status)
          ? 'DEFAULTED'
          : 'ACTIVE',
    installmentsPaid: paid,
    installmentsTotal: loan.installments.length,
    overdue: loan.installments.filter((row) => row.status === 'OVERDUE').length,
  };
}

const preferred = (applications: CreditApplicationFacts[]) =>
  applications.find((item) => item.loan) ?? applications.at(-1);

/**
 * Tells the two builder credits apart. When StartIF labels the product
 * (`productCode`), that label decides. Otherwise the first disbursed credit is
 * builder 1 and a later application, after it was fully paid, is builder 2.
 */
export function splitCredits(applications: CreditApplicationFacts[]) {
  const ordered = [...applications].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  if (ordered.some((item) => typeof item.productCode === 'string'))
    return {
      first: preferred(
        ordered.filter((item) => item.productCode !== 'BUILDER_2'),
      ),
      second: preferred(
        ordered.filter((item) => item.productCode === 'BUILDER_2'),
      ),
    };
  const first = preferred(ordered);
  const second =
    first?.loan?.status === 'COMPLETED'
      ? preferred(
          ordered.filter(
            (item) => item.createdAt.getTime() > first.createdAt.getTime(),
          ),
        )
      : undefined;
  return { first, second };
}

export function completedModules(
  modules: ProfileFactsInput['modules'],
  lessons: ProfileFactsInput['lessons'],
) {
  const done = new Set(
    lessons.map((lesson) => `${lesson.moduleId}:${lesson.lessonKey}`),
  );
  return modules.filter(
    (module) =>
      module.lessons.length > 0 &&
      module.lessons.every((lesson) => done.has(`${module.id}:${lesson.key}`)),
  ).length;
}

const onTime = (row: { status: string; dueDate: Date; paidAt: Date | null }) =>
  row.status === 'PAID' &&
  row.paidAt !== null &&
  row.paidAt.toISOString().slice(0, 10) <=
    row.dueDate.toISOString().slice(0, 10);

/** Facts for the archetype rules. Only data the app really collects. */
export function archetypeFacts(input: ProfileFactsInput): ArchetypeFacts {
  const { context } = input;
  const sources = context.income?.sources ?? [];
  const assets = context.assets?.items ?? [];
  const installments = input.applications.flatMap(
    (item) => item.loan?.installments ?? [],
  );
  const activeProjects = input.projects.filter(
    (project) => project.status === 'ACTIVE',
  );
  return {
    goal: input.classification?.goal ?? null,
    creditExperience: input.classification?.creditExperience ?? null,
    employmentSituation: context.employment?.situation ?? null,
    contractType: context.employment?.contractType ?? null,
    incomeKinds: context.income
      ? [...new Set(sources.map((row) => row.kind))]
      : null,
    incomeSourceCount: context.income ? sources.length : null,
    monthlyIncomeCOP: context.income
      ? sources.reduce((total, row) => total + row.monthlyCOP, 0)
      : null,
    hasWithholding: context.income?.withholding ?? null,
    assetKinds: context.assets
      ? [
          ...new Set(
            assets.filter((row) => row.valueCOP > 0).map((row) => row.kind),
          ),
        ]
      : null,
    totalAssetsCOP: context.assets
      ? assets.reduce((total, row) => total + row.valueCOP, 0)
      : null,
    totalDebtCOP: context.debts?.totalDebtCOP ?? null,
    paysRent: context.recurring?.paysRent ?? null,
    socialSecurity: context.recurring?.socialSecurity ?? null,
    existingHistory: input.existingHistory,
    currentScore: input.currentScore,
    lessonsCompleted: input.lessons.length,
    modulesCompleted: completedModules(input.modules, input.lessons),
    creditActive: input.applications.some(
      (item) => item.loan && item.loan.status === 'ACTIVE',
    ),
    onTimeInstallments: installments.filter(onTime).length,
    householdRole: input.household?.role ?? null,
    householdBeneficiaries: input.household?.beneficiaries ?? 0,
    householdSupportMembers: input.household?.support ?? 0,
    sharedGoals: input.household?.sharedGoals ?? 0,
    lifeProjects: activeProjects.length,
    lifeProjectKinds: [...new Set(activeProjects.map((item) => item.kind))],
  };
}

/**
 * Facts for the route machine. A later route (new life stage or project)
 * counts learning and credit only since it started.
 */
export function routeFacts(
  input: ProfileFactsInput,
  options: {
    archetypeAssigned: boolean;
    requiredDocuments: DocumentKind[];
    since?: Date | null;
  },
): RouteFacts {
  const since = options.since?.getTime() ?? 0;
  const lessons = input.lessons.filter(
    (lesson) => lesson.completedAt.getTime() >= since,
  );
  const applications = input.applications.filter(
    (item) => item.createdAt.getTime() >= since,
  );
  const { first, second } = splitCredits(applications);
  const kinds = new Set(input.documents.map((document) => document.kind));
  const formalization: FormalizationStatus = isFormalizationStatus(
    input.formalizationStatus,
  )
    ? input.formalizationStatus
    : 'SIN_EVALUAR';
  // Inquiries arrive newest first: only an open request counts as "in progress".
  const latestInitial = input.inquiries.find((item) => item.type === 'INITIAL');
  return {
    classified: Boolean(input.classification),
    bureauRequested:
      latestInitial !== undefined &&
      ['PENDING', 'PROCESSING', 'CONFIGURATION_REQUIRED'].includes(
        latestInitial.status,
      ),
    bureauCompleted: input.inquiries.some(
      (item) => item.status === 'COMPLETED',
    ),
    archetypeAssigned: options.archetypeAssigned,
    incomeDeclared: profileBlocks(input.sections, input.documents).blocks.work,
    formalization,
    requiredDocuments: options.requiredDocuments.length,
    requiredDocumentsUploaded: options.requiredDocuments.filter((kind) =>
      kinds.has(kind),
    ).length,
    lessonsCompleted: lessons.length,
    modulesCompleted: completedModules(input.modules, lessons),
    credit1: creditFact(first),
    credit2: creditFact(second),
    finalScoreCompleted: input.inquiries.some(
      (item) => item.type === 'FINAL' && item.status === 'COMPLETED',
    ),
    matchingAvailable: input.opportunities > 0,
    lifeProjects: input.projects.filter((item) => item.status === 'ACTIVE')
      .length,
  };
}

/**
 * Monthly capacity declared in the financial profile: income minus fixed
 * expenses and the builder-credit installment that is currently due.
 */
export function capacityFacts(input: ProfileFactsInput): CapacityFacts | null {
  const { context } = input;
  if (!context.income || !context.debts) return null;
  const nextInstallment = input.applications
    .flatMap((item) =>
      item.loan && item.loan.status === 'ACTIVE' ? item.loan.installments : [],
    )
    .filter((row) => !['PAID', 'WAIVED'].includes(row.status))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  return {
    monthlyIncomeCOP: context.income.sources.reduce(
      (total, row) => total + row.monthlyCOP,
      0,
    ),
    monthlyCommitmentsCOP:
      context.debts.fixedExpensesMonthlyCOP +
      (nextInstallment ? Number(nextInstallment.amountCOP) : 0),
  };
}

export function monthlyCapacity(input: ProfileFactsInput): number | null {
  const capacity = capacityFacts(input);
  return capacity
    ? Math.max(0, capacity.monthlyIncomeCOP - capacity.monthlyCommitmentsCOP)
    : null;
}
