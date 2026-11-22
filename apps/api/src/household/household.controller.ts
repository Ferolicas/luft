import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { readBody, uploadedFileName } from '../luft/http';
import { MAX_DOCUMENT_BYTES } from '../luft/journey';
import { HouseholdService } from './household.service';

const metadata = (request: Request) => ({
  ip: request.ip,
  userAgent: request.get('user-agent'),
});

@Controller('luft')
@UseGuards(AuthGuard)
export class HouseholdController {
  constructor(private readonly households: HouseholdService) {}

  @Get('subscription') subscription(@CurrentUser() user: AuthenticatedUser) {
    return this.households.subscription(user);
  }

  @Post('subscription') chooseSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.households.chooseSubscription(user, body);
  }

  @Get('household') board(@CurrentUser() user: AuthenticatedUser) {
    return this.households.board(user);
  }

  @Post('household') create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.households.create(user, body, metadata(request));
  }

  @Patch('household') rename(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.households.rename(user, body);
  }

  @Post('household/invitations')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invite(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.households.invite(user, body);
  }

  @Delete('household/invitations/:id') revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.households.revokeInvitation(user, id);
  }

  @Put('household/permissions') setPermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.households.setPermissions(user, body);
  }

  @Post('household/leave') leave(@CurrentUser() user: AuthenticatedUser) {
    return this.households.leave(user);
  }

  @Delete('household/members/:id') removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.households.removeMember(user, id);
  }

  @Post('household/goals') createGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.households.createGoal(user, body);
  }

  @Patch('household/goals/:id') updateGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.households.updateGoal(user, id, body);
  }

  @Post('household/goals/:id/contributions') contribute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.households.contribute(user, id, body);
  }

  @Post('household/contributions/:id/confirm') confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.households.resolveContribution(user, id, 'CONFIRMED');
  }

  @Post('household/contributions/:id/reject') reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.households.resolveContribution(user, id, 'REJECTED');
  }

  @Post('household/contributions/:id/support')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async attachSupport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    const buffer = await readBody(request, MAX_DOCUMENT_BYTES);
    return this.households.attachSupport(
      user,
      id,
      uploadedFileName(request),
      buffer,
    );
  }

  @Get('household/contributions/:id/support') async supportFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const { document, content } = await this.households.supportFile(user, id);
    response
      .set({
        'Content-Type': document.mimeType,
        'Content-Length': String(content.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(content);
  }

  @Post('invitations/:token/accept')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.households.acceptInvitation(
      user,
      token,
      body,
      metadata(request),
    );
  }
}

/** Public: lets an invited person see who invites them before signing in. */
@Controller('luft/invitations')
export class InvitationController {
  constructor(private readonly households: HouseholdService) {}

  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preview(@Param('token') token: string) {
    return this.households.invitationPreview(token);
  }
}
