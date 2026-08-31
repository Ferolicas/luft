import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { StartifService } from './startif.service';

@Controller('startif')
@UseGuards(AuthGuard)
export class StartifController {
  constructor(
    private readonly startif: StartifService,
    private readonly auth: AuthService,
  ) {}
  @Post('quote') quote(@Body() body: unknown) {
    return this.startif.quote(body);
  }
  @Post('consents') consent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.startif.acceptConsent(user, body, request);
  }
  @Post('applications') create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.startif.createApplication(user, body);
  }
  @Post('applications/:id/kyc') kyc(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.startif.startKyc(user, id);
  }
  @Post('applications/:id/signature-otp') signatureOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.startif.requestSignatureOtp(
      user,
      id,
      this.auth.issueOtp.bind(this.auth),
    );
  }
  @Post('applications/:id/sign') sign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.startif.signPromissoryNote(user, id, body, request);
  }
  @Get('credit') credit(@CurrentUser() user: AuthenticatedUser) {
    return this.startif.credit(user);
  }
  @Post('payments/pse') payment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.startif.createPsePayment(user, body);
  }
  @Post('pqr') pqr(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.startif.createPqr(user, body);
  }
  @Get('pqr') listPqr(@CurrentUser() user: AuthenticatedUser) {
    return this.startif.listPqr(user);
  }
}

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly startif: StartifService) {}
  @Post('mercadopago')
  mercadoPago(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Query('data.id') dataId?: string,
  ) {
    return this.startif.webhookMercadoPago(headers, body, dataId);
  }

  @Post('truora')
  truora(
    @Headers('x-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    return this.startif.webhookTruora(signature, request.rawBody, body);
  }
}
