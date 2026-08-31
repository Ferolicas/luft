import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private server?: Server;
  attach(server: Server) {
    this.server = server;
  }
  toUser(userId: string, event: string, payload: Record<string, unknown>) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
  toRole(role: string, event: string, payload: Record<string, unknown>) {
    this.server?.to(`role:${role}`).emit(event, payload);
  }
}
