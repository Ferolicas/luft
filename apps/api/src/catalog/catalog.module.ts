import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  CatalogAdminController,
  CatalogController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
