import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RouteService } from './route.service';

@Controller('luft')
@UseGuards(AuthGuard)
export class RouteController {
  constructor(private readonly routes: RouteService) {}

  @Get('route') route(@CurrentUser() user: AuthenticatedUser) {
    return this.routes.overview(user);
  }

  @Put('route/category') setCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.routes.setCategory(user, body);
  }

  @Get('route/archetypes') archetypeHistory(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routes.archetypeHistory(user);
  }

  @Post('routes') startRoute(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.routes.startRoute(user, body);
  }

  @Get('evidence') evidence(@CurrentUser() user: AuthenticatedUser) {
    return this.routes.evidenceList(user);
  }

  @Get('profile-snapshots') snapshots(@CurrentUser() user: AuthenticatedUser) {
    return this.routes.snapshots(user);
  }
}
