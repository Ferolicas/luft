import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  OpenFinanceController,
  OpenFinanceWebhookController,
} from './openfinance.controller';
import { OpenFinanceService } from './openfinance.service';

@Module({
  imports: [AuthModule],
  controllers: [OpenFinanceController, OpenFinanceWebhookController],
  providers: [OpenFinanceService],
  exports: [OpenFinanceService],
})
export class OpenFinanceModule {}
