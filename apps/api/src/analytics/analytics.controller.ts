import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ANALYTICS_STAFF } from '../matching/roles';
import { AnalyticsService } from './analytics.service';

/** Cohorts, effectiveness and backtesting. Staff: RISK, FINANCE, SUPERADMIN. */
@Controller('admin/analytics')
@UseGuards(AuthGuard)
@Roles(...ANALYTICS_STAFF)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('cohorts') cohorts(
    @Query('groupBy') groupBy?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.analytics.cohorts({ groupBy, from, to, asOf });
  }
  @Get('cohorts/snapshots') cohortSnapshots(
    @Query('page') page?: string,
    @Query('groupBy') groupBy?: string,
    @Query('originationMonth') originationMonth?: string,
  ) {
    return this.analytics.cohortSnapshots({ page, groupBy, originationMonth });
  }
  @Post('cohorts/snapshots') saveCohortSnapshot(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.analytics.saveCohortSnapshot(actor, body);
  }
  @Get('effectiveness') effectiveness(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.effectiveness({ from, to });
  }
  @Get('backtests') backtests(@Query('page') page?: string) {
    return this.analytics.backtests(page);
  }
  @Post('backtests')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  createBacktest(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.analytics.createBacktest(actor, body);
  }
  @Get('backtests/:id') backtest(@Param('id') id: string) {
    return this.analytics.backtest(id);
  }
}
