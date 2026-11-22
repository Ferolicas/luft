import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  assignArchetype,
  decisionFingerprint,
  LEGACY_ARCHETYPE_CODES,
  type ArchetypeExplanation,
} from '../catalog/archetype-engine';
import {
  CATEGORY_CODE,
  readCategoryConfig,
  suggestCategory,
} from '../catalog/catalog-rules';
import { CatalogService } from '../catalog/catalog.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { EvidenceService } from '../evidence/evidence.service';
import type {
  ArchetypeAssignment,
  Evidence,
  ServiceCategory,
  UserRoute,
} from '../generated/luft/client';
import { isUniqueViolation } from '../luft/http';
import { RealtimeService } from '../realtime/realtime.service';
import { archetypeFacts, routeFacts } from './facts';
import {
  ProfileFactsService,
  type ProfileBundle,
} from './profile-facts.service';
import {
  advance,
  canStartNewRoute,
  isRouteStage,
  nextStep,
  ROUTE_STAGE_LABELS,
  routeProgress,
  stageIndex,
  visibleStages,
  type RouteFacts,
  type RouteStage,
  type VisibleStage,
} from './route';

type RouteWithCategory = UserRoute & { category: ServiceCategory };

export interface RouteState {
  bundle: ProfileBundle;
  route: RouteWithCategory;
  assignment: ArchetypeAssignment | null;
  facts: RouteFacts;
  stages: VisibleStage[];
  evidences: Evidence[];
}

const stageOf = (route: UserRoute): RouteStage =>
  isRouteStage(route.stage) ? route.stage : 'REGISTRADO';

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly catalog: CatalogService,
    private readonly profileFacts: ProfileFactsService,
    private readonly evidence: EvidenceService,
  ) {}

  private activeRoute(userId: string) {
    return this.db.luft.userRoute.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { category: true },
    });
  }

  private async resolveCategory(code: string) {
    const category =
      (await this.db.luft.serviceCategory.findFirst({
        where: { code, active: true },
      })) ??
      (await this.db.luft.serviceCategory.findFirst({
        where: { active: true },
        orderBy: [{ position: 'asc' }, { code: 'asc' }],
      }));
    if (!category)
      throw new ServiceUnavailableException({
        code: 'catalog_unavailable',
        message:
          'No hay categorías de servicio activas. El equipo LUFT debe configurarlas.',
      });
    return category;
  }

  /** One active route per person; created on first use with the suggested category. */
  private async ensureRoute(bundle: ProfileBundle): Promise<RouteWithCategory> {
    const existing = await this.activeRoute(bundle.userId);
    if (existing) return existing;
    const goal = bundle.state.classification?.goal;
    const category = await this.resolveCategory(suggestCategory(goal));
    try {
      return await this.db.luft.userRoute.create({
        data: {
          userId: bundle.userId,
          categoryId: category.id,
          suggestedCategoryCode: goal ? suggestCategory(goal) : null,
        },
        include: { category: true },
      });
    } catch (error) {
      // A concurrent request created it first (unique active route per user).
      const created = isUniqueViolation(error)
        ? await this.activeRoute(bundle.userId)
        : null;
      if (created) return created;
      throw error;
    }
  }

  /** Until the user chooses, the first route follows the classification suggestion. */
  private async followSuggestion(
    route: RouteWithCategory,
    bundle: ProfileBundle,
  ): Promise<RouteWithCategory> {
    const goal = bundle.state.classification?.goal;
    if (!goal) return route;
    const suggested = suggestCategory(goal);
    const follows =
      !route.categoryChosenByUser &&
      route.origin === 'INITIAL' &&
      route.category.code !== suggested &&
      stageIndex(stageOf(route)) < stageIndex('CREDITO_1');
    if (!follows && route.suggestedCategoryCode === suggested) return route;
    const category = follows ? await this.resolveCategory(suggested) : null;
    return this.db.luft.userRoute.update({
      where: { id: route.id },
      data: {
        suggestedCategoryCode: suggested,
        ...(category ? { categoryId: category.id } : {}),
      },
      include: { category: true },
    });
  }

  private async assign(
    route: RouteWithCategory,
    bundle: ProfileBundle,
    reason: string,
  ): Promise<ArchetypeAssignment | null> {
    const current = await this.db.luft.archetypeAssignment.findFirst({
      where: { userId: bundle.userId, supersededAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const stored = bundle.profile?.archetype ?? null;
    const legacyCode =
      stored && LEGACY_ARCHETYPE_CODES.includes(stored)
        ? stored
        : (current?.legacyCode ?? null);
    // The archetype exists once the person is classified (or came classified from before V2).
    if (!bundle.state.classification && !legacyCode && !current) return null;
    const facts = archetypeFacts(bundle.input);
    const decision = assignArchetype(
      await this.catalog.activeArchetypes(route.categoryId),
      facts,
      { categoryCode: route.category.code, legacyCode },
    );
    if (!decision) return current;
    const signature = createHash('sha256')
      .update(decisionFingerprint(decision))
      .digest('hex');
    const unchanged =
      current &&
      current.signature === signature &&
      current.categoryCode === route.category.code;
    if (unchanged) {
      // Keeps the compatibility column aligned if a legacy flow overwrote it.
      if (stored !== decision.archetype.code)
        await this.db.luft.financialProfile.upsert({
          where: { userId: bundle.userId },
          create: {
            userId: bundle.userId,
            archetype: decision.archetype.code,
          },
          update: { archetype: decision.archetype.code },
        });
      return current;
    }
    const now = new Date();
    const [, created] = await this.db.luft.$transaction([
      this.db.luft.archetypeAssignment.updateMany({
        where: { userId: bundle.userId, supersededAt: null },
        data: { supersededAt: now },
      }),
      this.db.luft.archetypeAssignment.create({
        data: {
          userId: bundle.userId,
          routeId: route.id,
          categoryCode: route.category.code,
          archetypeId: decision.archetype.id,
          archetypeCode: decision.archetype.code,
          archetypeName: decision.archetype.name,
          archetypeVersion: decision.archetype.version,
          reason: reason.slice(0, 80),
          explanation: decision.explanation as unknown as object,
          factsCiphertext: this.crypto.encrypt(JSON.stringify(facts)),
          signature,
          legacyCode,
          createdAt: now,
        },
      }),
      this.db.luft.financialProfile.upsert({
        where: { userId: bundle.userId },
        create: {
          userId: bundle.userId,
          archetype: decision.archetype.code,
        },
        update: { archetype: decision.archetype.code },
      }),
    ]);
    await this.audit.record({
      actorUserId: bundle.userId,
      actorRole: 'SYSTEM',
      action: 'route.archetype.assigned',
      resource: 'ArchetypeAssignment',
      resourceId: created.id,
      payload: {
        category: route.category.code,
        archetype: decision.archetype.code,
        version: decision.archetype.version,
        basis: decision.explanation.basis,
        previous: current?.archetypeCode ?? legacyCode,
        reason,
      },
    });
    this.realtime.toUser(bundle.userId, 'profile:updated', {
      archetype: decision.archetype.code,
    });
    return created;
  }

  private async move(
    route: RouteWithCategory,
    facts: RouteFacts,
  ): Promise<RouteWithCategory> {
    const steps = advance(stageOf(route), facts);
    if (!steps.length) return route;
    const now = new Date();
    const target = steps[steps.length - 1].to;
    const summary = {
      classified: facts.classified,
      bureauCompleted: facts.bureauCompleted,
      incomeDeclared: facts.incomeDeclared,
      formalization: facts.formalization,
      lessonsCompleted: facts.lessonsCompleted,
      modulesCompleted: facts.modulesCompleted,
      credit1: facts.credit1.state,
      credit2: facts.credit2.state,
      finalScoreCompleted: facts.finalScoreCompleted,
      matchingAvailable: facts.matchingAvailable,
      lifeProjects: facts.lifeProjects,
    };
    // Guarded by the stage read above: a concurrent sync cannot record the steps twice.
    const moved = await this.db.luft.userRoute.updateMany({
      where: { id: route.id, stage: route.stage },
      data: { stage: target, stageChangedAt: now },
    });
    if (!moved.count) return (await this.activeRoute(route.userId)) ?? route;
    await this.db.luft.routeTransition.createMany({
      data: steps.map((step, index) => ({
        routeId: route.id,
        userId: route.userId,
        fromStage: step.from,
        toStage: step.to,
        reason: step.reason,
        facts: summary,
        createdAt: new Date(now.getTime() + index),
      })),
    });
    this.realtime.toUser(route.userId, 'route:updated', {
      routeId: route.id,
      stage: target,
    });
    return { ...route, stage: target, stageChangedAt: now };
  }

  /**
   * Idempotent synchronization: route, category suggestion, archetype, stage,
   * evidence and profile snapshot, all recomputed from real facts.
   */
  async sync(userId: string, reason: string): Promise<RouteState> {
    const bundle = await this.profileFacts.load(userId);
    let route = await this.followSuggestion(
      await this.ensureRoute(bundle),
      bundle,
    );
    const assignment = await this.assign(route, bundle, reason);
    const config = readCategoryConfig(route.category.config);
    const facts = routeFacts(bundle.input, {
      archetypeAssigned: Boolean(assignment),
      requiredDocuments: config.requiredDocuments,
      since: route.origin === 'INITIAL' ? null : route.startedAt,
    });
    route = await this.move(route, facts);
    const stages = visibleStages(facts);
    const progressPercent = routeProgress(stages);
    if (route.progressPercent !== progressPercent) {
      // Stored so a household board can show it without recomputing each member.
      await this.db.luft.userRoute.update({
        where: { id: route.id },
        data: { progressPercent },
      });
      route = { ...route, progressPercent };
    }
    const evidences = await this.evidence.sync(bundle);
    await this.evidence.snapshot(bundle, reason, {
      categoryCode: route.category.code,
      archetypeCode: assignment?.archetypeCode ?? null,
      archetypeVersion: assignment?.archetypeVersion ?? null,
      stage: route.stage,
    });
    return {
      bundle,
      route,
      assignment,
      facts,
      stages,
      evidences,
    };
  }

  /** Used after profile events: a failed sync never breaks the user's action. */
  async syncQuietly(userId: string, reason: string) {
    try {
      return await this.sync(userId, reason);
    } catch (error) {
      this.logger.warn(
        `No se pudo sincronizar la ruta de ${userId} (${reason}): ${(error as Error).message}`,
      );
      return null;
    }
  }

  private archetypeView(assignment: ArchetypeAssignment | null) {
    if (!assignment) return null;
    const explanation =
      assignment.explanation as unknown as ArchetypeExplanation;
    return {
      code: assignment.archetypeCode,
      name: assignment.archetypeName,
      version: assignment.archetypeVersion,
      assignedAt: assignment.createdAt,
      basis: explanation.basis,
      summary: explanation.summary,
      matched: explanation.matched ?? [],
      legacyCode: assignment.legacyCode,
    };
  }

  private categoryView(route: RouteWithCategory) {
    const config = readCategoryConfig(route.category.config);
    return {
      code: route.category.code,
      brand: route.category.brand,
      label: route.category.label,
      description: route.category.description,
      chosenByUser: route.categoryChosenByUser,
      suggestedCode: route.suggestedCategoryCode,
      onboarding: config.onboarding,
      messages: config.messages,
      modules: config.modules,
      requiredDocuments: config.requiredDocuments,
      projectKinds: config.projectKinds,
    };
  }

  summaryOf(state: RouteState) {
    const stage = stageOf(state.route);
    const current =
      state.stages.find((item) => item.status === 'CURRENT') ??
      state.stages[state.stages.length - 1];
    return {
      id: state.route.id,
      categoryCode: state.route.category.code,
      categoryBrand: state.route.category.brand,
      categoryLabel: state.route.category.label,
      archetype: state.assignment
        ? {
            code: state.assignment.archetypeCode,
            name: state.assignment.archetypeName,
          }
        : null,
      stage,
      stageLabel: ROUTE_STAGE_LABELS[stage],
      visibleStage: { key: current.key, title: current.title },
      progressPercent: routeProgress(state.stages),
      nextStep: nextStep(state.stages),
      evidenceVerified: this.evidence.summary(state.evidences).verified,
    };
  }

  /** Route summary for the dashboard; null when the catalog is not ready. */
  async summary(user: AuthenticatedUser) {
    const state = await this.syncQuietly(user.id, 'dashboard');
    return state ? this.summaryOf(state) : null;
  }

  async overview(user: AuthenticatedUser, reason = 'route_view') {
    const state = await this.sync(user.id, reason);
    const { route } = state;
    const stage = stageOf(route);
    const [transitions, archetype, routes] = await Promise.all([
      this.db.luft.routeTransition.findMany({
        where: { routeId: route.id },
        orderBy: { createdAt: 'asc' },
      }),
      state.assignment
        ? this.db.luft.archetype.findUnique({
            where: { id: state.assignment.archetypeId },
            select: { description: true },
          })
        : null,
      this.db.luft.userRoute.findMany({
        where: { userId: user.id, id: { not: route.id } },
        include: { category: true },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
    ]);
    const view = this.archetypeView(state.assignment);
    return {
      route: {
        id: route.id,
        status: route.status,
        origin: route.origin,
        title: route.title,
        stage,
        stageLabel: ROUTE_STAGE_LABELS[stage],
        stageIndex: stageIndex(stage),
        stageChangedAt: route.stageChangedAt,
        startedAt: route.startedAt,
        progressPercent: routeProgress(state.stages),
        categoryLocked: stageIndex(stage) >= stageIndex('CREDITO_1'),
        canStartNewRoute: canStartNewRoute(stage),
      },
      category: this.categoryView(route),
      archetype: view
        ? { ...view, description: archetype?.description ?? '' }
        : null,
      stages: state.stages,
      nextStep: nextStep(state.stages),
      evidence: this.evidence.summary(state.evidences),
      history: transitions.map((row) => ({
        from: row.fromStage,
        to: row.toStage,
        toLabel: isRouteStage(row.toStage)
          ? ROUTE_STAGE_LABELS[row.toStage]
          : row.toStage,
        reason: row.reason,
        at: row.createdAt,
      })),
      previousRoutes: routes.map((row) => ({
        id: row.id,
        categoryCode: row.category.code,
        categoryBrand: row.category.brand,
        origin: row.origin,
        title: row.title,
        stage: row.stage,
        startedAt: row.startedAt,
        closedAt: row.closedAt,
      })),
    };
  }

  /** The category is the user's choice; it stays stable once the builder credit starts. */
  async setCategory(user: AuthenticatedUser, body: unknown) {
    const { categoryCode } = z
      .object({ categoryCode: CATEGORY_CODE })
      .strict()
      .parse(body);
    const category = await this.db.luft.serviceCategory.findFirst({
      where: { code: categoryCode, active: true },
    });
    if (!category) throw new NotFoundException('Categoría no disponible.');
    const state = await this.sync(user.id, 'category_change');
    const { route } = state;
    if (
      route.categoryId !== category.id &&
      stageIndex(stageOf(route)) >= stageIndex('CREDITO_1')
    )
      throw new ConflictException({
        code: 'category_locked',
        message:
          'Tu categoría queda estable desde que inicia tu crédito constructor. Podrás elegir otra cuando abras una nueva ruta.',
      });
    await this.db.luft.userRoute.update({
      where: { id: route.id },
      data: { categoryId: category.id, categoryChosenByUser: true },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'route.category.chosen',
      resource: 'UserRoute',
      resourceId: route.id,
      payload: { from: route.category.code, to: category.code },
    });
    return this.overview(user, 'category_change');
  }

  /**
   * Opens a new route (another life stage or a life project). The current one
   * is closed and kept as history; profiles and evidence are never reset.
   */
  async openRoute(
    user: AuthenticatedUser,
    input: {
      categoryCode?: string;
      origin: 'LIFE_STAGE' | 'PROJECT';
      title?: string;
      lifeProjectId?: string;
    },
  ) {
    const state = await this.sync(user.id, 'new_route_request');
    const current = state.route;
    if (!canStartNewRoute(stageOf(current)))
      throw new ConflictException({
        code: 'route_in_progress',
        message:
          'Podrás abrir una nueva ruta cuando tu ruta actual llegue a tu perfil final. Mientras tanto puedes cambiar de categoría o crear proyectos dentro de esta ruta.',
      });
    const category = input.categoryCode
      ? await this.db.luft.serviceCategory.findFirst({
          where: { code: input.categoryCode, active: true },
        })
      : current.category;
    if (!category) throw new NotFoundException('Categoría no disponible.');
    const now = new Date();
    const created = await this.db.luft.$transaction(async (tx) => {
      await tx.userRoute.update({
        where: { id: current.id },
        data: {
          status: 'CLOSED',
          closedAt: now,
          closedReason:
            input.origin === 'PROJECT' ? 'new_project_route' : 'new_life_stage',
        },
      });
      return tx.userRoute.create({
        data: {
          userId: user.id,
          categoryId: category.id,
          origin: input.origin,
          title: input.title,
          lifeProjectId: input.lifeProjectId,
          categoryChosenByUser: Boolean(input.categoryCode),
          suggestedCategoryCode: current.suggestedCategoryCode,
          startedAt: now,
          stageChangedAt: now,
        },
      });
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'route.opened',
      resource: 'UserRoute',
      resourceId: created.id,
      payload: {
        origin: input.origin,
        category: category.code,
        previousRouteId: current.id,
        lifeProjectId: input.lifeProjectId ?? null,
      },
    });
    return created;
  }

  async startRoute(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        categoryCode: CATEGORY_CODE,
        title: z.string().trim().min(3).max(160).optional(),
      })
      .strict()
      .parse(body);
    await this.openRoute(user, { ...input, origin: 'LIFE_STAGE' });
    return this.overview(user, 'new_route');
  }

  async evidenceList(user: AuthenticatedUser) {
    const state = await this.sync(user.id, 'evidence_view');
    return this.evidence.list(state.evidences);
  }

  async archetypeHistory(user: AuthenticatedUser) {
    const rows = await this.db.luft.archetypeAssignment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        categoryCode: row.categoryCode,
        ...this.archetypeView(row),
        reason: row.reason,
        current: row.supersededAt === null,
        supersededAt: row.supersededAt,
      })),
    };
  }

  async snapshots(user: AuthenticatedUser) {
    const rows = await this.db.luft.financialProfileSnapshot.findMany({
      where: { userId: user.id },
      orderBy: { version: 'desc' },
      take: 50,
      select: {
        id: true,
        version: true,
        reason: true,
        summary: true,
        createdAt: true,
      },
    });
    return { items: rows };
  }
}
