import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import webPush from 'web-push';
import { CryptoService } from './common/crypto.service';
import { DatabaseService } from './database/database.service';
import { IntegrationService } from './integrations/integration.service';

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly workers: Worker[] = [];
  private schedulerQueue?: Queue;
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly integrations: IntegrationService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const connection = { url: this.config.getOrThrow<string>('REDIS_URL') };
    const prefix = `${this.config.get<string>('REDIS_PREFIX') ?? 'luft:'}bull`;
    this.workers.push(
      new Worker('bureau', (job) => this.bureau(job), {
        connection,
        prefix,
        concurrency: 5,
        limiter: { max: 30, duration: 60_000 },
      }),
      new Worker('lifecycle', (job) => this.lifecycle(job), {
        connection,
        prefix,
        concurrency: 10,
      }),
      new Worker('notifications', (job) => this.notifications(job), {
        connection,
        prefix,
        concurrency: 10,
      }),
    );
    this.schedulerQueue = new Queue('lifecycle', { connection, prefix });
    void this.schedulerQueue.upsertJobScheduler(
      'daily-credit-lifecycle',
      { pattern: '0 11 * * *' },
      { name: 'daily-overdue', data: {} },
    );
    void this.schedulerQueue.upsertJobScheduler(
      'monthly-tradeline-reporting',
      { pattern: '0 12 1 * *' },
      { name: 'monthly-report', data: {} },
    );
    this.workers.forEach((worker) =>
      worker.on('failed', (job, error) =>
        this.logger.error(`${worker.name}/${job?.name}: ${error.message}`),
      ),
    );
  }

  async onModuleDestroy() {
    await Promise.all([
      ...this.workers.map((worker) => worker.close()),
      this.schedulerQueue?.close() ?? Promise.resolve(),
    ]);
  }

  private async bureau(job: Job) {
    if (job.name !== 'query-score') return;
    const { inquiryId, userId, provider } = job.data as {
      inquiryId: string;
      userId: string;
      provider: 'DATACREDITO' | 'TRANSUNION';
    };
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await this.db.luft.scoreInquiry.update({
      where: { id: inquiryId },
      data: { status: 'PROCESSING' },
    });
    try {
      const result = await this.integrations.queryBureau(provider, {
        documentType: 'CC',
        documentNumber: this.crypto.decrypt(identity.documentCiphertext),
        documentIssueDate: this.crypto.decrypt(
          identity.documentIssuedAtCiphertext,
        ),
        consent: true,
        purpose: 'LUFT_FINANCIAL_DIAGNOSIS',
      });
      const score = Number(
        result.score ?? result.creditScore ?? result.puntaje,
      );
      if (!Number.isInteger(score))
        throw new Error('El operador no devolvió un puntaje válido');
      const existingHistory = Boolean(
        result.existingHistory ?? result.hasCreditHistory ?? true,
      );
      await this.db.luft.$transaction([
        this.db.luft.scoreInquiry.update({
          where: { id: inquiryId },
          data: {
            status: 'COMPLETED',
            score,
            existingHistory,
            resultCiphertext: this.crypto.encrypt(JSON.stringify(result)),
            externalReference: String(result.referenceId ?? result.id ?? ''),
            completedAt: new Date(),
          },
        }),
        this.db.luft.financialProfile.upsert({
          where: { userId },
          create: {
            userId,
            currentScore: score,
            existingHistory,
            completionPercent: 65,
          },
          update: {
            currentScore: score,
            existingHistory,
            completionPercent: { increment: 20 },
          },
        }),
      ]);
    } catch (error: any) {
      const configuration = error?.response?.code === 'configuration_required';
      await this.db.luft.scoreInquiry.update({
        where: { id: inquiryId },
        data: {
          status: configuration ? 'CONFIGURATION_REQUIRED' : 'FAILED',
          errorCode: configuration
            ? `${provider}_CREDENTIALS_REQUIRED`
            : 'PROVIDER_ERROR',
          completedAt: new Date(),
        },
      });
      if (!configuration) throw error;
    }
  }

  private async lifecycle(job: Job) {
    if (job.name === 'credit-review') {
      await this.integrations.triggerAutomation('luft-credit-review', {
        event: 'credit.review_requested',
        ...job.data,
      });
      return;
    }
    if (job.name === 'report-payment') {
      const { paymentId, userId } = job.data as {
        paymentId: string;
        userId: string;
      };
      const payment = await this.db.startif.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { installment: true },
      });
      if (!payment.installment) return;
      const period = new Date().toISOString().slice(0, 7);
      await this.reportTradeline(payment.installment.loanId, userId, period);
      return;
    }
    if (job.name === 'daily-overdue') {
      const now = new Date();
      const due = await this.db.startif.installment.findMany({
        where: {
          dueDate: { lte: now },
          status: { in: ['PENDING', 'DUE', 'PARTIALLY_PAID'] },
        },
        include: { loan: true },
      });
      for (const installment of due) {
        const overdue =
          installment.dueDate.getTime() <
          new Date(now.toISOString().slice(0, 10)).getTime();
        await this.db.startif.installment.update({
          where: { id: installment.id },
          data: { status: overdue ? 'OVERDUE' : 'DUE' },
        });
        await this.schedulerQueue?.add(
          'payment-reminder',
          {
            userId: installment.loan.userId,
            installmentId: installment.id,
            dueDate: installment.dueDate.toISOString(),
            status: overdue ? 'OVERDUE' : 'DUE',
          },
          {
            jobId: `reminder-${installment.id}-${now.toISOString().slice(0, 10)}`,
          },
        );
      }
      return;
    }
    if (job.name === 'payment-reminder') {
      const identity = await this.db.identity.user.findUnique({
        where: { id: String(job.data.userId) },
      });
      if (identity) {
        const overdue = job.data.status === 'OVERDUE';
        await Promise.all([
          this.integrations.sendEmail(
            identity.email,
            'Tu próxima cuota LUFT',
            `<h1>Hola, ${identity.fullName.split(' ')[0]}</h1><p>Tu cuota está ${overdue ? 'vencida' : 'próxima a vencer'}. Ingresa a LUFT para revisar el valor y pagar por PSE.</p>`,
          ),
          this.integrations.sendWhatsApp(
            identity.phone,
            `LUFT: tu cuota está ${overdue ? 'vencida' : 'próxima a vencer'}. Revisa y paga de forma segura en luft.restaurar.co.`,
          ),
        ]);
      }
      await this.integrations.triggerAutomation('luft-payment-reminder', {
        event: 'installment.reminder',
        ...job.data,
      });
      return;
    }
    if (job.name === 'monthly-report') {
      const loans = await this.db.startif.loan.findMany({
        where: { status: { in: ['ACTIVE', 'DEFAULTED', 'COMPLETED'] } },
      });
      const period = new Date().toISOString().slice(0, 7);
      for (const loan of loans) {
        await this.reportTradeline(loan.id, loan.userId, period);
      }
      return;
    }
  }

  private async reportTradeline(
    loanId: string,
    userId: string,
    period: string,
  ) {
    const [loan, identity] = await Promise.all([
      this.db.startif.loan.findUniqueOrThrow({
        where: { id: loanId },
        include: { installments: { orderBy: { sequence: 'asc' } } },
      }),
      this.db.identity.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    const overdue = loan.installments.filter(
      (installment) => installment.status === 'OVERDUE',
    );
    const payload = {
      reportingPeriod: period,
      accountReference: loan.id,
      documentType: 'CC',
      documentNumber: this.crypto.decrypt(identity.documentCiphertext),
      openedAt: loan.disbursedAt?.toISOString() ?? loan.createdAt.toISOString(),
      status: loan.status,
      originalAmountCOP: loan.principalCOP.toString(),
      outstandingBalanceCOP: loan.outstandingBalanceCOP.toString(),
      overdueInstallments: overdue.length,
      overdueBalanceCOP: overdue
        .reduce(
          (total, installment) =>
            total + (installment.amountCOP - installment.paidCOP),
          0n,
        )
        .toString(),
    };
    for (const provider of ['DATACREDITO', 'TRANSUNION'] as const) {
      const configured = this.integrations.tradelineReady(provider);
      const existing = await this.db.startif.tradelineReport.findUnique({
        where: {
          loanId_provider_period: { loanId, provider, period },
        },
      });
      if (existing?.status === 'COMPLETED') continue;
      const report = await this.db.startif.tradelineReport.upsert({
        where: {
          loanId_provider_period: { loanId, provider, period },
        },
        create: {
          userId,
          loanId,
          provider,
          period,
          status: configured ? 'PENDING' : 'CONFIGURATION_REQUIRED',
          failureReason: configured
            ? undefined
            : `${provider}_TRADELINE_CONFIGURATION_REQUIRED`,
        },
        update: configured
          ? { status: 'PENDING', failureReason: null }
          : {
              status: 'CONFIGURATION_REQUIRED',
              failureReason: `${provider}_TRADELINE_CONFIGURATION_REQUIRED`,
            },
      });
      if (!configured) continue;
      try {
        await this.db.startif.tradelineReport.update({
          where: { id: report.id },
          data: { status: 'PROCESSING' },
        });
        const result = await this.integrations.reportTradeline(
          provider,
          payload,
        );
        await this.db.startif.tradelineReport.update({
          where: { id: report.id },
          data: {
            status: 'COMPLETED',
            payloadHash: this.crypto.hash(JSON.stringify(payload)),
            externalReference: String(
              result.referenceId ?? result.id ?? result.transactionId ?? '',
            ).slice(0, 160),
            submittedAt: new Date(),
          },
        });
      } catch (error: any) {
        await this.db.startif.tradelineReport.update({
          where: { id: report.id },
          data: {
            status: 'FAILED',
            failureReason: String(
              error?.response?.message ?? error?.message ?? 'PROVIDER_ERROR',
            ).slice(0, 500),
          },
        });
        this.logger.error(`${provider}/tradeline/${loanId}: ${error?.message}`);
      }
    }
  }

  private async notifications(job: Job) {
    const userId =
      typeof job.data.userId === 'string' ? job.data.userId : undefined;
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    if (userId && publicKey && privateKey) {
      webPush.setVapidDetails(
        this.config.get<string>('VAPID_SUBJECT') ??
          'mailto:soporte@luft.restaurar.co',
        publicKey,
        privateKey,
      );
      const subscriptions = await this.db.identity.pushSubscription.findMany({
        where: { userId },
      });
      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await webPush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify({
                title: 'LUFT',
                body:
                  job.name === 'credit-approved'
                    ? 'Tu ruta de crédito tiene una actualización.'
                    : 'Hay una novedad en tu ruta financiera.',
                url: '/app',
              }),
            );
          } catch (error: any) {
            if ([404, 410].includes(Number(error?.statusCode)))
              await this.db.identity.pushSubscription.delete({
                where: { id: subscription.id },
              });
            else throw error;
          }
        }),
      );
    }
    if (userId) {
      const identity = await this.db.identity.user.findUnique({
        where: { id: userId },
      });
      if (identity) {
        const approved = job.name === 'credit-approved';
        await Promise.all([
          this.integrations.sendEmail(
            identity.email,
            approved
              ? 'Tu crédito LUFT fue aprobado'
              : 'Tienes una actualización en LUFT',
            `<h1>Hola, ${identity.fullName.split(' ')[0]}</h1><p>${approved ? 'Tu ruta StartIF fue aprobada. Revisa tu plan y tarjeta virtual.' : 'Ingresa a LUFT para ver la novedad de tu ruta.'}</p>`,
          ),
          this.integrations.sendWhatsApp(
            identity.phone,
            approved
              ? 'LUFT: tu ruta StartIF fue aprobada. Ingresa para revisar tu plan.'
              : 'LUFT: tienes una actualización en tu ruta financiera.',
          ),
        ]);
      }
    }
    await this.integrations.triggerAutomation('luft-notifications', {
      event: job.name,
      ...job.data,
    });
  }
}
