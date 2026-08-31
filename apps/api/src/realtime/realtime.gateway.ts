import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import cookieParser from 'cookie-parser';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { RealtimeService } from './realtime.service';

@WebSocketGateway({ path: '/socket.io', transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(client: Socket) {
    const cookieName = this.config.get('SESSION_COOKIE_NAME') ?? 'luft_session';
    const cookies = Object.fromEntries(
      (client.handshake.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim().split('=').map(decodeURIComponent))
        .filter((pair) => pair.length === 2),
    );
    const signedToken = cookies[cookieName];
    const token = signedToken
      ? cookieParser.signedCookie(
          signedToken,
          this.config.getOrThrow<string>('COOKIE_SECRET'),
        )
      : false;
    const user = token ? await this.auth.userFromSession(token) : null;
    if (!user) return client.disconnect(true);
    client.data.user = user;
    await Promise.all([
      client.join(`user:${user.id}`),
      client.join(`role:${user.role}`),
    ]);
    client.emit('session:ready', {
      userId: user.id,
      at: new Date().toISOString(),
    });
  }
}
