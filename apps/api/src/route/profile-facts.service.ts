import { Injectable } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import type {
  Consent,
  FinancialProfile,
  FormalizationCase,
  LifeProject,
  ScoreInquiry,
} from '../generated/luft/client';
import { targetTaxYear, type FinancialContext } from '../luft/journey';
import { readJourneyState, type JourneyState } from '../luft/journey-state';
import type { CreditApplicationFacts, ProfileFactsInput } from './facts';

export interface ProfileBundle {
  userId: string;
  profile: FinancialProfile | null;
  state: JourneyState;
  context: FinancialContext;
  modules: Array<{
    id: string;
    slug: string;
    title: string;
    lessons: Array<{ key: string; title: string }>;
  }>;
  lessons: Array<{ moduleId: string; lessonKey: string; completedAt: Date }>;
  inquiries: ScoreInquiry[];
  applications: CreditApplicationFacts[];
  kyc: Array<{
    id: string;
    provider: string;
    status: string;
    completedAt: Date | null;
  }>;
  taxCase: FormalizationCase | null;
  consents: Consent[];
  startifConsentId: string | null;
  projects: LifeProject[];
  input: ProfileFactsInput;
}

function readLessons(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (row): row is { key: string; title?: unknown } =>
        Boolean(row) && typeof (row as { key?: unknown }).key === 'string',
    )
    .map((row) => ({
      key: row.key,
      title: typeof row.title === 'string' ? row.title : row.key,
    }));
}

/**
 * Loads, once, everything LUFT knows about a person that the pure rules need.
 * StartIF data is only read (never copied) and crossed by the user UUID.
 */
@Injectable()
export class ProfileFactsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
  ) {}

  decryptContext(state: JourneyState): FinancialContext {
    if (!state.context) return {};
    return JSON.parse(this.crypto.decrypt(state.context)) as FinancialContext;
  }

  async load(userId: string): Promise<ProfileBundle> {
    const [
      profile,
      modules,
      progress,
      inquiries,
      applications,
      kyc,
      taxCase,
      consents,
      startifConsent,
      projects,
      membership,
      opportunities,
    ] = await Promise.all([
      this.db.luft.financialProfile.findUnique({ where: { userId } }),
      this.db.luft.educationModule.findMany({
        where: { published: true },
        orderBy: { position: 'asc' },
      }),
      this.db.luft.lessonProgress.findMany({
        where: { userId, completedAt: { not: null } },
      }),
      this.db.luft.scoreInquiry.findMany({
        where: { userId },
        orderBy: { requestedAt: 'desc' },
      }),
      this.db.startif.creditApplication.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: {
          loan: { include: { installments: { orderBy: { sequence: 'asc' } } } },
        },
      }),
      this.db.startif.kycProcess.findMany({
        where: { userId, status: 'COMPLETED' },
        orderBy: { startedAt: 'asc' },
      }),
      this.db.luft.formalizationCase.findUnique({
        where: { userId_taxYear: { userId, taxYear: targetTaxYear() } },
      }),
      this.db.luft.consent.findMany({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
      }),
      this.db.startif.startifConsent.findFirst({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
        select: { id: true },
      }),
      this.db.luft.lifeProject.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.luft.householdMember.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: {
          household: {
            include: {
              members: { where: { status: 'ACTIVE' }, select: { role: true } },
              _count: { select: { goals: { where: { status: 'ACTIVE' } } } },
            },
          },
        },
      }),
      this.db.luft.opportunity.count({ where: { userId } }),
    ]);
    const state = readJourneyState(profile?.demographicAnswers);
    const context = this.decryptContext(state);
    const moduleViews = modules.map((module) => ({
      id: module.id,
      slug: module.slug,
      title: module.title,
      lessons: readLessons(module.lessons),
    }));
    const lessons = progress.map((row) => ({
      moduleId: row.moduleId,
      lessonKey: row.lessonKey,
      completedAt: row.completedAt as Date,
    }));
    const applicationFacts: CreditApplicationFacts[] = applications.map(
      (application) => ({
        id: application.id,
        status: application.status,
        createdAt: application.createdAt,
        productCode: (application as { productCode?: string | null })
          .productCode,
        loan: application.loan
          ? {
              status: application.loan.status,
              closedAt: application.loan.closedAt,
              installments: application.loan.installments.map((row) => ({
                id: row.id,
                sequence: row.sequence,
                status: row.status,
                dueDate: row.dueDate,
                paidAt: row.paidAt,
                amountCOP: row.amountCOP,
              })),
            }
          : null,
      }),
    );
    const members = membership?.household.members ?? [];
    const input: ProfileFactsInput = {
      classification: state.classification
        ? {
            goal: state.classification.goal,
            creditExperience: state.classification.creditExperience,
          }
        : null,
      context,
      sections: state.sections ?? {},
      documents: state.documents ?? [],
      currentScore: profile?.currentScore ?? null,
      existingHistory: profile?.existingHistory ?? null,
      inquiries: inquiries.map((row) => ({
        type: row.type,
        status: row.status,
      })),
      modules: moduleViews,
      lessons,
      applications: applicationFacts,
      formalizationStatus: taxCase?.status ?? null,
      household: membership
        ? {
            role: membership.role,
            beneficiaries: members.filter((row) => row.role !== 'SUPPORT')
              .length,
            support: members.filter((row) => row.role === 'SUPPORT').length,
            sharedGoals: membership.household._count.goals,
          }
        : null,
      projects: projects.map((row) => ({ kind: row.kind, status: row.status })),
      opportunities,
    };
    return {
      userId,
      profile,
      state,
      context,
      modules: moduleViews,
      lessons,
      inquiries,
      applications: applicationFacts,
      kyc: kyc.map((row) => ({
        id: row.id,
        provider: row.provider,
        status: row.status,
        completedAt: row.completedAt,
      })),
      taxCase,
      consents,
      startifConsentId: startifConsent?.id ?? null,
      projects,
      input,
    };
  }
}
