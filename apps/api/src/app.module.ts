import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CardsModule } from './cards/cards.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommonModule } from './common/common.module';
import { validateEnvironment } from './config/environment';
import { ConsentsModule } from './consents/consents.module';
import { DatabaseModule } from './database/database.module';
import { FormalizationModule } from './formalization/formalization.module';
import { HealthModule } from './health/health.module';
import { HouseholdModule } from './household/household.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { LuftModule } from './luft/luft.module';
import { MatchingModule } from './matching/matching.module';
import { ZodExceptionFilter } from './luft/zod-exception.filter';
import { NotificationsModule } from './notifications/notifications.module';
import { OpenFinanceModule } from './openfinance/openfinance.module';
import { ProjectsModule } from './projects/projects.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RouteModule } from './route/route.module';
import { StartifModule } from './startif/startif.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    CommonModule,
    IntegrationsModule,
    RealtimeModule,
    AuthModule,
    LuftModule,
    CatalogModule,
    RouteModule,
    FormalizationModule,
    HouseholdModule,
    CardsModule,
    ProjectsModule,
    OpenFinanceModule,
    ConsentsModule,
    NotificationsModule,
    StartifModule,
    AdminModule,
    MatchingModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
export class AppModule {}
