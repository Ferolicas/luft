import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as AuditClient } from '../generated/audit/client';
import { PrismaClient as IdentityClient } from '../generated/identity/client';
import { PrismaClient as LuftClient } from '../generated/luft/client';
import { PrismaClient as ScoringClient } from '../generated/scoring/client';
import { PrismaClient as StartifClient } from '../generated/startif/client';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly identity: IdentityClient;
  readonly luft: LuftClient;
  readonly startif: StartifClient;
  readonly audit: AuditClient;
  readonly scoring: ScoringClient;

  constructor(config: ConfigService) {
    const pool = (url: string) => ({
      connectionString: url,
      max: Number(config.get('DATABASE_POOL_MAX') ?? 3),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    this.identity = new IdentityClient({
      adapter: new PrismaPg(pool(config.getOrThrow('IDENTITY_DATABASE_URL')), {
        schema: 'identity',
      }),
    });
    this.luft = new LuftClient({
      adapter: new PrismaPg(pool(config.getOrThrow('LUFT_DATABASE_URL')), {
        schema: 'luft',
      }),
    });
    this.startif = new StartifClient({
      adapter: new PrismaPg(pool(config.getOrThrow('STARTIF_DATABASE_URL')), {
        schema: 'startif',
      }),
    });
    this.audit = new AuditClient({
      adapter: new PrismaPg(pool(config.getOrThrow('AUDIT_DATABASE_URL')), {
        schema: 'audit',
      }),
    });
    this.scoring = new ScoringClient({
      adapter: new PrismaPg(pool(config.getOrThrow('SCORING_DATABASE_URL')), {
        schema: 'scoring',
      }),
    });
  }

  async onModuleInit() {
    await Promise.all([
      this.identity.$connect(),
      this.luft.$connect(),
      this.startif.$connect(),
      this.audit.$connect(),
      this.scoring.$connect(),
    ]);
  }

  async onModuleDestroy() {
    await Promise.all([
      this.identity.$disconnect(),
      this.luft.$disconnect(),
      this.startif.$disconnect(),
      this.audit.$disconnect(),
      this.scoring.$disconnect(),
    ]);
  }
}
