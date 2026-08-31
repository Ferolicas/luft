import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { Role } from '../generated/identity/enums';
import { IntegrationService } from '../integrations/integration.service';
import { QueueService } from '../integrations/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StartifService } from '../startif/startif.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly queues: QueueService,
    private readonly realtime: RealtimeService,
    private readonly startif: StartifService,
  ) {}

  async overview() {
    const [
      users,
      activeUsers,
      applications,
      activeLoans,
      overdue,
      openPqr,
      payments,
      pendingIntegrations,
    ] = await Promise.all([
      this.db.identity.user.count(),
      this.db.identity.user.count({ where: { status: 'ACTIVE' } }),
      this.db.startif.creditApplication.count(),
      this.db.startif.loan.count({ where: { status: 'ACTIVE' } }),
      this.db.startif.installment.count({ where: { status: 'OVERDUE' } }),
      this.db.startif.pqr.count({
        where: { status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_USER'] } },
      }),
      this.db.startif.payment.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amountCOP: true },
        _count: true,
      }),
      this.db.audit.integrationEvent.count({
        where: { status: { in: ['FAILED', 'CONFIGURATION_REQUIRED'] } },
      }),
    ]);
    return {
      users,
      activeUsers,
      applications,
      activeLoans,
      overdueInstallments: overdue,
      openPqr,
      approvedPayments: {
        count: payments._count,
        amountCOP: payments._sum.amountCOP?.toString() ?? '0',
      },
      pendingIntegrations,
      integrations: this.integrations.status(),
    };
  }

  async users(page = 1, search = '') {
    const take = 25;
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { username: { contains: search, mode: 'insensitive' as const } },
            { fullName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.identity.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          phone: true,
          fullName: true,
          stratum: true,
          role: true,
          status: true,
          phoneVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
      this.db.identity.user.count({ where }),
    ]);
    return { items, page, pages: Math.ceil(total / take), total };
  }

  async setRole(actor: AuthenticatedUser, userId: string, body: unknown) {
    const { role } = z.object({ role: z.nativeEnum(Role) }).parse(body);
    if (actor.id === userId && role !== Role.SUPERADMIN)
      throw new BadRequestException(
        'No puedes retirar tu propio acceso de superadministración.',
      );
    const updated = await this.db.identity.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, role: true },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.user.role_changed',
      resource: 'User',
      resourceId: userId,
      payload: { role },
    });
    return updated;
  }

  async applications(page = 1, status?: string) {
    const take = 25;
    const where = status ? { status: status as any } : {};
    const [items, total] = await Promise.all([
      this.db.startif.creditApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          kycProcesses: { orderBy: { startedAt: 'desc' }, take: 1 },
          signatures: { orderBy: { createdAt: 'desc' }, take: 1 },
          loan: true,
        },
        skip: (page - 1) * take,
        take,
      }),
      this.db.startif.creditApplication.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        amountCOP: item.amountCOP.toString(),
        loan: item.loan
          ? {
              ...item.loan,
              principalCOP: item.loan.principalCOP.toString(),
              outstandingBalanceCOP: item.loan.outstandingBalanceCOP.toString(),
            }
          : null,
      })),
      page,
      pages: Math.ceil(total / take),
      total,
    };
  }

  async decideApplication(
    actor: AuthenticatedUser,
    applicationId: string,
    body: unknown,
  ) {
    const input = z
      .discriminatedUnion('decision', [
        z.object({
          decision: z.literal('APPROVE'),
          reason: z.string().trim().min(5).max(2_000),
          monthlyRate: z.coerce.number().min(0).max(0.1).default(0.02),
        }),
        z.object({
          decision: z.literal('REJECT'),
          reason: z.string().trim().min(5).max(2_000),
        }),
      ])
      .parse(body);
    const application = await this.db.startif.creditApplication.findUnique({
      where: { id: applicationId },
      include: { kycProcesses: true, signatures: true },
    });
    if (!application) throw new NotFoundException('Solicitud no encontrada.');
    if (application.status !== 'PENDING_REVIEW')
      throw new BadRequestException(
        'La solicitud no está pendiente de decisión.',
      );
    if (input.decision === 'REJECT') {
      const rejected = await this.db.startif.creditApplication.update({
        where: { id: application.id },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decisionReason: input.reason,
        },
      });
      await this.audit.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'credit.application.rejected',
        resource: 'CreditApplication',
        resourceId: application.id,
        payload: { reason: input.reason },
      });
      this.realtime.toUser(application.userId, 'credit:decision', {
        applicationId,
        status: 'REJECTED',
      });
      return { ...rejected, amountCOP: rejected.amountCOP.toString() };
    }
    if (
      !application.kycProcesses.some((item) => item.status === 'COMPLETED') ||
      !application.signatures.some((item) => item.status === 'COMPLETED')
    )
      throw new BadRequestException('KYC y pagaré deben estar completos.');
    const today = new Date();
    const usury = await this.db.startif.usuryRate.findFirst({
      where: { effectiveFrom: { lte: today }, effectiveTo: { gte: today } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!usury)
      throw new BadRequestException({
        code: 'legal_rate_required',
        message: 'Carga la tasa máxima legal vigente antes de aprobar.',
      });
    const annualEffective = Math.pow(1 + input.monthlyRate, 12) - 1;
    if (annualEffective > Number(usury.annualEffectiveRate))
      throw new BadRequestException({
        code: 'rate_exceeds_legal_limit',
        requestedAnnualEffective: annualEffective,
        legalAnnualEffective: Number(usury.annualEffectiveRate),
      });
    const plan = this.startif.schedule(
      Number(application.amountCOP),
      application.termMonths,
      input.monthlyRate,
    );
    const loan = await this.db.startif.$transaction(async (tx) => {
      const updated = await tx.creditApplication.update({
        where: { id: application.id },
        data: {
          status: 'ACTIVE',
          approvedRateMonthly: input.monthlyRate,
          usuryRateId: usury.id,
          decidedAt: new Date(),
          decisionReason: input.reason,
        },
      });
      const created = await tx.loan.create({
        data: {
          applicationId: application.id,
          userId: application.userId,
          principalCOP: application.amountCOP,
          monthlyRate: input.monthlyRate,
          termMonths: application.termMonths,
          outstandingBalanceCOP: application.amountCOP,
          status: 'ACTIVE',
          disbursedAt: new Date(),
          installments: {
            create: plan.map((row) => ({
              sequence: row.sequence,
              dueDate: new Date(`${row.dueDate}T12:00:00Z`),
              openingBalanceCOP: BigInt(row.openingBalanceCOP),
              amountCOP: BigInt(row.amountCOP),
              principalCOP: BigInt(row.principalCOP),
              interestCOP: BigInt(row.interestCOP),
              closingBalanceCOP: BigInt(row.closingBalanceCOP),
            })),
          },
        },
      });
      await tx.virtualCard.create({
        data: {
          loanId: created.id,
          userId: application.userId,
          last4: randomInt(0, 10_000).toString().padStart(4, '0'),
          fixedLimitCOP: application.amountCOP,
        },
      });
      return { created, updated };
    });
    await this.queues.add(
      'notifications',
      'credit-approved',
      { applicationId, userId: application.userId },
      `approved-${applicationId}`,
    );
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.application.approved',
      resource: 'CreditApplication',
      resourceId: application.id,
      payload: {
        monthlyRate: input.monthlyRate,
        usuryRateId: usury.id,
        reason: input.reason,
      },
    });
    this.realtime.toUser(application.userId, 'credit:decision', {
      applicationId,
      status: 'ACTIVE',
      loanId: loan.created.id,
    });
    return {
      applicationId,
      loanId: loan.created.id,
      status: loan.updated.status,
    };
  }

  async setUsuryRate(actor: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        category: z.string().trim().min(3).max(100),
        annualEffectiveRate: z.coerce.number().positive().max(2),
        effectiveFrom: z.coerce.date(),
        effectiveTo: z.coerce.date(),
        sourceUrl: z.string().url(),
      })
      .parse(body);
    if (input.effectiveTo < input.effectiveFrom)
      throw new BadRequestException(
        'La fecha final debe ser posterior a la inicial.',
      );
    const rate = await this.db.startif.usuryRate.upsert({
      where: {
        category_effectiveFrom: {
          category: input.category,
          effectiveFrom: input.effectiveFrom,
        },
      },
      create: { ...input, verifiedAt: new Date(), createdBy: actor.id },
      update: {
        annualEffectiveRate: input.annualEffectiveRate,
        effectiveTo: input.effectiveTo,
        sourceUrl: input.sourceUrl,
        verifiedAt: new Date(),
        createdBy: actor.id,
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'legal.usury_rate.updated',
      resource: 'UsuryRate',
      resourceId: rate.id,
      payload: {
        category: input.category,
        annualEffectiveRate: input.annualEffectiveRate,
        effectiveFrom: input.effectiveFrom.toISOString(),
        sourceUrl: input.sourceUrl,
      },
    });
    return rate;
  }

  async pqr(page = 1, status?: string) {
    const take = 25;
    const where = status ? { status: status as any } : {};
    const rows = await this.db.startif.pqr.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * take,
      take,
    });
    return rows.map((row) => ({
      ...row,
      message: this.crypto.decrypt(row.messageCiphertext),
      resolution: row.resolutionCiphertext
        ? this.crypto.decrypt(row.resolutionCiphertext)
        : null,
      messageCiphertext: undefined,
      resolutionCiphertext: undefined,
    }));
  }

  async resolvePqr(actor: AuthenticatedUser, pqrId: string, body: unknown) {
    const input = z
      .object({
        status: z.enum(['IN_REVIEW', 'WAITING_USER', 'RESOLVED', 'CLOSED']),
        resolution: z.string().trim().min(10).max(8_000).optional(),
        assignedRole: z.enum(['SUPPORT', 'LEGAL', 'COLLECTIONS']).optional(),
      })
      .parse(body);
    const pqr = await this.db.startif.pqr.update({
      where: { id: pqrId },
      data: {
        status: input.status,
        assignedRole: input.assignedRole,
        resolutionCiphertext: input.resolution
          ? this.crypto.encrypt(input.resolution)
          : undefined,
        resolvedAt: ['RESOLVED', 'CLOSED'].includes(input.status)
          ? new Date()
          : undefined,
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'pqr.status.updated',
      resource: 'Pqr',
      resourceId: pqr.id,
      payload: { status: input.status, assignedRole: input.assignedRole },
    });
    this.realtime.toUser(pqr.userId, 'pqr:status', {
      id: pqr.id,
      status: pqr.status,
    });
    return { id: pqr.id, status: pqr.status, resolvedAt: pqr.resolvedAt };
  }

  auditLog(page = 1) {
    return this.db.audit.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * 50,
      take: 50,
    });
  }
}
