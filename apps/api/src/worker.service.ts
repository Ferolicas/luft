import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import webPush from 'web-push';
import { AuditService } from './common/audit.service';
import { CryptoService } from './common/crypto.service';
import { DatabaseService } from './database/database.service';
import { IntegrationService } from './integrations/integration.service';
import { lowBalanceEmail } from './integrations/sms';
import {
  canContactNow,
  negativeReportAllowedFrom,
  noticesForCurrentDelinquency,
  priorNoticeDue,
  priorNoticeText,
  reminderDue,
  reminderText,
  textToHtml,
} from './startif/collection';
import { toIsoDate } from './startif/credit-calculator';
import {
  bogotaDate,
  daysOverdue,
  isSettled,
  openInstallmentStatus,
  resolveLoanStatus,
} from './startif/credit-lifecycle';
import { LegalRateService } from './startif/legal-rate.service';
import { lockLoan, syncLoanStatus } from './startif/loan-sync';

/** Textos de las notificaciones de crédito, por nombre del job. */
const CREDIT_NOTICES: Record<
  string,
  { subject: string; body: string; push: string }
> = {
  'credit-approved': {
    subject: 'Tu crédito LUFT fue aprobado',
    body: 'Tu ruta StartIF fue aprobada. Revisa tu plan y tarjeta virtual.',
    push: 'Tu ruta de crédito tiene una actualización.',
  },
  'credit-approved-transfer': {
    subject: 'Tu crédito LUFT fue aprobado',
    body: 'Tu crédito fue aprobado. Te avisaremos cuando se registre el desembolso; desde esa fecha empieza tu plan de cuotas.',
    push: 'Tu crédito fue aprobado. Falta el desembolso.',
  },
  'credit-disbursed': {
    subject: 'Registramos el desembolso de tu crédito LUFT',
    body: 'Tu crédito ya está vigente. Ingresa a LUFT para revisar tu plan de cuotas.',
    push: 'Tu crédito ya está vigente. Revisa tu plan de cuotas.',
  },
};

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
    private readonly audit: AuditService,
    private readonly legalRates: LegalRateService,
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
      // 9:00 a. m. de Colombia: dentro del horario en que la ley permite contactar.
      { pattern: '0 14 * * *' },
      { name: 'daily-overdue', data: {} },
    );
    void this.schedulerQueue.upsertJobScheduler(
      'monthly-tradeline-reporting',
      { pattern: '0 12 1 * *' },
      { name: 'monthly-report', data: {} },
    );
    // La tasa máxima legal se revisa cada seis horas y al arrancar, para que
    // el cambio de mes no deje la aprobación de créditos sin tasa vigente.
    void this.schedulerQueue.upsertJobScheduler(
      'legal-rate-sync',
      { pattern: '5 */6 * * *' },
      { name: 'legal-rate-sync', data: {} },
    );
    // Saldo de SMS: sin saldo nadie puede terminar de registrarse.
    void this.schedulerQueue.upsertJobScheduler(
      'sms-balance-check',
      { pattern: '*/15 * * * *' },
      { name: 'sms-balance-check', data: {} },
    );
    void this.legalRates
      .sync()
      .then(() => this.reviewLoanRates())
      .catch((error: Error) =>
        this.logger.warn(`Tasa legal sin actualizar: ${error.message}`),
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

  /**
   * Una vez por cada certificación de tasa (cada mes) comprueba que ningún
   * crédito vigente cobre por encima del máximo legal y avisa si alguno lo hace.
   */
  private async reviewLoanRates() {
    if (!this.schedulerQueue) return;
    const rate = await this.legalRates.current();
    if (!rate) return;
    const redis = await this.schedulerQueue.client;
    const key = `${this.config.get<string>('REDIS_PREFIX') ?? 'luft:'}loan-rate-review:${rate.id}`;
    if (await redis.get(key)) return;
    const review = await this.legalRates.reviewActiveLoans();
    if (!review) return;
    await redis.set(key, new Date().toISOString());
    if (!review.aboveLimit.length) return;
    this.logger.error(
      `Créditos por encima de la tasa máxima legal: ${review.aboveLimit.join(', ')}`,
    );
    const to =
      this.config.get<string>('OPERATIONS_ALERT_EMAIL') ??
      this.config.get<string>('SMS_LOW_BALANCE_ALERT_EMAIL');
    if (to)
      await this.integrations.sendEmail(
        to,
        'LUFT: hay créditos por encima de la tasa máxima legal',
        `<p>La revisión mensual encontró ${review.aboveLimit.length} crédito(s) con una tasa superior al máximo legal vigente (${(review.legalAnnualEffective * 100).toFixed(2)} % efectivo anual).</p><p>Ajusta la tasa de estos créditos desde la consola: ${review.aboveLimit.join(', ')}</p>`,
      );
  }

  /**
   * Avisa por correo cuando el saldo de SMS alcanza para pocos mensajes. El
   * aviso se repite una vez al día mientras siga bajo y se rearma al recargar.
   */
  private async checkSmsBalance() {
    const to = this.config.get<string>('SMS_LOW_BALANCE_ALERT_EMAIL');
    if (!to || !this.schedulerQueue) return;
    const threshold = Number(
      this.config.get('SMS_LOW_BALANCE_THRESHOLD') ?? 20,
    );
    const balance = await this.integrations.smsBalance();
    if (!balance) return;
    const redis = await this.schedulerQueue.client;
    const key = `${this.config.get<string>('REDIS_PREFIX') ?? 'luft:'}sms-low-balance-alerted`;
    if (balance.remaining > threshold) {
      await redis.del(key);
      return;
    }
    // Una sola alerta por día mientras el saldo siga bajo.
    const last = Number(await redis.get(key));
    if (last && Date.now() - last < 86_400_000) return;
    await redis.set(key, String(Date.now()));
    try {
      const { subject, html } = lowBalanceEmail(balance, threshold);
      const delivery = await this.integrations.sendEmail(to, subject, html);
      if (delivery.status !== 'ready') throw new Error('correo sin configurar');
      this.logger.warn(`Saldo de SMS bajo: quedan ${balance.remaining}`);
    } catch (error) {
      // Si el aviso no salió, se vuelve a intentar en la siguiente revisión.
      await redis.del(key);
      throw error;
    }
  }

  private async lifecycle(job: Job) {
    if (job.name === 'sms-balance-check') {
      await this.checkSmsBalance();
      return;
    }
    if (job.name === 'legal-rate-sync') {
      await this.legalRates.sync();
      await this.reviewLoanRates();
      return;
    }
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
      // Un abono anticipado no tiene cuota: el préstamo va en el pago.
      const loanId = payment.loanId ?? payment.installment?.loanId;
      if (!loanId) return;
      const period = new Date().toISOString().slice(0, 7);
      await this.reportTradeline(loanId, userId, period);
      return;
    }
    if (job.name === 'daily-overdue') {
      const now = new Date();
      // Los vencimientos se miden con el día calendario de Colombia.
      const today = bogotaDate(now);
      const due = await this.db.startif.installment.findMany({
        where: {
          dueDate: { lte: new Date(`${today}T00:00:00Z`) },
          status: { in: ['PENDING', 'DUE', 'PARTIALLY_PAID'] },
        },
        include: { loan: true },
      });
      for (const installment of due) {
        const status = openInstallmentStatus({
          dueDate: installment.dueDate,
          paidCOP: installment.paidCOP,
          today,
        });
        if (status !== installment.status)
          await this.db.startif.installment.update({
            where: { id: installment.id },
            data: { status },
          });
      }
      await this.reviewLoanStatuses(now);
      await this.planCollectionContacts(now);
      return;
    }
    if (job.name === 'collection-contact') {
      await this.collectionContact(job);
      return;
    }
    if (job.name === 'loan-status-changed') {
      const defaulted = job.data.status === 'DEFAULTED';
      // La mora la comunican los avisos de cobro (un solo contacto diario). El
      // regreso a estar al día se celebra por correo, dentro del horario legal.
      if (!defaulted && canContactNow(new Date())) {
        const identity = await this.db.identity.user.findUnique({
          where: { id: String(job.data.userId) },
        });
        if (identity)
          await this.integrations.sendEmail(
            identity.email,
            'Tu crédito LUFT está al día',
            `<h1>Hola, ${identity.fullName.split(' ')[0]}</h1><p>Tu crédito volvió a estar al día. Gracias por ponerte al corriente.</p>`,
          );
      }
      await this.integrations.triggerAutomation('luft-loan-status', {
        event: defaulted ? 'loan.defaulted' : 'loan.cured',
        ...job.data,
      });
      return;
    }
    if (job.name === 'monthly-report') {
      const loans = await this.db.startif.loan.findMany({
        where: {
          status: { in: ['ACTIVE', 'DEFAULTED', 'COMPLETED', 'WRITTEN_OFF'] },
        },
      });
      const period = new Date().toISOString().slice(0, 7);
      for (const loan of loans) {
        await this.reportTradeline(loan.id, loan.userId, period);
      }
      return;
    }
  }

  /**
   * Decide el único contacto de cobro del día para cada persona (Ley 2300 de
   * 2023: dentro del horario permitido, un solo canal y una vez al día). El
   * aviso previo al reporte negativo tiene prioridad sobre el recordatorio.
   * También envía a las centrales los reportes que esperaban ese aviso.
   */
  private async planCollectionContacts(now: Date) {
    const today = bogotaDate(now);
    const loans = await this.db.startif.loan.findMany({
      where: { status: { in: ['ACTIVE', 'DEFAULTED'] } },
      include: { installments: true },
    });
    const period = now.toISOString().slice(0, 7);
    const contacted = new Set<string>();
    for (const loan of loans) {
      const open = loan.installments.filter((row) => !isSettled(row.status));
      const overdue = open.filter((row) => row.status === 'OVERDUE');
      const dueToday = open.some((row) => toIsoDate(row.dueDate) === today);
      if (!overdue.length && !dueToday) continue;
      const current = overdue.length
        ? await this.currentNotices(loan.id, overdue)
        : [];
      const allowedFrom = negativeReportAllowedFrom(current);
      if (overdue.length && allowedFrom && today >= allowedFrom)
        await this.reportTradeline(loan.id, loan.userId, period);
      if (!canContactNow(now) || contacted.has(loan.userId)) continue;
      const notice = overdue.length ? priorNoticeDue(current, today) : null;
      const maxDaysOverdue = overdue.reduce(
        (max, row) => Math.max(max, daysOverdue(row.dueDate, today)),
        0,
      );
      if (!notice && !reminderDue({ dueToday, maxDaysOverdue })) continue;
      contacted.add(loan.userId);
      await this.schedulerQueue?.add(
        'collection-contact',
        {
          userId: loan.userId,
          loanId: loan.id,
          kind: notice ? 'PRIOR_NOTICE' : 'REMINDER',
          sequence: notice,
        },
        // Una sola tarea por persona y día: no hay segundo contacto.
        { jobId: `contact-${loan.userId}-${today}` },
      );
    }
  }

  /** Avisos previos que valen para la mora actual de un préstamo. */
  private async currentNotices(
    loanId: string,
    overdue: Array<{ dueDate: Date }>,
  ) {
    const earliest = overdue.map((row) => toIsoDate(row.dueDate)).sort()[0];
    const notices = await this.db.startif.negativeReportNotice.findMany({
      where: { loanId },
      orderBy: { sentAt: 'asc' },
    });
    return noticesForCurrentDelinquency(
      notices.map((notice) => ({
        sequence: notice.sequence,
        sentOn: bogotaDate(notice.sentAt),
      })),
      earliest,
    );
  }

  /** Envía el contacto de cobro del día y guarda la evidencia del aviso previo. */
  private async collectionContact(job: Job) {
    const now = new Date();
    // Si la tarea se atrasó y ya no es hora de contactar, se deja para mañana.
    if (!canContactNow(now)) return;
    const today = bogotaDate(now);
    const { userId, loanId, kind } = job.data as {
      userId: string;
      loanId: string;
      kind: 'PRIOR_NOTICE' | 'REMINDER';
    };
    const [loan, identity] = await Promise.all([
      this.db.startif.loan.findUnique({
        where: { id: loanId },
        include: { installments: { orderBy: { sequence: 'asc' } } },
      }),
      this.db.identity.user.findUnique({ where: { id: userId } }),
    ]);
    if (!loan || !identity || !['ACTIVE', 'DEFAULTED'].includes(loan.status))
      return;
    const open = loan.installments.filter((row) => !isSettled(row.status));
    const overdue = open.filter((row) => row.status === 'OVERDUE');
    const firstName = identity.fullName.split(' ')[0];
    const host = this.integrations.publicHost();
    if (kind === 'PRIOR_NOTICE') {
      // Se vuelve a comprobar: la persona pudo pagar desde que se planeó.
      if (!overdue.length) return;
      const sequence = priorNoticeDue(
        await this.currentNotices(loan.id, overdue),
        today,
      );
      if (!sequence) return;
      const overdueCOP = overdue.reduce(
        (total, row) => total + (row.amountCOP - row.paidCOP),
        0n,
      );
      const notice = priorNoticeText({
        firstName,
        sequence,
        loanReference: loan.id.slice(0, 8).toUpperCase(),
        overdue: overdue.map((row) => ({
          sequence: row.sequence,
          dueDate: toIsoDate(row.dueDate),
          pendingCOP: row.amountCOP - row.paidCOP,
        })),
        sentOn: today,
        host,
      });
      const delivery = await this.integrations.sendEmail(
        identity.email,
        notice.subject,
        textToHtml(notice.text),
      );
      // Sin correo enviado no hay aviso: no se guarda nada y el reporte espera.
      if (delivery.status !== 'ready') return;
      const record = await this.db.startif.negativeReportNotice.create({
        data: {
          loanId: loan.id,
          userId,
          sequence,
          destinationCiphertext: this.crypto.encrypt(identity.email),
          overdueCOP,
          subject: notice.subject,
          textSnapshot: notice.text,
          textHash: this.crypto.hash(notice.text),
          providerMessageId: delivery.data?.id?.slice(0, 160),
        },
      });
      await this.audit.record({
        actorRole: 'SYSTEM',
        action: 'credit.loan.prior_notice_sent',
        resource: 'Loan',
        resourceId: loan.id,
        payload: {
          noticeId: record.id,
          sequence,
          overdueCOP: overdueCOP.toString(),
          textHash: record.textHash,
        },
      });
      return;
    }
    const dueToday = open.some((row) => toIsoDate(row.dueDate) === today);
    const maxDaysOverdue = overdue.reduce(
      (max, row) => Math.max(max, daysOverdue(row.dueDate, today)),
      0,
    );
    if (!overdue.length && !dueToday) return;
    const reminder = reminderText({
      firstName,
      dueToday,
      maxDaysOverdue,
      host,
    });
    await this.integrations.sendEmail(
      identity.email,
      reminder.subject,
      textToHtml(reminder.text),
    );
    await this.integrations.triggerAutomation('luft-payment-reminder', {
      event: 'installment.reminder',
      userId,
      loanId,
      status: overdue.length ? 'OVERDUE' : 'DUE',
    });
  }

  /**
   * Mora automática: un préstamo vigente entra en mora cuando una cuota lleva
   * `defaultAfterDays` días vencida, y vuelve a vigente al ponerse al día.
   * El castigo nunca es automático: lo decide finanzas.
   */
  private async reviewLoanStatuses(now: Date) {
    const today = bogotaDate(now);
    const loans = await this.db.startif.loan.findMany({
      where: { status: { in: ['ACTIVE', 'DEFAULTED'] } },
      include: { installments: { select: { status: true, dueDate: true } } },
    });
    for (const loan of loans) {
      const expected = resolveLoanStatus({
        current: loan.status,
        installments: loan.installments,
        today,
        defaultAfterDays: loan.defaultAfterDays,
      });
      if (expected === loan.status) continue;
      const result = await this.db.startif.$transaction(async (tx) => {
        await lockLoan(tx, loan.id);
        return syncLoanStatus(tx, loan.id, now);
      });
      if (result.status === result.previousStatus) continue;
      await this.audit.record({
        actorRole: 'SYSTEM',
        action:
          result.status === 'DEFAULTED'
            ? 'credit.loan.defaulted'
            : 'credit.loan.status_changed',
        resource: 'Loan',
        resourceId: loan.id,
        payload: {
          previousStatus: result.previousStatus,
          status: result.status,
          defaultAfterDays: loan.defaultAfterDays,
          daysOverdue: loan.installments
            .filter((row) => !isSettled(row.status))
            .reduce(
              (max, row) => Math.max(max, daysOverdue(row.dueDate, today)),
              0,
            ),
          outstandingBalanceCOP: result.outstandingBalanceCOP.toString(),
        },
      });
      if (['ACTIVE', 'DEFAULTED'].includes(result.status))
        await this.schedulerQueue?.add(
          'loan-status-changed',
          {
            userId: loan.userId,
            loanId: loan.id,
            previousStatus: result.previousStatus,
            status: result.status,
          },
          { jobId: `loan-status-${loan.id}-${result.status}-${today}` },
        );
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
    // Ley 1266, art. 12: la información negativa solo se reporta después de
    // los avisos previos y de veinte días calendario desde el último.
    if (overdue.length) {
      const allowedFrom = negativeReportAllowedFrom(
        await this.currentNotices(loan.id, overdue),
      );
      if (!allowedFrom || bogotaDate(new Date()) < allowedFrom) {
        for (const provider of ['DATACREDITO', 'TRANSUNION'] as const) {
          const key = { loanId_provider_period: { loanId, provider, period } };
          const existing = await this.db.startif.tradelineReport.findUnique({
            where: key,
          });
          if (existing?.status === 'COMPLETED') continue;
          await this.db.startif.tradelineReport.upsert({
            where: key,
            create: {
              userId,
              loanId,
              provider,
              period,
              status: 'PENDING',
              failureReason: 'AWAITING_PRIOR_NOTICE',
            },
            update: {
              status: 'PENDING',
              failureReason: 'AWAITING_PRIOR_NOTICE',
            },
          });
        }
        return;
      }
    }
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
          `mailto:soporte@${this.integrations.publicHost()}`,
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
                  CREDIT_NOTICES[job.name]?.push ??
                  'Hay una novedad en tu ruta financiera.',
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
        const notice = CREDIT_NOTICES[job.name];
        await Promise.all([
          this.integrations.sendEmail(
            identity.email,
            notice?.subject ?? 'Tienes una actualización en LUFT',
            `<h1>Hola, ${identity.fullName.split(' ')[0]}</h1><p>${notice?.body ?? 'Ingresa a LUFT para ver la novedad de tu ruta.'}</p>`,
          ),
          this.integrations.sendWhatsApp(
            identity.phone,
            notice
              ? `LUFT: ${notice.body}`
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
