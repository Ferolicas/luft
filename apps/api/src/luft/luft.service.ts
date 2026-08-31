import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { differenceInCalendarDays, startOfDay } from 'date-fns';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { IntegrationService } from '../integrations/integration.service';
import { QueueService } from '../integrations/queue.service';
import { RealtimeService } from '../realtime/realtime.service';

const CONSENTS: Record<string, string> = {
  BUREAU_QUERY:
    'Autorizo de manera previa, expresa e informada a LUFT para consultar mi información ante operadores de información financiera con el propósito de realizar mi diagnóstico y medir la evolución de mi historial.',
  SCORE_SHARE_WITH_STARTIF:
    'Autorizo a LUFT a compartir con StartIF mi diagnóstico, arquetipo y puntaje estrictamente para estudiar y gestionar mi solicitud de crédito.',
  COMMUNICATIONS:
    'Autorizo recibir comunicaciones transaccionales y educativas por los canales que registré. Puedo retirar la autorización para mensajes no esenciales.',
};

@Injectable()
export class LuftService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly queues: QueueService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  pushConfig() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    return { enabled: Boolean(publicKey), publicKey: publicKey ?? null };
  }

  async dashboard(user: AuthenticatedUser) {
    const [
      profile,
      goals,
      modules,
      progress,
      streak,
      scoreInquiries,
      application,
      pqr,
    ] = await Promise.all([
      this.db.luft.financialProfile.findUnique({ where: { userId: user.id } }),
      this.db.luft.goal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.db.luft.educationModule.findMany({
        where: { published: true },
        orderBy: { position: 'asc' },
      }),
      this.db.luft.lessonProgress.findMany({ where: { userId: user.id } }),
      this.db.luft.streak.findUnique({ where: { userId: user.id } }),
      this.db.luft.scoreInquiry.findMany({
        where: { userId: user.id },
        orderBy: { requestedAt: 'desc' },
        take: 6,
      }),
      this.db.startif.creditApplication.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        include: {
          loan: {
            include: {
              installments: { orderBy: { sequence: 'asc' } },
              virtualCard: true,
            },
          },
          kycProcesses: { orderBy: { startedAt: 'desc' }, take: 1 },
        },
      }),
      this.db.startif.pqr.count({
        where: {
          userId: user.id,
          status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_USER'] },
        },
      }),
    ]);
    const completedLessons = new Set(
      progress
        .filter((item) => item.completedAt)
        .map((item) => `${item.moduleId}:${item.lessonKey}`),
    );
    return {
      user,
      profile: profile ?? {
        currentScore: null,
        archetype: null,
        completionPercent: 10,
      },
      streak: streak ?? { currentDays: 0, longestDays: 0 },
      goals: goals.map((goal) => ({
        ...goal,
        targetCOP: goal.targetCOP?.toString(),
      })),
      learning: modules.map((module) => ({
        ...module,
        completedLessons: [...completedLessons].filter((key) =>
          key.startsWith(module.id),
        ).length,
      })),
      scoreHistory: scoreInquiries,
      credit: application ? this.serializeCredit(application) : null,
      openPqr: pqr,
      integrations: this.integrations.status(),
    };
  }

  async acceptConsent(
    user: AuthenticatedUser,
    body: unknown,
    metadata: { ip?: string; userAgent?: string },
  ) {
    const input = z
      .object({
        kind: z.enum([
          'BUREAU_QUERY',
          'SCORE_SHARE_WITH_STARTIF',
          'COMMUNICATIONS',
        ]),
        accepted: z.literal(true),
        version: z.literal('2026-09-01'),
        deviceMeta: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(body);
    const text = CONSENTS[input.kind];
    const consent = await this.db.luft.consent.create({
      data: {
        userId: user.id,
        kind: input.kind,
        version: input.version,
        textSnapshot: text,
        textHash: this.crypto.hash(text),
        ipHash: metadata.ip ? this.crypto.hash(metadata.ip) : undefined,
        userAgent: metadata.userAgent?.slice(0, 500),
        deviceMeta: input.deviceMeta as any,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'consent.accepted',
      resource: 'Consent',
      resourceId: consent.id,
      ip: metadata.ip,
      payload: {
        kind: input.kind,
        version: input.version,
        textHash: consent.textHash,
      },
    });
    return consent;
  }

  async requestInitialScore(user: AuthenticatedUser, body: unknown) {
    const { provider } = z
      .object({
        provider: z.enum(['DATACREDITO', 'TRANSUNION']).default('DATACREDITO'),
      })
      .parse(body);
    const consent = await this.db.luft.consent.findFirst({
      where: { userId: user.id, kind: 'BUREAU_QUERY', revokedAt: null },
      orderBy: { acceptedAt: 'desc' },
    });
    if (!consent)
      throw new BadRequestException({
        code: 'consent_required',
        consent: 'BUREAU_QUERY',
      });
    const inquiry = await this.db.luft.scoreInquiry.create({
      data: { userId: user.id, type: 'INITIAL', provider },
    });
    await this.queues.add(
      'bureau',
      'query-score',
      { inquiryId: inquiry.id, userId: user.id, provider },
      inquiry.id,
    );
    this.realtime.toUser(user.id, 'score:status', {
      id: inquiry.id,
      status: inquiry.status,
    });
    return { inquiry, processing: true };
  }

  async questionnaire(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        answers: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
        version: z.literal('2026-09-01'),
      })
      .parse(body);
    const numeric = Object.values(input.answers).reduce<number>(
      (total, value) =>
        total +
        (typeof value === 'number'
          ? value
          : typeof value === 'boolean'
            ? value
              ? 2
              : 0
            : Math.min(String(value).length / 8, 4)),
      0,
    );
    const archetype =
      numeric >= 24
        ? 'ESTRATEGA'
        : numeric >= 16
          ? 'EXPLORADOR'
          : numeric >= 9
            ? 'CONSTRUCTOR'
            : 'INICIADOR';
    const score = Math.max(100, Math.min(900, Math.round(250 + numeric * 15)));
    const traits = {
      planning: Number(input.answers.planning ?? 0),
      consistency: Number(input.answers.consistency ?? 0),
      riskAwareness: Number(input.answers.riskAwareness ?? 0),
    };
    const [response, result, profile] = await this.db.luft.$transaction([
      this.db.luft.questionnaireResponse.create({
        data: {
          userId: user.id,
          version: input.version,
          answers: input.answers,
        },
      }),
      this.db.luft.archetypeResult.create({
        data: {
          userId: user.id,
          archetype,
          score,
          traits,
          ruleVersion: 'rules-2026.09',
        },
      }),
      this.db.luft.financialProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          archetype,
          demographicAnswers: input.answers,
          completionPercent: 45,
        },
        update: {
          archetype,
          demographicAnswers: input.answers,
          completionPercent: { increment: 25 },
        },
      }),
    ]);
    await this.db.scoring.scoreResult.create({
      data: {
        userId: user.id,
        decisionVersion: 'rules-2026.09',
        score,
        archetype,
        factors: traits,
        modelUsed: false,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'profile.questionnaire.completed',
      resource: 'QuestionnaireResponse',
      resourceId: response.id,
      payload: { archetype, score, ruleVersion: 'rules-2026.09' },
    });
    this.realtime.toUser(user.id, 'profile:updated', {
      archetype,
      completionPercent: profile.completionPercent,
    });
    return { result, profile };
  }

  async createGoal(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        kind: z.string().trim().min(2).max(80),
        title: z.string().trim().min(3).max(160),
        targetCOP: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
        targetDate: z.coerce.date().optional(),
      })
      .parse(body);
    return this.db.luft.goal.create({
      data: {
        userId: user.id,
        kind: input.kind,
        title: input.title,
        targetCOP: input.targetCOP ? BigInt(input.targetCOP) : undefined,
        targetDate: input.targetDate,
      },
    });
  }

  async updateGoal(user: AuthenticatedUser, goalId: string, body: unknown) {
    const { progress } = z
      .object({ progress: z.coerce.number().int().min(0).max(100) })
      .parse(body);
    const goal = await this.db.luft.goal.findFirst({
      where: { id: goalId, userId: user.id },
    });
    if (!goal) throw new BadRequestException('Meta no encontrada.');
    return this.db.luft.goal.update({
      where: { id: goal.id },
      data: { progress, completedAt: progress === 100 ? new Date() : null },
    });
  }

  async completeLesson(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        moduleId: z.string().uuid(),
        lessonKey: z.string().trim().min(1).max(80),
        score: z.coerce.number().int().min(0).max(100).optional(),
      })
      .parse(body);
    const progress = await this.db.luft.lessonProgress.upsert({
      where: {
        userId_moduleId_lessonKey: {
          userId: user.id,
          moduleId: input.moduleId,
          lessonKey: input.lessonKey,
        },
      },
      create: { ...input, userId: user.id, completedAt: new Date() },
      update: { score: input.score, completedAt: new Date() },
    });
    const now = startOfDay(new Date());
    const current = await this.db.luft.streak.findUnique({
      where: { userId: user.id },
    });
    const days = current?.lastActivity
      ? differenceInCalendarDays(now, current.lastActivity)
      : null;
    const currentDays =
      days === 0
        ? (current?.currentDays ?? 1)
        : days === 1
          ? (current?.currentDays ?? 0) + 1
          : 1;
    const streak = await this.db.luft.streak.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        currentDays: 1,
        longestDays: 1,
        lastActivity: now,
      },
      update: {
        currentDays,
        longestDays: Math.max(current?.longestDays ?? 0, currentDays),
        lastActivity: now,
      },
    });
    this.realtime.toUser(user.id, 'learning:completed', {
      progressId: progress.id,
      streak: streak.currentDays,
    });
    return { progress, streak };
  }

  async subscribePush(
    user: AuthenticatedUser,
    body: unknown,
    userAgent?: string,
  ) {
    const input = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({
          p256dh: z.string().min(20),
          auth: z.string().min(8),
        }),
      })
      .parse(body);
    const subscription = await this.db.identity.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: userAgent?.slice(0, 500),
      },
      update: {
        userId: user.id,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: userAgent?.slice(0, 500),
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'notifications.push.subscribed',
      resource: 'PushSubscription',
      resourceId: subscription.id,
    });
    return { ok: true };
  }

  private serializeCredit(application: any) {
    return {
      ...application,
      amountCOP: application.amountCOP.toString(),
      loan: application.loan
        ? {
            ...application.loan,
            principalCOP: application.loan.principalCOP.toString(),
            outstandingBalanceCOP:
              application.loan.outstandingBalanceCOP.toString(),
            virtualCard: application.loan.virtualCard
              ? {
                  ...application.loan.virtualCard,
                  fixedLimitCOP:
                    application.loan.virtualCard.fixedLimitCOP.toString(),
                }
              : null,
            installments: application.loan.installments.map((item: any) => ({
              ...item,
              openingBalanceCOP: item.openingBalanceCOP.toString(),
              amountCOP: item.amountCOP.toString(),
              principalCOP: item.principalCOP.toString(),
              interestCOP: item.interestCOP.toString(),
              closingBalanceCOP: item.closingBalanceCOP.toString(),
              paidCOP: item.paidCOP.toString(),
            })),
          }
        : null,
    };
  }
}
