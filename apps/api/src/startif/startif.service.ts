import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { IntegrationService } from '../integrations/integration.service';
import { QueueService } from '../integrations/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { geometricSchedule } from './credit-calculator';

const STARTIF_CONSENT =
  'Autorizo a StartIF y LUFT para estudiar, originar y administrar mi solicitud de crédito, validar mi identidad, firmar electrónicamente el pagaré, recaudar las cuotas y reportar el comportamiento positivo o negativo a los operadores de información, conforme a la ley y a las autorizaciones entregadas.';

@Injectable()
export class StartifService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly queues: QueueService,
    private readonly realtime: RealtimeService,
  ) {}

  quote(body: unknown) {
    const input = z
      .object({
        amountCOP: z.coerce
          .number()
          .int()
          .min(100_000)
          .max(2_000_000)
          .default(500_000),
        termMonths: z.coerce.number().int().min(3).max(12).default(6),
      })
      .parse(body);
    return {
      amountCOP: input.amountCOP,
      termMonths: input.termMonths,
      monthlyRate: 0.02,
      installments: this.schedule(input.amountCOP, input.termMonths, 0.02),
      note: 'La tasa final nunca podrá superar el límite legal vigente y se confirma antes de firmar.',
    };
  }

  async acceptConsent(
    user: AuthenticatedUser,
    body: unknown,
    request: Request,
  ) {
    const input = z
      .object({
        accepted: z.literal(true),
        version: z.literal('2026-09-01'),
        deviceMeta: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(body);
    const consent = await this.db.startif.startifConsent.create({
      data: {
        userId: user.id,
        kind: 'CREDIT_ORIGINATION_AND_REPORTING',
        version: input.version,
        textSnapshot: STARTIF_CONSENT,
        textHash: this.crypto.hash(STARTIF_CONSENT),
        ipHash: request.ip ? this.crypto.hash(request.ip) : undefined,
        userAgent: request.get('user-agent')?.slice(0, 500),
        deviceMeta: input.deviceMeta as any,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'startif.consent.accepted',
      resource: 'StartifConsent',
      resourceId: consent.id,
      ip: request.ip,
      payload: { version: input.version, textHash: consent.textHash },
    });
    return consent;
  }

  async createApplication(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        amountCOP: z.coerce
          .number()
          .int()
          .min(100_000)
          .max(2_000_000)
          .default(500_000),
        termMonths: z.coerce.number().int().min(3).max(12).default(6),
      })
      .parse(body);
    const consent = await this.db.startif.startifConsent.findFirst({
      where: {
        userId: user.id,
        kind: 'CREDIT_ORIGINATION_AND_REPORTING',
        revokedAt: null,
      },
      orderBy: { acceptedAt: 'desc' },
    });
    const scoreShare = await this.db.luft.consent.findFirst({
      where: {
        userId: user.id,
        kind: 'SCORE_SHARE_WITH_STARTIF',
        revokedAt: null,
      },
      orderBy: { acceptedAt: 'desc' },
    });
    if (!consent || !scoreShare)
      throw new BadRequestException({
        code: 'consent_required',
        consents: [
          'CREDIT_ORIGINATION_AND_REPORTING',
          'SCORE_SHARE_WITH_STARTIF',
        ],
      });
    const profile = await this.db.luft.financialProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile?.archetype)
      throw new BadRequestException({
        code: 'profile_incomplete',
        message: 'Completa el diagnóstico financiero primero.',
      });
    const application = await this.db.startif.creditApplication.create({
      data: {
        userId: user.id,
        amountCOP: BigInt(input.amountCOP),
        termMonths: input.termMonths,
        requestedRateMonthly: 0.02,
        status: 'PENDING_KYC',
        submittedAt: new Date(),
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'startif.application.created',
      resource: 'CreditApplication',
      resourceId: application.id,
      payload: { amountCOP: input.amountCOP, termMonths: input.termMonths },
    });
    return { ...application, amountCOP: application.amountCOP.toString() };
  }

  async startKyc(user: AuthenticatedUser, applicationId: string) {
    const application = await this.ownedApplication(user.id, applicationId);
    if (!['PENDING_KYC', 'CONFIGURATION_REQUIRED'].includes(application.status))
      throw new BadRequestException(
        'La solicitud no está lista para validar identidad.',
      );
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const process = await this.db.startif.kycProcess.create({
      data: {
        applicationId: application.id,
        userId: user.id,
        status: 'PROCESSING',
      },
    });
    try {
      const provider = await this.integrations.startTruoraValidation({
        userId: user.id,
        document: this.crypto.decrypt(identity.documentCiphertext),
        email: identity.email,
      });
      const updated = await this.db.startif.kycProcess.update({
        where: { id: process.id },
        data: {
          externalId: provider.process_id,
          verificationUrl: provider.validation_url,
        },
      });
      this.realtime.toUser(user.id, 'kyc:status', {
        id: updated.id,
        status: updated.status,
        verificationUrl: updated.verificationUrl,
      });
      return updated;
    } catch (error: any) {
      const configuration = error?.response?.code === 'configuration_required';
      await this.db.startif.$transaction([
        this.db.startif.kycProcess.update({
          where: { id: process.id },
          data: {
            status: configuration ? 'CONFIGURATION_REQUIRED' : 'FAILED',
            failureReason: configuration
              ? 'TRUORA_CREDENTIALS_REQUIRED'
              : 'PROVIDER_ERROR',
          },
        }),
        this.db.startif.creditApplication.update({
          where: { id: application.id },
          data: {
            status: configuration ? 'CONFIGURATION_REQUIRED' : 'PENDING_KYC',
          },
        }),
      ]);
      throw error;
    }
  }

  async signPromissoryNote(
    user: AuthenticatedUser,
    applicationId: string,
    body: unknown,
    request: Request,
  ) {
    const input = z
      .object({
        signatureData: z.string().min(50).max(500_000),
        challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/),
        accepted: z.literal(true),
      })
      .parse(body);
    const application = await this.ownedApplication(user.id, applicationId);
    const kyc = await this.db.startif.kycProcess.findFirst({
      where: { applicationId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    if (!kyc)
      throw new BadRequestException(
        'La identidad debe estar validada antes de firmar.',
      );
    const otp = await this.db.identity.otpChallenge.findFirst({
      where: {
        id: input.challengeId,
        userId: user.id,
        purpose: 'SIGNATURE',
        verifiedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
    });
    if (
      !otp ||
      !this.crypto.equals(
        otp.codeHash,
        this.crypto.hash(`otp:${otp.id}:${input.code}`),
      )
    )
      throw new BadRequestException('Código de firma inválido o vencido.');
    const document = `PAGARÉ STARTIF ${application.id}\nCapital: COP ${application.amountCOP.toString()}\nPlazo: ${application.termMonths} meses\nEl plan definitivo y la tasa se anexan tras la aprobación, sin superar el límite legal vigente.`;
    const envelope = await this.db.startif.$transaction(async (tx) => {
      await this.db.identity.otpChallenge.update({
        where: { id: otp.id },
        data: { verifiedAt: new Date() },
      });
      const created = await tx.signatureEnvelope.create({
        data: {
          applicationId,
          userId: user.id,
          status: 'COMPLETED',
          documentVersion: '2026-09-01',
          documentSnapshot: document,
          documentHash: this.crypto.hash(document),
          signatureCiphertext: this.crypto.encrypt(input.signatureData),
          otpChallengeId: otp.id,
          ipHash: request.ip ? this.crypto.hash(request.ip) : undefined,
          userAgent: request.get('user-agent')?.slice(0, 500),
          signedAt: new Date(),
        },
      });
      await tx.creditApplication.update({
        where: { id: applicationId },
        data: { status: 'PENDING_REVIEW' },
      });
      return created;
    });
    await this.queues.add(
      'lifecycle',
      'credit-review',
      { applicationId, userId: user.id },
      applicationId,
    );
    await this.audit.record({
      actorUserId: user.id,
      action: 'startif.promissory_note.signed',
      resource: 'SignatureEnvelope',
      resourceId: envelope.id,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      payload: { documentHash: envelope.documentHash, otpChallengeId: otp.id },
    });
    return {
      id: envelope.id,
      status: envelope.status,
      signedAt: envelope.signedAt,
      documentHash: envelope.documentHash,
    };
  }

  async requestSignatureOtp(
    user: AuthenticatedUser,
    applicationId: string,
    authIssueOtp: (
      userId: string,
      destination: string,
      purpose: 'SIGNATURE',
    ) => Promise<unknown>,
  ) {
    await this.ownedApplication(user.id, applicationId);
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    return authIssueOtp(user.id, identity.phone, 'SIGNATURE');
  }

  async createPsePayment(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        installmentId: z.string().uuid(),
        bankCode: z.string().trim().min(1).max(30),
      })
      .parse(body);
    const installment = await this.db.startif.installment.findFirst({
      where: {
        id: input.installmentId,
        loan: { userId: user.id },
        status: { in: ['PENDING', 'DUE', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      include: { loan: true },
    });
    if (!installment)
      throw new NotFoundException('Cuota no encontrada o ya pagada.');
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const remaining = installment.amountCOP - installment.paidCOP;
    const idempotencyKey = randomUUID();
    const payment = await this.db.startif.payment.create({
      data: {
        userId: user.id,
        installmentId: installment.id,
        idempotencyKey,
        amountCOP: remaining,
      },
    });
    try {
      const order = await this.integrations.createPseOrder({
        amount: Number(remaining),
        email: identity.email,
        identification: this.crypto.decrypt(identity.documentCiphertext),
        entity: input.bankCode,
        description: `Cuota ${installment.sequence} crédito LUFT`,
        idempotencyKey,
      });
      const providerPayment = order.transactions?.payments?.[0] ?? {};
      const updated = await this.db.startif.payment.update({
        where: { id: payment.id },
        data: {
          externalId: String(order.id ?? providerPayment.id),
          status: 'ACTION_REQUIRED',
          redirectUrl:
            providerPayment.payment_method?.ticket_url ??
            providerPayment.ticket_url ??
            order.processing_data?.redirect_url,
        },
      });
      await this.audit.record({
        actorUserId: user.id,
        action: 'payment.pse.created',
        resource: 'Payment',
        resourceId: updated.id,
        payload: {
          installmentId: installment.id,
          amountCOP: remaining.toString(),
          provider: 'MERCADOPAGO',
        },
      });
      return { ...updated, amountCOP: updated.amountCOP.toString() };
    } catch (error) {
      await this.db.startif.payment.update({
        where: { id: payment.id },
        data: { statusDetail: 'CONFIGURATION_REQUIRED_OR_PROVIDER_ERROR' },
      });
      throw error;
    }
  }

  async webhookMercadoPago(
    headers: Record<string, string | string[] | undefined>,
    body: any,
    dataId?: string,
  ) {
    this.integrations.validateMercadoPagoWebhook(
      headers['x-signature'] as string | undefined,
      headers['x-request-id'] as string | undefined,
      dataId ?? String(body?.data?.id ?? ''),
    );
    const externalId = String(body?.data?.id ?? dataId ?? '');
    const resource = body?.status
      ? body
      : await this.integrations.getMercadoPagoResource(
          externalId,
          String(body?.type ?? body?.topic ?? body?.action ?? ''),
        );
    const providerPayment = resource?.transactions?.payments?.[0] ?? resource;
    const rawStatus = String(
      providerPayment?.status ?? resource?.status ?? body?.status ?? '',
    ).toLowerCase();
    const status =
      rawStatus.includes('approved') || rawStatus.includes('processed')
        ? 'APPROVED'
        : rawStatus.includes('reject')
          ? 'REJECTED'
          : rawStatus.includes('cancel')
            ? 'CANCELLED'
            : 'PROCESSING';
    const providerExternalId = String(
      resource?.id ?? providerPayment?.id ?? externalId,
    );
    const externalReference = String(
      resource?.external_reference ??
        providerPayment?.external_reference ??
        body?.external_reference ??
        '',
    );
    const payment = await this.db.startif.payment.findFirst({
      where: {
        OR: [
          { externalId },
          { externalId: providerExternalId },
          ...(externalReference ? [{ idempotencyKey: externalReference }] : []),
        ],
      },
    });
    if (!payment) return { accepted: true, matched: false };
    if (payment.status === 'APPROVED')
      return { accepted: true, matched: true, idempotent: true };
    const result = await this.db.startif.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          approvedAt: status === 'APPROVED' ? new Date() : undefined,
          externalId: providerExternalId,
          providerPayloadHash: this.crypto.hash(JSON.stringify(resource)),
          statusDetail: String(
            providerPayment?.status_detail ??
              resource?.status_detail ??
              rawStatus,
          ).slice(0, 160),
        },
      });
      if (status === 'APPROVED' && payment.installmentId) {
        const installment = await tx.installment.findUniqueOrThrow({
          where: { id: payment.installmentId },
        });
        const paid = installment.paidCOP + payment.amountCOP;
        const paidInFull = paid >= installment.amountCOP;
        await tx.installment.update({
          where: { id: installment.id },
          data: {
            paidCOP: paid,
            status: paidInFull ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: paidInFull ? new Date() : undefined,
          },
        });
        if (paidInFull) {
          const pending = await tx.installment.count({
            where: {
              loanId: installment.loanId,
              id: { not: installment.id },
              status: { notIn: ['PAID', 'WAIVED'] },
            },
          });
          const completed = pending === 0;
          await tx.loan.update({
            where: { id: installment.loanId },
            data: {
              outstandingBalanceCOP: installment.closingBalanceCOP,
              status: completed ? 'COMPLETED' : 'ACTIVE',
              closedAt: completed ? new Date() : undefined,
            },
          });
          if (completed) {
            const loan = await tx.loan.findUniqueOrThrow({
              where: { id: installment.loanId },
            });
            await tx.creditApplication.update({
              where: { id: loan.applicationId },
              data: { status: 'COMPLETED' },
            });
          }
          return { loanClosed: completed, loanId: installment.loanId };
        }
      }
      return { loanClosed: false, loanId: undefined };
    });
    this.realtime.toUser(payment.userId, 'payment:status', {
      paymentId: payment.id,
      status,
    });
    if (status === 'APPROVED')
      await this.queues.add(
        'lifecycle',
        'report-payment',
        { paymentId: payment.id, userId: payment.userId },
        `report-${payment.id}`,
      );
    if (status === 'APPROVED' && result.loanClosed) {
      const previousFinal = await this.db.luft.scoreInquiry.findFirst({
        where: { userId: payment.userId, type: 'FINAL' },
      });
      if (!previousFinal) {
        const inquiry = await this.db.luft.scoreInquiry.create({
          data: {
            userId: payment.userId,
            type: 'FINAL',
            provider: 'DATACREDITO',
          },
        });
        await this.queues.add(
          'bureau',
          'query-score',
          {
            inquiryId: inquiry.id,
            userId: payment.userId,
            provider: inquiry.provider,
          },
          `final-score-${result.loanId}`,
        );
      }
    }
    return { accepted: true, matched: true };
  }

  async webhookTruora(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    body: any,
  ) {
    this.integrations.validateTruoraWebhook(signature, rawBody);
    const externalId = String(
      body?.process_id ?? body?.data?.process_id ?? body?.id ?? '',
    );
    const rawStatus = String(
      body?.status ?? body?.data?.status ?? '',
    ).toLowerCase();
    const status = ['success', 'approved', 'completed'].some((value) =>
      rawStatus.includes(value),
    )
      ? 'COMPLETED'
      : ['failure', 'failed', 'rejected', 'declined'].some((value) =>
            rawStatus.includes(value),
          )
        ? 'FAILED'
        : 'PROCESSING';
    const process = await this.db.startif.kycProcess.findUnique({
      where: { externalId },
    });
    if (!process) return { accepted: true, matched: false };
    await this.db.startif.$transaction([
      this.db.startif.kycProcess.update({
        where: { id: process.id },
        data: {
          status,
          resultCiphertext: this.crypto.encrypt(JSON.stringify(body)),
          failureReason:
            status === 'FAILED' ? rawStatus.slice(0, 500) : undefined,
          completedAt: status === 'COMPLETED' ? new Date() : undefined,
        },
      }),
      this.db.startif.creditApplication.update({
        where: { id: process.applicationId },
        data: {
          status:
            status === 'COMPLETED'
              ? 'PENDING_SIGNATURE'
              : status === 'FAILED'
                ? 'PENDING_KYC'
                : 'PENDING_KYC',
        },
      }),
    ]);
    await this.audit.record({
      actorRole: 'SYSTEM',
      action: 'kyc.webhook.received',
      resource: 'KycProcess',
      resourceId: process.id,
      payload: { provider: 'TRUORA', status },
    });
    this.realtime.toUser(process.userId, 'kyc:status', {
      id: process.id,
      status,
    });
    return { accepted: true, matched: true };
  }

  async credit(user: AuthenticatedUser) {
    const application = await this.db.startif.creditApplication.findFirst({
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
        signatures: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!application) return null;
    return this.serialize(application);
  }

  async createPqr(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        type: z.enum(['PETICION', 'QUEJA', 'RECLAMO', 'CONSULTA']),
        subject: z.string().trim().min(5).max(180),
        message: z.string().trim().min(20).max(8_000),
      })
      .parse(body);
    const days = input.type === 'CONSULTA' ? 10 : 15;
    const pqr = await this.db.startif.pqr.create({
      data: {
        userId: user.id,
        type: input.type,
        subject: input.subject,
        messageCiphertext: this.crypto.encrypt(input.message),
        dueAt: new Date(Date.now() + days * 86_400_000),
        assignedRole: input.type === 'RECLAMO' ? 'LEGAL' : 'SUPPORT',
      },
    });
    this.realtime.toRole(pqr.assignedRole ?? 'SUPPORT', 'pqr:new', {
      id: pqr.id,
      type: pqr.type,
      dueAt: pqr.dueAt,
    });
    return { ...pqr, messageCiphertext: undefined };
  }

  async listPqr(user: AuthenticatedUser) {
    return this.db.startif.pqr.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        type: true,
        subject: true,
        status: true,
        dueAt: true,
        resolvedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  schedule(principal: number, months: number, monthlyRate: number) {
    return geometricSchedule(principal, months, monthlyRate);
  }

  private async ownedApplication(userId: string, applicationId: string) {
    const application = await this.db.startif.creditApplication.findFirst({
      where: { id: applicationId, userId },
    });
    if (!application) throw new NotFoundException('Solicitud no encontrada.');
    return application;
  }

  private serialize(application: any) {
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
            installments: application.loan.installments.map((row: any) => ({
              ...row,
              openingBalanceCOP: row.openingBalanceCOP.toString(),
              amountCOP: row.amountCOP.toString(),
              principalCOP: row.principalCOP.toString(),
              interestCOP: row.interestCOP.toString(),
              closingBalanceCOP: row.closingBalanceCOP.toString(),
              paidCOP: row.paidCOP.toString(),
            })),
          }
        : null,
    };
  }
}
