import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  PLAN_CODES,
  planView,
  quoteSubscription,
} from '../catalog/catalog-rules';
import { CatalogService } from '../catalog/catalog.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import {
  CONSENT_TEXTS,
  CONSENT_VERSION,
  isActive,
} from '../consents/consent-catalog';
import { DatabaseService } from '../database/database.service';
import type {
  Contribution,
  Household,
  HouseholdInvitation,
  HouseholdMember,
  SharedGoal,
  Subscription,
} from '../generated/luft/client';
import { IntegrationService } from '../integrations/integration.service';
import { isUniqueViolation } from '../luft/http';
import { RealtimeService } from '../realtime/realtime.service';
import { completedModules, creditFact, splitCredits } from '../route/facts';
import { isRouteStage, ROUTE_STAGE_LABELS } from '../route/route';
import { RouteService } from '../route/route.service';
import { DocumentVaultService } from '../vault/document-vault.service';
import {
  aggregateBoard,
  canResolveContribution,
  goalProgress,
  inviteDecision,
  memberView,
  METRIC_LABELS,
  normalizePermissions,
  permissionsSchema,
  PRIVATE_PERMISSIONS,
  seatUsage,
  SHARE_LEVELS,
  type HouseholdRole,
  type MemberMetrics,
  type MemberRecord,
} from './privacy';

const INVITATION_DAYS = 7;
const CONTRIBUTION_SUPPORT = 'CONTRIBUTION_SUPPORT';
const cop = z.coerce.number().int().min(1).max(100_000_000_000);

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const firstName = (fullName?: string | null) =>
  fullName?.trim().split(/\s+/)[0] ?? 'Integrante';
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] as string,
  );

type Membership = HouseholdMember & { household: Household };

@Injectable()
export class HouseholdService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly integrations: IntegrationService,
    private readonly config: ConfigService,
    private readonly catalog: CatalogService,
    private readonly routes: RouteService,
    private readonly vault: DocumentVaultService,
  ) {}

  // ---- Subscription ------------------------------------------------------

  private liveSubscription(userId: string) {
    return this.db.luft.subscription.findFirst({
      where: { userId, status: { in: ['SELECTED', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A selected plan becomes active once the buyer's own builder credit exists (real fact). */
  private async refreshSubscription(subscription: Subscription | null) {
    if (!subscription || subscription.status !== 'SELECTED')
      return subscription;
    const loan = await this.db.startif.loan.findFirst({
      where: { userId: subscription.userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (!loan) return subscription;
    return this.db.luft.subscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', activatedAt: loan.createdAt },
    });
  }

  private subscriptionView(subscription: Subscription | null) {
    if (!subscription) return null;
    return {
      id: subscription.id,
      planCode: subscription.planCode,
      seats: subscription.seats,
      basePriceCOP: Number(subscription.basePriceCOP),
      discountPercent: Number(subscription.discountPercent),
      pricePerSeatCOP: Number(subscription.pricePerSeatCOP),
      totalCOP: Number(subscription.totalCOP),
      status: subscription.status,
      activatedAt: subscription.activatedAt,
      createdAt: subscription.createdAt,
    };
  }

  private async seats(ownerUserId: string, householdId?: string) {
    const subscription = await this.liveSubscription(ownerUserId);
    const [beneficiaries, pending] = householdId
      ? await Promise.all([
          this.db.luft.householdMember.count({
            where: { householdId, status: 'ACTIVE', role: 'BENEFICIARY' },
          }),
          this.db.luft.householdInvitation.count({
            where: {
              householdId,
              status: 'PENDING',
              seatAssigned: true,
              expiresAt: { gt: new Date() },
            },
          }),
        ])
      : [0, 0];
    return seatUsage({
      seats: subscription?.seats ?? 1,
      beneficiaries,
      pendingSeatInvitations: pending,
    });
  }

  async subscription(user: AuthenticatedUser) {
    const [subscription, plans, household] = await Promise.all([
      this.liveSubscription(user.id).then((row) =>
        this.refreshSubscription(row),
      ),
      this.catalog.activePlans(),
      this.db.luft.household.findUnique({ where: { ownerUserId: user.id } }),
    ]);
    return {
      subscription: this.subscriptionView(subscription),
      plans: plans.map(planView),
      seats: await this.seats(user.id, household?.id),
      note: 'Cada identidad del plan conserva su propia cuenta, su expediente y sus productos. El plan solo define cuántas rutas completas incluye tu paquete.',
    };
  }

  /** The buyer chooses or changes plan and seats; seats in use can never be dropped. */
  async chooseSubscription(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        planCode: z.enum(PLAN_CODES),
        seats: z.coerce.number().int().min(1).max(20).optional(),
      })
      .strict()
      .parse(body);
    const plan = (await this.catalog.activePlans()).find(
      (item) => item.code === input.planCode,
    );
    if (!plan) throw new NotFoundException('Plan no disponible.');
    const quote = quoteSubscription(plan, input.seats ?? plan.minSeats);
    if (!quote.ok) throw new BadRequestException(quote.reason);
    const household = await this.db.luft.household.findUnique({
      where: { ownerUserId: user.id },
    });
    const usage = await this.seats(user.id, household?.id);
    if (quote.seats < usage.used)
      throw new ConflictException({
        code: 'seats_in_use',
        message: `Tienes ${usage.used} cupos en uso entre integrantes e invitaciones. Retira integrantes antes de reducir tu plan.`,
      });
    const current = await this.refreshSubscription(
      await this.liveSubscription(user.id),
    );
    if (
      current &&
      current.planCode === plan.code &&
      current.seats === quote.seats &&
      Number(current.pricePerSeatCOP) === quote.pricePerSeatCOP
    )
      return this.subscription(user);
    const now = new Date();
    const created = await this.db.luft.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { userId: user.id, status: { in: ['SELECTED', 'ACTIVE'] } },
        data: { status: 'REPLACED', endedAt: now },
      });
      return tx.subscription.create({
        data: {
          userId: user.id,
          planCode: plan.code,
          seats: quote.seats,
          basePriceCOP: BigInt(quote.basePriceCOP),
          discountPercent: quote.discountPercent,
          pricePerSeatCOP: BigInt(quote.pricePerSeatCOP),
          totalCOP: BigInt(quote.totalCOP),
          status: current?.status === 'ACTIVE' ? 'ACTIVE' : 'SELECTED',
          activatedAt:
            current?.status === 'ACTIVE' ? current.activatedAt : null,
        },
      });
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'subscription.plan_selected',
      resource: 'Subscription',
      resourceId: created.id,
      payload: {
        planCode: plan.code,
        seats: quote.seats,
        pricePerSeatCOP: quote.pricePerSeatCOP,
        totalCOP: quote.totalCOP,
        discountPercent: quote.discountPercent,
        previous: current?.planCode ?? null,
      },
    });
    return this.subscription(user);
  }

  // ---- Membership --------------------------------------------------------

  private membership(userId: string): Promise<Membership | null> {
    return this.db.luft.householdMember.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { household: true },
    });
  }

  private async requireMembership(userId: string) {
    const membership = await this.membership(userId);
    if (!membership)
      throw new NotFoundException({
        code: 'no_household',
        message: 'Aún no haces parte de un hogar LUFT.',
      });
    return membership;
  }

  private async requireOwner(userId: string) {
    const membership = await this.requireMembership(userId);
    if (membership.role !== 'OWNER')
      throw new ForbiddenException(
        'Solo quien creó el hogar puede hacer este cambio.',
      );
    return membership;
  }

  private async recordConsent(
    userId: string,
    householdId: string,
    metadata: { ip?: string; userAgent?: string },
    role: string,
  ) {
    const text = CONSENT_TEXTS.HOUSEHOLD_SHARING;
    const consent = await this.db.luft.consent.create({
      data: {
        userId,
        kind: 'HOUSEHOLD_SHARING',
        version: CONSENT_VERSION,
        textSnapshot: text,
        textHash: this.crypto.hash(text),
        ipHash: metadata.ip ? this.crypto.hash(metadata.ip) : undefined,
        userAgent: metadata.userAgent?.slice(0, 500),
        scope: [
          'Métricas que autorices una por una',
          'Metas compartidas',
          'Aportes',
        ],
        deviceMeta: { householdId, role },
      },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'consent.accepted',
      resource: 'Consent',
      resourceId: consent.id,
      ip: metadata.ip,
      payload: {
        kind: 'HOUSEHOLD_SHARING',
        version: CONSENT_VERSION,
        textHash: consent.textHash,
        householdId,
      },
    });
    return consent;
  }

  async create(
    user: AuthenticatedUser,
    body: unknown,
    metadata: { ip?: string; userAgent?: string },
  ) {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        accepted: z.literal(true),
      })
      .strict()
      .parse(body);
    if (await this.membership(user.id))
      throw new ConflictException({
        code: 'already_in_household',
        message: 'Ya haces parte de un hogar LUFT.',
      });
    let household: Household;
    try {
      household = await this.db.luft.household.create({
        data: { ownerUserId: user.id, name: input.name },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The owner left an empty household behind: it is reused, never duplicated.
      household = await this.db.luft.household.update({
        where: { ownerUserId: user.id },
        data: { name: input.name },
      });
    }
    const consent = await this.recordConsent(
      user.id,
      household.id,
      metadata,
      'OWNER',
    );
    await this.db.luft.householdMember.create({
      data: {
        householdId: household.id,
        userId: user.id,
        role: 'OWNER',
        seatAssigned: true,
        permissions: PRIVATE_PERMISSIONS,
        consentId: consent.id,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.created',
      resource: 'Household',
      resourceId: household.id,
    });
    return this.board(user);
  }

  async rename(user: AuthenticatedUser, body: unknown) {
    const { name } = z
      .object({ name: z.string().trim().min(2).max(80) })
      .strict()
      .parse(body);
    const membership = await this.requireOwner(user.id);
    await this.db.luft.household.update({
      where: { id: membership.householdId },
      data: { name },
    });
    return this.board(user);
  }

  // ---- Board -------------------------------------------------------------

  private async records(members: HouseholdMember[]): Promise<MemberRecord[]> {
    const userIds = members.map((member) => member.userId);
    const [people, routes, assignments, lessons, modules, profiles, credits] =
      await Promise.all([
        this.db.identity.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        }),
        this.db.luft.userRoute.findMany({
          where: { userId: { in: userIds }, status: 'ACTIVE' },
          include: { category: true },
        }),
        this.db.luft.archetypeAssignment.findMany({
          where: { userId: { in: userIds }, supersededAt: null },
        }),
        this.db.luft.lessonProgress.findMany({
          where: { userId: { in: userIds }, completedAt: { not: null } },
          select: {
            userId: true,
            moduleId: true,
            lessonKey: true,
            completedAt: true,
          },
        }),
        this.db.luft.educationModule.findMany({ where: { published: true } }),
        this.db.luft.financialProfile.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, currentScore: true },
        }),
        this.db.startif.creditApplication.findMany({
          where: { userId: { in: userIds } },
          orderBy: { createdAt: 'asc' },
          include: { loan: { include: { installments: true } } },
        }),
      ]);
    const moduleFacts = modules.map((module) => ({
      id: module.id,
      lessons: (Array.isArray(module.lessons) ? module.lessons : []) as Array<{
        key: string;
      }>,
    }));
    return members.map((member) => {
      const route = routes.find((row) => row.userId === member.userId);
      const assignment = assignments.find(
        (row) => row.userId === member.userId,
      );
      const own = lessons
        .filter((row) => row.userId === member.userId)
        .map((row) => ({
          moduleId: row.moduleId,
          lessonKey: row.lessonKey,
          completedAt: row.completedAt as Date,
        }));
      const score = profiles.find(
        (row) => row.userId === member.userId,
      )?.currentScore;
      const applications = credits
        .filter((row) => row.userId === member.userId)
        .map((row) => ({
          id: row.id,
          status: row.status,
          createdAt: row.createdAt,
          productCode: (row as { productCode?: string | null }).productCode,
          loan: row.loan
            ? {
                status: row.loan.status,
                closedAt: row.loan.closedAt,
                installments: row.loan.installments,
              }
            : null,
        }));
      const split = splitCredits(applications);
      const credit = creditFact(
        split.second?.loan ? split.second : split.first,
      );
      const stage = route && isRouteStage(route.stage) ? route.stage : null;
      const metrics: MemberMetrics = {
        routeProgress:
          route && stage
            ? {
                percent: route.progressPercent,
                stage,
                stageLabel: ROUTE_STAGE_LABELS[stage],
              }
            : null,
        archetype: route
          ? {
              categoryCode: route.category.code,
              categoryBrand: route.category.brand,
              archetypeName: assignment?.archetypeName ?? null,
            }
          : null,
        learning: {
          lessonsCompleted: own.length,
          modulesCompleted: completedModules(moduleFacts, own),
        },
        credit:
          credit.state === 'NONE'
            ? null
            : {
                state: credit.state,
                installmentsPaid: credit.installmentsPaid,
                installmentsTotal: credit.installmentsTotal,
                upToDate:
                  credit.overdue === 0 &&
                  ['ACTIVE', 'COMPLETED'].includes(credit.state),
              },
        score: score == null ? null : { value: score },
      };
      return {
        memberId: member.id,
        userId: member.userId,
        firstName: firstName(
          people.find((row) => row.id === member.userId)?.fullName,
        ),
        role: member.role as HouseholdRole,
        seatAssigned: member.seatAssigned,
        joinedAt: member.joinedAt,
        permissions: normalizePermissions(member.permissions),
        metrics,
      };
    });
  }

  private invitationView(invitation: HouseholdInvitation) {
    const expired =
      invitation.status === 'PENDING' &&
      invitation.expiresAt.getTime() < Date.now();
    return {
      id: invitation.id,
      role: invitation.role,
      seatAssigned: invitation.seatAssigned,
      inviteeName: invitation.inviteeName,
      channel: invitation.channel,
      status: expired ? 'EXPIRED' : invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }

  private goalView(
    goal: SharedGoal & { contributions: Contribution[] },
    viewerUserId: string,
    names: Map<string, string>,
  ) {
    const progress = goalProgress(
      Number(goal.targetCOP),
      goal.contributions.map((row) => ({
        amountCOP: Number(row.amountCOP),
        status: row.status,
      })),
    );
    const mine = goal.ownerUserId === viewerUserId;
    return {
      id: goal.id,
      title: goal.title,
      kind: goal.kind,
      targetCOP: Number(goal.targetCOP),
      targetDate: goal.targetDate
        ? goal.targetDate.toISOString().slice(0, 10)
        : null,
      status: goal.status,
      ownerName: names.get(goal.ownerUserId) ?? 'Integrante',
      isMine: mine,
      ...progress,
      contributions: goal.contributions
        .sort((a, b) => b.declaredAt.getTime() - a.declaredAt.getTime())
        .map((row) => ({
          id: row.id,
          amountCOP: Number(row.amountCOP),
          note: row.note,
          status: row.status,
          declaredAt: row.declaredAt,
          resolvedAt: row.resolvedAt,
          contributorName: names.get(row.contributorUserId) ?? 'Integrante',
          isMine: row.contributorUserId === viewerUserId,
          hasSupport: Boolean(row.documentId),
          canResolve: mine && row.status === 'DECLARED',
        })),
    };
  }

  /**
   * Household board. Members are listed for everyone, but each metric is
   * only included when that member opened it to the viewer's role.
   */
  async board(user: AuthenticatedUser) {
    const membership = await this.membership(user.id);
    if (!membership)
      return {
        household: null,
        me: null,
        members: [],
        board: null,
        seats: null,
        invitations: [],
        goals: [],
        metricLabels: METRIC_LABELS,
        shareLevels: SHARE_LEVELS,
        consent: {
          kind: 'HOUSEHOLD_SHARING',
          version: CONSENT_VERSION,
          text: CONSENT_TEXTS.HOUSEHOLD_SHARING,
        },
      };
    const { household } = membership;
    const isOwner = membership.role === 'OWNER';
    const [members, goals, invitations] = await Promise.all([
      this.db.luft.householdMember.findMany({
        where: { householdId: household.id, status: 'ACTIVE' },
        orderBy: { joinedAt: 'asc' },
      }),
      this.db.luft.sharedGoal.findMany({
        where: { householdId: household.id, status: { not: 'CANCELLED' } },
        include: { contributions: true },
        orderBy: { createdAt: 'desc' },
      }),
      isOwner
        ? this.db.luft.householdInvitation.findMany({
            where: { householdId: household.id, status: 'PENDING' },
            orderBy: { createdAt: 'desc' },
          })
        : [],
    ]);
    const records = await this.records(members);
    const viewer = { userId: user.id, role: membership.role as HouseholdRole };
    const names = new Map(records.map((row) => [row.userId, row.firstName]));
    // Contributors who already left keep a first name on their past contributions.
    const missing = [
      ...new Set(
        goals
          .flatMap((goal) => [
            goal.ownerUserId,
            ...goal.contributions.map((row) => row.contributorUserId),
          ])
          .filter((id) => !names.has(id)),
      ),
    ];
    if (missing.length)
      for (const person of await this.db.identity.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, fullName: true },
      }))
        names.set(person.id, firstName(person.fullName));
    return {
      household: {
        id: household.id,
        name: household.name,
        createdAt: household.createdAt,
        isOwner,
      },
      me: {
        memberId: membership.id,
        role: membership.role,
        seatAssigned: membership.seatAssigned,
        permissions: normalizePermissions(membership.permissions),
      },
      members: records.map((record) => memberView(viewer, record)),
      board: aggregateBoard(viewer, records),
      seats: isOwner
        ? await this.seats(household.ownerUserId, household.id)
        : null,
      invitations: invitations.map((row) => this.invitationView(row)),
      goals: goals.map((goal) => this.goalView(goal, user.id, names)),
      metricLabels: METRIC_LABELS,
      shareLevels: SHARE_LEVELS,
      consent: {
        kind: 'HOUSEHOLD_SHARING',
        version: CONSENT_VERSION,
        text: CONSENT_TEXTS.HOUSEHOLD_SHARING,
      },
    };
  }

  // ---- Invitations -------------------------------------------------------

  async invite(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        role: z.enum(['BENEFICIARY', 'SUPPORT']),
        inviteeName: z.string().trim().min(2).max(80).optional(),
        email: z.string().trim().toLowerCase().email().max(160).optional(),
        phone: z
          .string()
          .trim()
          .regex(/^\+?[1-9]\d{9,14}$/)
          .optional(),
      })
      .strict()
      .parse(body);
    const membership = await this.requireMembership(user.id);
    const { household } = membership;
    const [activeMembers, pending, usage] = await Promise.all([
      this.db.luft.householdMember.count({
        where: { householdId: household.id, status: 'ACTIVE' },
      }),
      this.db.luft.householdInvitation.count({
        where: {
          householdId: household.id,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      }),
      this.seats(household.ownerUserId, household.id),
    ]);
    const decision = inviteDecision({
      inviterRole: membership.role as HouseholdRole,
      role: input.role,
      seatsAvailable: usage.available,
      activeMembers,
      pendingInvitations: pending,
    });
    if (!decision.ok)
      throw new ConflictException({
        code: decision.code,
        message: decision.message,
      });
    const token = this.crypto.randomToken(32);
    const contact = input.email ?? input.phone;
    const invitation = await this.db.luft.householdInvitation.create({
      data: {
        householdId: household.id,
        invitedBy: user.id,
        role: input.role,
        seatAssigned: input.role === 'BENEFICIARY',
        tokenHash: hashToken(token),
        inviteeName: input.inviteeName,
        channel: input.email ? 'EMAIL' : input.phone ? 'WHATSAPP' : 'LINK',
        contactCiphertext: contact ? this.crypto.encrypt(contact) : undefined,
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
      },
    });
    const link = `${this.config.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/invitacion/${token}`;
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.invitation.created',
      resource: 'HouseholdInvitation',
      resourceId: invitation.id,
      payload: {
        householdId: household.id,
        role: input.role,
        seatAssigned: invitation.seatAssigned,
        channel: invitation.channel,
      },
    });
    const inviter = firstName(user.fullName);
    const purpose =
      input.role === 'SUPPORT'
        ? 'ser parte de su red de apoyo'
        : 'activar tu propia ruta financiera dentro de su paquete';
    const delivery: Array<{ channel: string; status: string }> = [];
    const attempt = async (
      channel: string,
      send: () => Promise<{ status: string }>,
    ) => {
      try {
        const result = await send();
        delivery.push({
          channel,
          status: result.status === 'ready' ? 'SENT' : 'CONFIGURATION_REQUIRED',
        });
      } catch {
        delivery.push({ channel, status: 'FAILED' });
      }
    };
    if (input.email)
      await attempt('EMAIL', () =>
        this.integrations.sendEmail(
          input.email as string,
          `${inviter} te invitó a su hogar en LUFT`,
          `<h1>Hola${input.inviteeName ? `, ${escapeHtml(input.inviteeName)}` : ''}</h1><p>${escapeHtml(inviter)} te invitó al hogar «${escapeHtml(household.name)}» en LUFT para ${purpose}. Tu cuenta, tu perfil y tus productos son tuyos e independientes: solo compartes lo que autorices.</p><p><a href="${link}">Aceptar la invitación</a></p><p>El enlace vence en ${INVITATION_DAYS} días y solo sirve una vez.</p>`,
        ),
      );
    if (input.phone)
      await attempt('WHATSAPP', () =>
        this.integrations.sendWhatsApp(
          input.phone as string,
          `LUFT: ${inviter} te invitó al hogar "${household.name}" para ${purpose}. Tu perfil sigue siendo tuyo e independiente. Acepta aquí: ${link} (vence en ${INVITATION_DAYS} días).`,
        ),
      );
    return {
      invitation: this.invitationView(invitation),
      link,
      delivery,
    };
  }

  async revokeInvitation(user: AuthenticatedUser, id: string) {
    const membership = await this.requireOwner(user.id);
    const revoked = await this.db.luft.householdInvitation.updateMany({
      where: { id, householdId: membership.householdId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (!revoked.count)
      throw new NotFoundException('Invitación no encontrada.');
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.invitation.revoked',
      resource: 'HouseholdInvitation',
      resourceId: id,
    });
    return this.board(user);
  }

  private async invitationByToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(token))
      throw new NotFoundException('Invitación no encontrada.');
    const invitation = await this.db.luft.householdInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { household: true },
    });
    if (!invitation) throw new NotFoundException('Invitación no encontrada.');
    return invitation;
  }

  /** Public preview of an invitation: no identifiers, no contact data, no metrics. */
  async invitationPreview(token: string) {
    const invitation = await this.invitationByToken(token);
    const inviter = await this.db.identity.user.findUnique({
      where: { id: invitation.invitedBy },
      select: { fullName: true },
    });
    const view = this.invitationView(invitation);
    return {
      status: view.status,
      householdName: invitation.household.name,
      inviterFirstName: firstName(inviter?.fullName),
      role: invitation.role,
      seatAssigned: invitation.seatAssigned,
      expiresAt: invitation.expiresAt,
      consent: {
        kind: 'HOUSEHOLD_SHARING',
        version: CONSENT_VERSION,
        text: CONSENT_TEXTS.HOUSEHOLD_SHARING,
      },
      metricLabels: METRIC_LABELS,
      shareLevels: SHARE_LEVELS,
    };
  }

  /**
   * The invited adult accepts with their own account and their own consent.
   * Nothing is merged: the member keeps an independent file, route and score.
   */
  async acceptInvitation(
    user: AuthenticatedUser,
    token: string,
    body: unknown,
    metadata: { ip?: string; userAgent?: string },
  ) {
    const input = z
      .object({
        accepted: z.literal(true),
        version: z.literal(CONSENT_VERSION),
        permissions: permissionsSchema.optional(),
      })
      .strict()
      .parse(body);
    const invitation = await this.invitationByToken(token);
    if (invitation.status !== 'PENDING')
      throw new GoneException({
        code: 'invitation_used',
        message: 'Esta invitación ya fue usada o cancelada.',
      });
    if (invitation.expiresAt.getTime() < Date.now())
      throw new GoneException({
        code: 'invitation_expired',
        message: 'Esta invitación venció. Pide una nueva a quien te invitó.',
      });
    if (invitation.invitedBy === user.id)
      throw new BadRequestException('No puedes aceptar tu propia invitación.');
    if (await this.membership(user.id))
      throw new ConflictException({
        code: 'already_in_household',
        message:
          'Ya haces parte de un hogar LUFT. Sal de ese hogar antes de aceptar otra invitación.',
      });
    // Single use: only one request can flip the invitation out of PENDING.
    const claimed = await this.db.luft.householdInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedBy: user.id, acceptedAt: new Date() },
    });
    if (!claimed.count)
      throw new GoneException({
        code: 'invitation_used',
        message: 'Esta invitación ya fue usada o cancelada.',
      });
    const consent = await this.recordConsent(
      user.id,
      invitation.householdId,
      metadata,
      invitation.role,
    );
    let member: HouseholdMember;
    try {
      member = await this.db.luft.householdMember.create({
        data: {
          householdId: invitation.householdId,
          userId: user.id,
          role: invitation.role,
          seatAssigned: invitation.seatAssigned,
          permissions: normalizePermissions(input.permissions),
          consentId: consent.id,
          invitationId: invitation.id,
        },
      });
    } catch (error) {
      // Lost a race with another acceptance of this user: release the invitation.
      await this.db.luft.$transaction([
        this.db.luft.householdInvitation.update({
          where: { id: invitation.id },
          data: { status: 'PENDING', acceptedBy: null, acceptedAt: null },
        }),
        this.db.luft.consent.update({
          where: { id: consent.id },
          data: { revokedAt: new Date(), revokedReason: 'membership_failed' },
        }),
      ]);
      if (isUniqueViolation(error))
        throw new ConflictException({
          code: 'already_in_household',
          message: 'Ya haces parte de un hogar LUFT.',
        });
      throw error;
    }
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.invitation.accepted',
      resource: 'HouseholdMember',
      resourceId: member.id,
      ip: metadata.ip,
      payload: {
        householdId: invitation.householdId,
        invitationId: invitation.id,
        role: invitation.role,
        consentId: consent.id,
      },
    });
    this.realtime.toUser(invitation.invitedBy, 'household:invitation', {
      status: 'ACCEPTED',
      invitationId: invitation.id,
      memberName: firstName(user.fullName),
      role: invitation.role,
    });
    // A beneficiary gets a full, independent route of their own.
    if (invitation.role === 'BENEFICIARY')
      await this.routes.syncQuietly(user.id, 'household_joined');
    return this.board(user);
  }

  // ---- Members -----------------------------------------------------------

  async setPermissions(user: AuthenticatedUser, body: unknown) {
    const input = permissionsSchema.parse(body);
    const membership = await this.requireMembership(user.id);
    const permissions = {
      ...normalizePermissions(membership.permissions),
      ...input,
    };
    // Sharing anything needs the member's own authorization in force.
    if (Object.values(permissions).some((level) => level !== 'NONE')) {
      const consents = await this.db.luft.consent.findMany({
        where: { userId: user.id, kind: 'HOUSEHOLD_SHARING', revokedAt: null },
      });
      if (!consents.some((consent) => isActive(consent)))
        throw new BadRequestException({
          code: 'consent_required',
          consent: 'HOUSEHOLD_SHARING',
          message:
            'Retiraste tu autorización para compartir con el hogar. Vuelve a aceptarla para compartir métricas.',
        });
    }
    await this.db.luft.householdMember.update({
      where: { id: membership.id },
      data: { permissions },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.permissions.updated',
      resource: 'HouseholdMember',
      resourceId: membership.id,
      payload: { permissions },
    });
    return this.board(user);
  }

  private async endMembership(
    member: HouseholdMember,
    status: 'LEFT' | 'REMOVED',
    actor: AuthenticatedUser,
  ) {
    const now = new Date();
    await this.db.luft.$transaction([
      this.db.luft.householdMember.update({
        where: { id: member.id },
        data: { status, leftAt: now, permissions: PRIVATE_PERMISSIONS },
      }),
      this.db.luft.sharedGoal.updateMany({
        where: {
          householdId: member.householdId,
          ownerUserId: member.userId,
          status: 'ACTIVE',
        },
        data: { status: 'CANCELLED' },
      }),
      ...(member.consentId
        ? [
            this.db.luft.consent.updateMany({
              where: { id: member.consentId, revokedAt: null },
              data: {
                revokedAt: now,
                revokedReason: 'household_membership_ended',
              },
            }),
          ]
        : []),
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action:
        status === 'LEFT'
          ? 'household.member.left'
          : 'household.member.removed',
      resource: 'HouseholdMember',
      resourceId: member.id,
      payload: { householdId: member.householdId, role: member.role },
    });
  }

  async leave(user: AuthenticatedUser) {
    const membership = await this.requireMembership(user.id);
    if (membership.role === 'OWNER') {
      const others = await this.db.luft.householdMember.count({
        where: {
          householdId: membership.householdId,
          status: 'ACTIVE',
          id: { not: membership.id },
        },
      });
      if (others)
        throw new ConflictException({
          code: 'owner_has_members',
          message:
            'Antes de cerrar el hogar retira a los demás integrantes. Sus cuentas y perfiles no se afectan.',
        });
      await this.endMembership(membership, 'LEFT', user);
      await this.db.luft.householdInvitation.updateMany({
        where: { householdId: membership.householdId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
    } else await this.endMembership(membership, 'LEFT', user);
    return this.board(user);
  }

  async removeMember(user: AuthenticatedUser, memberId: string) {
    const membership = await this.requireOwner(user.id);
    const member = await this.db.luft.householdMember.findFirst({
      where: {
        id: memberId,
        householdId: membership.householdId,
        status: 'ACTIVE',
      },
    });
    if (!member) throw new NotFoundException('Integrante no encontrado.');
    if (member.id === membership.id)
      throw new BadRequestException(
        'Para salir tú, usa la opción de cerrar el hogar.',
      );
    await this.endMembership(member, 'REMOVED', user);
    return this.board(user);
  }

  // ---- Shared goals and contributions -------------------------------------

  async createGoal(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        title: z.string().trim().min(3).max(160),
        kind: z.string().trim().min(2).max(40).optional(),
        targetCOP: cop,
        targetDate: z.coerce.date().optional(),
      })
      .strict()
      .parse(body);
    const membership = await this.requireMembership(user.id);
    if (membership.role === 'SUPPORT')
      throw new ForbiddenException(
        'Las metas las crean quienes tienen una ruta en el hogar. Como red de apoyo puedes aportar a ellas.',
      );
    const goal = await this.db.luft.sharedGoal.create({
      data: {
        householdId: membership.householdId,
        ownerUserId: user.id,
        title: input.title,
        kind: input.kind,
        targetCOP: BigInt(input.targetCOP),
        targetDate: input.targetDate,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.goal.created',
      resource: 'SharedGoal',
      resourceId: goal.id,
      payload: { householdId: goal.householdId, targetCOP: input.targetCOP },
    });
    return this.board(user);
  }

  private async goalFor(user: AuthenticatedUser, goalId: string) {
    const membership = await this.requireMembership(user.id);
    const goal = await this.db.luft.sharedGoal.findFirst({
      where: { id: goalId, householdId: membership.householdId },
    });
    if (!goal) throw new NotFoundException('Meta no encontrada.');
    return { membership, goal };
  }

  async updateGoal(user: AuthenticatedUser, goalId: string, body: unknown) {
    const input = z
      .object({
        title: z.string().trim().min(3).max(160),
        targetCOP: cop,
        targetDate: z.coerce.date().nullable(),
        status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']),
      })
      .partial()
      .strict()
      .parse(body);
    const { goal } = await this.goalFor(user, goalId);
    if (goal.ownerUserId !== user.id)
      throw new ForbiddenException('Solo quien creó la meta puede cambiarla.');
    await this.db.luft.sharedGoal.update({
      where: { id: goal.id },
      data: {
        title: input.title,
        targetDate: input.targetDate,
        status: input.status,
        targetCOP:
          input.targetCOP === undefined ? undefined : BigInt(input.targetCOP),
        completedAt:
          input.status === undefined
            ? undefined
            : input.status === 'COMPLETED'
              ? new Date()
              : null,
      },
    });
    return this.board(user);
  }

  /** A contribution is declared by whoever gives it; only the goal owner confirms it. */
  async contribute(user: AuthenticatedUser, goalId: string, body: unknown) {
    const input = z
      .object({
        amountCOP: cop,
        note: z.string().trim().max(280).optional(),
      })
      .strict()
      .parse(body);
    const { goal } = await this.goalFor(user, goalId);
    if (goal.status !== 'ACTIVE')
      throw new ConflictException('Esta meta ya no recibe aportes.');
    const own = goal.ownerUserId === user.id;
    const now = new Date();
    const contribution = await this.db.luft.contribution.create({
      data: {
        goalId: goal.id,
        householdId: goal.householdId,
        contributorUserId: user.id,
        amountCOP: BigInt(input.amountCOP),
        note: input.note,
        status: own ? 'CONFIRMED' : 'DECLARED',
        resolvedBy: own ? user.id : undefined,
        resolvedAt: own ? now : undefined,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.contribution.declared',
      resource: 'Contribution',
      resourceId: contribution.id,
      payload: {
        goalId: goal.id,
        amountCOP: input.amountCOP,
        status: contribution.status,
      },
    });
    if (own) await this.closeGoalIfReached(goal.id);
    else
      this.realtime.toUser(goal.ownerUserId, 'household:contribution', {
        status: 'DECLARED',
        contributionId: contribution.id,
        goalTitle: goal.title,
        contributorName: firstName(user.fullName),
      });
    return { contributionId: contribution.id, ...(await this.board(user)) };
  }

  private async closeGoalIfReached(goalId: string) {
    const goal = await this.db.luft.sharedGoal.findUnique({
      where: { id: goalId },
      include: { contributions: true },
    });
    if (!goal || goal.status !== 'ACTIVE') return;
    const progress = goalProgress(
      Number(goal.targetCOP),
      goal.contributions.map((row) => ({
        amountCOP: Number(row.amountCOP),
        status: row.status,
      })),
    );
    if (progress.reached)
      await this.db.luft.sharedGoal.update({
        where: { id: goalId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
  }

  private async contributionFor(user: AuthenticatedUser, id: string) {
    const membership = await this.requireMembership(user.id);
    const contribution = await this.db.luft.contribution.findFirst({
      where: { id, householdId: membership.householdId },
      include: { goal: true },
    });
    if (!contribution) throw new NotFoundException('Aporte no encontrado.');
    return contribution;
  }

  async resolveContribution(
    user: AuthenticatedUser,
    id: string,
    outcome: 'CONFIRMED' | 'REJECTED',
  ) {
    const contribution = await this.contributionFor(user, id);
    if (!canResolveContribution(user.id, contribution.goal.ownerUserId))
      throw new ForbiddenException(
        'Solo quien administra la meta puede confirmar los aportes.',
      );
    const resolved = await this.db.luft.contribution.updateMany({
      where: { id, status: 'DECLARED' },
      data: { status: outcome, resolvedBy: user.id, resolvedAt: new Date() },
    });
    if (!resolved.count)
      throw new ConflictException('Este aporte ya fue conciliado.');
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action:
        outcome === 'CONFIRMED'
          ? 'household.contribution.confirmed'
          : 'household.contribution.rejected',
      resource: 'Contribution',
      resourceId: id,
      payload: {
        goalId: contribution.goalId,
        amountCOP: Number(contribution.amountCOP),
      },
    });
    if (outcome === 'CONFIRMED')
      await this.closeGoalIfReached(contribution.goalId);
    this.realtime.toUser(
      contribution.contributorUserId,
      'household:contribution',
      {
        status: outcome,
        contributionId: id,
        goalTitle: contribution.goal.title,
      },
    );
    return this.board(user);
  }

  async attachSupport(
    user: AuthenticatedUser,
    id: string,
    fileName: string,
    buffer: Buffer,
  ) {
    const contribution = await this.contributionFor(user, id);
    if (contribution.contributorUserId !== user.id)
      throw new ForbiddenException(
        'Solo quien hizo el aporte puede cargar su soporte.',
      );
    if (contribution.documentId)
      await this.vault
        .remove(user.id, contribution.documentId)
        .catch(() => null);
    const document = await this.vault.store({
      userId: user.id,
      purpose: CONTRIBUTION_SUPPORT,
      refId: contribution.id,
      fileName,
      buffer,
    });
    await this.db.luft.contribution.update({
      where: { id },
      data: { documentId: document.id },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'household.contribution.support_uploaded',
      resource: 'UserDocument',
      resourceId: document.id,
      payload: { contributionId: id, sha256: document.sha256 },
    });
    return { document: this.vault.view(document) };
  }

  /** The support is visible to who gave it and to the goal owner who reconciles it. */
  async supportFile(user: AuthenticatedUser, id: string) {
    const contribution = await this.contributionFor(user, id);
    const allowed =
      contribution.contributorUserId === user.id ||
      contribution.goal.ownerUserId === user.id;
    if (!allowed || !contribution.documentId)
      throw new NotFoundException('Soporte no encontrado.');
    return this.vault.read(
      contribution.contributorUserId,
      contribution.documentId,
    );
  }
}
