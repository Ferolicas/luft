import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OpenFinanceModule } from '../openfinance/openfinance.module';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';

@Module({
  imports: [AuthModule, OpenFinanceModule],
  controllers: [ConsentsController],
  providers: [ConsentsService],
})
export class ConsentsModule {}
