import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import type { Prisma } from '../generated/scoring/client';
import {
  catalogView,
  describeCondition,
  factField,
  OPERATOR_LABELS,
  type Operator,
} from './fact-catalog';
import { businessDay } from './facts';
import {
  allowedTransitions,
  approvalCheck,
  canTransition,
  isEditable,
  POLICY_STATUS_LABELS,
  POLICY_STATUSES,
  submissionIssues,
  transitionAction,
  type PolicyStatusName,
} from './policy-lifecycle';
import { evaluatePolicy, explain, type EngineRule } from './rule-engine';
import { INTERNAL_STAFF, POLICY_WRITERS } from './roles';
import {
  INSTITUTION_KIND_LABELS,
  INSTITUTION_KINDS,
  institutionPatchSchema,
  institutionSchema,
  PRODUCT_KIND_LABELS,
  PRODUCT_KINDS,
  productPatchSchema,
  productSchema,
  ruleSchema,
  rulesSchema,
  simulateSchema,
  transitionSchema,
  versionPatchSchema,
  versionSchema,
  type RuleInput,
} from './schemas';
import {
  isoDay,
  isUniqueViolation,
  optionalEnum,
  PAGE_SIZE,
  pageNumber,
  paginated,
  parseId,
  parseInput,
  toNumber,
  toRate,
} from './validation';

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
const rate = (value: number | null | undefined) =>
  value === null || value === undefined ? value : value.toFixed(5);
const amount = (value: number | null | undefined) =>
  value === null || value === undefined ? value : BigInt(value);

/** Staff console: institutions, products, policy versions and rules. */
@Injectable()
export class PolicyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Field/operator catalog the console uses to build parameterized forms. */
  async catalog() {
    const archetypes = await this.db.luft.financialProfile.findMany({
      where: { archetype: { not: null } },
      distinct: ['archetype'],
      select: { archetype: true },
      orderBy: { archetype: 'asc' },
      take: 100,
    });
    const base = catalogView();
    return {
      ...base,
      fields: base.fields.map((item) =>
        item.key === 'archetype'
          ? {
              ...item,
              options: archetypes.flatMap((row) =>
                row.archetype
                  ? [{ value: row.archetype, label: row.archetype }]
                  : [],
              ),
            }
          : item,
      ),
      institutionKinds: INSTITUTION_KINDS.map((key) => ({
        key,
        label: INSTITUTION_KIND_LABELS[key],
      })),
      productKinds: PRODUCT_KINDS.map((key) => ({
        key,
        label: PRODUCT_KIND_LABELS[key],
      })),
      policyStatuses: POLICY_STATUSES.map((key) => ({
        key,
        label: POLICY_STATUS_LABELS[key],
        next: allowedTransitions(key),
      })),
    };
  }

  // ---------------------------------------------------------------- entidades

  async institutions(query: {
    page?: string;
    search?: string;
    active?: string;
  }) {
    const page = pageNumber(query.page);
    const search = query.search?.trim().slice(0, 120);
    const where = {
      ...(query.active === 'true' || query.active === 'false'
        ? { active: query.active === 'true' }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { taxId: { contains: search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.scoring.institution.findMany({
        where,
        include: { _count: { select: { products: true, users: true } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.institution.count({ where }),
    ]);
    return paginated(
      items.map((item) => this.institutionView(item)),
      total,
      page,
    );
  }

  async institution(id: string) {
    const item = await this.db.scoring.institution.findUnique({
      where: { id: parseId(id, 'Entidad no encontrada.') },
      include: { _count: { select: { products: true, users: true } } },
    });
    if (!item) throw new NotFoundException('Entidad no encontrada.');
    return this.institutionView(item);
  }

  async createInstitution(actor: AuthenticatedUser, body: unknown) {
    const input = parseInput(institutionSchema, body);
    const created = await this.db.scoring.institution
      .create({ data: { ...input, createdBy: actor.id } })
      .catch((error) =>
        this.duplicate(error, 'Ya existe una entidad con ese nombre o NIT.'),
      );
    await this.record(actor, 'matching.institution.created', 'Institution', {
      id: created.id,
      payload: { name: created.name, kind: created.kind },
    });
    return this.institution(created.id);
  }

  async updateInstitution(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = parseInput(institutionPatchSchema, body);
    const current = await this.institution(id);
    await this.db.scoring.institution
      .update({ where: { id: current.id }, data: input })
      .catch((error) =>
        this.duplicate(error, 'Ya existe una entidad con ese nombre o NIT.'),
      );
    await this.record(actor, 'matching.institution.updated', 'Institution', {
      id: current.id,
      payload: { changed: Object.keys(input) },
    });
    return this.institution(current.id);
  }

  async deleteInstitution(actor: AuthenticatedUser, id: string) {
    const current = await this.institution(id);
    const presentations = await this.db.scoring.matchPresentation.count({
      where: { institutionId: current.id },
    });
    if (current.productsCount > 0 || presentations > 0)
      throw new ConflictException({
        code: 'institution_in_use',
        message:
          'La entidad tiene productos o presentaciones. Desactívala en lugar de eliminarla.',
      });
    await this.db.scoring.institution.delete({ where: { id: current.id } });
    await this.record(actor, 'matching.institution.deleted', 'Institution', {
      id: current.id,
      payload: { name: current.name },
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- productos

  async products(query: {
    page?: string;
    institutionId?: string;
    kind?: string;
    active?: string;
    search?: string;
  }) {
    const page = pageNumber(query.page);
    const search = query.search?.trim().slice(0, 120);
    const kind = optionalEnum(PRODUCT_KINDS, query.kind);
    const where = {
      ...(query.institutionId
        ? { institutionId: parseId(query.institutionId) }
        : {}),
      ...(kind ? { kind } : {}),
      ...(query.active === 'true' || query.active === 'false'
        ? { active: query.active === 'true' }
        : {}),
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.scoring.financialProduct.findMany({
        where,
        include: {
          institution: { select: { id: true, name: true, active: true } },
          versions: {
            where: { status: 'VIGENTE' },
            select: { id: true, version: true, effectiveFrom: true },
            take: 1,
          },
          _count: { select: { versions: true } },
        },
        orderBy: [{ institution: { name: 'asc' } }, { name: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.financialProduct.count({ where }),
    ]);
    return paginated(
      items.map((item) => this.productView(item)),
      total,
      page,
    );
  }

  async product(id: string) {
    const item = await this.loadProduct(id);
    const versions = await this.versions(item.id);
    return { ...this.productView(item), versions };
  }

  async createProduct(actor: AuthenticatedUser, body: unknown) {
    const input = parseInput(productSchema, body);
    const institution = await this.db.scoring.institution.findUnique({
      where: { id: input.institutionId },
      select: { id: true },
    });
    if (!institution) throw new NotFoundException('Entidad no encontrada.');
    const created = await this.db.scoring.financialProduct
      .create({
        data: {
          ...input,
          minAmountCOP: amount(input.minAmountCOP),
          maxAmountCOP: amount(input.maxAmountCOP),
          referenceRateEA: rate(input.referenceRateEA),
          commissionPercent: rate(input.commissionPercent),
          guarantees: input.guarantees ?? [],
          requiredDocuments: input.requiredDocuments ?? [],
          createdBy: actor.id,
        },
      })
      .catch((error) =>
        this.duplicate(
          error,
          'Esta entidad ya tiene un producto con ese nombre.',
        ),
      );
    await this.record(actor, 'matching.product.created', 'FinancialProduct', {
      id: created.id,
      payload: {
        institutionId: created.institutionId,
        name: created.name,
        kind: created.kind,
      },
    });
    return this.product(created.id);
  }

  async updateProduct(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = parseInput(productPatchSchema, body);
    const current = await this.loadProduct(id);
    const merged = {
      minAmountCOP:
        input.minAmountCOP !== undefined
          ? input.minAmountCOP
          : toNumber(current.minAmountCOP),
      maxAmountCOP:
        input.maxAmountCOP !== undefined
          ? input.maxAmountCOP
          : toNumber(current.maxAmountCOP),
      minTermMonths:
        input.minTermMonths !== undefined
          ? input.minTermMonths
          : current.minTermMonths,
      maxTermMonths:
        input.maxTermMonths !== undefined
          ? input.maxTermMonths
          : current.maxTermMonths,
    };
    if (
      (merged.minAmountCOP != null &&
        merged.maxAmountCOP != null &&
        merged.minAmountCOP > merged.maxAmountCOP) ||
      (merged.minTermMonths != null &&
        merged.maxTermMonths != null &&
        merged.minTermMonths > merged.maxTermMonths)
    )
      throw new BadRequestException({
        code: 'validation_error',
        message:
          'Los máximos de monto y plazo deben ser mayores o iguales a los mínimos.',
      });
    await this.db.scoring.financialProduct
      .update({
        where: { id: current.id },
        data: {
          ...input,
          minAmountCOP: amount(input.minAmountCOP),
          maxAmountCOP: amount(input.maxAmountCOP),
          referenceRateEA: rate(input.referenceRateEA),
          commissionPercent: rate(input.commissionPercent),
        },
      })
      .catch((error) =>
        this.duplicate(
          error,
          'Esta entidad ya tiene un producto con ese nombre.',
        ),
      );
    await this.record(actor, 'matching.product.updated', 'FinancialProduct', {
      id: current.id,
      payload: { changed: Object.keys(input) },
    });
    return this.product(current.id);
  }

  async deleteProduct(actor: AuthenticatedUser, id: string) {
    const current = await this.loadProduct(id);
    const [versions, results] = await Promise.all([
      this.db.scoring.policyVersion.count({
        where: { productId: current.id, status: { not: 'BORRADOR' } },
      }),
      this.db.scoring.matchResult.count({ where: { productId: current.id } }),
    ]);
    if (versions > 0 || results > 0)
      throw new ConflictException({
        code: 'product_in_use',
        message:
          'El producto tiene políticas tramitadas o resultados históricos. Desactívalo en lugar de eliminarlo.',
      });
    await this.db.scoring.$transaction([
      this.db.scoring.policyVersion.deleteMany({
        where: { productId: current.id },
      }),
      this.db.scoring.financialProduct.delete({ where: { id: current.id } }),
    ]);
    await this.record(actor, 'matching.product.deleted', 'FinancialProduct', {
      id: current.id,
      payload: { name: current.name, institutionId: current.institutionId },
    });
    return { ok: true };
  }

  // ------------------------------------------------------ versiones de política

  async versions(productId: string) {
    const id = parseId(productId, 'Producto no encontrado.');
    const items = await this.db.scoring.policyVersion.findMany({
      where: { productId: id },
      include: { _count: { select: { rules: true } } },
      orderBy: { version: 'desc' },
    });
    const names = await this.names(items.flatMap((item) => this.people(item)));
    return items.map((item) => this.versionView(item, names));
  }

  async version(id: string) {
    const item = await this.loadVersion(id);
    const names = await this.names([
      ...this.people(item),
      ...item.events.map((event) => event.actorUserId),
    ]);
    return {
      ...this.versionView(item, names),
      product: {
        id: item.product.id,
        name: item.product.name,
        kind: item.product.kind,
        institutionId: item.product.institutionId,
        institutionName: item.product.institution.name,
      },
      rules: item.rules.map((rule) => this.ruleView(rule)),
      submissionIssues: isEditable(item.status)
        ? submissionIssues(item, item.rules)
        : [],
      history: item.events.map((event) => this.eventView(event, names)),
    };
  }

  async history(id: string) {
    const versionId = parseId(id, 'Versión no encontrada.');
    const events = await this.db.scoring.policyVersionEvent.findMany({
      where: { policyVersionId: versionId },
      orderBy: { createdAt: 'asc' },
    });
    if (events.length === 0) await this.loadVersion(versionId);
    const names = await this.names(events.map((event) => event.actorUserId));
    return { items: events.map((event) => this.eventView(event, names)) };
  }

  async createVersion(
    actor: AuthenticatedUser,
    productId: string,
    body: unknown,
  ) {
    const input = parseInput(versionSchema, body);
    const product = await this.loadProduct(productId);
    const responsibleUserId = await this.responsible(
      input.responsibleUserId ?? actor.id,
    );
    const created = await this.insertVersion(actor, product.id, {
      sourceDocument: input.sourceDocument,
      sourceUrl: input.sourceUrl ?? null,
      notes: input.notes ?? null,
      effectiveTo: input.effectiveTo ? dateOf(input.effectiveTo) : null,
      responsibleUserId,
      clonedFromId: null,
      rules: input.rules ?? [],
      action: 'created',
    });
    await this.record(
      actor,
      'matching.policy_version.created',
      'PolicyVersion',
      {
        id: created.id,
        payload: {
          productId: product.id,
          version: created.version,
          rules: (input.rules ?? []).length,
        },
      },
    );
    return this.version(created.id);
  }

  /** Copies any version (rules included) into a new draft of the same product. */
  async cloneVersion(actor: AuthenticatedUser, id: string) {
    const source = await this.loadVersion(id);
    const created = await this.insertVersion(actor, source.productId, {
      sourceDocument: source.sourceDocument,
      sourceUrl: source.sourceUrl,
      notes: source.notes,
      effectiveTo: null,
      responsibleUserId: actor.id,
      clonedFromId: source.id,
      rules: source.rules.map((rule) => ({
        field: rule.field,
        operator: rule.operator as Operator,
        value: rule.value as unknown,
        kind: rule.kind,
        weight: rule.weight,
        label: rule.label,
        internal: rule.internal,
        exceptionAllowed: rule.exceptionAllowed,
        exceptionApprovalLevel:
          rule.exceptionApprovalLevel as RuleInput['exceptionApprovalLevel'],
      })),
      action: 'cloned',
    });
    await this.record(
      actor,
      'matching.policy_version.cloned',
      'PolicyVersion',
      {
        id: created.id,
        payload: {
          productId: source.productId,
          version: created.version,
          clonedFromId: source.id,
          clonedFromVersion: source.version,
        },
      },
    );
    return this.version(created.id);
  }

  async updateVersion(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = parseInput(versionPatchSchema, body);
    const current = await this.editable(id);
    const responsibleUserId = input.responsibleUserId
      ? await this.responsible(input.responsibleUserId)
      : undefined;
    await this.db.scoring.policyVersion.update({
      where: { id: current.id },
      data: {
        sourceDocument: input.sourceDocument,
        sourceUrl: input.sourceUrl,
        notes: input.notes,
        responsibleUserId,
        effectiveTo:
          input.effectiveTo === undefined
            ? undefined
            : input.effectiveTo
              ? dateOf(input.effectiveTo)
              : null,
        updatedBy: actor.id,
      },
    });
    await this.record(
      actor,
      'matching.policy_version.updated',
      'PolicyVersion',
      { id: current.id, payload: { changed: Object.keys(input) } },
    );
    return this.version(current.id);
  }

  async deleteVersion(actor: AuthenticatedUser, id: string) {
    const current = await this.editable(id);
    await this.db.scoring.policyVersion.delete({ where: { id: current.id } });
    await this.record(
      actor,
      'matching.policy_version.deleted',
      'PolicyVersion',
      {
        id: current.id,
        payload: { productId: current.productId, version: current.version },
      },
    );
    return { ok: true };
  }

  // -------------------------------------------------------------------- reglas

  async replaceRules(actor: AuthenticatedUser, id: string, body: unknown) {
    const { rules } = parseInput(rulesSchema, body);
    const current = await this.editable(id);
    await this.db.scoring.$transaction([
      this.db.scoring.policyRule.deleteMany({
        where: { policyVersionId: current.id },
      }),
      this.db.scoring.policyRule.createMany({
        data: rules.map((rule, index) => ({
          ...rule,
          value: rule.value as object,
          position: index + 1,
          policyVersionId: current.id,
        })),
      }),
      this.db.scoring.policyVersion.update({
        where: { id: current.id },
        data: { updatedBy: actor.id },
      }),
    ]);
    await this.record(
      actor,
      'matching.policy_rules.replaced',
      'PolicyVersion',
      {
        id: current.id,
        payload: {
          rules: rules.length,
          fields: rules.map((rule) => rule.field),
        },
      },
    );
    return this.version(current.id);
  }

  async addRule(actor: AuthenticatedUser, id: string, body: unknown) {
    const rule = parseInput(ruleSchema, body);
    const current = await this.editable(id);
    if (current.rules.length >= 60)
      throw new BadRequestException('Una política admite máximo 60 reglas.');
    const position =
      Math.max(0, ...current.rules.map((item) => item.position)) + 1;
    const [created] = await this.db.scoring.$transaction([
      this.db.scoring.policyRule.create({
        data: {
          ...rule,
          value: rule.value as object,
          position,
          policyVersionId: current.id,
        },
      }),
      this.db.scoring.policyVersion.update({
        where: { id: current.id },
        data: { updatedBy: actor.id },
      }),
    ]);
    await this.record(actor, 'matching.policy_rule.created', 'PolicyRule', {
      id: created.id,
      payload: {
        policyVersionId: current.id,
        field: rule.field,
        kind: rule.kind,
      },
    });
    return this.version(current.id);
  }

  async updateRule(actor: AuthenticatedUser, ruleId: string, body: unknown) {
    const existing = await this.loadRule(ruleId);
    const current = await this.editable(existing.policyVersionId);
    const input =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const position =
      typeof input.position === 'number' &&
      Number.isInteger(input.position) &&
      input.position >= 1 &&
      input.position <= 1_000
        ? input.position
        : existing.position;
    // A partial edit is validated as the complete resulting rule.
    const rule = parseInput(ruleSchema, {
      field: existing.field,
      operator: existing.operator,
      value: existing.value,
      kind: existing.kind,
      weight: existing.weight,
      label: existing.label,
      internal: existing.internal,
      exceptionAllowed: existing.exceptionAllowed,
      exceptionApprovalLevel: existing.exceptionApprovalLevel,
      ...input,
    });
    await this.db.scoring.$transaction([
      this.db.scoring.policyRule.update({
        where: { id: existing.id },
        data: { ...rule, value: rule.value as object, position },
      }),
      this.db.scoring.policyVersion.update({
        where: { id: current.id },
        data: { updatedBy: actor.id },
      }),
    ]);
    await this.record(actor, 'matching.policy_rule.updated', 'PolicyRule', {
      id: existing.id,
      payload: { policyVersionId: current.id, field: rule.field },
    });
    return this.version(current.id);
  }

  async deleteRule(actor: AuthenticatedUser, ruleId: string) {
    const existing = await this.loadRule(ruleId);
    const current = await this.editable(existing.policyVersionId);
    await this.db.scoring.$transaction([
      this.db.scoring.policyRule.delete({ where: { id: existing.id } }),
      this.db.scoring.policyVersion.update({
        where: { id: current.id },
        data: { updatedBy: actor.id },
      }),
    ]);
    await this.record(actor, 'matching.policy_rule.deleted', 'PolicyRule', {
      id: existing.id,
      payload: { policyVersionId: current.id, field: existing.field },
    });
    return this.version(current.id);
  }

  // --------------------------------------------------------------- transiciones

  async transition(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = parseInput(transitionSchema, body);
    const current = await this.loadVersion(id);
    const from = current.status;
    const to = input.to;
    if (!canTransition(from, to))
      throw new ConflictException({
        code: 'invalid_transition',
        message: `Una política ${POLICY_STATUS_LABELS[from].toLowerCase()} no puede pasar a ${POLICY_STATUS_LABELS[to].toLowerCase()}.`,
        from,
        allowed: allowedTransitions(from),
      });
    const needsNote =
      to === 'SUSPENDIDA' || (to === 'BORRADOR' && from !== 'BORRADOR');
    if (needsNote && !input.note)
      throw new BadRequestException({
        code: 'note_required',
        message: 'Explica el motivo de este cambio de estado.',
      });

    const now = new Date();
    const today = businessDay(now);
    const metadata: Record<string, unknown> = {};
    let data: Prisma.PolicyVersionUncheckedUpdateManyInput = {};

    if (to === 'REVISION') {
      const issues = submissionIssues(current, current.rules);
      if (issues.length)
        throw new BadRequestException({
          code: 'policy_incomplete',
          message: 'La política aún no puede enviarse a revisión.',
          issues,
        });
      data = { submittedBy: actor.id, submittedAt: now };
    } else if (to === 'BORRADOR') {
      data = {
        submittedBy: null,
        submittedAt: null,
        approvedBy: null,
        approvedByRole: null,
        approvedAt: null,
        approvalIndependence: null,
      };
    } else if (to === 'APROBADA') {
      const authorIds = [...new Set([current.createdBy, current.updatedBy])];
      const [author, others] = await Promise.all([
        this.db.identity.user.findUnique({
          where: { id: current.updatedBy },
          select: { role: true },
        }),
        this.db.identity.user.count({
          where: {
            role: { in: POLICY_WRITERS },
            status: 'ACTIVE',
            id: { notIn: authorIds },
          },
        }),
      ]);
      const check = approvalCheck({
        authorIds,
        authorRole: author?.role ?? null,
        approverId: actor.id,
        approverRole: actor.role,
        otherApproversAvailable: others > 0,
      });
      if (!check.allowed)
        throw new ConflictException({
          code: 'independent_approval_required',
          message:
            'Esta política debe aprobarla una persona distinta de quien la redactó.',
        });
      metadata.approvalIndependence = check.independence;
      data = {
        approvedBy: actor.id,
        approvedByRole: actor.role,
        approvedAt: now,
        approvalIndependence: check.independence,
      };
    } else if (to === 'VIGENTE') {
      // A reactivated version keeps the date it first came into force.
      const effectiveFrom =
        input.effectiveFrom ??
        (from === 'SUSPENDIDA' ? isoDay(current.effectiveFrom) : null) ??
        today;
      if (effectiveFrom > today)
        throw new BadRequestException({
          code: 'effective_from_in_future',
          message:
            'La vigencia inicia hoy o antes. Activa la política el día en que deba empezar a regir.',
        });
      const effectiveTo =
        input.effectiveTo !== undefined
          ? input.effectiveTo
          : isoDay(current.effectiveTo);
      if (effectiveTo && effectiveTo < today)
        throw new BadRequestException({
          code: 'effective_to_in_past',
          message: 'La fecha final de vigencia ya pasó.',
        });
      if (!current.approvedBy)
        throw new ConflictException({
          code: 'approval_required',
          message:
            'La política debe estar aprobada antes de entrar en vigencia.',
        });
      data = {
        effectiveFrom: dateOf(effectiveFrom),
        effectiveTo: effectiveTo ? dateOf(effectiveTo) : null,
        activatedBy: actor.id,
        activatedAt: now,
        suspendedBy: null,
        suspendedAt: null,
        suspensionReason: null,
      };
      metadata.effectiveFrom = effectiveFrom;
      metadata.effectiveTo = effectiveTo ?? null;
    } else if (to === 'SUSPENDIDA') {
      data = {
        suspendedBy: actor.id,
        suspendedAt: now,
        suspensionReason: input.note,
      };
    }

    const action = transitionAction(from, to);
    const superseded = await this.db.scoring
      .$transaction(async (tx) => {
        let replaced: { id: string; version: number } | null = null;
        if (to === 'VIGENTE') {
          // The previous VIGENTE version is superseded first: the database
          // allows a single version in force per product.
          const previous = await tx.policyVersion.findFirst({
            where: {
              productId: current.productId,
              status: 'VIGENTE',
              id: { not: current.id },
            },
          });
          if (previous) {
            await tx.policyVersion.update({
              where: { id: previous.id },
              data: {
                status: 'SUSTITUIDA',
                supersededById: current.id,
                supersededAt: now,
                effectiveTo:
                  previous.effectiveTo && isoDay(previous.effectiveTo)! <= today
                    ? previous.effectiveTo
                    : dateOf(today),
              },
            });
            await tx.policyVersionEvent.create({
              data: {
                policyVersionId: previous.id,
                action: 'superseded',
                fromStatus: 'VIGENTE',
                toStatus: 'SUSTITUIDA',
                actorUserId: actor.id,
                actorRole: actor.role,
                metadata: {
                  supersededById: current.id,
                  supersededByVersion: current.version,
                },
              },
            });
            replaced = { id: previous.id, version: previous.version };
          }
        }
        const updated = await tx.policyVersion.updateMany({
          where: { id: current.id, status: from },
          data: { ...data, status: to },
        });
        if (updated.count !== 1)
          throw new ConflictException({
            code: 'policy_changed',
            message:
              'Otra persona cambió esta política. Recarga antes de continuar.',
          });
        await tx.policyVersionEvent.create({
          data: {
            policyVersionId: current.id,
            action,
            fromStatus: from,
            toStatus: to,
            actorUserId: actor.id,
            actorRole: actor.role,
            note: input.note ?? null,
            metadata: metadata as object,
          },
        });
        return replaced;
      })
      .catch((error) => {
        if (isUniqueViolation(error))
          throw new ConflictException({
            code: 'policy_changed',
            message:
              'Otra versión de este producto entró en vigencia al mismo tiempo. Recarga antes de continuar.',
          });
        throw error;
      });

    await this.record(
      actor,
      `matching.policy_version.${action}`,
      'PolicyVersion',
      {
        id: current.id,
        payload: {
          productId: current.productId,
          version: current.version,
          from,
          to,
          note: input.note ?? null,
          ...metadata,
          supersededVersionId: superseded?.id ?? null,
        },
      },
    );
    if (superseded)
      await this.record(
        actor,
        'matching.policy_version.superseded',
        'PolicyVersion',
        {
          id: superseded.id,
          payload: {
            productId: current.productId,
            version: superseded.version,
            supersededById: current.id,
          },
        },
      );
    return this.version(current.id);
  }

  /** Dry run of a version against facts typed by an analyst. Stores nothing. */
  async simulate(id: string, body: unknown) {
    const { facts } = parseInput(simulateSchema, body);
    const current = await this.loadVersion(id);
    const unknown = Object.keys(facts).filter((key) => !factField(key));
    if (unknown.length)
      throw new BadRequestException({
        code: 'validation_error',
        message: `Campos fuera del catálogo: ${unknown.join(', ')}.`,
      });
    const evaluation = evaluatePolicy(facts, this.engineRules(current.rules));
    return {
      policyVersionId: current.id,
      version: current.version,
      engineVersion: evaluation.engineVersion,
      status: evaluation.status,
      fitPercent: evaluation.fitPercent,
      presentable: evaluation.presentable,
      requiresException: evaluation.requiresException,
      exceptionApprovalLevels: evaluation.exceptionApprovalLevels,
      totals: evaluation.totals,
      explanation: explain(evaluation, 'staff'),
    };
  }

  // ------------------------------------------------------------------ internos

  engineRules(
    rules: ReadonlyArray<{
      id: string;
      position: number;
      field: string;
      operator: string;
      value: unknown;
      kind: EngineRule['kind'];
      weight: number;
      label: string;
      internal: boolean;
      exceptionAllowed: boolean;
      exceptionApprovalLevel: string | null;
    }>,
  ): EngineRule[] {
    return rules.map((rule) => ({
      id: rule.id,
      position: rule.position,
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
      kind: rule.kind,
      weight: rule.weight,
      label: rule.label,
      internal: rule.internal,
      exceptionAllowed: rule.exceptionAllowed,
      exceptionApprovalLevel: rule.exceptionApprovalLevel,
    }));
  }

  private async insertVersion(
    actor: AuthenticatedUser,
    productId: string,
    input: {
      sourceDocument: string;
      sourceUrl: string | null;
      notes: string | null;
      effectiveTo: Date | null;
      responsibleUserId: string;
      clonedFromId: string | null;
      rules: RuleInput[];
      action: 'created' | 'cloned';
    },
  ) {
    // Two analysts may create a version at once: the unique (product, version)
    // index decides and the loser simply takes the next number.
    for (let attempt = 0; ; attempt += 1) {
      const last = await this.db.scoring.policyVersion.aggregate({
        where: { productId },
        _max: { version: true },
      });
      try {
        return await this.db.scoring.policyVersion.create({
          data: {
            productId,
            version: (last._max.version ?? 0) + 1,
            sourceDocument: input.sourceDocument,
            sourceUrl: input.sourceUrl,
            notes: input.notes,
            effectiveTo: input.effectiveTo,
            responsibleUserId: input.responsibleUserId,
            clonedFromId: input.clonedFromId,
            createdBy: actor.id,
            updatedBy: actor.id,
            rules: {
              create: input.rules.map((rule, index) => ({
                ...rule,
                value: rule.value as object,
                position: index + 1,
              })),
            },
            events: {
              create: {
                action: input.action,
                toStatus: 'BORRADOR',
                actorUserId: actor.id,
                actorRole: actor.role,
                metadata: input.clonedFromId
                  ? { clonedFromId: input.clonedFromId }
                  : undefined,
              },
            },
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 2) throw error;
      }
    }
  }

  private async loadProduct(id: string) {
    const item = await this.db.scoring.financialProduct.findUnique({
      where: { id: parseId(id, 'Producto no encontrado.') },
      include: {
        institution: { select: { id: true, name: true, active: true } },
        versions: {
          where: { status: 'VIGENTE' },
          select: { id: true, version: true, effectiveFrom: true },
          take: 1,
        },
        _count: { select: { versions: true } },
      },
    });
    if (!item) throw new NotFoundException('Producto no encontrado.');
    return item;
  }

  private async loadVersion(id: string) {
    const item = await this.db.scoring.policyVersion.findUnique({
      where: { id: parseId(id, 'Versión no encontrada.') },
      include: {
        rules: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
        events: { orderBy: { createdAt: 'asc' } },
        product: {
          include: { institution: { select: { id: true, name: true } } },
        },
        _count: { select: { rules: true } },
      },
    });
    if (!item) throw new NotFoundException('Versión no encontrada.');
    return item;
  }

  private async loadRule(id: string) {
    const rule = await this.db.scoring.policyRule.findUnique({
      where: { id: parseId(id, 'Regla no encontrada.') },
    });
    if (!rule) throw new NotFoundException('Regla no encontrada.');
    return rule;
  }

  /** Loads a version and refuses to change it unless it is still a draft. */
  private async editable(id: string) {
    const current = await this.loadVersion(id);
    if (!isEditable(current.status))
      throw new ConflictException({
        code: 'policy_not_editable',
        message:
          'Solo un borrador puede modificarse. Clona la versión para proponer cambios.',
        status: current.status,
      });
    return current;
  }

  private async responsible(userId: string) {
    const user = await this.db.identity.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !INTERNAL_STAFF.includes(user.role)
    )
      throw new BadRequestException({
        code: 'validation_error',
        message: 'El responsable debe ser una persona activa del equipo LUFT.',
      });
    return user.id;
  }

  private async names(ids: ReadonlyArray<string | null | undefined>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map<string, string>();
    const users = await this.db.identity.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  private people(item: {
    createdBy: string;
    updatedBy: string;
    responsibleUserId: string;
    approvedBy: string | null;
    submittedBy: string | null;
    activatedBy: string | null;
    suspendedBy: string | null;
  }) {
    return [
      item.createdBy,
      item.updatedBy,
      item.responsibleUserId,
      item.approvedBy,
      item.submittedBy,
      item.activatedBy,
      item.suspendedBy,
    ];
  }

  private duplicate(error: unknown, message: string): never {
    if (isUniqueViolation(error))
      throw new ConflictException({ code: 'duplicate', message });
    throw error;
  }

  private record(
    actor: AuthenticatedUser,
    action: string,
    resource: string,
    detail: { id: string; payload?: Record<string, unknown> },
  ) {
    return this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action,
      resource,
      resourceId: detail.id,
      payload: detail.payload,
    });
  }

  private institutionView(item: {
    id: string;
    name: string;
    kind: string;
    taxId: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    website: string | null;
    notes: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: { products: number; users: number };
  }) {
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      taxId: item.taxId,
      contactName: item.contactName,
      contactEmail: item.contactEmail,
      contactPhone: item.contactPhone,
      website: item.website,
      notes: item.notes,
      active: item.active,
      productsCount: item._count.products,
      usersCount: item._count.users,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private productView(item: Awaited<ReturnType<PolicyService['loadProduct']>>) {
    const current = item.versions[0] ?? null;
    return {
      id: item.id,
      institutionId: item.institutionId,
      institution: item.institution,
      name: item.name,
      kind: item.kind,
      description: item.description,
      minAmountCOP: toNumber(item.minAmountCOP),
      maxAmountCOP: toNumber(item.maxAmountCOP),
      minTermMonths: item.minTermMonths,
      maxTermMonths: item.maxTermMonths,
      referenceRateEA: toRate(item.referenceRateEA),
      guarantees: (item.guarantees as string[]) ?? [],
      requiredDocuments: (item.requiredDocuments as string[]) ?? [],
      channel: item.channel,
      commissionPercent: toRate(item.commissionPercent),
      commissionNotes: item.commissionNotes,
      agreementReference: item.agreementReference,
      active: item.active,
      versionsCount: item._count.versions,
      currentVersion: current
        ? {
            id: current.id,
            version: current.version,
            effectiveFrom: isoDay(current.effectiveFrom),
          }
        : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private versionView(
    item: {
      id: string;
      productId: string;
      version: number;
      status: PolicyStatusName;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
      sourceDocument: string;
      sourceUrl: string | null;
      notes: string | null;
      responsibleUserId: string;
      createdBy: string;
      updatedBy: string;
      submittedBy: string | null;
      submittedAt: Date | null;
      approvedBy: string | null;
      approvedByRole: string | null;
      approvedAt: Date | null;
      approvalIndependence: string | null;
      activatedBy: string | null;
      activatedAt: Date | null;
      supersededById: string | null;
      supersededAt: Date | null;
      suspendedBy: string | null;
      suspendedAt: Date | null;
      suspensionReason: string | null;
      clonedFromId: string | null;
      createdAt: Date;
      updatedAt: Date;
      _count: { rules: number };
    },
    names: Map<string, string>,
  ) {
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      id: item.id,
      productId: item.productId,
      version: item.version,
      status: item.status,
      statusLabel: POLICY_STATUS_LABELS[item.status],
      editable: isEditable(item.status),
      allowedTransitions: allowedTransitions(item.status),
      effectiveFrom: isoDay(item.effectiveFrom),
      effectiveTo: isoDay(item.effectiveTo),
      sourceDocument: item.sourceDocument,
      sourceUrl: item.sourceUrl,
      notes: item.notes,
      responsibleUserId: item.responsibleUserId,
      responsibleName: name(item.responsibleUserId),
      createdBy: item.createdBy,
      createdByName: name(item.createdBy),
      updatedBy: item.updatedBy,
      updatedByName: name(item.updatedBy),
      submittedBy: item.submittedBy,
      submittedByName: name(item.submittedBy),
      submittedAt: item.submittedAt,
      approvedBy: item.approvedBy,
      approvedByName: name(item.approvedBy),
      approvedByRole: item.approvedByRole,
      approvedAt: item.approvedAt,
      approvalIndependence: item.approvalIndependence,
      activatedBy: item.activatedBy,
      activatedByName: name(item.activatedBy),
      activatedAt: item.activatedAt,
      supersededById: item.supersededById,
      supersededAt: item.supersededAt,
      suspendedBy: item.suspendedBy,
      suspendedByName: name(item.suspendedBy),
      suspendedAt: item.suspendedAt,
      suspensionReason: item.suspensionReason,
      clonedFromId: item.clonedFromId,
      rulesCount: item._count.rules,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private ruleView(rule: {
    id: string;
    position: number;
    field: string;
    operator: string;
    value: unknown;
    kind: string;
    weight: number;
    label: string;
    internal: boolean;
    exceptionAllowed: boolean;
    exceptionApprovalLevel: string | null;
  }) {
    return {
      id: rule.id,
      position: rule.position,
      field: rule.field,
      fieldLabel: factField(rule.field)?.label ?? rule.field,
      operator: rule.operator,
      operatorLabel:
        OPERATOR_LABELS[rule.operator as Operator] ?? rule.operator,
      value: rule.value,
      kind: rule.kind,
      weight: rule.weight,
      label: rule.label,
      summary: describeCondition(rule),
      internal: rule.internal,
      exceptionAllowed: rule.exceptionAllowed,
      exceptionApprovalLevel: rule.exceptionApprovalLevel,
    };
  }

  private eventView(
    event: {
      id: string;
      action: string;
      fromStatus: string | null;
      toStatus: string;
      actorUserId: string;
      actorRole: string;
      note: string | null;
      metadata: unknown;
      createdAt: Date;
    },
    names: Map<string, string>,
  ) {
    return {
      id: event.id,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorUserId: event.actorUserId,
      actorName: names.get(event.actorUserId) ?? null,
      actorRole: event.actorRole,
      note: event.note,
      metadata: event.metadata ?? null,
      createdAt: event.createdAt,
    };
  }
}
