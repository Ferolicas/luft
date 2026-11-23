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
import type { Prisma } from '../generated/startif/client';
import { IntegrationService } from '../integrations/integration.service';
import { QueueService } from '../integrations/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  bogotaDate,
  colombiaDateInput,
  daysOverdue,
  isSettled,
} from '../startif/credit-lifecycle';
import { annualEffectiveRate, rateString } from '../startif/credit-product';
import { CreditProductService } from '../startif/credit-product.service';
import { LegalRateService } from '../startif/legal-rate.service';
import { normalizePurpose } from '../startif/second-credit';
import { StartifService } from '../startif/startif.service';

type Tx = Prisma.TransactionClient;

const reasonSchema = z.object({
  reason: z.string().trim().min(10).max(2_000),
});

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
    private readonly products: CreditProductService,
    private readonly legalRates: LegalRateService,
  ) {}

  async overview() {
    const [
      users,
      activeUsers,
      applications,
      activeLoans,
      defaultedLoans,
      writtenOffLoans,
      pendingDisbursements,
      overdue,
      openPqr,
      payments,
      pendingIntegrations,
    ] = await Promise.all([
      this.db.identity.user.count(),
      this.db.identity.user.count({ where: { status: 'ACTIVE' } }),
      this.db.startif.creditApplication.count(),
      this.db.startif.loan.count({ where: { status: 'ACTIVE' } }),
      this.db.startif.loan.count({ where: { status: 'DEFAULTED' } }),
      this.db.startif.loan.count({ where: { status: 'WRITTEN_OFF' } }),
      this.db.startif.disbursement.count({ where: { status: 'PENDING' } }),
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
      defaultedLoans,
      writtenOffLoans,
      pendingDisbursements,
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

  /**
   * Names for the ids that operational listings return. Every staff role
   * needs to know whom a credit, payment or request belongs to, but only for
   * the ids it is already looking at: this is a lookup, not a directory.
   */
  async lookupPeople(body: unknown) {
    const { ids } = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(200) })
      .parse(body);
    const items = await this.db.identity.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, fullName: true, email: true },
    });
    return { items };
  }

  async setRole(actor: AuthenticatedUser, userId: string, body: unknown) {
    const { role } = z.object({ role: z.nativeEnum(Role) }).parse(body);
    // Entity and ally accounts only exist linked to their institution or
    // ally; that link (and its role) is managed from the matching console.
    if (role === Role.ALLY || role === Role.INSTITUTION)
      throw new BadRequestException({
        code: 'partner_role_requires_link',
        message:
          'Este rol se asigna al vincular la cuenta con una entidad o un aliado.',
      });
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
          product: { select: { name: true } },
          disbursement: true,
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
      items: items.map((item) => this.startif.serialize(item)),
      page,
      pages: Math.ceil(total / take),
      total,
    };
  }

  /**
   * Requisitos del crédito 2 para una solicitud en estudio. Es un insumo para
   * el analista: la decisión sigue siendo suya.
   */
  async applicationEligibility(
    actor: AuthenticatedUser,
    applicationId: string,
  ) {
    const application = await this.db.startif.creditApplication.findUnique({
      where: { id: z.string().uuid().parse(applicationId) },
    });
    if (!application) throw new NotFoundException('Solicitud no encontrada.');
    if (application.productCode !== 'BUILDER_2')
      throw new BadRequestException(
        'La elegibilidad solo aplica al segundo crédito.',
      );
    const result = await this.startif.secondCreditEligibility(
      application.userId,
      {
        purpose: normalizePurpose(
          application.purpose,
          application.purposeDescription,
        ),
        amountCOP: Number(application.amountCOP),
        excludeApplicationId: application.id,
      },
    );
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.eligibility.reviewed',
      resource: 'CreditApplication',
      resourceId: application.id,
      payload: {
        eligible: result.eligible,
        requirements: result.requirements.map((item) => ({
          code: item.code,
          met: item.met,
        })),
      },
    });
    return { applicationId: application.id, ...result };
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
          // Sin valor se aprueba a la tasa del producto con la que se firmó.
          monthlyRate: z.coerce.number().min(0).max(0.1).optional(),
        }),
        z.object({
          decision: z.literal('REJECT'),
          reason: z.string().trim().min(5).max(2_000),
        }),
      ])
      .parse(body);
    const application = await this.db.startif.creditApplication.findUnique({
      where: { id: applicationId },
      include: { kycProcesses: true, signatures: true, product: true },
    });
    if (!application) throw new NotFoundException('Solicitud no encontrada.');
    if (application.status !== 'PENDING_REVIEW')
      throw new BadRequestException(
        'La solicitud no está pendiente de decisión.',
      );
    const now = new Date();
    const pending = { id: application.id, status: 'PENDING_REVIEW' as const };
    if (input.decision === 'REJECT') {
      const claimed = await this.db.startif.creditApplication.updateMany({
        where: pending,
        data: {
          status: 'REJECTED',
          decidedAt: now,
          decisionReason: input.reason,
        },
      });
      if (!claimed.count)
        throw new BadRequestException(
          'La solicitud no está pendiente de decisión.',
        );
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
      return {
        id: application.id,
        status: 'REJECTED',
        amountCOP: application.amountCOP.toString(),
        decidedAt: now,
        decisionReason: input.reason,
      };
    }
    if (
      !application.kycProcesses.some((item) => item.status === 'COMPLETED') ||
      !application.signatures.some((item) => item.status === 'COMPLETED')
    )
      throw new BadRequestException('KYC y pagaré deben estar completos.');
    if (application.geometricDecrease === null)
      throw new BadRequestException(
        'La solicitud no tiene gradiente de amortización definido.',
      );
    const signedRate =
      application.requestedRateMonthly === null
        ? null
        : Number(application.requestedRateMonthly);
    const monthlyRate = input.monthlyRate ?? signedRate;
    if (monthlyRate === null)
      throw new BadRequestException({
        code: 'rate_required',
        message: 'La solicitud no tiene tasa de producto: indica la tasa.',
      });
    // El pagaré se firmó con la tasa del producto: se puede aprobar a esa tasa
    // o a una menor, nunca a una mayor.
    if (signedRate !== null && monthlyRate > signedRate)
      throw new BadRequestException({
        code: 'rate_exceeds_signed_note',
        message: 'La tasa no puede superar la del pagaré firmado.',
        signedMonthlyRate: signedRate,
      });
    // Si falta la del periodo, se consulta la certificación oficial al momento.
    const usury = await this.legalRates.currentOrSync(now);
    if (!usury)
      throw new BadRequestException({
        code: 'legal_rate_required',
        message: 'Carga la tasa máxima legal vigente antes de aprobar.',
      });
    const annualEffective = annualEffectiveRate(monthlyRate);
    if (annualEffective > Number(usury.annualEffectiveRate))
      throw new BadRequestException({
        code: 'rate_exceeds_legal_limit',
        message:
          'La tasa supera el máximo legal vigente. Revisa la tasa del producto o la tasa legal registrada.',
        requestedAnnualEffective: annualEffective,
        legalAnnualEffective: Number(usury.annualEffectiveRate),
      });
    const approval = {
      approvedRateMonthly: rateString(monthlyRate),
      usuryRateId: usury.id,
      decidedAt: now,
      decisionReason: input.reason,
    };
    // Las solicitudes anteriores al catálogo financiaron el servicio LUFT.
    const transfer = application.product?.disbursementMode === 'TRANSFER';
    const outcome = await this.db.startif.$transaction(async (tx) => {
      const claimed = await tx.creditApplication.updateMany({
        where: pending,
        data: { ...approval, status: transfer ? 'APPROVED' : 'ACTIVE' },
      });
      if (!claimed.count)
        throw new BadRequestException(
          'La solicitud no está pendiente de decisión.',
        );
      if (transfer) {
        // Hay giro de dinero: el crédito no nace hasta que finanzas registre
        // la referencia y la fecha reales del desembolso.
        const disbursement = await tx.disbursement.create({
          data: {
            applicationId: application.id,
            userId: application.userId,
            productCode: application.productCode,
            kind: 'TRANSFER',
            purpose: application.purpose,
            amountCOP: application.amountCOP,
            status: 'PENDING',
            createdBy: actor.id,
          },
        });
        return { disbursementId: disbursement.id, loanId: null };
      }
      const loan = await this.openLoan(tx, application, {
        monthlyRate,
        startDate: bogotaDate(now),
        disbursedAt: now,
        virtualCard: true,
      });
      const disbursement = await tx.disbursement.create({
        data: {
          applicationId: application.id,
          loanId: loan.id,
          userId: application.userId,
          productCode: application.productCode,
          kind: 'SERVICE_FINANCING',
          purpose: application.purpose,
          amountCOP: application.amountCOP,
          status: 'COMPLETED',
          note: 'Financiación del servicio LUFT. No hay giro de dinero.',
          disbursedAt: now,
          createdBy: actor.id,
        },
      });
      return { disbursementId: disbursement.id, loanId: loan.id };
    });
    const status = transfer ? 'APPROVED' : 'ACTIVE';
    await this.queues.add(
      'notifications',
      transfer ? 'credit-approved-transfer' : 'credit-approved',
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
        productCode: application.productCode,
        productVersion: application.productVersion,
        monthlyRate,
        signedMonthlyRate: signedRate,
        geometricDecrease: Number(application.geometricDecrease),
        usuryRateId: usury.id,
        reason: input.reason,
        status,
        loanId: outcome.loanId,
        disbursementId: outcome.disbursementId,
        disbursementKind: transfer ? 'TRANSFER' : 'SERVICE_FINANCING',
      },
    });
    this.realtime.toUser(application.userId, 'credit:decision', {
      applicationId,
      status,
      loanId: outcome.loanId,
    });
    if (transfer)
      this.realtime.toRole(Role.FINANCE, 'disbursement:pending', {
        disbursementId: outcome.disbursementId,
        applicationId,
      });
    return {
      applicationId,
      loanId: outcome.loanId,
      disbursementId: outcome.disbursementId,
      status,
    };
  }

  /** Crea el préstamo y su plan con las condiciones propias de la solicitud. */
  private async openLoan(
    tx: Tx,
    application: {
      id: string;
      userId: string;
      productId: string | null;
      productCode: string;
      productVersion: number | null;
      purpose: string;
      amountCOP: bigint;
      termMonths: number;
      geometricDecrease: unknown;
      product: { defaultAfterDays: number } | null;
    },
    options: {
      monthlyRate: number;
      /** Día calendario desde el que se cuentan las cuotas. */
      startDate: string;
      disbursedAt: Date;
      virtualCard: boolean;
    },
  ) {
    const geometricDecrease = Number(application.geometricDecrease);
    const plan = this.startif.schedule(
      Number(application.amountCOP),
      application.termMonths,
      options.monthlyRate,
      geometricDecrease,
      options.startDate,
    );
    const loan = await tx.loan.create({
      data: {
        applicationId: application.id,
        userId: application.userId,
        productId: application.productId,
        productCode: application.productCode,
        productVersion: application.productVersion,
        purpose: application.purpose,
        principalCOP: application.amountCOP,
        monthlyRate: rateString(options.monthlyRate),
        termMonths: application.termMonths,
        geometricDecrease: rateString(geometricDecrease),
        defaultAfterDays: application.product?.defaultAfterDays,
        outstandingBalanceCOP: application.amountCOP,
        status: 'ACTIVE',
        disbursedAt: options.disbursedAt,
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
    if (options.virtualCard)
      await tx.virtualCard.create({
        data: {
          loanId: loan.id,
          userId: application.userId,
          last4: randomInt(0, 10_000).toString().padStart(4, '0'),
          fixedLimitCOP: application.amountCOP,
        },
      });
    return loan;
  }

  async disbursements(page = 1, status?: string) {
    const take = 25;
    const where = status
      ? {
          status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).parse(status),
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.startif.disbursement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
      this.db.startif.disbursement.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        amountCOP: item.amountCOP.toString(),
      })),
      page,
      pages: Math.ceil(total / take),
      total,
    };
  }

  /**
   * Finanzas registra un giro ya realizado (referencia y fecha reales). Solo
   * entonces nace el préstamo y sus cuotas cuentan desde la fecha del giro.
   * La plataforma nunca ordena ni simula el giro.
   */
  async registerDisbursement(
    actor: AuthenticatedUser,
    disbursementId: string,
    body: unknown,
  ) {
    const input = z
      .object({
        reference: z.string().trim().min(4).max(160),
        disbursedAt: z.string().trim().min(10).max(40),
        channel: z.string().trim().min(2).max(80).optional(),
        note: z.string().trim().max(2_000).optional(),
      })
      .parse(body);
    let when: ReturnType<typeof colombiaDateInput>;
    try {
      when = colombiaDateInput(input.disbursedAt);
    } catch {
      throw new BadRequestException('La fecha del giro no es válida.');
    }
    const disbursement = await this.db.startif.disbursement.findUnique({
      where: { id: z.string().uuid().parse(disbursementId) },
      include: { application: { include: { product: true } } },
    });
    if (!disbursement) throw new NotFoundException('Desembolso no encontrado.');
    const application = disbursement.application;
    if (
      disbursement.status !== 'PENDING' ||
      disbursement.kind !== 'TRANSFER' ||
      application.status !== 'APPROVED' ||
      application.approvedRateMonthly === null
    )
      throw new BadRequestException(
        'El desembolso no está pendiente de registro.',
      );
    const now = new Date();
    if (when.date > bogotaDate(now))
      throw new BadRequestException('La fecha del giro no puede ser futura.');
    if (application.decidedAt && when.date < bogotaDate(application.decidedAt))
      throw new BadRequestException(
        'La fecha del giro no puede ser anterior a la aprobación.',
      );
    const monthlyRate = Number(application.approvedRateMonthly);
    const loan = await this.db.startif
      .$transaction(async (tx) => {
        const claimed = await tx.disbursement.updateMany({
          where: { id: disbursement.id, status: 'PENDING' },
          data: {
            status: 'COMPLETED',
            reference: input.reference,
            channel: input.channel,
            note: input.note,
            disbursedAt: when.instant,
            registeredBy: actor.id,
          },
        });
        const activated = await tx.creditApplication.updateMany({
          where: { id: application.id, status: 'APPROVED' },
          data: { status: 'ACTIVE' },
        });
        if (!claimed.count || !activated.count)
          throw new BadRequestException(
            'El desembolso no está pendiente de registro.',
          );
        const created = await this.openLoan(tx, application, {
          monthlyRate,
          startDate: when.date,
          disbursedAt: when.instant,
          virtualCard: false,
        });
        await tx.disbursement.update({
          where: { id: disbursement.id },
          data: { loanId: created.id },
        });
        return created;
      })
      .catch((error: any) => {
        // La misma referencia bancaria no puede respaldar dos desembolsos.
        if (error?.code === 'P2002')
          throw new BadRequestException({
            code: 'reference_already_registered',
            message: 'Esa referencia ya está registrada en otro desembolso.',
          });
        throw error;
      });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.disbursement.registered',
      resource: 'Disbursement',
      resourceId: disbursement.id,
      payload: {
        applicationId: application.id,
        loanId: loan.id,
        amountCOP: disbursement.amountCOP.toString(),
        reference: input.reference,
        channel: input.channel ?? null,
        disbursedOn: when.date,
      },
    });
    await this.queues.add(
      'notifications',
      'credit-disbursed',
      { applicationId: application.id, userId: application.userId },
      `disbursed-${disbursement.id}`,
    );
    this.realtime.toUser(application.userId, 'credit:decision', {
      applicationId: application.id,
      status: 'ACTIVE',
      loanId: loan.id,
    });
    return {
      disbursementId: disbursement.id,
      applicationId: application.id,
      loanId: loan.id,
      status: 'COMPLETED',
    };
  }

  /** El giro no se hará: la solicitud aprobada se cierra sin crédito. */
  async cancelDisbursement(
    actor: AuthenticatedUser,
    disbursementId: string,
    body: unknown,
  ) {
    const { reason } = reasonSchema.parse(body);
    const disbursement = await this.db.startif.disbursement.findUnique({
      where: { id: z.string().uuid().parse(disbursementId) },
    });
    if (!disbursement) throw new NotFoundException('Desembolso no encontrado.');
    await this.db.startif.$transaction(async (tx) => {
      const claimed = await tx.disbursement.updateMany({
        where: { id: disbursement.id, status: 'PENDING', kind: 'TRANSFER' },
        data: { status: 'CANCELLED', note: reason, registeredBy: actor.id },
      });
      const closed = await tx.creditApplication.updateMany({
        where: { id: disbursement.applicationId, status: 'APPROVED' },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decisionReason: `Desembolso cancelado: ${reason}`,
        },
      });
      if (!claimed.count || !closed.count)
        throw new BadRequestException(
          'El desembolso no está pendiente de registro.',
        );
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.disbursement.cancelled',
      resource: 'Disbursement',
      resourceId: disbursement.id,
      payload: { applicationId: disbursement.applicationId, reason },
    });
    this.realtime.toUser(disbursement.userId, 'credit:decision', {
      applicationId: disbursement.applicationId,
      status: 'REJECTED',
    });
    return {
      disbursementId: disbursement.id,
      applicationId: disbursement.applicationId,
      status: 'CANCELLED',
    };
  }

  async loans(page = 1, status?: string) {
    const take = 25;
    const where = status
      ? {
          status: z
            .enum(['ACTIVE', 'DEFAULTED', 'COMPLETED', 'WRITTEN_OFF'])
            .parse(status),
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.startif.loan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          installments: {
            select: {
              status: true,
              dueDate: true,
              amountCOP: true,
              paidCOP: true,
            },
          },
        },
        skip: (page - 1) * take,
        take,
      }),
      this.db.startif.loan.count({ where }),
    ]);
    const today = bogotaDate(new Date());
    return {
      items: items.map(({ installments, ...loan }) => {
        const late = installments.filter(
          (row) =>
            !isSettled(row.status) && daysOverdue(row.dueDate, today) > 0,
        );
        return {
          ...loan,
          principalCOP: loan.principalCOP.toString(),
          outstandingBalanceCOP: loan.outstandingBalanceCOP.toString(),
          installmentsTotal: installments.length,
          installmentsPaid: installments.filter((row) => isSettled(row.status))
            .length,
          overdueInstallments: late.length,
          overdueCOP: late
            .reduce((sum, row) => sum + (row.amountCOP - row.paidCOP), 0n)
            .toString(),
          daysOverdue: late.reduce(
            (max, row) => Math.max(max, daysOverdue(row.dueDate, today)),
            0,
          ),
        };
      }),
      page,
      pages: Math.ceil(total / take),
      total,
    };
  }

  /** Castigo de cartera: decisión manual sobre un crédito en mora. */
  async writeOffLoan(actor: AuthenticatedUser, loanId: string, body: unknown) {
    const { reason } = reasonSchema.parse(body);
    const loan = await this.db.startif.loan.findUnique({
      where: { id: z.string().uuid().parse(loanId) },
    });
    if (!loan) throw new NotFoundException('Crédito no encontrado.');
    const now = new Date();
    await this.db.startif.$transaction(async (tx) => {
      const claimed = await tx.loan.updateMany({
        where: { id: loan.id, status: 'DEFAULTED' },
        data: {
          status: 'WRITTEN_OFF',
          writtenOffAt: now,
          writtenOffBy: actor.id,
          writtenOffReason: reason,
        },
      });
      if (!claimed.count)
        throw new BadRequestException({
          code: 'loan_not_defaulted',
          message: 'Solo se castiga un crédito que está en mora.',
        });
      await tx.creditApplication.update({
        where: { id: loan.applicationId },
        data: { status: 'WRITTEN_OFF' },
      });
    });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'credit.loan.written_off',
      resource: 'Loan',
      resourceId: loan.id,
      payload: {
        reason,
        outstandingBalanceCOP: loan.outstandingBalanceCOP.toString(),
        defaultedAt: loan.defaultedAt?.toISOString() ?? null,
      },
    });
    this.realtime.toUser(loan.userId, 'credit:status', {
      loanId: loan.id,
      applicationId: loan.applicationId,
      status: 'WRITTEN_OFF',
    });
    return { loanId: loan.id, status: 'WRITTEN_OFF', writtenOffAt: now };
  }

  creditProducts() {
    return this.products.list();
  }

  createProductVersion(actor: AuthenticatedUser, code: string, body: unknown) {
    return this.products.createVersion(actor, code, body);
  }

  activateProduct(actor: AuthenticatedUser, id: string, body: unknown) {
    return this.products.activate(actor, id, body);
  }

  suspendProduct(actor: AuthenticatedUser, id: string, body: unknown) {
    return this.products.suspend(actor, id, body);
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
