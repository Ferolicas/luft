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
import type { Prisma } from '../generated/startif/client';
import { diditDocumentMatches, diditOutcome } from '../integrations/didit';
import { IntegrationService } from '../integrations/integration.service';
import { QueueService } from '../integrations/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  geometricAmounts,
  geometricSchedule,
  scheduleTotals,
} from './credit-calculator';
import {
  bogotaDate,
  creditStage,
  isInProgress,
  isResumable,
  isSettled,
  openInstallmentStatus,
} from './credit-lifecycle';
import {
  PrincipalOutOfRangeError,
  productCodeSchema,
  resolvePrincipal,
  type CompleteTerms,
  type ProductCode,
} from './credit-product';
import { CreditProductService } from './credit-product.service';
import { lockLoan, syncLoanStatus } from './loan-sync';
import { mercadoPagoPaymentStatus } from './payment-status';
import {
  planPrepayment,
  planPrepaymentReversal,
  toPlanRow,
  type PlanRow,
} from './prepayment';
import { PROMISSORY_NOTE_VERSION, promissoryNoteText } from './promissory-note';
import {
  CREDIT_PURPOSES,
  evaluateSecondCredit,
  financialSnapshot,
  normalizePurpose,
  readSecondCreditPolicy,
  type FinancialSnapshot,
  type NormalizedPurpose,
  type Requirement,
} from './second-credit';

type Tx = Prisma.TransactionClient;

/** Versión del texto: cambia cada vez que cambia lo que la persona autoriza. */
export const STARTIF_CONSENT_VERSION = '2026-11-23';

const STARTIF_CONSENT =
  'Autorizo a StartIF y LUFT, marcas de Tureporte S.A.S., para estudiar, originar y administrar mi solicitud de crédito, validar mi identidad, firmar electrónicamente el pagaré, recaudar las cuotas y reportar el comportamiento positivo o negativo a los operadores de información, conforme a la ley y a las autorizaciones entregadas. Autorizo de manera expresa el tratamiento de mis datos biométricos (la imagen de mi rostro y de mi documento de identidad) únicamente para validar mi identidad y prevenir la suplantación; sé que son datos sensibles, que no estoy obligado a autorizarlos y que sin esa validación no es posible estudiar un crédito.';

const QUOTE_NOTE =
  'Cuotas mensuales decrecientes. Las fechas son estimadas y se cuentan desde la activación del crédito. La tasa nunca podrá superar el límite legal vigente y se confirma antes de firmar.';

/** Pagos que aún pueden completarse en el banco y se reutilizan. */
const OPEN_PAYMENT_STATUSES = ['CREATED', 'ACTION_REQUIRED', 'PROCESSING'];
const PAYMENT_REUSE_MS = 30 * 60_000;

const CREDIT_INCLUDE = {
  product: { select: { name: true } },
  disbursement: true,
  loan: {
    include: {
      installments: { orderBy: { sequence: 'asc' } },
      virtualCard: true,
    },
  },
  kycProcesses: {
    orderBy: { startedAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      verificationUrl: true,
      failureReason: true,
      startedAt: true,
      completedAt: true,
    },
  },
  signatures: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      documentVersion: true,
      documentHash: true,
      signedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CreditApplicationInclude;

/** Resultado de procesar una notificación de pago dentro de la transacción. */
interface PaymentOutcome {
  idempotent: boolean;
  credited: boolean;
  loanClosed: boolean;
  loanId?: string;
  loanStatus?: string;
  reconciliationRequired?: boolean;
  refunded?: boolean;
  appliedCOP?: string;
  prepayment?: { closedLoan?: boolean; reversal?: string };
}

const NOT_CREDITED: PaymentOutcome = {
  idempotent: false,
  credited: false,
  loanClosed: false,
};

@Injectable()
export class StartifService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly queues: QueueService,
    private readonly realtime: RealtimeService,
    private readonly products: CreditProductService,
  ) {}

  /**
   * Cotiza el producto vigente. Monto, plazo, tasa y gradiente salen del
   * producto; solo un producto con rango acepta un monto solicitado.
   */
  async quote(body: unknown) {
    const input = z
      .object({
        productCode: productCodeSchema.default('BUILDER_1'),
        amountCOP: z.coerce.number().int().positive().optional(),
      })
      .parse(body ?? {});
    const { terms } = await this.products.requireActive(input.productCode);
    const amountCOP = this.principalFor(terms, input.amountCOP);
    const installments = geometricSchedule(
      amountCOP,
      terms.termMonths,
      terms.monthlyRate,
      terms.geometricDecrease,
      bogotaDate(new Date()),
    );
    const totals = scheduleTotals(installments);
    return {
      product: {
        code: terms.code,
        name: terms.name,
        purpose: terms.purpose,
        version: terms.version,
      },
      amountCOP,
      termMonths: terms.termMonths,
      monthlyRate: terms.monthlyRate,
      geometricDecrease: terms.geometricDecrease,
      firstInstallmentCOP: totals.firstInstallmentCOP,
      lastInstallmentCOP: totals.lastInstallmentCOP,
      totalCOP: totals.totalCOP,
      totalInterestCOP: totals.totalInterestCOP,
      installments,
      note: QUOTE_NOTE,
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
        version: z.literal(STARTIF_CONSENT_VERSION),
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

  /**
   * Origina una solicitud del producto vigente. El crédito 2 se bloquea si no
   * cumple todos los requisitos de elegibilidad (`code: 'not_eligible'`).
   */
  async createApplication(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({
        productCode: productCodeSchema.default('BUILDER_1'),
        purpose: z.string().trim().max(200).optional(),
        purposeDescription: z.string().trim().max(500).optional(),
        amountCOP: z.coerce.number().int().positive().optional(),
      })
      .parse(body ?? {});
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

    // Una solicitud del mismo producto que aún no llega a estudio se retoma.
    const resumable = await this.resumableApplication(
      this.db.startif,
      user.id,
      input.productCode,
    );
    if (resumable) return this.resumed(resumable.id);

    const second = input.productCode === 'BUILDER_2';
    let purpose: NormalizedPurpose | undefined;
    let requirements: Requirement[] | undefined;
    if (second) {
      purpose = normalizePurpose(input.purpose, input.purposeDescription);
      const eligibility = await this.secondCreditEligibility(user.id, {
        purpose,
        amountCOP: input.amountCOP,
      });
      if (!eligibility.eligible)
        throw new BadRequestException({
          code: 'not_eligible',
          message: 'Aún no cumples los requisitos del segundo crédito.',
          requirements: eligibility.requirements,
        });
      requirements = eligibility.requirements;
    }
    const { row: product, terms } = await this.products.requireActive(
      input.productCode,
    );
    const amountCOP = this.principalFor(terms, input.amountCOP);

    const result = await this.db.startif.$transaction(async (tx) => {
      // Serializa las solicitudes de una misma persona: dos envíos simultáneos
      // no pueden originar dos créditos.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))::text AS "locked"`;
      const again = await this.resumableApplication(
        tx,
        user.id,
        input.productCode,
      );
      if (again) return { id: again.id, reused: true };
      const existing = await tx.creditApplication.findMany({
        where: { userId: user.id },
        select: {
          status: true,
          productCode: true,
          loan: { select: { id: true } },
        },
      });
      if (existing.some((item) => isInProgress(item.status)))
        throw new BadRequestException({
          code: 'application_in_progress',
          message:
            'Ya tienes una solicitud o un crédito en curso. Termínalo antes de pedir otro.',
        });
      if (
        terms.sequence === 1 &&
        existing.some(
          (item) => item.productCode === terms.code && item.loan !== null,
        )
      )
        throw new BadRequestException({
          code: 'product_already_used',
          message: 'Ya financiaste tu servicio LUFT con este crédito.',
        });
      const created = await tx.creditApplication.create({
        data: {
          userId: user.id,
          productId: product.id,
          productCode: terms.code,
          productVersion: terms.version,
          amountCOP: BigInt(amountCOP),
          termMonths: terms.termMonths,
          requestedRateMonthly: product.monthlyRate,
          geometricDecrease: product.geometricDecrease,
          purpose: purpose?.code ?? terms.purpose,
          purposeDescription: purpose?.description ?? null,
          status: 'PENDING_KYC',
          submittedAt: new Date(),
        },
        select: { id: true },
      });
      return { id: created.id, reused: false };
    });
    if (result.reused) return this.resumed(result.id);
    const application =
      await this.db.startif.creditApplication.findUniqueOrThrow({
        where: { id: result.id },
        include: CREDIT_INCLUDE,
      });
    await this.audit.record({
      actorUserId: user.id,
      action: 'startif.application.created',
      resource: 'CreditApplication',
      resourceId: application.id,
      payload: {
        productCode: terms.code,
        productVersion: terms.version,
        amountCOP,
        termMonths: terms.termMonths,
        monthlyRate: terms.monthlyRate,
        geometricDecrease: terms.geometricDecrease,
        purpose: application.purpose,
        ...(requirements
          ? {
              eligibility: requirements.map((item) => ({
                code: item.code,
                met: item.met,
              })),
              // El perfil financiero de LUFT se leyó bajo este consentimiento.
              scoreShareConsentId: scoreShare.id,
            }
          : {}),
      },
    });
    return this.publicView(application);
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
    const kycProvider = this.integrations.kycProvider();
    const process = await this.db.startif.kycProcess.create({
      data: {
        applicationId: application.id,
        userId: user.id,
        provider: kycProvider,
        status: 'PROCESSING',
      },
    });
    try {
      const document = this.crypto.decrypt(identity.documentCiphertext);
      const provider =
        kycProvider === 'DIDIT'
          ? await this.integrations.startDiditValidation({
              attemptId: process.id,
              applicationId: application.id,
              userId: user.id,
              document,
            })
          : await this.integrations.startTruoraValidation({
              userId: user.id,
              document,
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
              ? `${kycProvider}_CREDENTIALS_REQUIRED`
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
    if (application.status !== 'PENDING_SIGNATURE')
      throw new BadRequestException(
        'La solicitud no está lista para firmar el pagaré.',
      );
    if (
      application.requestedRateMonthly === null ||
      application.geometricDecrease === null
    )
      throw new BadRequestException(
        'La solicitud no tiene condiciones de crédito definidas.',
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
    // El pagaré lleva el producto, las condiciones y el plan cotizado hoy.
    const quotedOn = bogotaDate(new Date());
    const principal = Number(application.amountCOP);
    const monthlyRate = Number(application.requestedRateMonthly);
    const geometricDecrease = Number(application.geometricDecrease);
    const document = promissoryNoteText({
      applicationId: application.id,
      product: {
        code: application.productCode,
        name: application.product?.name ?? application.productCode,
        version: application.productVersion,
      },
      purpose: application.purpose,
      purposeDescription: application.purposeDescription,
      principalCOP: principal,
      termMonths: application.termMonths,
      monthlyRate,
      geometricDecrease,
      quotedOn,
      installments: geometricSchedule(
        principal,
        application.termMonths,
        monthlyRate,
        geometricDecrease,
        quotedOn,
      ),
    });
    const envelope = await this.db.startif.$transaction(async (tx) => {
      const claimed = await tx.creditApplication.updateMany({
        where: { id: applicationId, status: 'PENDING_SIGNATURE' },
        data: { status: 'PENDING_REVIEW' },
      });
      if (!claimed.count)
        throw new BadRequestException(
          'La solicitud no está lista para firmar el pagaré.',
        );
      await this.db.identity.otpChallenge.update({
        where: { id: otp.id },
        data: { verifiedAt: new Date() },
      });
      return tx.signatureEnvelope.create({
        data: {
          applicationId,
          userId: user.id,
          status: 'COMPLETED',
          documentVersion: PROMISSORY_NOTE_VERSION,
          documentSnapshot: document,
          documentHash: this.crypto.hash(document),
          signatureCiphertext: this.crypto.encrypt(input.signatureData),
          otpChallengeId: otp.id,
          ipHash: request.ip ? this.crypto.hash(request.ip) : undefined,
          userAgent: request.get('user-agent')?.slice(0, 500),
          signedAt: new Date(),
        },
      });
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
      payload: {
        documentHash: envelope.documentHash,
        documentVersion: envelope.documentVersion,
        otpChallengeId: otp.id,
        productCode: application.productCode,
        productVersion: application.productVersion,
        principalCOP: principal,
        monthlyRate,
        geometricDecrease,
      },
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
    // El código de firma viaja al correo: el SMS es solo para el registro.
    return authIssueOtp(user.id, identity.email, 'SIGNATURE');
  }

  /**
   * Inicia un pago PSE: una cuota (`installmentId`) o un abono anticipado a
   * capital (`kind: "PREPAYMENT"`). Nada se aplica al crédito hasta que el
   * proveedor confirma el pago por webhook.
   */
  async createPsePayment(user: AuthenticatedUser, body: unknown) {
    const bankCode = z.string().trim().min(1).max(30);
    const input = z
      .union([
        z.object({
          kind: z.literal('PREPAYMENT'),
          loanId: z.string().uuid(),
          amountCOP: z.coerce.number().int().positive().max(1_000_000_000),
          bankCode,
        }),
        z.object({
          kind: z.literal('INSTALLMENT').default('INSTALLMENT'),
          installmentId: z.string().uuid(),
          bankCode,
        }),
      ])
      .parse(body);
    return input.kind === 'PREPAYMENT'
      ? this.createPrepayment(user, input)
      : this.createInstallmentPayment(user, input);
  }

  private async createInstallmentPayment(
    user: AuthenticatedUser,
    input: { installmentId: string; bankCode: string },
  ) {
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
    const remaining = installment.amountCOP - installment.paidCOP;
    const reusable = await this.db.startif.payment.findFirst({
      where: {
        kind: 'INSTALLMENT',
        installmentId: installment.id,
        // Un abono posterior pudo bajar el valor de la cuota.
        amountCOP: remaining,
        status: { in: OPEN_PAYMENT_STATUSES as any },
        createdAt: { gt: new Date(Date.now() - PAYMENT_REUSE_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable)
      return {
        ...reusable,
        amountCOP: reusable.amountCOP.toString(),
        creditedCOP: reusable.creditedCOP.toString(),
        reused: true,
      };
    return this.startPsePayment(user, {
      kind: 'INSTALLMENT',
      loanId: installment.loanId,
      installmentId: installment.id,
      amountCOP: remaining,
      bankCode: input.bankCode,
      description: `Cuota ${installment.sequence} crédito LUFT`,
    });
  }

  private async createPrepayment(
    user: AuthenticatedUser,
    input: { loanId: string; amountCOP: number; bankCode: string },
  ) {
    const loan = await this.db.startif.loan.findFirst({
      where: { id: input.loanId, userId: user.id },
      include: { installments: true },
    });
    if (!loan) throw new NotFoundException('Crédito no encontrado.');
    if (loan.status !== 'ACTIVE')
      throw new BadRequestException({
        code: 'loan_not_current',
        message:
          loan.status === 'COMPLETED'
            ? 'Este crédito ya está pagado.'
            : 'Ponte al día con tus cuotas antes de abonar a capital.',
      });
    const today = bogotaDate(new Date());
    const open = loan.installments.filter((row) => !isSettled(row.status));
    if (
      open.some(
        (row) =>
          row.paidCOP > 0n ||
          openInstallmentStatus({
            dueDate: row.dueDate,
            paidCOP: row.paidCOP,
            today,
          }) === 'OVERDUE',
      )
    )
      throw new BadRequestException({
        code: 'loan_not_current',
        message: 'Paga primero tu cuota pendiente y luego abona a capital.',
      });
    const balance = loan.outstandingBalanceCOP;
    if (balance <= 0n || !open.length)
      throw new BadRequestException({
        code: 'loan_not_current',
        message: 'Este crédito no tiene saldo por abonar.',
      });
    const amount = BigInt(input.amountCOP);
    if (amount > balance)
      throw new BadRequestException({
        code: 'prepayment_exceeds_balance',
        message: 'El abono no puede superar tu saldo de capital.',
        maxCOP: Number(balance),
      });
    const reusable = await this.db.startif.payment.findFirst({
      where: {
        kind: 'PREPAYMENT',
        loanId: loan.id,
        amountCOP: amount,
        status: { in: OPEN_PAYMENT_STATUSES as any },
        createdAt: { gt: new Date(Date.now() - PAYMENT_REUSE_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable)
      return {
        ...reusable,
        amountCOP: reusable.amountCOP.toString(),
        creditedCOP: reusable.creditedCOP.toString(),
        reused: true,
      };
    return this.startPsePayment(user, {
      kind: 'PREPAYMENT',
      loanId: loan.id,
      installmentId: null,
      amountCOP: amount,
      bankCode: input.bankCode,
      description: 'Abono a capital crédito LUFT',
    });
  }

  private async startPsePayment(
    user: AuthenticatedUser,
    input: {
      kind: 'INSTALLMENT' | 'PREPAYMENT';
      loanId: string;
      installmentId: string | null;
      amountCOP: bigint;
      bankCode: string;
      description: string;
    },
  ) {
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const idempotencyKey = randomUUID();
    const payment = await this.db.startif.payment.create({
      data: {
        userId: user.id,
        kind: input.kind,
        loanId: input.loanId,
        installmentId: input.installmentId,
        idempotencyKey,
        amountCOP: input.amountCOP,
      },
    });
    try {
      const order = await this.integrations.createPseOrder({
        amount: Number(input.amountCOP),
        email: identity.email,
        identification: this.crypto.decrypt(identity.documentCiphertext),
        entity: input.bankCode,
        description: input.description,
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
        action:
          input.kind === 'PREPAYMENT'
            ? 'payment.prepayment.created'
            : 'payment.pse.created',
        resource: 'Payment',
        resourceId: updated.id,
        payload: {
          kind: input.kind,
          loanId: input.loanId,
          installmentId: input.installmentId,
          amountCOP: input.amountCOP.toString(),
          provider: 'MERCADOPAGO',
        },
      });
      return {
        ...updated,
        amountCOP: updated.amountCOP.toString(),
        creditedCOP: updated.creditedCOP.toString(),
      };
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
    const externalId = String(dataId ?? body?.data?.id ?? '');
    this.integrations.validateMercadoPagoWebhook(
      headers['x-signature'] as string | undefined,
      headers['x-request-id'] as string | undefined,
      externalId,
    );
    const resource = await this.integrations.getMercadoPagoResource(
      externalId,
      String(body?.type ?? body?.topic ?? body?.action ?? ''),
    );
    const providerPayment = resource?.transactions?.payments?.[0] ?? resource;
    const rawStatus = String(
      providerPayment?.status ?? resource?.status ?? '',
    ).toLowerCase();
    const status = mercadoPagoPaymentStatus(rawStatus);
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
    // Un pago aprobado solo cambia por un reembolso; uno reembolsado es final.
    if (
      payment.status === 'REFUNDED' ||
      (payment.status === 'APPROVED' && status !== 'REFUNDED')
    )
      return { accepted: true, matched: true, idempotent: true };
    const providerAmount = Number(
      providerPayment?.amount ??
        providerPayment?.transaction_amount ??
        resource?.total_amount,
    );
    if (
      ['APPROVED', 'REFUNDED'].includes(status) &&
      (!Number.isFinite(providerAmount) ||
        Math.abs(providerAmount - Number(payment.amountCOP)) > 0.01)
    )
      throw new BadRequestException({
        code: 'payment_amount_mismatch',
        paymentId: payment.id,
      });
    const now = new Date();
    const result = await this.db.startif.$transaction(
      async (tx): Promise<PaymentOutcome> => {
        const paymentData = {
          status,
          approvedAt: status === 'APPROVED' ? now : undefined,
          externalId: providerExternalId,
          providerPayloadHash: this.crypto.hash(JSON.stringify(resource)),
          statusDetail: String(
            providerPayment?.status_detail ??
              resource?.status_detail ??
              rawStatus,
          ).slice(0, 160),
        };
        if (status === 'APPROVED') {
          // Solo una confirmación gana; las repetidas no vuelven a aplicar.
          const claimed = await tx.payment.updateMany({
            where: {
              id: payment.id,
              status: { notIn: ['APPROVED', 'REFUNDED'] },
            },
            data: paymentData,
          });
          if (!claimed.count) return { ...NOT_CREDITED, idempotent: true };
          if (payment.kind === 'PREPAYMENT')
            return this.applyPrepayment(tx, payment, now);
          if (payment.installmentId)
            return this.applyInstallmentPayment(tx, payment, now);
          return NOT_CREDITED;
        }
        if (status === 'REFUNDED') {
          const claimed = await tx.payment.updateMany({
            where: { id: payment.id, status: 'APPROVED' },
            data: paymentData,
          });
          if (!claimed.count) return { ...NOT_CREDITED, idempotent: true };
          if (payment.kind === 'PREPAYMENT')
            return this.reversePrepayment(tx, payment, now);
          if (payment.installmentId)
            return this.reverseInstallmentPayment(tx, payment, now);
          return { ...NOT_CREDITED, refunded: true };
        }
        await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: { notIn: ['APPROVED', 'REFUNDED'] },
          },
          data: paymentData,
        });
        return NOT_CREDITED;
      },
    );
    if (result.idempotent)
      return { accepted: true, matched: true, idempotent: true };
    this.realtime.toUser(payment.userId, 'payment:status', {
      paymentId: payment.id,
      kind: payment.kind,
      status,
      loanId: result.loanId,
      loanStatus: result.loanStatus,
    });
    if (status === 'APPROVED' && result.credited)
      await this.queues.add(
        'lifecycle',
        'report-payment',
        { paymentId: payment.id, userId: payment.userId },
        `report-${payment.id}`,
      );
    if (result.reconciliationRequired || result.refunded)
      await this.integrations.triggerAutomation('luft-payment-reconciliation', {
        event: result.refunded
          ? 'payment.refunded'
          : 'payment.reconciliation_required',
        paymentId: payment.id,
        kind: payment.kind,
        userId: payment.userId,
        loanId: result.loanId,
        reversal: result.prepayment?.reversal,
      });
    await this.audit.record({
      actorRole: 'SYSTEM',
      action: result.refunded
        ? 'payment.refunded'
        : payment.kind === 'PREPAYMENT' && result.credited
          ? 'payment.prepayment.applied'
          : 'payment.webhook.processed',
      resource: 'Payment',
      resourceId: payment.id,
      payload: {
        provider: 'MERCADOPAGO',
        kind: payment.kind,
        status,
        credited: result.credited,
        appliedCOP: result.appliedCOP ?? null,
        loanId: result.loanId ?? null,
        loanStatus: result.loanStatus ?? null,
        loanClosed: result.loanClosed,
        prepayment: result.prepayment ?? null,
        reconciliationRequired: Boolean(result.reconciliationRequired),
        providerPayloadHash: this.crypto.hash(JSON.stringify(resource)),
      },
    });
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

  /** Aplica a su cuota un pago aprobado. */
  private async applyInstallmentPayment(
    tx: Tx,
    payment: { id: string; installmentId: string | null; amountCOP: bigint },
    now: Date,
  ): Promise<PaymentOutcome> {
    const { loanId } = await tx.installment.findUniqueOrThrow({
      where: { id: payment.installmentId as string },
      select: { loanId: true },
    });
    await lockLoan(tx, loanId);
    const installment = await tx.installment.findUniqueOrThrow({
      where: { id: payment.installmentId as string },
    });
    const remaining = installment.amountCOP - installment.paidCOP;
    if (remaining <= 0n || isSettled(installment.status)) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { statusDetail: 'DUPLICATE_PAYMENT_REQUIRES_RECONCILIATION' },
      });
      return { ...NOT_CREDITED, loanId, reconciliationRequired: true };
    }
    const credited =
      payment.amountCOP > remaining ? remaining : payment.amountCOP;
    const paid = installment.paidCOP + credited;
    const paidInFull = paid >= installment.amountCOP;
    await tx.installment.update({
      where: { id: installment.id },
      data: {
        paidCOP: paid,
        status: paidInFull ? 'PAID' : 'PARTIALLY_PAID',
        paidAt: paidInFull ? now : undefined,
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { creditedCOP: credited, loanId },
    });
    const synced = await syncLoanStatus(tx, loanId, now);
    return {
      idempotent: false,
      credited: true,
      loanClosed: synced.closed,
      loanId,
      loanStatus: synced.status,
      appliedCOP: credited.toString(),
      reconciliationRequired: payment.amountCOP > remaining,
    };
  }

  /** Revierte lo que un pago de cuota había aplicado. */
  private async reverseInstallmentPayment(
    tx: Tx,
    payment: { id: string; installmentId: string | null },
    now: Date,
  ): Promise<PaymentOutcome> {
    const { loanId } = await tx.installment.findUniqueOrThrow({
      where: { id: payment.installmentId as string },
      select: { loanId: true },
    });
    await lockLoan(tx, loanId);
    const installment = await tx.installment.findUniqueOrThrow({
      where: { id: payment.installmentId as string },
    });
    const fresh = await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    // Un duplicado enviado a conciliación nunca se aplicó: no hay qué revertir.
    if (fresh.creditedCOP <= 0n)
      return { ...NOT_CREDITED, loanId, refunded: true };
    const paid =
      installment.paidCOP > fresh.creditedCOP
        ? installment.paidCOP - fresh.creditedCOP
        : 0n;
    await tx.installment.update({
      where: { id: installment.id },
      data: {
        paidCOP: paid,
        paidAt: null,
        status: openInstallmentStatus({
          dueDate: installment.dueDate,
          paidCOP: paid,
          today: bogotaDate(now),
        }),
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { creditedCOP: 0n },
    });
    const synced = await syncLoanStatus(tx, loanId, now);
    return {
      ...NOT_CREDITED,
      loanId,
      loanStatus: synced.status,
      refunded: true,
      appliedCOP: fresh.creditedCOP.toString(),
    };
  }

  /**
   * Abono anticipado aprobado: reduce el capital, recalcula las cuotas
   * pendientes y guarda el plan anterior para poder revertirlo.
   */
  private async applyPrepayment(
    tx: Tx,
    payment: {
      id: string;
      userId: string;
      loanId: string | null;
      amountCOP: bigint;
    },
    now: Date,
  ): Promise<PaymentOutcome> {
    const loanId = payment.loanId as string;
    await lockLoan(tx, loanId);
    const loan = await tx.loan.findUniqueOrThrow({
      where: { id: loanId },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    const plan = planPrepayment({
      installments: loan.installments.map(toPlanRow),
      prepaymentCOP: Number(payment.amountCOP),
      monthlyRate: Number(loan.monthlyRate),
      geometricDecrease: Number(loan.geometricDecrease),
      now,
    });
    if (plan.outcome !== 'APPLIED') {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          statusDetail:
            plan.outcome === 'NO_BALANCE'
              ? 'PREPAYMENT_WITHOUT_BALANCE_REQUIRES_RECONCILIATION'
              : 'PREPAYMENT_ON_PARTIAL_INSTALLMENT_REQUIRES_RECONCILIATION',
        },
      });
      return { ...NOT_CREDITED, loanId, reconciliationRequired: true };
    }
    await tx.loanPrepayment.create({
      data: {
        loanId,
        paymentId: payment.id,
        userId: payment.userId,
        amountCOP: payment.amountCOP,
        appliedCOP: BigInt(plan.appliedCOP),
        balanceBeforeCOP: BigInt(plan.balanceBeforeCOP),
        balanceAfterCOP: BigInt(plan.balanceAfterCOP),
        loanStatusBefore: loan.status,
        closedLoan: plan.closesLoan,
        previousPlan: plan.previousPlan as unknown as Prisma.InputJsonValue,
        newPlan: plan.newPlan as unknown as Prisma.InputJsonValue,
        appliedAt: now,
      },
    });
    await this.writePlan(tx, plan.newPlan);
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        creditedCOP: BigInt(plan.appliedCOP),
        ...(plan.excessCOP > 0
          ? { statusDetail: 'PREPAYMENT_EXCESS_REQUIRES_RECONCILIATION' }
          : {}),
      },
    });
    const synced = await syncLoanStatus(tx, loanId, now);
    return {
      idempotent: false,
      credited: true,
      loanClosed: synced.closed,
      loanId,
      loanStatus: synced.status,
      appliedCOP: String(plan.appliedCOP),
      reconciliationRequired: plan.excessCOP > 0,
      prepayment: { closedLoan: plan.closesLoan },
    };
  }

  /** Reembolso de un abono: repone el capital sin corromper el plan. */
  private async reversePrepayment(
    tx: Tx,
    payment: { id: string; loanId: string | null },
    now: Date,
  ): Promise<PaymentOutcome> {
    const loanId = payment.loanId as string;
    await lockLoan(tx, loanId);
    const record = await tx.loanPrepayment.findUnique({
      where: { paymentId: payment.id },
    });
    // El abono nunca se aplicó (quedó en conciliación): no hay plan que reponer.
    if (!record || record.reversedAt)
      return { ...NOT_CREDITED, loanId, refunded: true };
    const loan = await tx.loan.findUniqueOrThrow({
      where: { id: loanId },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    const laterPrepayments = await tx.loanPrepayment.count({
      where: {
        loanId,
        reversedAt: null,
        id: { not: record.id },
        appliedAt: { gte: record.appliedAt },
      },
    });
    const reversal = planPrepaymentReversal({
      previousPlan: record.previousPlan as unknown as PlanRow[],
      newPlan: record.newPlan as unknown as PlanRow[],
      current: loan.installments.map(toPlanRow),
      appliedCOP: Number(record.appliedCOP),
      laterPrepayments,
      monthlyRate: Number(loan.monthlyRate),
      geometricDecrease: Number(loan.geometricDecrease),
      today: bogotaDate(now),
    });
    if (reversal.mode === 'MANUAL_REVIEW') {
      await tx.loanPrepayment.update({
        where: { id: record.id },
        data: { reversalMode: reversal.mode },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { statusDetail: 'PREPAYMENT_REFUND_REQUIRES_RECONCILIATION' },
      });
      return {
        ...NOT_CREDITED,
        loanId,
        loanStatus: loan.status,
        refunded: true,
        reconciliationRequired: true,
        prepayment: { reversal: reversal.mode },
      };
    }
    await this.writePlan(tx, reversal.installments);
    await tx.loanPrepayment.update({
      where: { id: record.id },
      data: { reversedAt: now, reversalMode: reversal.mode },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { creditedCOP: 0n },
    });
    const synced = await syncLoanStatus(tx, loanId, now);
    return {
      ...NOT_CREDITED,
      loanId,
      loanStatus: synced.status,
      refunded: true,
      appliedCOP: record.appliedCOP.toString(),
      prepayment: { reversal: reversal.mode },
    };
  }

  private async writePlan(tx: Tx, rows: PlanRow[]) {
    for (const row of rows)
      await tx.installment.update({
        where: { id: row.id },
        data: {
          openingBalanceCOP: BigInt(row.openingBalanceCOP),
          amountCOP: BigInt(row.amountCOP),
          principalCOP: BigInt(row.principalCOP),
          interestCOP: BigInt(row.interestCOP),
          closingBalanceCOP: BigInt(row.closingBalanceCOP),
          paidCOP: BigInt(row.paidCOP),
          status: row.status as any,
          paidAt: row.paidAt ? new Date(row.paidAt) : null,
        },
      });
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
    return this.applyKycResult(process, {
      provider: 'TRUORA',
      status,
      result: body,
      failureReason: status === 'FAILED' ? rawStatus : undefined,
    });
  }

  /**
   * Resultado de la validación de identidad con Didit. El aviso solo dispara
   * la lectura: el resultado que vale es el que se consulta en Didit, y la
   * cédula del documento validado debe ser la que la persona registró.
   */
  async webhookDidit(
    headers: { signatureV2?: string; signature?: string; timestamp?: string },
    rawBody: Buffer | undefined,
    body: any,
  ) {
    this.integrations.validateDiditWebhook(headers, rawBody, body);
    const externalId = String(body?.session_id ?? '');
    if (!externalId || !String(body?.webhook_type ?? '').endsWith('.updated'))
      return { accepted: true, matched: false };
    const process = await this.db.startif.kycProcess.findUnique({
      where: { externalId },
    });
    if (!process || process.provider !== 'DIDIT')
      return { accepted: true, matched: false };
    const sandbox = body?.environment === 'sandbox';
    // Un resultado simulado nunca valida a nadie en producción.
    if (sandbox && !this.integrations.diditSandbox())
      return { accepted: true, matched: false };
    let status = diditOutcome(body?.status);
    let result: unknown = body;
    let failureReason =
      status === 'FAILED' ? String(body?.status ?? 'Declined') : undefined;
    if (status === 'COMPLETED') {
      const decision = await this.integrations.diditDecision(externalId);
      result = decision;
      status = diditOutcome(decision.status);
      if (status === 'FAILED') failureReason = String(decision.status);
      if (status === 'COMPLETED' && !sandbox) {
        const identity = await this.db.identity.user.findUniqueOrThrow({
          where: { id: process.userId },
        });
        if (
          !diditDocumentMatches(
            decision,
            this.crypto.decrypt(identity.documentCiphertext),
          )
        ) {
          status = 'FAILED';
          failureReason = 'DOCUMENT_MISMATCH';
        }
      }
    }
    return this.applyKycResult(process, {
      provider: 'DIDIT',
      status,
      result,
      failureReason,
    });
  }

  private async applyKycResult(
    process: {
      id: string;
      applicationId: string;
      userId: string;
      status: string;
    },
    outcome: {
      provider: 'TRUORA' | 'DIDIT';
      status: 'COMPLETED' | 'FAILED' | 'PROCESSING';
      result: unknown;
      failureReason?: string;
    },
  ) {
    // Una validación ya aprobada no se revierte con un aviso tardío.
    if (process.status === 'COMPLETED')
      return { accepted: true, matched: true };
    const { status } = outcome;
    await this.db.startif.$transaction([
      this.db.startif.kycProcess.update({
        where: { id: process.id },
        data: {
          status,
          resultCiphertext: this.crypto.encrypt(JSON.stringify(outcome.result)),
          failureReason:
            status === 'FAILED'
              ? (outcome.failureReason ?? 'FAILED').slice(0, 500)
              : undefined,
          completedAt: status === 'COMPLETED' ? new Date() : undefined,
        },
      }),
      // Una notificación tardía no puede devolver una solicitud que ya firmó,
      // está en estudio o tiene crédito.
      this.db.startif.creditApplication.updateMany({
        where: {
          id: process.applicationId,
          status: { in: ['PENDING_KYC', 'CONFIGURATION_REQUIRED'] },
        },
        data: {
          status: status === 'COMPLETED' ? 'PENDING_SIGNATURE' : 'PENDING_KYC',
        },
      }),
    ]);
    await this.audit.record({
      actorRole: 'SYSTEM',
      action: 'kyc.webhook.received',
      resource: 'KycProcess',
      resourceId: process.id,
      payload: {
        provider: outcome.provider,
        status,
        ...(outcome.failureReason ? { reason: outcome.failureReason } : {}),
      },
    });
    this.realtime.toUser(process.userId, 'kyc:status', {
      id: process.id,
      status,
    });
    return { accepted: true, matched: true };
  }

  /** Solicitud o crédito más reciente de la persona. */
  async credit(user: AuthenticatedUser) {
    const application = await this.db.startif.creditApplication.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: CREDIT_INCLUDE,
    });
    if (!application) return null;
    return this.publicView(application);
  }

  /**
   * Todos los créditos de la persona (del más antiguo al más reciente) y la
   * elegibilidad explicada del crédito 2. La finalidad se evalúa solo si llega.
   */
  async credits(user: AuthenticatedUser, query: unknown) {
    const input = z
      .object({
        purpose: z.string().trim().max(200).optional(),
        purposeDescription: z.string().trim().max(500).optional(),
        amountCOP: z.coerce.number().int().positive().optional(),
      })
      .parse(query ?? {});
    const [applications, second] = await Promise.all([
      this.db.startif.creditApplication.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        include: CREDIT_INCLUDE,
      }),
      this.secondCreditEligibility(user.id, {
        purpose:
          input.purpose === undefined
            ? undefined
            : normalizePurpose(input.purpose, input.purposeDescription),
        amountCOP: input.amountCOP,
      }),
    ]);
    return {
      credits: applications.map((item) => this.publicView(item)),
      second: { ...second, purposes: CREDIT_PURPOSES },
    };
  }

  /**
   * Evalúa los requisitos del crédito 2 para una persona. Lee el perfil
   * financiero de LUFT solo si el consentimiento SCORE_SHARE_WITH_STARTIF está
   * vigente. No decide el crédito: la decisión final es del rol RISK.
   */
  async secondCreditEligibility(
    userId: string,
    options: {
      purpose?: NormalizedPurpose;
      amountCOP?: number;
      /** Solicitud que se está estudiando: no cuenta como "otra en curso". */
      excludeApplicationId?: string;
    } = {},
  ) {
    const code: ProductCode = 'BUILDER_2';
    const [active, latest, applications, finances] = await Promise.all([
      this.products.active(code),
      this.products.latest(code),
      this.db.startif.creditApplication.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          productCode: true,
          loan: {
            select: {
              status: true,
              installments: {
                select: { status: true, dueDate: true, paidAt: true },
              },
            },
          },
        },
      }),
      this.financialSnapshotFor(userId),
    ]);
    const terms = active?.terms ?? null;
    const principal = terms
      ? this.principalFor(terms, options.amountCOP)
      : null;
    const amounts =
      terms && principal !== null
        ? geometricAmounts(
            principal,
            terms.termMonths,
            terms.monthlyRate,
            terms.geometricDecrease,
          )
        : null;
    const first = applications.find(
      (item) => item.productCode === 'BUILDER_1' && item.loan,
    );
    const result = evaluateSecondCredit({
      product:
        principal !== null && amounts
          ? {
              principalCOP: principal,
              highestInstallmentCOP: Math.max(
                ...amounts.map((row) => row.amountCOP),
              ),
            }
          : null,
      policy: readSecondCreditPolicy(
        (active?.row ?? latest)?.requirements ?? null,
      ),
      firstCredit: first?.loan
        ? {
            status: first.loan.status,
            installments: first.loan.installments.map((row) => ({
              status: row.status,
              dueDate: row.dueDate,
              paidOn: row.paidAt ? bogotaDate(row.paidAt) : null,
            })),
          }
        : null,
      purpose: options.purpose,
      finances,
      otherStatuses: applications
        .filter((item) => item.id !== options.excludeApplicationId)
        .map((item) => item.status),
      today: bogotaDate(new Date()),
    });
    const totals = amounts ? scheduleTotals(amounts) : null;
    return {
      product:
        terms && principal !== null && totals
          ? {
              code: terms.code,
              name: terms.name,
              purpose: terms.purpose,
              version: terms.version,
              amountCOP: principal,
              minAmountCOP: terms.minPrincipalCOP ?? principal,
              maxAmountCOP: terms.maxPrincipalCOP ?? principal,
              termMonths: terms.termMonths,
              monthlyRate: terms.monthlyRate,
              geometricDecrease: terms.geometricDecrease,
              firstInstallmentCOP: totals.firstInstallmentCOP,
              lastInstallmentCOP: totals.lastInstallmentCOP,
              totalCOP: totals.totalCOP,
              totalInterestCOP: totals.totalInterestCOP,
            }
          : null,
      eligible: result.eligible,
      requirements: result.requirements,
    };
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

  /** Plan de cuotas con las condiciones propias de una operación. */
  schedule(
    principal: number,
    months: number,
    monthlyRate: number,
    geometricDecrease: number,
    startDate: Date | string,
  ) {
    return geometricSchedule(
      principal,
      months,
      monthlyRate,
      geometricDecrease,
      startDate,
    );
  }

  private principalFor(terms: CompleteTerms, requestedCOP?: number) {
    try {
      return resolvePrincipal(terms, requestedCOP);
    } catch (error) {
      if (error instanceof PrincipalOutOfRangeError)
        throw new BadRequestException({
          code: 'amount_out_of_range',
          message: 'El monto está fuera del rango del producto.',
          minCOP: error.minCOP,
          maxCOP: error.maxCOP,
        });
      throw error;
    }
  }

  /** Ingresos, gastos y deudas declarados en LUFT, solo con consentimiento. */
  private async financialSnapshotFor(
    userId: string,
  ): Promise<FinancialSnapshot> {
    const consent = await this.db.luft.consent.findFirst({
      where: { userId, kind: 'SCORE_SHARE_WITH_STARTIF', revokedAt: null },
      select: { id: true },
    });
    if (!consent) return financialSnapshot(false, null);
    const profile = await this.db.luft.financialProfile.findUnique({
      where: { userId },
      select: { demographicAnswers: true },
    });
    const state = profile?.demographicAnswers;
    const ciphertext =
      state && typeof state === 'object' && !Array.isArray(state)
        ? (state as Record<string, unknown>).context
        : undefined;
    if (typeof ciphertext !== 'string') return financialSnapshot(true, null);
    try {
      return financialSnapshot(
        true,
        JSON.parse(this.crypto.decrypt(ciphertext)),
      );
    } catch {
      return financialSnapshot(true, null);
    }
  }

  private resumableApplication(
    client: Pick<Tx, 'creditApplication'>,
    userId: string,
    productCode: string,
  ) {
    return client.creditApplication
      .findMany({
        where: { userId, productCode },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      })
      .then((rows) => rows.find((row) => isResumable(row.status)) ?? null);
  }

  private async resumed(applicationId: string) {
    const application =
      await this.db.startif.creditApplication.findUniqueOrThrow({
        where: { id: applicationId },
        include: CREDIT_INCLUDE,
      });
    return { ...this.publicView(application), reused: true };
  }

  private async ownedApplication(userId: string, applicationId: string) {
    const application = await this.db.startif.creditApplication.findFirst({
      where: { id: applicationId, userId },
      include: { product: { select: { name: true } } },
    });
    if (!application) throw new NotFoundException('Solicitud no encontrada.');
    return application;
  }

  /** Convierte montos BigInt a texto y agrega la etapa del crédito. */
  /**
   * What the person sees of their own credit: the serialized application
   * without internal identifiers, staff authorship or the analyst's notes.
   */
  publicView(application: any) {
    const strip = <T extends Record<string, unknown>>(
      row: T,
      keys: readonly string[],
    ) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => !keys.includes(key)),
      );
    const view = this.serialize(application);
    return {
      ...strip(view, [
        'userId',
        'usuryRateId',
        'usuryRate',
        'productId',
        'previousTerms',
        'decisionReason',
      ]),
      disbursement: view.disbursement
        ? strip(view.disbursement, [
            'userId',
            'createdBy',
            'registeredBy',
            'note',
          ])
        : null,
      loan: view.loan
        ? {
            ...strip(view.loan, [
              'userId',
              'productId',
              'writtenOffBy',
              'writtenOffReason',
            ]),
            virtualCard: view.loan.virtualCard
              ? strip(view.loan.virtualCard, ['userId'])
              : null,
          }
        : null,
    };
  }

  serialize(application: any) {
    const { product, ...rest } = application;
    const signatures: Array<{ status: string }> | undefined = rest.signatures;
    return {
      ...rest,
      productName: product?.name ?? null,
      stage: creditStage({
        status: rest.status,
        signed: signatures
          ? signatures.some((item) => item.status === 'COMPLETED')
          : undefined,
        disbursed: rest.disbursement?.status === 'COMPLETED',
      }),
      amountCOP: rest.amountCOP.toString(),
      disbursement: rest.disbursement
        ? {
            ...rest.disbursement,
            amountCOP: rest.disbursement.amountCOP.toString(),
          }
        : null,
      loan: rest.loan
        ? {
            ...rest.loan,
            principalCOP: rest.loan.principalCOP.toString(),
            outstandingBalanceCOP: rest.loan.outstandingBalanceCOP.toString(),
            virtualCard: rest.loan.virtualCard
              ? {
                  ...rest.loan.virtualCard,
                  fixedLimitCOP: rest.loan.virtualCard.fixedLimitCOP.toString(),
                }
              : null,
            installments: (rest.loan.installments ?? []).map((row: any) => ({
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
