import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Role } from '../generated/identity/enums';
import { PresentationService } from './presentation.service';

/**
 * Portal of a financial institution. Role INSTITUTION plus an active link to
 * one entity; every query is scoped to that entity inside the service.
 */
@Controller('institution')
@UseGuards(AuthGuard)
@Roles(Role.INSTITUTION)
export class InstitutionPortalController {
  constructor(private readonly presentations: PresentationService) {}

  @Get('me') me(@CurrentUser() user: AuthenticatedUser) {
    return this.presentations.institutionHome(user);
  }
  @Get('presentations') list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    return this.presentations.institutionList(user, { page, status });
  }
  @Get('presentations/:id') detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.presentations.institutionDetail(user, id);
  }
  @Post('presentations/:id/decision') decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.presentations.institutionDecide(user, id, body);
  }
}

/** Portal of an ally: aggregated funnel of its referrals, no personal data. */
@Controller('ally')
@UseGuards(AuthGuard)
@Roles(Role.ALLY)
export class AllyPortalController {
  constructor(private readonly presentations: PresentationService) {}

  @Get('me') me(@CurrentUser() user: AuthenticatedUser) {
    return this.presentations.allyHome(user);
  }
  @Get('funnel') funnel(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.presentations.allyFunnel(user, { from, to });
  }
}
