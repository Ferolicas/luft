import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StartifController, WebhookController } from './startif.controller';
import { StartifService } from './startif.service';

@Module({
  imports: [AuthModule],
  controllers: [StartifController, WebhookController],
  providers: [StartifService],
  exports: [StartifService],
})
export class StartifModule {}
