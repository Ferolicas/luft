import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

export interface AuditInput {
  actorUserId?: string;
  actorRole?: string;
  action: string;
  resource: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(input: AuditInput) {
    const previous = await this.db.audit.auditEvent.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { eventHash: true },
    });
    const createdAt = new Date();
    const body = JSON.stringify({
      ...input,
      ip: undefined,
      previousHash: previous?.eventHash ?? null,
      createdAt: createdAt.toISOString(),
    });
    const eventHash = createHash('sha256').update(body).digest('hex');
    return this.db.audit.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        ipHash: input.ip
          ? createHash('sha256').update(input.ip).digest('hex')
          : undefined,
        userAgent: input.userAgent?.slice(0, 500),
        payload: input.payload as any,
        previousHash: previous?.eventHash,
        eventHash,
        createdAt,
      },
    });
  }
}
