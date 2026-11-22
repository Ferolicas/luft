import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ConsentsService } from './consents.service';

@Controller('luft/consents')
@UseGuards(AuthGuard)
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.consents.list(user);
  }

  @Post(':id/revoke') revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.consents.revoke(user, id, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
}
