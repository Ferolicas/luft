import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PROJECT_KINDS, type ProjectKind } from '../catalog/catalog-rules';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import type { LifeProject } from '../generated/luft/client';
import { creditFact, monthlyCapacity } from '../route/facts';
import {
  ProfileFactsService,
  type ProfileBundle,
} from '../route/profile-facts.service';
import { RouteService } from '../route/route.service';
import {
  CYCLE_LABELS,
  cycleStage,
  cycleView,
  MODULES_BY_KIND,
  PROJECT_KIND_LABELS,
  projectInputSchema,
  projectPlan,
  projectUpdateSchema,
  type ProjectFacts,
  type ProjectStatus,
} from './projects';

const MAX_OPEN_PROJECTS = 12;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly profileFacts: ProfileFactsService,
    private readonly routes: RouteService,
  ) {}

  private view(project: LifeProject, bundle: ProfileBundle, today: Date) {
    const kind = (
      PROJECT_KINDS.includes(project.kind as ProjectKind)
        ? project.kind
        : 'OTRO'
    ) as ProjectKind;
    const done = new Set(
      bundle.lessons.map((lesson) => `${lesson.moduleId}:${lesson.lessonKey}`),
    );
    const recommendedModules = MODULES_BY_KIND[kind]
      .map((slug) => bundle.modules.find((module) => module.slug === slug))
      .filter((module) => module !== undefined)
      .map((module) => ({
        slug: module.slug,
        title: module.title,
        completed:
          module.lessons.length > 0 &&
          module.lessons.every((lesson) =>
            done.has(`${module.id}:${lesson.key}`),
          ),
        href: `/app/aprender/${module.slug}`,
      }));
    const credits = bundle.applications.map((application) =>
      creditFact(application),
    );
    const facts: ProjectFacts = {
      kind,
      status: project.status as ProjectStatus,
      targetCOP: Number(project.targetCOP),
      savedCOP: Number(project.savedCOP),
      targetDate: project.targetDate,
      monthlyCapacityCOP:
        project.monthlyCapacityCOP === null
          ? null
          : Number(project.monthlyCapacityCOP),
      profileCapacityCOP: monthlyCapacity(bundle.input),
      recommendedModules,
      creditHistoryDemonstrated: credits.some(
        (credit) =>
          credit.state === 'COMPLETED' ||
          (credit.state === 'ACTIVE' &&
            credit.installmentsPaid >= 3 &&
            credit.overdue === 0),
      ),
      matchingAvailable: bundle.input.opportunities > 0,
    };
    const stage = cycleStage(facts);
    return {
      id: project.id,
      kind,
      kindLabel: PROJECT_KIND_LABELS[kind],
      title: project.title,
      targetCOP: facts.targetCOP,
      savedCOP: facts.savedCOP,
      monthlyCapacityCOP: facts.monthlyCapacityCOP,
      targetDate: project.targetDate.toISOString().slice(0, 10),
      status: project.status,
      routeId: project.routeId,
      createdAt: project.createdAt,
      completedAt: project.completedAt,
      plan: projectPlan(facts, today),
      cycle: {
        stage,
        label: CYCLE_LABELS[stage],
        steps: cycleView(stage),
      },
      recommendedModules,
    };
  }

  async list(user: AuthenticatedUser) {
    const today = new Date();
    const bundle = await this.profileFacts.load(user.id);
    return {
      projects: bundle.projects
        .filter((project) => project.status !== 'CANCELLED')
        .map((project) => this.view(project, bundle, today)),
      kinds: PROJECT_KINDS.map((code) => ({
        code,
        label: PROJECT_KIND_LABELS[code],
      })),
      profileCapacityCOP: monthlyCapacity(bundle.input),
      cycle: cycleView('APRENDER').map(({ key, label }) => ({ key, label })),
    };
  }

  private async owned(userId: string, id: string) {
    const project = await this.db.luft.lifeProject.findFirst({
      where: { id, userId },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return project;
  }

  private goalProgress(savedCOP: number, targetCOP: number) {
    return targetCOP > 0
      ? Math.min(100, Math.round((savedCOP / targetCOP) * 100))
      : 0;
  }

  async create(user: AuthenticatedUser, body: unknown) {
    const input = projectInputSchema.parse(body);
    if (input.targetDate.getTime() <= Date.now())
      throw new BadRequestException('Elige una fecha futura para tu proyecto.');
    const open = await this.db.luft.lifeProject.count({
      where: { userId: user.id, status: { in: ['ACTIVE', 'PAUSED'] } },
    });
    if (open >= MAX_OPEN_PROJECTS)
      throw new BadRequestException(
        `Puedes tener máximo ${MAX_OPEN_PROJECTS} proyectos abiertos.`,
      );
    const id = randomUUID();
    // Opening a route is validated first: nothing is created if it is not allowed yet.
    const route = input.openRoute
      ? await this.routes.openRoute(user, {
          origin: 'PROJECT',
          title: input.title,
          lifeProjectId: id,
        })
      : null;
    // A life project lives alongside the classic goal list, so both stay in sync.
    const goal = await this.db.luft.goal.create({
      data: {
        userId: user.id,
        kind: `PROYECTO_${input.kind}`,
        title: input.title,
        targetCOP: BigInt(input.targetCOP),
        targetDate: input.targetDate,
        progress: this.goalProgress(input.savedCOP, input.targetCOP),
      },
    });
    await this.db.luft.lifeProject.create({
      data: {
        id,
        userId: user.id,
        kind: input.kind,
        title: input.title,
        targetCOP: BigInt(input.targetCOP),
        savedCOP: BigInt(input.savedCOP),
        monthlyCapacityCOP:
          input.monthlyCapacityCOP === undefined
            ? undefined
            : BigInt(input.monthlyCapacityCOP),
        targetDate: input.targetDate,
        routeId: route?.id,
        goalId: goal.id,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'projects.project.created',
      resource: 'LifeProject',
      resourceId: id,
      payload: {
        kind: input.kind,
        targetCOP: input.targetCOP,
        routeId: route?.id ?? null,
      },
    });
    await this.routes.syncQuietly(user.id, 'life_project');
    return this.list(user);
  }

  async update(user: AuthenticatedUser, id: string, body: unknown) {
    const input = projectUpdateSchema.parse(body);
    const project = await this.owned(user.id, id);
    const targetCOP = input.targetCOP ?? Number(project.targetCOP);
    const savedCOP = input.savedCOP ?? Number(project.savedCOP);
    const status = input.status ?? project.status;
    await this.db.luft.lifeProject.update({
      where: { id: project.id },
      data: {
        title: input.title,
        targetDate: input.targetDate,
        status: input.status,
        targetCOP:
          input.targetCOP === undefined ? undefined : BigInt(input.targetCOP),
        savedCOP:
          input.savedCOP === undefined ? undefined : BigInt(input.savedCOP),
        monthlyCapacityCOP:
          input.monthlyCapacityCOP === undefined
            ? undefined
            : input.monthlyCapacityCOP === null
              ? null
              : BigInt(input.monthlyCapacityCOP),
        completedAt:
          input.status === undefined
            ? undefined
            : input.status === 'COMPLETED'
              ? (project.completedAt ?? new Date())
              : null,
      },
    });
    if (project.goalId) {
      const progress =
        status === 'COMPLETED' ? 100 : this.goalProgress(savedCOP, targetCOP);
      await this.db.luft.goal.updateMany({
        where: { id: project.goalId, userId: user.id },
        data: {
          title: input.title,
          targetCOP: BigInt(targetCOP),
          targetDate: input.targetDate,
          progress,
          completedAt: progress === 100 ? new Date() : null,
        },
      });
    }
    await this.routes.syncQuietly(user.id, 'life_project');
    return this.list(user);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const project = await this.owned(user.id, id);
    await this.db.luft.$transaction([
      this.db.luft.lifeProject.delete({ where: { id: project.id } }),
      ...(project.goalId
        ? [
            this.db.luft.goal.deleteMany({
              where: { id: project.goalId, userId: user.id },
            }),
          ]
        : []),
    ]);
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'projects.project.deleted',
      resource: 'LifeProject',
      resourceId: id,
    });
    return this.list(user);
  }
}
