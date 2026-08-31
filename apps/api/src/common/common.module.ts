import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService, AuditService],
  exports: [CryptoService, AuditService],
})
export class CommonModule {}
