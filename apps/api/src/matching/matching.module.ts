import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { PartnerService } from './partner.service';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import {
  AllyPortalController,
  InstitutionPortalController,
} from './portal.controller';
import { PresentationService } from './presentation.service';
import { LuftProfileSource, PROFILE_SOURCE } from './profile-source';
import { ReviewService } from './review.service';

/**
 * Policy engine, explainable matching, presentations to institutions and the
 * institution/ally portals. Relies on the global Database, Common and
 * Realtime modules already registered by `AppModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    MatchingController,
    PolicyController,
    InstitutionPortalController,
    AllyPortalController,
  ],
  providers: [
    { provide: PROFILE_SOURCE, useClass: LuftProfileSource },
    PolicyService,
    MatchingService,
    PresentationService,
    PartnerService,
    ReviewService,
  ],
  exports: [MatchingService, PolicyService, PROFILE_SOURCE],
})
export class MatchingModule {}
