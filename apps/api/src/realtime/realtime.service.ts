import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { DatabaseService } from '../database/database.service';
import { isUniqueViolation } from '../luft/http';
import { notificationFor } from '../notifications/notification-catalog';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Server;

  constructor(private readonly db: DatabaseService) {}

  attach(server: Server) {
    this.server = server;
  }

  /**
   * Emits the event to the user's sockets. Whitelisted events also leave a
   * persistent in-app notification and a `notification:new` event, so the
   * user finds it later even if no socket was connected.
   */
  toUser(userId: string, event: string, payload: Record<string, unknown>) {
    this.server?.to(`user:${userId}`).emit(event, payload);
    const draft = notificationFor(event, payload);
    if (draft) void this.notify(userId, draft);
  }

  toRole(role: string, event: string, payload: Record<string, unknown>) {
    this.server?.to(`role:${role}`).emit(event, payload);
  }

  private async notify(
    userId: string,
    draft: NonNullable<ReturnType<typeof notificationFor>>,
  ) {
    try {
      const notification = await this.db.luft.notification.create({
        data: { userId, ...draft },
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          href: true,
          createdAt: true,
          readAt: true,
        },
      });
      this.server?.to(`user:${userId}`).emit('notification:new', notification);
    } catch (error) {
      // The same event for the same subject and status is stored only once.
      if (isUniqueViolation(error)) return;
      this.logger.warn(
        `No se pudo guardar la notificación ${draft.kind}: ${(error as Error).message}`,
      );
    }
  }
}
