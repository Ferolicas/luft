import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FormalizationModule } from '../formalization/formalization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RouteModule } from '../route/route.module';
import { LuftController } from './luft.controller';
import { JourneyService } from './journey.service';
import { LuftService } from './luft.service';

@Module({
  imports: [AuthModule, RouteModule, FormalizationModule, NotificationsModule],
  controllers: [LuftController],
  providers: [LuftService, JourneyService],
  exports: [LuftService],
})
export class LuftModule {}
