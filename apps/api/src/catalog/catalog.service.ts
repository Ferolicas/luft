import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import type {
  Archetype,
  ServiceCategory,
  SubscriptionPlan,
} from '../generated/luft/client';
import { isUniqueViolation, PAGE_SIZE, paged } from '../luft/http';
import {
  archetypeRulesSchema,
  FACT_CATALOG,
  RULE_OPERATORS,
  type ArchetypeDefinition,
} from './archetype-engine';
import {
  CATEGORY_CODE,
  categoryConfigSchema,
  planView,
  readCategoryConfig,
  type PlanDefinition,
} from './catalog-rules';

// Update schemas never carry defaults: an absent field must stay untouched.
const categoryFields = {
  brand: z.string().trim().min(2).max(80),
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(1_000),
  config: categoryConfigSchema,
  active: z.boolean(),
  position: z.coerce.number().int().min(0).max(1_000),
};

const categoryInput = z
  .object({
    ...categoryFields,
    code: CATEGORY_CODE,
    active: categoryFields.active.default(true),
    position: categoryFields.position.default(0),
  })
  .strict();

const categoryUpdate = z.object(categoryFields).partial().strict();

const archetypeFields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(1_000),
  rules: archetypeRulesSchema,
  priority: z.coerce.number().int().min(0).max(1_000),
  isDefault: z.boolean().default(false),
};

const archetypeInput = z
  .object({
    categoryCode: CATEGORY_CODE,
    code: CATEGORY_CODE,
    ...archetypeFields,
  })
  .strict();

const archetypeVersionInput = z.object(archetypeFields).strict();

const planUpdate = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(1_000),
    minSeats: z.coerce.number().int().min(1).max(20),
    maxSeats: z.coerce.number().int().min(1).max(20),
    basePriceCOP: z.coerce.number().int().min(0).max(100_000_000),
    discountPercent: z.coerce.number().min(0).max(100).multipleOf(0.01),
    active: z.boolean(),
    position: z.coerce.number().int().min(0).max(1_000),
  })
  .partial()
  .strict();

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  toDefinition(archetype: Archetype): ArchetypeDefinition {
    return {
      id: archetype.id,
      code: archetype.code,
      name: archetype.name,
      description: archetype.description,
      rules: archetype.rules,
      priority: archetype.priority,
      version: archetype.version,
      isDefault: archetype.isDefault,
      active: archetype.active,
    };
  }

  toPlan(plan: SubscriptionPlan): PlanDefinition {
    return {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      minSeats: plan.minSeats,
      maxSeats: plan.maxSeats,
      basePriceCOP: Number(plan.basePriceCOP),
      discountPercent: Number(plan.discountPercent),
    };
  }

  categoryView(category: ServiceCategory & { archetypes?: Archetype[] }) {
    const config = readCategoryConfig(category.config);
    return {
      code: category.code,
      brand: category.brand,
      label: category.label,
      description: category.description,
      position: category.position,
      onboarding: config.onboarding,
      messages: config.messages,
      modules: config.modules,
      requiredDocuments: config.requiredDocuments,
      projectKinds: config.projectKinds,
      archetypes: (category.archetypes ?? [])
        .filter((item) => item.active)
        .sort((a, b) => a.priority - b.priority)
        .map((item) => ({
          code: item.code,
          name: item.name,
          description: item.description,
        })),
    };
  }

  async activeCategories() {
    const categories = await this.db.luft.serviceCategory.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { code: 'asc' }],
      include: { archetypes: { where: { active: true } } },
    });
    return { categories: categories.map((item) => this.categoryView(item)) };
  }

  categoryByCode(code: string) {
    return this.db.luft.serviceCategory.findUnique({ where: { code } });
  }

  async activeArchetypes(categoryId: string) {
    const rows = await this.db.luft.archetype.findMany({
      where: { categoryId, active: true },
    });
    return rows.map((row) => this.toDefinition(row));
  }

  async activePlans() {
    const plans = await this.db.luft.subscriptionPlan.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { code: 'asc' }],
    });
    return plans.map((plan) => this.toPlan(plan));
  }

  async plans() {
    return { plans: (await this.activePlans()).map(planView) };
  }

  // ---- Staff -------------------------------------------------------------

  private adminCategory(
    category: ServiceCategory & {
      _count?: { archetypes: number; routes: number };
    },
  ) {
    return {
      id: category.id,
      code: category.code,
      brand: category.brand,
      label: category.label,
      description: category.description,
      config: readCategoryConfig(category.config),
      active: category.active,
      position: category.position,
      archetypes: category._count?.archetypes ?? 0,
      routes: category._count?.routes ?? 0,
      updatedAt: category.updatedAt,
    };
  }

  async adminCategories(page: number) {
    const [items, total] = await Promise.all([
      this.db.luft.serviceCategory.findMany({
        orderBy: [{ position: 'asc' }, { code: 'asc' }],
        include: { _count: { select: { archetypes: true, routes: true } } },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.luft.serviceCategory.count(),
    ]);
    return paged(
      items.map((item) => this.adminCategory(item)),
      total,
      page,
    );
  }

  async createCategory(actor: AuthenticatedUser, body: unknown) {
    const input = categoryInput.parse(body);
    try {
      const category = await this.db.luft.serviceCategory.create({
        data: { ...input, updatedBy: actor.id },
      });
      await this.audit.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'catalog.category.created',
        resource: 'ServiceCategory',
        resourceId: category.id,
        payload: { code: category.code, brand: category.brand },
      });
      return this.adminCategory(category);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Ya existe una categoría con ese código.');
      throw error;
    }
  }

  async updateCategory(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = categoryUpdate.parse(body);
    const current = await this.db.luft.serviceCategory.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Categoría no encontrada.');
    if (input.active === false && current.active) {
      const others = await this.db.luft.serviceCategory.count({
        where: { active: true, id: { not: id } },
      });
      if (!others)
        throw new BadRequestException(
          'Debe quedar al menos una categoría activa.',
        );
    }
    const category = await this.db.luft.serviceCategory.update({
      where: { id },
      data: { ...input, updatedBy: actor.id },
      include: { _count: { select: { archetypes: true, routes: true } } },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'catalog.category.updated',
      resource: 'ServiceCategory',
      resourceId: id,
      payload: { code: category.code, changed: Object.keys(input) },
    });
    return this.adminCategory(category);
  }

  async deleteCategory(actor: AuthenticatedUser, id: string) {
    const category = await this.db.luft.serviceCategory.findUnique({
      where: { id },
      include: { _count: { select: { routes: true } } },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada.');
    const assignments = await this.db.luft.archetypeAssignment.count({
      where: { categoryCode: category.code },
    });
    if (category._count.routes > 0 || assignments > 0)
      throw new ConflictException(
        'Esta categoría ya tiene rutas o arquetipos asignados. Desactívala en lugar de eliminarla.',
      );
    await this.db.luft.$transaction([
      this.db.luft.archetype.deleteMany({ where: { categoryId: id } }),
      this.db.luft.serviceCategory.delete({ where: { id } }),
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'catalog.category.deleted',
      resource: 'ServiceCategory',
      resourceId: id,
      payload: { code: category.code },
    });
    return { ok: true };
  }

  factCatalog() {
    return {
      facts: Object.entries(FACT_CATALOG).map(([key, value]) => ({
        key,
        ...value,
      })),
      operators: RULE_OPERATORS,
    };
  }

  private adminArchetype(
    archetype: Archetype & { category?: ServiceCategory },
  ) {
    return {
      id: archetype.id,
      categoryCode: archetype.category?.code ?? null,
      code: archetype.code,
      name: archetype.name,
      description: archetype.description,
      rules: archetype.rules,
      priority: archetype.priority,
      version: archetype.version,
      isDefault: archetype.isDefault,
      active: archetype.active,
      createdAt: archetype.createdAt,
    };
  }

  async adminArchetypes(page: number, categoryCode?: string, history = false) {
    const where = {
      ...(categoryCode
        ? { category: { code: categoryCode.toUpperCase() } }
        : {}),
      ...(history ? {} : { active: true }),
    };
    const [items, total] = await Promise.all([
      this.db.luft.archetype.findMany({
        where,
        include: { category: true },
        orderBy: [{ categoryId: 'asc' }, { code: 'asc' }, { version: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.luft.archetype.count({ where }),
    ]);
    return paged(
      items.map((item) => this.adminArchetype(item)),
      total,
      page,
    );
  }

  async createArchetype(actor: AuthenticatedUser, body: unknown) {
    const input = archetypeInput.parse(body);
    const category = await this.categoryByCode(input.categoryCode);
    if (!category) throw new NotFoundException('Categoría no encontrada.');
    const existing = await this.db.luft.archetype.findFirst({
      where: { categoryId: category.id, code: input.code },
    });
    if (existing)
      throw new ConflictException(
        'Ya existe un arquetipo con ese código en la categoría. Publica una nueva versión.',
      );
    const created = await this.db.luft.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.archetype.updateMany({
          where: { categoryId: category.id, isDefault: true },
          data: { isDefault: false },
        });
      return tx.archetype.create({
        data: {
          categoryId: category.id,
          code: input.code,
          name: input.name,
          description: input.description,
          rules: input.rules as object,
          priority: input.priority,
          isDefault: input.isDefault,
          version: 1,
          createdBy: actor.id,
        },
        include: { category: true },
      });
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'catalog.archetype.created',
      resource: 'Archetype',
      resourceId: created.id,
      payload: { category: category.code, code: created.code, version: 1 },
    });
    return this.adminArchetype(created);
  }

  /** Publishes a new version; the previous one stays as history and is deactivated. */
  async publishArchetypeVersion(
    actor: AuthenticatedUser,
    id: string,
    body: unknown,
  ) {
    const input = archetypeVersionInput.parse(body);
    const current = await this.db.luft.archetype.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Arquetipo no encontrado.');
    const latest = await this.db.luft.archetype.findFirst({
      where: { categoryId: current.categoryId, code: current.code },
      orderBy: { version: 'desc' },
    });
    if (current.isDefault && !input.isDefault && current.active)
      throw new BadRequestException(
        'Este es el arquetipo por defecto de la categoría. Marca otro como predeterminado antes de cambiarlo.',
      );
    const created = await this.db.luft.$transaction(async (tx) => {
      await tx.archetype.updateMany({
        where: { categoryId: current.categoryId, code: current.code },
        data: { active: false, isDefault: false },
      });
      if (input.isDefault)
        await tx.archetype.updateMany({
          where: { categoryId: current.categoryId, isDefault: true },
          data: { isDefault: false },
        });
      return tx.archetype.create({
        data: {
          categoryId: current.categoryId,
          code: current.code,
          name: input.name,
          description: input.description,
          rules: input.rules as object,
          priority: input.priority,
          isDefault: input.isDefault,
          version: (latest?.version ?? current.version) + 1,
          createdBy: actor.id,
        },
        include: { category: true },
      });
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'catalog.archetype.version_published',
      resource: 'Archetype',
      resourceId: created.id,
      payload: {
        code: created.code,
        version: created.version,
        previousId: current.id,
      },
    });
    return this.adminArchetype(created);
  }

  async deactivateArchetype(actor: AuthenticatedUser, id: string) {
    const current = await this.db.luft.archetype.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!current) throw new NotFoundException('Arquetipo no encontrado.');
    if (current.isDefault)
      throw new BadRequestException(
        'No puedes desactivar el arquetipo por defecto. Marca otro como predeterminado primero.',
      );
    const updated = await this.db.luft.archetype.update({
      where: { id },
      data: { active: false },
      include: { category: true },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'catalog.archetype.deactivated',
      resource: 'Archetype',
      resourceId: id,
      payload: { code: current.code, version: current.version },
    });
    return this.adminArchetype(updated);
  }

  private adminPlan(plan: SubscriptionPlan) {
    return {
      ...planView(this.toPlan(plan)),
      id: plan.id,
      active: plan.active,
      position: plan.position,
      updatedAt: plan.updatedAt,
    };
  }

  async adminPlans(page: number) {
    const [items, total] = await Promise.all([
      this.db.luft.subscriptionPlan.findMany({
        orderBy: [{ position: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.luft.subscriptionPlan.count(),
    ]);
    return paged(
      items.map((item) => this.adminPlan(item)),
      total,
      page,
    );
  }

  async updatePlan(actor: AuthenticatedUser, code: string, body: unknown) {
    const input = planUpdate.parse(body);
    const current = await this.db.luft.subscriptionPlan.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!current) throw new NotFoundException('Plan no encontrado.');
    const minSeats = input.minSeats ?? current.minSeats;
    const maxSeats = input.maxSeats ?? current.maxSeats;
    if (minSeats > maxSeats)
      throw new BadRequestException(
        'El mínimo de identidades no puede superar el máximo.',
      );
    const plan = await this.db.luft.subscriptionPlan.update({
      where: { id: current.id },
      data: {
        ...input,
        basePriceCOP:
          input.basePriceCOP === undefined
            ? undefined
            : BigInt(input.basePriceCOP),
        updatedBy: actor.id,
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'catalog.plan.updated',
      resource: 'SubscriptionPlan',
      resourceId: plan.id,
      payload: {
        code: plan.code,
        changed: Object.keys(input),
        basePriceCOP: Number(plan.basePriceCOP),
        discountPercent: Number(plan.discountPercent),
      },
    });
    return this.adminPlan(plan);
  }
}
