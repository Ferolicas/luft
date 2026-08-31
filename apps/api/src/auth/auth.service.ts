import {
  BadRequestException,
  ConflictException,
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
import { addDays, addMinutes } from 'date-fns';
import type { Request, Response } from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { UserStatus } from '../generated/identity/enums';
import { IntegrationService } from '../integrations/integration.service';
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
  consentVersion: z.literal('2026-09-01'),
});

const CONSENT_TEXT =
  'Autorizo a LUFT el tratamiento de mis datos personales para crear mi cuenta, verificar mi identidad, personalizar mi educación financiera y gestionar mis solicitudes. Las consultas y reportes ante operadores de información financiera requieren autorizaciones separadas y expresas.';

@Injectable()
export class AuthService {
  private readonly cookieName: string;
  private readonly sessionDays: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly config: ConfigService,
  ) {
    this.cookieName = config.get('SESSION_COOKIE_NAME') ?? 'luft_session';
    this.sessionDays = Number(config.get('SESSION_TTL_DAYS') ?? 30);
  }

  async register(body: unknown, request: Request) {
    if (this.config.get('LEGAL_DOCUMENTS_READY') !== 'true')
      throw new ServiceUnavailableException({
        code: 'legal_configuration_required',
        message:
          'El alta pública se habilitará cuando se publique la identidad legal y la política de tratamiento de datos de LUFT/StartIF.',
      });
    const input = registrationSchema.parse(body);
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
    );
    await this.audit.record({
      actorUserId: user.id,
      action: 'identity.user.registered',
      resource: 'User',
      resourceId: user.id,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      payload: { consentVersion: input.consentVersion, stratum: input.stratum },
    });
    return { userId: user.id, next: 'verify_phone', verification };
  }

  async issueOtp(
    userId: string,
    destination: string,
    purpose: 'PHONE_VERIFICATION' | 'LOGIN' | 'SIGNATURE' | 'PASSWORD_RESET',
  ) {
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
    const delivery = await this.integrations.sendOtp(destination, code);
    return {
      challengeId: challenge.id,
      delivery: delivery.status,
      expiresAt: challenge.expiresAt,
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
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException({
        code: 'account_not_active',
        status: user.status,
      });
    await this.db.identity.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
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
    });
    return { user: safeUser };
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
    const result = await this.issueOtp(user.id, user.phone, 'PASSWORD_RESET');
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
