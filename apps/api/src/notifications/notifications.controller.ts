import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@Controller('luft/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user);
  }

  @Post('read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.notifications.markRead(user, body);
  }
}
