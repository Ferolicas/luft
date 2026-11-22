import { Module } from '@nestjs/common';
import { DocumentVaultService } from './document-vault.service';

@Module({
  providers: [DocumentVaultService],
  exports: [DocumentVaultService],
})
export class VaultModule {}
