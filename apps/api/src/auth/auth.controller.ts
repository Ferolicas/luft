import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import type { AuthenticatedUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: unknown, @Req() request: Request) {
    return this.auth.register(body, request);
  }

  @Post('verify-phone')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  verifyPhone(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    return this.auth.verifyPhone(body, response, request);
  }

  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    return this.auth.login(body, response, request);
  }

  @Post('password-reset/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  passwordResetRequest(@Body() body: unknown) {
    return this.auth.requestPasswordReset(body);
  }

  @Post('password-reset/verify')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  passwordResetVerify(@Body() body: unknown) {
    return this.auth.resetPassword(body);
  }

  @Post('logout')
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.logout(
      request.signedCookies?.[
        this.config.get('SESSION_COOKIE_NAME') ?? 'luft_session'
      ] as string | undefined,
      response,
    );
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }

  @Patch('password')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const token = request.signedCookies?.[
      this.config.get('SESSION_COOKIE_NAME') ?? 'luft_session'
    ] as string;
    return this.auth.changePassword(user, token, body, request);
  }

  @Delete('account')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  closeAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.closeAccount(user, body, request, response);
  }

  @Post('passkeys/registration-options')
  @UseGuards(AuthGuard)
  registrationOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.registrationOptions(user);
  }

  @Post('passkeys/registration-verification')
  @UseGuards(AuthGuard)
  registrationVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.auth.verifyPasskeyRegistration(user, body);
  }

  @Post('passkeys/authentication-options')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  authenticationOptions(@Body() body: unknown) {
    return this.auth.authenticationOptions(body);
  }

  @Post('passkeys/authentication-verification')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  authenticationVerification(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    return this.auth.verifyPasskeyAuthentication(body, response, request);
  }
}
