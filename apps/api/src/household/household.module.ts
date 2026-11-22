import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RouteModule } from '../route/route.module';
import { VaultModule } from '../vault/vault.module';
import {
  HouseholdController,
  InvitationController,
} from './household.controller';
import { HouseholdService } from './household.service';

@Module({
  imports: [AuthModule, CatalogModule, RouteModule, VaultModule],
  controllers: [HouseholdController, InvitationController],
  providers: [HouseholdService],
  exports: [HouseholdService],
})
export class HouseholdModule {}
