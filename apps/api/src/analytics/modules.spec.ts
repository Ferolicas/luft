import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

jest.mock('../database/database.service', () => ({
  DatabaseService: class {},
}));

import { AuthService } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { MatchingController } from '../matching/matching.controller';
import { MatchingModule } from '../matching/matching.module';
import { MatchingService } from '../matching/matching.service';
import { PartnerService } from '../matching/partner.service';
import { PolicyController } from '../matching/policy.controller';
import { PolicyService } from '../matching/policy.service';
import {
  AllyPortalController,
  InstitutionPortalController,
} from '../matching/portal.controller';
import { PresentationService } from '../matching/presentation.service';
import { LuftProfileSource, PROFILE_SOURCE } from '../matching/profile-source';
import { ReviewService } from '../matching/review.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './analytics.service';

/**
 * Stand-in for the global modules `AppModule` registers (Config, Database,
 * Common, Realtime). The modules under test must resolve with nothing else.
 */
@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: { get: () => undefined } },
    { provide: DatabaseService, useValue: {} },
    { provide: CryptoService, useValue: {} },
    { provide: AuditService, useValue: { record: jest.fn() } },
    { provide: RealtimeService, useValue: { toUser: jest.fn() } },
  ],
  exports: [
    ConfigService,
    DatabaseService,
    CryptoService,
    AuditService,
    RealtimeService,
  ],
})
class GlobalsStubModule {}

const compile = (modules: Array<new () => unknown>) =>
  Test.createTestingModule({ imports: [GlobalsStubModule, ...modules] })
    .overrideProvider(AuthService)
    .useValue({ userFromSession: jest.fn() })
    .compile();

describe('module wiring', () => {
  it('MatchingModule resolves every provider and controller', async () => {
    const moduleRef = await compile([MatchingModule]);
    for (const token of [
      MatchingService,
      PolicyService,
      PresentationService,
      PartnerService,
      ReviewService,
      MatchingController,
      PolicyController,
      InstitutionPortalController,
      AllyPortalController,
    ])
      expect(moduleRef.get(token, { strict: false })).toBeInstanceOf(token);
    expect(moduleRef.get(PROFILE_SOURCE, { strict: false })).toBeInstanceOf(
      LuftProfileSource,
    );
    await moduleRef.close();
  });

  it('AnalyticsModule resolves with the engine exported by MatchingModule', async () => {
    const moduleRef = await compile([AnalyticsModule]);
    expect(moduleRef.get(AnalyticsService, { strict: false })).toBeInstanceOf(
      AnalyticsService,
    );
    expect(
      moduleRef.get(AnalyticsController, { strict: false }),
    ).toBeInstanceOf(AnalyticsController);
    // Analytics reuses the same profile source: one extension point for both.
    expect(moduleRef.get(PROFILE_SOURCE, { strict: false })).toBeInstanceOf(
      LuftProfileSource,
    );
    await moduleRef.close();
  });

  it('lets the integrator replace the profile source', async () => {
    const custom = { signals: jest.fn(), segments: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalsStubModule, AnalyticsModule],
    })
      .overrideProvider(AuthService)
      .useValue({ userFromSession: jest.fn() })
      .overrideProvider(PROFILE_SOURCE)
      .useValue(custom)
      .compile();
    expect(moduleRef.get(PROFILE_SOURCE, { strict: false })).toBe(custom);
    await moduleRef.close();
  });
});
