import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreditProductService } from './credit-product.service';
import { StartifController, WebhookController } from './startif.controller';
import { StartifService } from './startif.service';

@Module({
  imports: [AuthModule],
  controllers: [StartifController, WebhookController],
  providers: [StartifService, CreditProductService],
  exports: [StartifService, CreditProductService],
})
export class StartifModule {}
