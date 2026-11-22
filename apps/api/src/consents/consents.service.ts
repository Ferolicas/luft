import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import { PRIVATE_PERMISSIONS } from '../household/privacy';
import { OpenFinanceService } from '../openfinance/openfinance.service';
import {
  CONSENT_CATALOG,
  consentView,
  type ConsentKindCode,
} from './consent-catalog';

const POLICY_URL = 'https://restaurar.co/privacy';

@Injectable()
export class ConsentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly openFinance: OpenFinanceService,
  ) {}

  /** Current and historical authorizations, with purpose, scope, date and version. */
  async list(user: AuthenticatedUser) {
    const [luft, startif] = await Promise.all([
      this.db.luft.consent.findMany({
        where: { userId: user.id },
        orderBy: { acceptedAt: 'desc' },
      }),
      this.db.startif.startifConsent.findMany({
        where: { userId: user.id },
        orderBy: { acceptedAt: 'desc' },
      }),
    ]);
    return {
      controller: 'Tureporte S.A.S.',
      policyUrl: POLICY_URL,
      items: [
        ...consentView(luft),
        // StartIF authorizations are shown for transparency and managed by StartIF.
        ...startif.map((consent, index) => ({
          id: consent.id,
          domain: 'STARTIF' as const,
          kind: consent.kind,
          title: 'Estudio, originación y reporte de crédito (StartIF)',
          purpose: consent.textSnapshot,
          scope: [
            'Estudio y originación del crédito',
            'Validación de identidad y firma',
            'Recaudo y reporte a operadores de información',
          ],
          version: consent.version,
          acceptedAt: consent.acceptedAt,
          expiresAt: null,
          revokedAt: consent.revokedAt,
          status: consent.revokedAt
            ? ('REVOKED' as const)
            : index === 0
              ? ('ACTIVE' as const)
              : ('SUPERSEDED' as const),
          revocable: false,
          revokeEffect:
            'Esta autorización respalda tu crédito con StartIF. Para ejercer tus derechos sobre ella radica una solicitud en Ayuda y PQR.',
        })),
      ].sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime()),
    };
  }

  /**
   * Revokes every acceptance in force of that purpose and applies its effects.
   * The basic data-processing authorization only ends by closing the account.
   */
  async revoke(
    user: AuthenticatedUser,
    id: string,
    metadata: { ip?: string; userAgent?: string },
  ) {
    const consent = await this.db.luft.consent.findFirst({
      where: { id, userId: user.id },
    });
    if (!consent) throw new NotFoundException('Autorización no encontrada.');
    const kind = consent.kind as ConsentKindCode;
    const definition = CONSENT_CATALOG[kind];
    if (!definition?.revocable)
      throw new ConflictException({
        code: 'account_closure_required',
        message:
          definition?.revokeEffect ??
          'Esta autorización no se puede retirar desde aquí.',
        href: '/app/perfil/cuenta',
      });
    if (consent.revokedAt)
      throw new ConflictException({
        code: 'already_revoked',
        message: 'Esta autorización ya fue revocada.',
      });
    const active = await this.db.luft.consent.findMany({
      where: { userId: user.id, kind: consent.kind, revokedAt: null },
      select: { id: true },
    });
    const ids = active.map((row) => row.id);
    const now = new Date();
    await this.db.luft.consent.updateMany({
      where: { id: { in: ids } },
      data: { revokedAt: now, revokedReason: 'user_request' },
    });
    const effects: string[] = [];
    if (kind === 'HOUSEHOLD_SHARING') {
      const stopped = await this.db.luft.householdMember.updateMany({
        where: { userId: user.id, status: 'ACTIVE' },
        data: { permissions: PRIVATE_PERMISSIONS },
      });
      if (stopped.count) effects.push('household_sharing_stopped');
    }
    if (kind === 'OPEN_FINANCE') {
      const revoked = await this.openFinance.revokeByConsent(user, ids);
      if (revoked) effects.push('open_finance_connections_revoked');
    }
    if (kind === 'BUREAU_QUERY') effects.push('bureau_queries_blocked');
    if (kind === 'SCORE_SHARE_WITH_STARTIF')
      effects.push('new_credit_applications_blocked');
    if (kind === 'TAX_ASSISTANCE') effects.push('tax_documents_blocked');
    if (kind === 'COMMUNICATIONS')
      effects.push('non_essential_communications_stopped');
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'consent.revoked',
      resource: 'Consent',
      resourceId: consent.id,
      ip: metadata.ip,
      userAgent: metadata.userAgent,
      payload: { kind, revokedIds: ids, effects },
    });
    return {
      revoked: { kind, title: definition.title, count: ids.length, at: now },
      effect: definition.revokeEffect,
      effects,
      ...(await this.list(user)),
    };
  }
}
