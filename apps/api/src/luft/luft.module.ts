import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LuftController } from './luft.controller';
import { LuftService } from './luft.service';

@Module({
  imports: [AuthModule],
  controllers: [LuftController],
  providers: [LuftService],
  exports: [LuftService],
})
export class LuftModule {}
