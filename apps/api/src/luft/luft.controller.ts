import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LuftService } from './luft.service';

@Controller('luft')
@UseGuards(AuthGuard)
export class LuftController {
  constructor(private readonly luft: LuftService) {}
  @Get('dashboard') dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.luft.dashboard(user);
  }
  @Get('push/config') pushConfig() {
    return this.luft.pushConfig();
  }
  @Post('consents') consent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.luft.acceptConsent(user, body, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
  @Post('score/initial') initialScore(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.requestInitialScore(user, body);
  }
  @Post('questionnaire') questionnaire(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.questionnaire(user, body);
  }
  @Post('goals') createGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.createGoal(user, body);
  }
  @Patch('goals/:id') updateGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.luft.updateGoal(user, id, body);
  }
  @Post('learning/complete') completeLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.completeLesson(user, body);
  }
  @Post('push/subscribe')
  subscribePush(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.luft.subscribePush(user, body, request.get('user-agent'));
  }
}
