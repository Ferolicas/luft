import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';

export const NOTIFICATIONS_PAGE = 30;

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  unread(userId: string) {
    return this.db.luft.notification.count({
      where: { userId, readAt: null },
    });
  }

  async list(user: AuthenticatedUser) {
    const [unread, items] = await Promise.all([
      this.unread(user.id),
      this.db.luft.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: NOTIFICATIONS_PAGE,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          href: true,
          createdAt: true,
          readAt: true,
        },
      }),
    ]);
    return { unread, items };
  }

  /** Marks the given notifications as read; without ids, all of them. */
  async markRead(user: AuthenticatedUser, body: unknown) {
    const { ids } = z
      .object({ ids: z.array(z.string().uuid()).max(100).optional() })
      .strict()
      .parse(body ?? {});
    await this.db.luft.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { unread: await this.unread(user.id) };
  }
}
