import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MatchingModule } from '../matching/matching.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Cohort/vintage analytics, intervention effectiveness and backtesting.
 * Reuses the policy engine and the profile source exported by MatchingModule.
 */
@Module({
  imports: [AuthModule, MatchingModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
