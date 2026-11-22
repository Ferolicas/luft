import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import { Role } from '../generated/identity/enums';
import { isInternalStaff } from './roles';
import { allyPatchSchema, allySchema, linkUserSchema } from './schemas';
import {
  isUniqueViolation,
  PAGE_SIZE,
  pageNumber,
  paginated,
  parseId,
  parseInput,
} from './validation';

type PartnerRole = typeof Role.INSTITUTION | typeof Role.ALLY;

/**
 * SUPERADMIN operations over external partners: allies, the accounts linked
 * to an institution or an ally, and referrals. Linking an account also sets
 * its identity role, so access is granted and revoked in one audited step.
 */
@Injectable()
export class PartnerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------- aliados

  async allies(query: { page?: string; search?: string }) {
    const page = pageNumber(query.page);
    const search = query.search?.trim().slice(0, 120);
    const where = search
      ? { name: { contains: search, mode: 'insensitive' as const } }
      : {};
    const [items, total] = await Promise.all([
      this.db.scoring.ally.findMany({
        where,
        include: { _count: { select: { users: true, referrals: true } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.ally.count({ where }),
    ]);
    return paginated(
      items.map((item) => this.allyView(item)),
      total,
      page,
    );
  }

  async ally(id: string) {
    const item = await this.db.scoring.ally.findUnique({
      where: { id: parseId(id, 'Aliado no encontrado.') },
      include: { _count: { select: { users: true, referrals: true } } },
    });
    if (!item) throw new NotFoundException('Aliado no encontrado.');
    return this.allyView(item);
  }

  async createAlly(actor: AuthenticatedUser, body: unknown) {
    const input = parseInput(allySchema, body);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const created = await this.db.scoring.ally.create({
          data: {
            ...input,
            referralCode: `AL${randomBytes(5).toString('hex').toUpperCase()}`,
            createdBy: actor.id,
          },
        });
        await this.record(actor, 'matching.ally.created', 'Ally', created.id, {
          name: created.name,
        });
        return this.ally(created.id);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Either the name/NIT is taken (a real conflict) or the random
        // referral code collided (retry with a new one).
        const clash = await this.db.scoring.ally.findFirst({
          where: {
            OR: [
              { name: input.name },
              ...(input.taxId ? [{ taxId: input.taxId }] : []),
            ],
          },
          select: { id: true },
        });
        if (clash || attempt >= 3)
          throw new ConflictException({
            code: 'duplicate',
            message: 'Ya existe un aliado con ese nombre o NIT.',
          });
      }
    }
  }

  async updateAlly(actor: AuthenticatedUser, id: string, body: unknown) {
    const input = parseInput(allyPatchSchema, body);
    const current = await this.ally(id);
    await this.db.scoring.ally
      .update({ where: { id: current.id }, data: input })
      .catch((error) => {
        if (isUniqueViolation(error))
          throw new ConflictException({
            code: 'duplicate',
            message: 'Ya existe un aliado con ese nombre o NIT.',
          });
        throw error;
      });
    await this.record(actor, 'matching.ally.updated', 'Ally', current.id, {
      changed: Object.keys(input),
    });
    return this.ally(current.id);
  }

  async deleteAlly(actor: AuthenticatedUser, id: string) {
    const current = await this.ally(id);
    if (current.usersCount > 0 || current.referralsCount > 0)
      throw new ConflictException({
        code: 'ally_in_use',
        message:
          'El aliado tiene cuentas o personas referidas. Desactívalo en lugar de eliminarlo.',
      });
    await this.db.scoring.ally.delete({ where: { id: current.id } });
    await this.record(actor, 'matching.ally.deleted', 'Ally', current.id, {
      name: current.name,
    });
    return { ok: true };
  }

  // ------------------------------------------------------- cuentas de entidades

  async institutionUsers(institutionId: string) {
    const id = await this.institutionId(institutionId);
    const links = await this.db.scoring.institutionUser.findMany({
      where: { institutionId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { items: await this.linkViews(links) };
  }

  async linkInstitutionUser(
    actor: AuthenticatedUser,
    institutionId: string,
    body: unknown,
  ) {
    const id = await this.institutionId(institutionId);
    const user = await this.linkable(body, Role.INSTITUTION);
    if (
      await this.db.scoring.allyUser.findUnique({ where: { userId: user.id } })
    )
      throw this.alreadyPartner();
    const previous = await this.db.scoring.institutionUser.findUnique({
      where: { userId: user.id },
    });
    const link = await this.db.scoring.institutionUser.upsert({
      where: { userId: user.id },
      create: { userId: user.id, institutionId: id, createdBy: actor.id },
      update: { institutionId: id, createdBy: actor.id },
    });
    await this.setRole(actor, user, Role.INSTITUTION);
    await this.record(
      actor,
      'matching.institution_user.linked',
      'InstitutionUser',
      link.id,
      {
        userId: user.id,
        institutionId: id,
        previousInstitutionId: previous?.institutionId ?? null,
      },
    );
    return this.institutionUsers(id);
  }

  async unlinkInstitutionUser(actor: AuthenticatedUser, linkId: string) {
    const link = await this.db.scoring.institutionUser.findUnique({
      where: { id: parseId(linkId, 'Vínculo no encontrado.') },
    });
    if (!link) throw new NotFoundException('Vínculo no encontrado.');
    await this.db.scoring.institutionUser.delete({ where: { id: link.id } });
    await this.clearRole(actor, link.userId, Role.INSTITUTION);
    await this.record(
      actor,
      'matching.institution_user.unlinked',
      'InstitutionUser',
      link.id,
      { userId: link.userId, institutionId: link.institutionId },
    );
    return { ok: true };
  }

  // ---------------------------------------------------------- cuentas de aliados

  async allyUsers(allyId: string) {
    const ally = await this.ally(allyId);
    const links = await this.db.scoring.allyUser.findMany({
      where: { allyId: ally.id },
      orderBy: { createdAt: 'asc' },
    });
    return { items: await this.linkViews(links) };
  }

  async linkAllyUser(actor: AuthenticatedUser, allyId: string, body: unknown) {
    const ally = await this.ally(allyId);
    const user = await this.linkable(body, Role.ALLY);
    if (
      await this.db.scoring.institutionUser.findUnique({
        where: { userId: user.id },
      })
    )
      throw this.alreadyPartner();
    const previous = await this.db.scoring.allyUser.findUnique({
      where: { userId: user.id },
    });
    const link = await this.db.scoring.allyUser.upsert({
      where: { userId: user.id },
      create: { userId: user.id, allyId: ally.id, createdBy: actor.id },
      update: { allyId: ally.id, createdBy: actor.id },
    });
    await this.setRole(actor, user, Role.ALLY);
    await this.record(actor, 'matching.ally_user.linked', 'AllyUser', link.id, {
      userId: user.id,
      allyId: ally.id,
      previousAllyId: previous?.allyId ?? null,
    });
    return this.allyUsers(ally.id);
  }

  async unlinkAllyUser(actor: AuthenticatedUser, linkId: string) {
    const link = await this.db.scoring.allyUser.findUnique({
      where: { id: parseId(linkId, 'Vínculo no encontrado.') },
    });
    if (!link) throw new NotFoundException('Vínculo no encontrado.');
    await this.db.scoring.allyUser.delete({ where: { id: link.id } });
    await this.clearRole(actor, link.userId, Role.ALLY);
    await this.record(
      actor,
      'matching.ally_user.unlinked',
      'AllyUser',
      link.id,
      {
        userId: link.userId,
        allyId: link.allyId,
      },
    );
    return { ok: true };
  }

  // ------------------------------------------------------------------ referidos

  async referrals(allyId: string, pageInput?: string) {
    const ally = await this.ally(allyId);
    const page = pageNumber(pageInput);
    const where = { referredByAllyId: ally.id };
    const [rows, total] = await Promise.all([
      this.db.scoring.allyReferral.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.db.scoring.allyReferral.count({ where }),
    ]);
    const users = await this.db.identity.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, fullName: true, email: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return paginated(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        fullName: byId.get(row.userId)?.fullName ?? null,
        email: byId.get(row.userId)?.email ?? null,
        source: row.source,
        createdAt: row.createdAt,
      })),
      total,
      page,
    );
  }

  /**
   * Manual capture of `referredByAllyId`. Registration does not ask for a
   * referral code yet, so SUPERADMIN records who referred an existing person.
   */
  async addReferral(actor: AuthenticatedUser, allyId: string, body: unknown) {
    const ally = await this.ally(allyId);
    const input = parseInput(linkUserSchema, body);
    const user = await this.db.identity.user.findFirst({
      where: input.userId ? { id: input.userId } : { email: input.email },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('Cuenta no encontrada.');
    if (user.role !== Role.USER)
      throw new ConflictException({
        code: 'not_a_customer',
        message: 'Solo una cuenta de usuario puede registrarse como referida.',
      });
    const referral = await this.db.scoring.allyReferral
      .create({
        data: {
          userId: user.id,
          referredByAllyId: ally.id,
          source: 'STAFF',
          capturedBy: actor.id,
        },
      })
      .catch((error) => {
        if (isUniqueViolation(error))
          throw new ConflictException({
            code: 'already_referred',
            message: 'Esta persona ya tiene un aliado registrado.',
          });
        throw error;
      });
    await this.record(
      actor,
      'matching.ally_referral.created',
      'AllyReferral',
      referral.id,
      { userId: user.id, referredByAllyId: ally.id, source: 'STAFF' },
    );
    return { id: referral.id, userId: user.id, createdAt: referral.createdAt };
  }

  async removeReferral(actor: AuthenticatedUser, referralId: string) {
    const referral = await this.db.scoring.allyReferral.findUnique({
      where: { id: parseId(referralId, 'Referido no encontrado.') },
    });
    if (!referral) throw new NotFoundException('Referido no encontrado.');
    await this.db.scoring.allyReferral.delete({ where: { id: referral.id } });
    await this.record(
      actor,
      'matching.ally_referral.deleted',
      'AllyReferral',
      referral.id,
      { userId: referral.userId, referredByAllyId: referral.referredByAllyId },
    );
    return { ok: true };
  }

  // ------------------------------------------------------------------ internos

  private async institutionId(id: string) {
    const institution = await this.db.scoring.institution.findUnique({
      where: { id: parseId(id, 'Entidad no encontrada.') },
      select: { id: true },
    });
    if (!institution) throw new NotFoundException('Entidad no encontrada.');
    return institution.id;
  }

  private alreadyPartner() {
    return new ConflictException({
      code: 'already_partner',
      message:
        'Esta cuenta ya está vinculada como aliado o entidad. Retira ese vínculo primero.',
    });
  }

  /** Finds the account and refuses internal staff or the other partner role. */
  private async linkable(body: unknown, target: PartnerRole) {
    const input = parseInput(linkUserSchema, body);
    const user = await this.db.identity.user.findFirst({
      where: input.userId ? { id: input.userId } : { email: input.email },
      select: { id: true, role: true, status: true },
    });
    if (!user) throw new NotFoundException('Cuenta no encontrada.');
    if (user.status !== 'ACTIVE')
      throw new ConflictException({
        code: 'account_not_active',
        message: 'La cuenta debe estar activa para vincularla.',
      });
    if (isInternalStaff(user.role))
      throw new ConflictException({
        code: 'staff_account',
        message:
          'Una cuenta del equipo interno no puede operar como aliado o entidad. Usa una cuenta distinta.',
      });
    if (user.role !== Role.USER && user.role !== target)
      throw this.alreadyPartner();
    return user;
  }

  private async setRole(
    actor: AuthenticatedUser,
    user: { id: string; role: Role },
    role: PartnerRole,
  ) {
    if (user.role === role) return;
    await this.db.identity.user.update({
      where: { id: user.id },
      data: { role },
    });
    await this.record(actor, 'admin.user.role_changed', 'User', user.id, {
      role,
      previousRole: user.role,
      reason: 'partner_link',
    });
  }

  /** Removing the link takes the partner role away in the same operation. */
  private async clearRole(
    actor: AuthenticatedUser,
    userId: string,
    role: PartnerRole,
  ) {
    const updated = await this.db.identity.user.updateMany({
      where: { id: userId, role },
      data: { role: Role.USER },
    });
    if (updated.count === 1)
      await this.record(actor, 'admin.user.role_changed', 'User', userId, {
        role: Role.USER,
        previousRole: role,
        reason: 'partner_unlink',
      });
  }

  private async linkViews(
    links: Array<{ id: string; userId: string; createdAt: Date }>,
  ) {
    const users = await this.db.identity.user.findMany({
      where: { id: { in: links.map((link) => link.userId) } },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
      },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return links.map((link) => ({
      id: link.id,
      userId: link.userId,
      fullName: byId.get(link.userId)?.fullName ?? null,
      email: byId.get(link.userId)?.email ?? null,
      role: byId.get(link.userId)?.role ?? null,
      status: byId.get(link.userId)?.status ?? null,
      createdAt: link.createdAt,
    }));
  }

  private allyView(item: {
    id: string;
    name: string;
    taxId: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    referralCode: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: { users: number; referrals: number };
  }) {
    return {
      id: item.id,
      name: item.name,
      taxId: item.taxId,
      contactName: item.contactName,
      contactEmail: item.contactEmail,
      contactPhone: item.contactPhone,
      referralCode: item.referralCode,
      active: item.active,
      usersCount: item._count.users,
      referralsCount: item._count.referrals,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private record(
    actor: AuthenticatedUser,
    action: string,
    resource: string,
    resourceId: string,
    payload: Record<string, unknown>,
  ) {
    return this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action,
      resource,
      resourceId,
      payload,
    });
  }
}
