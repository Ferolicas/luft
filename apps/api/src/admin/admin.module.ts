import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StartifModule } from '../startif/startif.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, StartifModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
