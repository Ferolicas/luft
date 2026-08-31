import { Global, Module } from '@nestjs/common';
import { IntegrationService } from './integration.service';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [IntegrationService, QueueService],
  exports: [IntegrationService, QueueService],
})
export class IntegrationsModule {}
