import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { EvidenceService } from '../evidence/evidence.service';
import { ProfileFactsService } from './profile-facts.service';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [RouteController],
  providers: [ProfileFactsService, EvidenceService, RouteService],
  exports: [ProfileFactsService, EvidenceService, RouteService],
})
export class RouteModule {}
