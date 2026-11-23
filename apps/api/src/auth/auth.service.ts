import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import * as argon2 from 'argon2';
import { addDays, addMinutes, addYears } from 'date-fns';
import type { Request, Response } from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { UserStatus } from '../generated/identity/enums';
import { IntegrationService } from '../integrations/integration.service';
import { maskEmail } from '../integrations/otp-email';
import {
  closeLuftAccountData,
  purgeLuftAccountData,
} from '../luft/account-data';
import { eraseMatchingAccountData } from '../matching/account-data';
import type { AuthenticatedUser } from './auth.types';

const registrationSchema = z.object({
  fullName: z.string().trim().min(3).max(160),
  document: z.preprocess(
    (value) => String(value ?? '').replace(/\D/g, ''),
    z.string().min(6).max(12),
  ),
  documentIssuedAt: z.coerce.date().max(new Date()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?57\d{10}$/),
  email: z.string().trim().toLowerCase().email().max(254),
  address: z.string().trim().min(8).max(300),
  stratum: z.coerce.number().int().min(1).max(6),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{4,40}$/),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/\d/),
  consentAccepted: z.literal(true),
  consentVersion: z.literal('2026-09-01-restaurar'),
  inviteCode: z.string().trim().max(200).optional(),
});

type OtpPurposeName =
  | 'PHONE_VERIFICATION'
  | 'LOGIN'
  | 'SIGNATURE'
  | 'PASSWORD_RESET'
  | 'EMAIL_VERIFICATION';

const otpInputSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

/** Códigos que una cuenta puede pedir por motivo: 3 en 10 minutos, 10 al día. */
const OTP_BURST = { minutes: 10, max: 3 };
const OTP_DAILY = { minutes: 24 * 60, max: 10 };

/** Versión de los Términos y Condiciones publicados en /legal/terminos. */
export const TERMS_VERSION = '2026-11-23';

const CONSENT_TEXT =
  'Autorizo a Tureporte S.A.S., propietaria de RESTAURAR y responsable de LUFT, el tratamiento de mis datos personales para crear mi cuenta, verificar mi identidad, personalizar mi educación financiera y gestionar mis solicitudes, conforme a la política publicada en https://restaurar.co/privacy. Las consultas y reportes ante operadores de información financiera requieren autorizaciones separadas y expresas.';

@Injectable()
export class AuthService {
  private readonly cookieName: string;
  private readonly sessionDays: number;
  private readonly financialRetentionYears: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly config: ConfigService,
  ) {
    this.cookieName = config.get('SESSION_COOKIE_NAME') ?? 'luft_session';
    this.sessionDays = Number(config.get('SESSION_TTL_DAYS') ?? 30);
    this.financialRetentionYears = Number(
      config.get('FINANCIAL_RECORD_RETENTION_YEARS') ?? 10,
    );
  }

  registrationSettings() {
    return {
      mode:
        this.config.get<'closed' | 'invite' | 'public'>('REGISTRATION_MODE') ??
        'closed',
      legalPolicyUrl: 'https://restaurar.co/privacy',
    };
  }

  async register(body: unknown, request: Request) {
    if (this.config.get('LEGAL_DOCUMENTS_READY') !== 'true')
      throw new ServiceUnavailableException({
        code: 'legal_configuration_required',
        message: 'La política de tratamiento de datos no está configurada.',
      });
    const input = registrationSchema.parse(body);
    const registrationMode =
      this.config.get<'closed' | 'invite' | 'public'>('REGISTRATION_MODE') ??
      'closed';
    if (registrationMode === 'closed')
      throw new ServiceUnavailableException({
        code: 'registration_closed',
        message: 'El registro no está habilitado en este momento.',
      });
    if (registrationMode === 'public' && !this.integrations.status().sms)
      throw new ServiceUnavailableException({
        code: 'configuration_required',
        provider: 'SMS',
        message:
          'El registro público requiere que el proveedor SMS esté configurado.',
      });
    if (registrationMode === 'invite') {
      const configuredCode =
        this.config.get<string>('REGISTRATION_INVITE_CODE') ?? '';
      const submittedHash = this.crypto.hash(
        `registration-invite:${input.inviteCode ?? ''}`,
      );
      const configuredHash = this.crypto.hash(
        `registration-invite:${configuredCode}`,
      );
      if (!this.crypto.equals(submittedHash, configuredHash))
        throw new UnauthorizedException({
          code: 'invalid_registration_invite',
          message: 'El código de acceso para las pruebas no es válido.',
        });
    }
    const existing = await this.db.identity.user.findFirst({
      where: {
        OR: [
          { email: input.email },
          { username: input.username },
          { phone: input.phone },
          { documentHash: this.crypto.hash(input.document) },
        ],
      },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('Ya existe una cuenta con esos datos.');
    const user = await this.db.identity.user.create({
      data: {
        email: input.email,
        username: input.username,
        phone: input.phone,
        fullName: input.fullName,
        documentHash: this.crypto.hash(input.document),
        documentCiphertext: this.crypto.encrypt(input.document),
        addressCiphertext: this.crypto.encrypt(input.address),
        documentIssuedAtCiphertext: this.crypto.encrypt(
          input.documentIssuedAt.toISOString().slice(0, 10),
        ),
        stratum: input.stratum,
        passwordHash: await argon2.hash(input.password, {
          type: argon2.argon2id,
          memoryCost: 65_536,
          timeCost: 3,
          parallelism: 1,
        }),
      },
    });
    await this.db.luft.consent.create({
      data: {
        userId: user.id,
        kind: 'DATA_PROCESSING',
        version: input.consentVersion,
        textSnapshot: CONSENT_TEXT,
        textHash: this.crypto.hash(CONSENT_TEXT),
        ipHash: request.ip ? this.crypto.hash(request.ip) : undefined,
        userAgent: request.get('user-agent')?.slice(0, 500),
      },
    });
    const verification = await this.issueOtp(
      user.id,
      user.phone,
      'PHONE_VERIFICATION',
      registrationMode === 'invite',
    );
    await this.audit.record({
      actorUserId: user.id,
      action: 'identity.user.registered',
      resource: 'User',
      resourceId: user.id,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      payload: {
        consentVersion: input.consentVersion,
        termsVersion: TERMS_VERSION,
        stratum: input.stratum,
      },
    });
    return { userId: user.id, next: 'verify_phone', verification };
  }

  /**
   * Emite un código de un solo uso. El SMS se usa únicamente para validar el
   * celular en el registro; los demás motivos viajan al correo de la cuenta.
   */
  async issueOtp(
    userId: string,
    destination: string,
    purpose: OtpPurposeName,
    revealWhenProviderIsMissing = false,
  ) {
    await this.assertOtpQuota(userId, purpose);
    const code = randomInt(100_000, 1_000_000).toString();
    const id = randomUUID();
    const challenge = await this.db.identity.otpChallenge.create({
      data: {
        id,
        userId,
        destination,
        purpose,
        codeHash: this.crypto.hash(`otp:${id}:${code}`),
        expiresAt: addMinutes(new Date(), 10),
      },
    });
    const delivery =
      purpose === 'PHONE_VERIFICATION'
        ? await this.integrations.sendOtp(destination, code)
        : await this.integrations.sendOtpEmail(destination, code, purpose);
    return {
      challengeId: challenge.id,
      delivery: delivery.status,
      expiresAt: challenge.expiresAt,
      ...(revealWhenProviderIsMissing &&
      delivery.status === 'configuration_required'
        ? { testCode: code }
        : {}),
    };
  }

  private async assertOtpQuota(userId: string, purpose: OtpPurposeName) {
    const since = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const [burst, daily] = await Promise.all([
      this.db.identity.otpChallenge.count({
        where: {
          userId,
          purpose,
          createdAt: { gt: since(OTP_BURST.minutes) },
        },
      }),
      this.db.identity.otpChallenge.count({
        where: {
          userId,
          purpose,
          createdAt: { gt: since(OTP_DAILY.minutes) },
        },
      }),
    ]);
    if (burst >= OTP_BURST.max || daily >= OTP_DAILY.max)
      throw new HttpException(
        {
          code: 'otp_rate_limited',
          message:
            'Pediste varios códigos seguidos. Espera unos minutos antes de solicitar otro.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  /** Valida un código y lo deja usado. Falla igual si no existe, venció o no coincide. */
  private async takeChallenge(
    input: { challengeId: string; code: string },
    purpose: OtpPurposeName,
    userId?: string,
  ) {
    const challenge = await this.db.identity.otpChallenge.findFirst({
      where: {
        id: input.challengeId,
        purpose,
        ...(userId ? { userId } : {}),
        verifiedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
    });
    const valid =
      challenge &&
      this.crypto.equals(
        challenge.codeHash,
        this.crypto.hash(`otp:${challenge.id}:${input.code}`),
      );
    if (!challenge?.userId || !valid) {
      if (challenge)
        await this.db.identity.otpChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
      throw new BadRequestException('Código inválido o vencido.');
    }
    // Un mismo código no abre dos sesiones aunque lleguen dos peticiones a la vez.
    const used = await this.db.identity.otpChallenge.updateMany({
      where: { id: challenge.id, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    if (used.count !== 1)
      throw new BadRequestException('Código inválido o vencido.');
    return { id: challenge.id, userId: challenge.userId };
  }

  private registrationMode() {
    return (
      this.config.get<'closed' | 'invite' | 'public'>('REGISTRATION_MODE') ??
      'closed'
    );
  }

  /** Código nuevo para quien todavía no validó su celular. */
  async resendPhoneVerification(body: unknown) {
    const { challengeId } = z
      .object({ challengeId: z.string().uuid() })
      .parse(body);
    const challenge = await this.db.identity.otpChallenge.findUnique({
      where: { id: challengeId },
      include: { user: true },
    });
    if (
      !challenge?.user ||
      challenge.purpose !== 'PHONE_VERIFICATION' ||
      challenge.user.status !== UserStatus.PENDING_VERIFICATION
    )
      throw new BadRequestException(
        'Inicia sesión con tu usuario y contraseña para recibir un código nuevo.',
      );
    return {
      verification: await this.issueOtp(
        challenge.user.id,
        challenge.user.phone,
        'PHONE_VERIFICATION',
        this.registrationMode() === 'invite',
      ),
    };
  }

  async verifyPhone(body: unknown, response: Response, request: Request) {
    const input = z
      .object({
        challengeId: z.string().min(10),
        code: z.string().regex(/^\d{6}$/),
      })
      .parse(body);
    const challenge = await this.db.identity.otpChallenge.findUnique({
      where: { id: input.challengeId },
      include: { user: true },
    });
    if (
      !challenge?.user ||
      challenge.purpose !== 'PHONE_VERIFICATION' ||
      challenge.verifiedAt ||
      challenge.expiresAt < new Date() ||
      challenge.attempts >= 5
    )
      throw new BadRequestException('Código inválido o vencido.');
    const valid = this.crypto.equals(
      challenge.codeHash,
      this.crypto.hash(`otp:${challenge.id}:${input.code}`),
    );
    if (!valid) {
      await this.db.identity.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Código inválido o vencido.');
    }
    await this.db.identity.$transaction([
      this.db.identity.otpChallenge.update({
        where: { id: challenge.id },
        data: { verifiedAt: new Date() },
      }),
      this.db.identity.user.update({
        where: { id: challenge.user.id },
        data: { status: UserStatus.ACTIVE, phoneVerifiedAt: new Date() },
      }),
    ]);
    const safeUser = this.toAuthenticated({
      ...challenge.user,
      status: UserStatus.ACTIVE,
    });
    await this.createSession(safeUser, response, request);
    await this.audit.record({
      actorUserId: safeUser.id,
      action: 'identity.phone.verified',
      resource: 'User',
      resourceId: safeUser.id,
      ip: request.ip,
    });
    return { user: safeUser };
  }

  async login(body: unknown, response: Response, request: Request) {
    const input = z
      .object({
        identifier: z.string().trim().min(3).max(254),
        password: z.string().min(1).max(128),
      })
      .parse(body);
    const identifier = input.identifier.toLowerCase();
    const user = await this.db.identity.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    if (!user || !(await argon2.verify(user.passwordHash, input.password)))
      throw new UnauthorizedException('Credenciales incorrectas.');
    if (user.status === UserStatus.PENDING_VERIFICATION)
      // Quien no terminó de validar su celular recibe un código nuevo por SMS.
      return {
        next: 'verify_phone' as const,
        verification: await this.issueOtp(
          user.id,
          user.phone,
          'PHONE_VERIFICATION',
          this.registrationMode() === 'invite',
        ),
      };
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException({
        code: 'account_not_active',
        status: user.status,
      });
    if (user.twoFactorEnabled) {
      const verification = await this.issueOtp(user.id, user.email, 'LOGIN');
      if (verification.delivery !== 'ready') throw this.emailUnavailable();
      return {
        next: 'two_factor' as const,
        challengeId: verification.challengeId,
        expiresAt: verification.expiresAt,
        destination: maskEmail(user.email),
      };
    }
    return this.openSession(user, response, request, false);
  }

  /** Segundo paso del inicio de sesión: el código que llegó al correo. */
  async verifyLogin(body: unknown, response: Response, request: Request) {
    const challenge = await this.takeChallenge(
      otpInputSchema.parse(body),
      'LOGIN',
    );
    const user = await this.db.identity.user.findUnique({
      where: { id: challenge.userId },
    });
    if (!user || user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('Credenciales incorrectas.');
    return this.openSession(user, response, request, true);
  }

  private emailUnavailable() {
    return new ServiceUnavailableException({
      code: 'configuration_required',
      provider: 'EMAIL',
      message:
        'No pudimos enviar el código a tu correo. Intenta de nuevo en unos minutos.',
    });
  }

  private async openSession(
    user: Parameters<AuthService['toAuthenticated']>[0] & {
      emailVerifiedAt?: Date | null;
    },
    response: Response,
    request: Request,
    twoFactor: boolean,
  ) {
    await this.db.identity.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        // Recibir el código demuestra que el correo es de la persona.
        ...(twoFactor && !user.emailVerifiedAt
          ? { emailVerifiedAt: new Date() }
          : {}),
      },
    });
    const safeUser = this.toAuthenticated(user);
    await this.createSession(safeUser, response, request);
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'identity.session.created',
      resource: 'Session',
      ip: request.ip,
      userAgent: request.get('user-agent'),
      ...(twoFactor ? { payload: { twoFactor: true } } : {}),
    });
    return { user: safeUser };
  }

  async twoFactorStatus(user: AuthenticatedUser) {
    const account = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { twoFactorEnabled: true, email: true },
    });
    return {
      enabled: account.twoFactorEnabled,
      destination: maskEmail(account.email),
      available: this.integrations.status().email,
    };
  }

  /** Antes de activar los dos pasos se comprueba que el correo sí recibe códigos. */
  async requestTwoFactor(user: AuthenticatedUser) {
    const account = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true },
    });
    const verification = await this.issueOtp(
      user.id,
      account.email,
      'EMAIL_VERIFICATION',
    );
    if (verification.delivery !== 'ready') throw this.emailUnavailable();
    return {
      challengeId: verification.challengeId,
      expiresAt: verification.expiresAt,
      destination: maskEmail(account.email),
    };
  }

  async enableTwoFactor(
    user: AuthenticatedUser,
    body: unknown,
    request: Request,
  ) {
    await this.takeChallenge(
      otpInputSchema.parse(body),
      'EMAIL_VERIFICATION',
      user.id,
    );
    await this.db.identity.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, emailVerifiedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'identity.two_factor.enabled',
      resource: 'User',
      resourceId: user.id,
      ip: request.ip,
    });
    return { enabled: true };
  }

  async disableTwoFactor(
    user: AuthenticatedUser,
    body: unknown,
    request: Request,
  ) {
    const { password } = z
      .object({ password: z.string().min(1).max(128) })
      .parse(body);
    const account = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    if (!(await argon2.verify(account.passwordHash, password)))
      throw new UnauthorizedException('La contraseña no es correcta.');
    await this.db.identity.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'identity.two_factor.disabled',
      resource: 'User',
      resourceId: user.id,
      ip: request.ip,
    });
    return { enabled: false };
  }

  async requestPasswordReset(body: unknown) {
    const { identifier } = z
      .object({ identifier: z.string().trim().toLowerCase().min(3).max(254) })
      .parse(body);
    const user = await this.db.identity.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    if (!user)
      return {
        challengeId: randomUUID(),
        delivery: 'accepted',
        expiresInMinutes: 10,
      };
    const result = await this.issueOtp(
      user.id,
      user.email,
      'PASSWORD_RESET',
    ).catch((error: unknown) => {
      // El tope de códigos no debe revelar si la cuenta existe.
      if (
        error instanceof HttpException &&
        error.getStatus() === Number(HttpStatus.TOO_MANY_REQUESTS)
      )
        return {
          challengeId: randomUUID(),
          delivery: 'ready' as const,
          expiresAt: addMinutes(new Date(), 10),
        };
      throw error;
    });
    return {
      ...result,
      delivery:
        result.delivery === 'configuration_required'
          ? 'configuration_required'
          : 'accepted',
      expiresInMinutes: 10,
    };
  }

  async resetPassword(body: unknown) {
    const input = z
      .object({
        challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/),
        password: z
          .string()
          .min(12)
          .max(128)
          .regex(/[A-Z]/)
          .regex(/[a-z]/)
          .regex(/\d/),
      })
      .parse(body);
    const challenge = await this.db.identity.otpChallenge.findFirst({
      where: {
        id: input.challengeId,
        purpose: 'PASSWORD_RESET',
        verifiedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
    });
    const valid =
      challenge &&
      this.crypto.equals(
        challenge.codeHash,
        this.crypto.hash(`otp:${challenge.id}:${input.code}`),
      );
    if (!challenge?.userId || !valid) {
      if (challenge)
        await this.db.identity.otpChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
      throw new BadRequestException('Código inválido o vencido.');
    }
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
    await this.db.identity.$transaction([
      this.db.identity.otpChallenge.update({
        where: { id: challenge.id },
        data: { verifiedAt: new Date() },
      }),
      this.db.identity.user.update({
        where: { id: challenge.userId },
        data: { passwordHash },
      }),
      this.db.identity.session.updateMany({
        where: { userId: challenge.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorUserId: challenge.userId,
      action: 'identity.password.reset',
      resource: 'User',
      resourceId: challenge.userId,
    });
    return { ok: true };
  }

  async logout(token: string | undefined, response: Response) {
    if (token)
      await this.db.identity.session.updateMany({
        where: { tokenHash: this.crypto.hash(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    response.clearCookie(this.cookieName, { path: '/' });
    return { ok: true };
  }

  async changePassword(
    user: AuthenticatedUser,
    currentToken: string,
    body: unknown,
    request: Request,
  ) {
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z
          .string()
          .min(12)
          .max(128)
          .regex(/[A-Z]/)
          .regex(/[a-z]/)
          .regex(/\d/),
      })
      .parse(body);
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    if (!(await argon2.verify(identity.passwordHash, input.currentPassword)))
      throw new UnauthorizedException('La contraseña actual no es correcta.');
    if (await argon2.verify(identity.passwordHash, input.newPassword))
      throw new BadRequestException('La nueva contraseña debe ser diferente.');
    const passwordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
    await this.db.identity.$transaction([
      this.db.identity.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.db.identity.session.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          tokenHash: { not: this.crypto.hash(currentToken) },
        },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'identity.password.changed',
      resource: 'User',
      resourceId: user.id,
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
    return { ok: true };
  }

  async closeAccount(
    user: AuthenticatedUser,
    body: unknown,
    request: Request,
    response: Response,
  ) {
    if (user.role !== 'USER')
      throw new BadRequestException(
        'Las cuentas operativas deben ser transferidas y cerradas por otra superadministración.',
      );
    const input = z
      .object({
        password: z.string().min(1).max(128),
        confirmation: z.literal('ELIMINAR MI CUENTA'),
      })
      .parse(body);
    const identity = await this.db.identity.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    if (!(await argon2.verify(identity.passwordHash, input.password)))
      throw new UnauthorizedException('La contraseña no es correcta.');

    const [applications, loans, payments, reports] = await Promise.all([
      this.db.startif.creditApplication.count({ where: { userId: user.id } }),
      this.db.startif.loan.count({ where: { userId: user.id } }),
      this.db.startif.payment.count({ where: { userId: user.id } }),
      this.db.startif.tradelineReport.count({ where: { userId: user.id } }),
    ]);
    const hasFinancialRecord = applications + loans + payments + reports > 0;
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'identity.account.closure_requested',
      resource: 'User',
      resourceId: user.id,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      payload: { retainedForFinancialRecord: hasFinancialRecord },
    });

    if (hasFinancialRecord) {
      const now = new Date();
      const retentionUntil = addYears(now, this.financialRetentionYears);
      await this.db.identity.$transaction([
        this.db.identity.user.update({
          where: { id: user.id },
          data: {
            status: 'CLOSED',
            closureRequestedAt: now,
            retentionUntil,
          },
        }),
        this.db.identity.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
      await closeLuftAccountData(this.db, user.id);
      await eraseMatchingAccountData(this.db, user.id);
      response.clearCookie(this.cookieName, { path: '/' });
      return {
        ok: true,
        deleted: false,
        retainedUntil: retentionUntil,
        reason: 'FINANCIAL_RECORD_RETENTION',
      };
    }

    await this.db.startif.$transaction([
      this.db.startif.pqr.deleteMany({ where: { userId: user.id } }),
      this.db.startif.startifConsent.deleteMany({ where: { userId: user.id } }),
    ]);
    await purgeLuftAccountData(this.db, user.id);
    await eraseMatchingAccountData(this.db, user.id);
    await this.db.luft.$transaction([
      this.db.luft.opportunity.deleteMany({ where: { userId: user.id } }),
      this.db.luft.scoreInquiry.deleteMany({ where: { userId: user.id } }),
      this.db.luft.streak.deleteMany({ where: { userId: user.id } }),
      this.db.luft.lessonProgress.deleteMany({ where: { userId: user.id } }),
      this.db.luft.goal.deleteMany({ where: { userId: user.id } }),
      this.db.luft.archetypeResult.deleteMany({ where: { userId: user.id } }),
      this.db.luft.questionnaireResponse.deleteMany({
        where: { userId: user.id },
      }),
      this.db.luft.financialProfile.deleteMany({ where: { userId: user.id } }),
      this.db.luft.consent.deleteMany({ where: { userId: user.id } }),
    ]);
    const storage = this.config.get<string>('PRIVATE_STORAGE_PATH');
    if (storage)
      await rm(join(storage, 'documents', user.id), {
        recursive: true,
        force: true,
      });
    await this.db.identity.user.delete({ where: { id: user.id } });
    response.clearCookie(this.cookieName, { path: '/' });
    return { ok: true, deleted: true };
  }

  async userFromSession(token: string): Promise<AuthenticatedUser | null> {
    const session = await this.db.identity.session.findUnique({
      where: { tokenHash: this.crypto.hash(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.user.status !== UserStatus.ACTIVE
    )
      return null;
    if (Date.now() - session.lastSeenAt.getTime() > 300_000)
      void this.db.identity.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    return this.toAuthenticated(session.user);
  }

  async registrationOptions(user: AuthenticatedUser) {
    const passkeys = await this.db.identity.passkey.findMany({
      where: { userId: user.id },
    });
    const options = await generateRegistrationOptions({
      rpName: this.config.getOrThrow('WEBAUTHN_RP_NAME'),
      rpID: this.config.getOrThrow('WEBAUTHN_RP_ID'),
      userName: user.email,
      userID: Buffer.from(user.id),
      userDisplayName: user.fullName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      excludeCredentials: passkeys.map((passkey) => ({
        id: passkey.credentialId,
        transports:
          (passkey.transports as AuthenticatorTransportFuture[] | null) ??
          undefined,
      })),
    });
    const challenge = await this.db.identity.webauthnChallenge.create({
      data: {
        userId: user.id,
        challenge: options.challenge,
        purpose: 'register',
        expiresAt: addMinutes(new Date(), 5),
      },
    });
    return { challengeId: challenge.id, options };
  }

  async verifyPasskeyRegistration(user: AuthenticatedUser, body: unknown) {
    const input = z
      .object({ challengeId: z.string().uuid(), response: z.any() })
      .parse(body) as {
      challengeId: string;
      response: RegistrationResponseJSON;
    };
    const challenge = await this.db.identity.webauthnChallenge.findFirst({
      where: {
        id: input.challengeId,
        userId: user.id,
        purpose: 'register',
        expiresAt: { gt: new Date() },
      },
    });
    if (!challenge)
      throw new BadRequestException('Ceremonia de registro vencida.');
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.config.getOrThrow('WEBAUTHN_ORIGIN'),
      expectedRPID: this.config.getOrThrow('WEBAUTHN_RP_ID'),
      requireUserVerification: true,
    });
    if (!verification.verified)
      throw new BadRequestException('No se pudo verificar la llave de acceso.');
    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    await this.db.identity.$transaction([
      this.db.identity.passkey.create({
        data: {
          userId: user.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
        },
      }),
      this.db.identity.webauthnChallenge.delete({
        where: { id: challenge.id },
      }),
    ]);
    return { verified: true };
  }

  async authenticationOptions(body: unknown) {
    const { identifier } = z
      .object({ identifier: z.string().trim().toLowerCase().min(3) })
      .parse(body);
    const user = await this.db.identity.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
      include: { passkeys: true },
    });
    if (!user?.passkeys.length)
      throw new BadRequestException(
        'Esta cuenta no tiene llaves de acceso configuradas.',
      );
    const options = await generateAuthenticationOptions({
      rpID: this.config.getOrThrow('WEBAUTHN_RP_ID'),
      userVerification: 'required',
      allowCredentials: user.passkeys.map((passkey) => ({
        id: passkey.credentialId,
        transports:
          (passkey.transports as AuthenticatorTransportFuture[] | null) ??
          undefined,
      })),
    });
    const challenge = await this.db.identity.webauthnChallenge.create({
      data: {
        userId: user.id,
        challenge: options.challenge,
        purpose: 'authenticate',
        expiresAt: addMinutes(new Date(), 5),
      },
    });
    return { challengeId: challenge.id, options };
  }

  async verifyPasskeyAuthentication(
    body: unknown,
    response: Response,
    request: Request,
  ) {
    const input = z
      .object({ challengeId: z.string().uuid(), response: z.any() })
      .parse(body) as {
      challengeId: string;
      response: AuthenticationResponseJSON;
    };
    const challenge = await this.db.identity.webauthnChallenge.findFirst({
      where: {
        id: input.challengeId,
        purpose: 'authenticate',
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!challenge?.user)
      throw new BadRequestException('Ceremonia de acceso vencida.');
    const passkey = await this.db.identity.passkey.findUnique({
      where: { credentialId: input.response.id },
    });
    if (!passkey || passkey.userId !== challenge.user.id)
      throw new UnauthorizedException('Llave de acceso desconocida.');
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.config.getOrThrow('WEBAUTHN_ORIGIN'),
      expectedRPID: this.config.getOrThrow('WEBAUTHN_RP_ID'),
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports:
          (passkey.transports as AuthenticatorTransportFuture[] | null) ??
          undefined,
      },
    });
    if (!verification.verified)
      throw new UnauthorizedException(
        'No se pudo verificar la llave de acceso.',
      );
    await this.db.identity.$transaction([
      this.db.identity.passkey.update({
        where: { id: passkey.id },
        data: {
          counter: BigInt(verification.authenticationInfo.newCounter),
          lastUsedAt: new Date(),
        },
      }),
      this.db.identity.webauthnChallenge.delete({
        where: { id: challenge.id },
      }),
      this.db.identity.user.update({
        where: { id: challenge.user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);
    const safeUser = this.toAuthenticated(challenge.user);
    await this.createSession(safeUser, response, request);
    return { user: safeUser };
  }

  private async createSession(
    user: AuthenticatedUser,
    response: Response,
    request: Request,
  ) {
    const token = this.crypto.randomToken(48);
    const expiresAt = addDays(new Date(), this.sessionDays);
    await this.db.identity.session.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.hash(token),
        ipHash: request.ip ? this.crypto.hash(request.ip) : undefined,
        userAgent: request.get('user-agent')?.slice(0, 500),
        expiresAt,
      },
    });
    response.cookie(this.cookieName, token, {
      signed: true,
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private toAuthenticated(user: {
    id: string;
    email: string;
    username: string;
    fullName: string;
    stratum: number;
    role: AuthenticatedUser['role'];
    status: string;
  }): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      stratum: user.stratum,
      role: user.role,
      status: user.status,
    };
  }
}
