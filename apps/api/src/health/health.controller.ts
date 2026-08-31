import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { IntegrationService } from '../integrations/integration.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly integrations: IntegrationService,
  ) {}
  @Get() health() {
    return {
      status: 'ok',
      service: 'luft-api',
      version: process.env.npm_package_version ?? '0.1.0',
      time: new Date().toISOString(),
    };
  }
  @Get('ready')
  async ready() {
    await this.db.identity.$queryRaw`SELECT 1`;
    await this.db.startif.$queryRaw`SELECT 1`;
    return {
      status: 'ready',
      environment: this.config.get('NODE_ENV'),
      integrations: this.integrations.status(),
    };
  }
}
