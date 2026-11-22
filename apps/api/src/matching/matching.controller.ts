import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MatchingService } from './matching.service';
import { MATCHING_USERS } from './roles';

const meta = (request: Request) => ({
  ip: request.ip,
  userAgent: request.get('user-agent'),
});

/** Matching for the person. Partner accounts (ALLY, INSTITUTION) have no access. */
@Controller('matching')
@UseGuards(AuthGuard)
@Roles(...MATCHING_USERS)
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get() latest(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.latest(user);
  }
  @Get('readiness') readiness(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.readiness(user);
  }
  @Get('profile') profile(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.declaredProfile(user);
  }
  @Put('profile') saveProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.matching.saveDeclaredProfile(user, body);
  }
  @Post('run')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.matching.run(user, body, meta(request));
  }
  @Get('history') history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
  ) {
    return this.matching.history(user, page);
  }
  @Get('runs/:id') runDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.matching.runDetail(user, id);
  }
  @Get('presentations') presentations(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.presentations(user);
  }
  @Get('results/:id/authorization') authorizationPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.matching.authorizationPreview(user, id);
  }
  @Post('results/:id/authorize')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.matching.authorize(user, id, body, meta(request));
  }
  @Post('results/:id/revoke') revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.matching.revoke(user, id, meta(request));
  }
}
