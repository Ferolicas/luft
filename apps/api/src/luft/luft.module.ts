import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LuftController } from './luft.controller';
import { JourneyService } from './journey.service';
import { LuftService } from './luft.service';

@Module({
  imports: [AuthModule],
  controllers: [LuftController],
  providers: [LuftService, JourneyService],
  exports: [LuftService],
})
export class LuftModule {}
