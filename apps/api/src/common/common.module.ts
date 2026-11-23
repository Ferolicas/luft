import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { LegalRateService } from '../startif/legal-rate.service';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService, AuditService, LegalRateService],
  exports: [CryptoService, AuditService, LegalRateService],
})
export class CommonModule {}
