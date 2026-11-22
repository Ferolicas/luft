import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OpenFinanceService } from './openfinance.service';

@Controller('luft/open-finance')
@UseGuards(AuthGuard)
export class OpenFinanceController {
  constructor(private readonly openFinance: OpenFinanceService) {}

  @Get() status(@CurrentUser() user: AuthenticatedUser) {
    return this.openFinance.status(user);
  }

  @Post('connections')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.openFinance.connect(user, body, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Post('connections/:id/revoke') revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.openFinance.revoke(user, id);
  }
}

/** Provider callback, authenticated only by its HMAC signature. */
@Controller('webhooks/open-finance')
export class OpenFinanceWebhookController {
  constructor(private readonly openFinance: OpenFinanceService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  webhook(
    @Headers('x-openfinance-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    return this.openFinance.webhook(signature, request.rawBody, body);
  }
}
