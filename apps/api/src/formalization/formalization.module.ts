import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RouteModule } from '../route/route.module';
import { VaultModule } from '../vault/vault.module';
import {
  FormalizationAdminController,
  FormalizationController,
} from './formalization.controller';
import { FormalizationService } from './formalization.service';

@Module({
  imports: [AuthModule, RouteModule, VaultModule],
  controllers: [FormalizationController, FormalizationAdminController],
  providers: [FormalizationService],
  exports: [FormalizationService],
})
export class FormalizationModule {}
