import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../generated/identity/enums';
import { ROLES_KEY } from './auth.decorators';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const token = request.signedCookies?.[
      this.config.get('SESSION_COOKIE_NAME') ?? 'luft_session'
    ] as string | undefined;
    const user = token ? await this.auth.userFromSession(token) : null;
    if (!user) throw new UnauthorizedException('Inicia sesión para continuar.');
    request.user = user;
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !roles.includes(user.role))
      throw new UnauthorizedException('Tu rol no tiene acceso a esta sección.');
    return true;
  }
}
