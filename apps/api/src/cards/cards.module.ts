import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RouteModule } from '../route/route.module';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';

@Module({
  imports: [AuthModule, RouteModule],
  controllers: [CardsController],
  providers: [CardsService],
})
export class CardsModule {}
