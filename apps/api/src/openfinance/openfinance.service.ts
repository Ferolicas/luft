import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { CONSENT_TEXTS, CONSENT_VERSION } from '../consents/consent-catalog';
import { DatabaseService } from '../database/database.service';
import type { OpenFinanceConnection } from '../generated/luft/client';
import { IntegrationService } from '../integrations/integration.service';
import { RealtimeService } from '../realtime/realtime.service';

export const OPEN_FINANCE_SCOPES = {
  ACCOUNTS: 'Cuentas que selecciones',
  TRANSACTIONS: 'Movimientos de esas cuentas',
  INCOME: 'Ingresos y su regularidad',
  RECURRING_PAYMENTS: 'Pagos recurrentes',
} as const;
type ScopeCode = keyof typeof OPEN_FINANCE_SCOPES;
const SCOPE_CODES = Object.keys(OPEN_FINANCE_SCOPES) as [
  ScopeCode,
  ...ScopeCode[],
];

const OPEN_STATUSES = [
  'PENDING',
  'CONFIGURATION_REQUIRED',
  'AUTHORIZATION_PENDING',
  'ACTIVE',
];

const NOT_READY_MESSAGE =
  'La conexión Open Finance aún no está habilitada: falta contratar el proveedor regulado. Registramos tu autorización y tu solicitud; no se leyó ninguna cuenta.';

@Injectable()
export class OpenFinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  private consentDays() {
    const days = Number(this.config.get('OPENFINANCE_CONSENT_DAYS') ?? 90);
    return Number.isInteger(days) && days >= 1 && days <= 365 ? days : 90;
  }

  private view(connection: OpenFinanceConnection) {
    const expired =
      OPEN_STATUSES.includes(connection.status) &&
      connection.expiresAt.getTime() < Date.now();
    return {
      id: connection.id,
      institution: connection.institution,
      status: expired ? 'EXPIRED' : connection.status,
      scopes: (connection.scopes as string[]).map((code) => ({
        code,
        label: OPEN_FINANCE_SCOPES[code as ScopeCode] ?? code,
      })),
      consentId: connection.consentId,
      requestedAt: connection.requestedAt,
      expiresAt: connection.expiresAt,
      activatedAt: connection.activatedAt,
      revokedAt: connection.revokedAt,
      lastSyncAt: connection.lastSyncAt,
    };
  }

  async status(user: AuthenticatedUser) {
    const connections = await this.db.luft.openFinanceConnection.findMany({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    });
    const ready = this.integrations.openFinanceReady();
    return {
      available: ready,
      status: ready ? 'ready' : 'configuration_required',
      message: ready ? null : NOT_READY_MESSAGE,
      notice: 'Nunca pediremos tus claves bancarias.',
      scopes: SCOPE_CODES.map((code) => ({
        code,
        label: OPEN_FINANCE_SCOPES[code],
      })),
      consent: {
        kind: 'OPEN_FINANCE',
        version: CONSENT_VERSION,
        text: CONSENT_TEXTS.OPEN_FINANCE,
        days: this.consentDays(),
      },
      connections: connections.map((row) => this.view(row)),
    };
  }

  /**
   * Records the user's consent (scope and expiry) and the request. Without a
   * regulated provider it answers `configuration_required`; nothing is simulated.
   */
  async connect(
    user: AuthenticatedUser,
    body: unknown,
    metadata: { ip?: string; userAgent?: string },
  ) {
    const input = z
      .object({
        accepted: z.literal(true),
        version: z.literal(CONSENT_VERSION),
        scopes: z.array(z.enum(SCOPE_CODES)).min(1).max(SCOPE_CODES.length),
        institution: z.string().trim().min(2).max(120).optional(),
      })
      .strict()
      .parse(body);
    const scopes = [...new Set(input.scopes)];
    const expiresAt = new Date(Date.now() + this.consentDays() * 86_400_000);
    const text = CONSENT_TEXTS.OPEN_FINANCE;
    const consent = await this.db.luft.consent.create({
      data: {
        userId: user.id,
        kind: 'OPEN_FINANCE',
        version: CONSENT_VERSION,
        textSnapshot: text,
        textHash: this.crypto.hash(text),
        ipHash: metadata.ip ? this.crypto.hash(metadata.ip) : undefined,
        userAgent: metadata.userAgent?.slice(0, 500),
        scope: scopes.map((code) => OPEN_FINANCE_SCOPES[code]),
        expiresAt,
      },
    });
    const connection = await this.db.luft.openFinanceConnection.create({
      data: {
        userId: user.id,
        institution: input.institution,
        status: 'PENDING',
        scopes,
        consentId: consent.id,
        expiresAt,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'consent.accepted',
      resource: 'Consent',
      resourceId: consent.id,
      ip: metadata.ip,
      payload: {
        kind: 'OPEN_FINANCE',
        version: CONSENT_VERSION,
        textHash: consent.textHash,
        scopes,
        expiresAt: expiresAt.toISOString(),
        connectionId: connection.id,
      },
    });
    try {
      const provider = await this.integrations.startOpenFinanceConsent({
        reference: connection.id,
        scopes,
        expiresAt,
        institution: input.institution,
      });
      const updated = await this.db.luft.openFinanceConnection.update({
        where: { id: connection.id },
        data: {
          status: 'AUTHORIZATION_PENDING',
          externalId: provider.externalId,
          provider: 'OPENFINANCE',
        },
      });
      return {
        connection: this.view(updated),
        redirectUrl: provider.redirectUrl,
      };
    } catch (error: any) {
      const configuration = error?.response?.code === 'configuration_required';
      await this.db.luft.openFinanceConnection.update({
        where: { id: connection.id },
        data: {
          status: configuration ? 'CONFIGURATION_REQUIRED' : 'FAILED',
          errorCode: configuration
            ? 'OPENFINANCE_CREDENTIALS_REQUIRED'
            : 'PROVIDER_ERROR',
        },
      });
      if (!configuration) throw error;
      throw new ServiceUnavailableException({
        code: 'configuration_required',
        provider: 'OPENFINANCE',
        connectionId: connection.id,
        message: NOT_READY_MESSAGE,
      });
    }
  }

  /** Revokes one connection and its consent. The local revocation never waits on the provider. */
  private async revokeConnection(
    connection: OpenFinanceConnection,
    actor: { id: string; role: string },
    reason: string,
  ) {
    let providerRevoked = !connection.externalId;
    if (connection.externalId)
      try {
        await this.integrations.revokeOpenFinanceConsent(connection.externalId);
        providerRevoked = true;
      } catch {
        providerRevoked = false;
      }
    const now = new Date();
    await this.db.luft.$transaction([
      this.db.luft.openFinanceConnection.update({
        where: { id: connection.id },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          errorCode: providerRevoked ? null : 'PROVIDER_REVOCATION_PENDING',
        },
      }),
      this.db.luft.consent.updateMany({
        where: { id: connection.consentId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      }),
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'openfinance.connection.revoked',
      resource: 'OpenFinanceConnection',
      resourceId: connection.id,
      payload: {
        consentId: connection.consentId,
        providerRevoked,
        reason,
      },
    });
    if (!providerRevoked)
      await this.integrations.triggerAutomation('luft-openfinance-revocation', {
        event: 'openfinance.revocation_pending',
        connectionId: connection.id,
        userId: connection.userId,
      });
    return providerRevoked;
  }

  async revoke(user: AuthenticatedUser, id: string) {
    const connection = await this.db.luft.openFinanceConnection.findFirst({
      where: { id, userId: user.id },
    });
    if (!connection) throw new NotFoundException('Conexión no encontrada.');
    if (connection.status === 'REVOKED')
      throw new ConflictException('Esta conexión ya fue revocada.');
    const providerRevoked = await this.revokeConnection(
      connection,
      user,
      'user_revoked_connection',
    );
    return { ...(await this.status(user)), providerRevoked };
  }

  /** Effect of revoking the OPEN_FINANCE consent from the habeas-data screen. */
  async revokeByConsent(user: AuthenticatedUser, consentIds: string[]) {
    const connections = await this.db.luft.openFinanceConnection.findMany({
      where: {
        userId: user.id,
        consentId: { in: consentIds },
        status: { not: 'REVOKED' },
      },
    });
    for (const connection of connections)
      await this.revokeConnection(connection, user, 'user_revoked_consent');
    return connections.length;
  }

  /** Signed provider callback: the only way a connection becomes active. */
  async webhook(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    body: any,
  ) {
    this.integrations.validateOpenFinanceWebhook(signature, rawBody);
    const externalId = String(
      body?.consent_id ?? body?.consentId ?? body?.data?.consent_id ?? '',
    );
    const raw = String(body?.status ?? body?.data?.status ?? '').toLowerCase();
    const connection = externalId
      ? await this.db.luft.openFinanceConnection.findUnique({
          where: { externalId },
        })
      : null;
    if (!connection || connection.status === 'REVOKED')
      return { accepted: true, matched: false };
    const status = ['authori', 'active', 'approved'].some((value) =>
      raw.includes(value),
    )
      ? 'ACTIVE'
      : ['revoked', 'cancel'].some((value) => raw.includes(value))
        ? 'REVOKED'
        : raw.includes('expired')
          ? 'EXPIRED'
          : ['reject', 'fail', 'denied'].some((value) => raw.includes(value))
            ? 'FAILED'
            : null;
    if (!status || status === connection.status)
      return { accepted: true, matched: true, changed: false };
    const now = new Date();
    await this.db.luft.openFinanceConnection.update({
      where: { id: connection.id },
      data: {
        status,
        activatedAt: status === 'ACTIVE' ? now : undefined,
        revokedAt: status === 'REVOKED' ? now : undefined,
      },
    });
    if (status !== 'ACTIVE')
      await this.db.luft.consent.updateMany({
        where: { id: connection.consentId, revokedAt: null },
        data: {
          revokedAt: now,
          revokedReason: `provider_${status.toLowerCase()}`,
        },
      });
    await this.audit.record({
      actorRole: 'SYSTEM',
      action: 'openfinance.webhook.received',
      resource: 'OpenFinanceConnection',
      resourceId: connection.id,
      payload: { status },
    });
    this.realtime.toUser(connection.userId, 'openfinance:status', {
      connectionId: connection.id,
      status,
    });
    return { accepted: true, matched: true, changed: true };
  }
}
