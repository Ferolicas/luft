import { BadRequestException, HttpException } from '@nestjs/common';

jest.mock('../common/audit.service', () => ({ AuditService: class {} }));
jest.mock('../common/crypto.service', () => ({ CryptoService: class {} }));
jest.mock('../database/database.service', () => ({
  DatabaseService: class {},
}));
jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn(),
  verify: jest.fn((hash: string, password: string) =>
    Promise.resolve(hash === `hash-of:${password}`),
  ),
}));

import { AuthService } from './auth.service';

const CHALLENGE = '7f6f1f4e-6f0a-4d0b-9a55-0a4f0c9b1a11';

const account = {
  id: 'user-1',
  email: 'ana.perez@correo.co',
  username: 'ana.perez',
  phone: '+573001234567',
  fullName: 'Ana Pérez',
  stratum: 3,
  role: 'USER',
  status: 'ACTIVE',
  passwordHash: 'hash-of:Password12345',
  twoFactorEnabled: false,
  emailVerifiedAt: null,
};

function fixture(user: Partial<typeof account> = {}) {
  const row = { ...account, ...user };
  const challenge = {
    create: jest.fn().mockImplementation(({ data }) => ({
      id: data.id,
      expiresAt: data.expiresAt,
    })),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const db = {
    identity: {
      user: {
        findFirst: jest.fn().mockResolvedValue(row),
        findUnique: jest.fn().mockResolvedValue(row),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        update: jest.fn(),
      },
      otpChallenge: challenge,
      session: { create: jest.fn() },
    },
  };
  const crypto = {
    hash: jest.fn((value: string) => `hash:${value.trim().toLowerCase()}`),
    equals: jest.fn((left: string, right: string) => left === right),
    randomToken: jest.fn(() => 'token'),
  };
  const integrations = {
    status: jest.fn(() => ({ sms: true, email: true })),
    sendOtp: jest.fn().mockResolvedValue({ status: 'ready', provider: 'SMS' }),
    sendOtpEmail: jest
      .fn()
      .mockResolvedValue({ status: 'ready', provider: 'RESEND' }),
  };
  const config = {
    get: jest.fn(
      (key: string) =>
        ({ REGISTRATION_MODE: 'public', NODE_ENV: 'production' })[key],
    ),
  };
  const service = new AuthService(
    db as never,
    crypto as never,
    { record: jest.fn() } as never,
    integrations as never,
    config as never,
  );
  const response = { cookie: jest.fn() };
  const request = { ip: '10.0.0.1', get: jest.fn() };
  return { service, db, challenge, integrations, response, request };
}

const credentials = { identifier: 'ana.perez', password: 'Password12345' };

describe('códigos de un solo uso', () => {
  it('usa SMS solo para validar el celular y correo para todo lo demás', async () => {
    const { service, integrations } = fixture();

    await service.issueOtp('user-1', '+573001234567', 'PHONE_VERIFICATION');
    expect(integrations.sendOtp).toHaveBeenCalledTimes(1);
    expect(integrations.sendOtpEmail).not.toHaveBeenCalled();

    for (const purpose of ['LOGIN', 'SIGNATURE', 'PASSWORD_RESET'] as const)
      await service.issueOtp('user-1', 'ana.perez@correo.co', purpose);
    expect(integrations.sendOtp).toHaveBeenCalledTimes(1);
    expect(integrations.sendOtpEmail.mock.calls.map((call) => call[2])).toEqual(
      ['LOGIN', 'SIGNATURE', 'PASSWORD_RESET'],
    );
  });

  it('frena a quien pide demasiados códigos sin gastar otro envío', async () => {
    const { service, challenge, integrations } = fixture();
    challenge.count.mockResolvedValue(3);

    await expect(
      service.issueOtp('user-1', '+573001234567', 'PHONE_VERIFICATION'),
    ).rejects.toBeInstanceOf(HttpException);
    expect(challenge.create).not.toHaveBeenCalled();
    expect(integrations.sendOtp).not.toHaveBeenCalled();
  });

  it('envía la recuperación de contraseña al correo de la cuenta', async () => {
    const { service, integrations } = fixture();

    const result = await service.requestPasswordReset({
      identifier: 'ana.perez',
    });

    expect(result.delivery).toBe('accepted');
    expect(integrations.sendOtpEmail).toHaveBeenCalledWith(
      'ana.perez@correo.co',
      expect.stringMatching(/^\d{6}$/),
      'PASSWORD_RESET',
    );
    expect(integrations.sendOtp).not.toHaveBeenCalled();
  });

  it('responde con la misma forma exista o no la cuenta (no la delata)', async () => {
    const existing = fixture();
    const known = await existing.service.requestPasswordReset({
      identifier: 'ana.perez',
    });

    const missing = fixture();
    missing.db.identity.user.findFirst.mockResolvedValue(null);
    const unknown = await missing.service.requestPasswordReset({
      identifier: 'nadie.existe',
    });

    expect(missing.integrations.sendOtpEmail).not.toHaveBeenCalled();
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
    expect(unknown.delivery).toBe(known.delivery);
    expect(unknown.expiresAt).toBeInstanceOf(Date);

    // También cuando la cuenta existe pero agotó su cupo de códigos.
    const limited = fixture();
    limited.challenge.count.mockResolvedValue(3);
    const throttled = await limited.service.requestPasswordReset({
      identifier: 'ana.perez',
    });
    expect(Object.keys(throttled).sort()).toEqual(Object.keys(known).sort());
  });
});

describe('inicio de sesión', () => {
  it('entra directo cuando la cuenta no tiene dos pasos', async () => {
    const { service, db, response, request, integrations } = fixture();

    const result = await service.login(
      credentials,
      response as never,
      request as never,
    );

    expect(result).toHaveProperty('user.id', 'user-1');
    expect(db.identity.session.create).toHaveBeenCalledTimes(1);
    expect(integrations.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('con dos pasos pide el código del correo y no abre sesión todavía', async () => {
    const { service, db, response, request, integrations } = fixture({
      twoFactorEnabled: true,
    });

    const result = await service.login(
      credentials,
      response as never,
      request as never,
    );

    expect(result).toMatchObject({
      next: 'two_factor',
      destination: 'an•••@correo.co',
    });
    expect(result).not.toHaveProperty('user');
    expect(db.identity.session.create).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(integrations.sendOtpEmail).toHaveBeenCalledWith(
      'ana.perez@correo.co',
      expect.stringMatching(/^\d{6}$/),
      'LOGIN',
    );
  });

  it('abre la sesión con el código correcto y lo deja usado', async () => {
    const { service, db, challenge, response, request } = fixture({
      twoFactorEnabled: true,
    });
    challenge.findFirst.mockResolvedValue({
      id: CHALLENGE,
      userId: 'user-1',
      codeHash: `hash:otp:${CHALLENGE}:123456`,
    });

    const result = await service.verifyLogin(
      { challengeId: CHALLENGE, code: '123456' },
      response as never,
      request as never,
    );

    expect(result).toHaveProperty('user.id', 'user-1');
    expect(challenge.updateMany).toHaveBeenCalledTimes(1);
    expect(db.identity.session.create).toHaveBeenCalledTimes(1);
    expect(response.cookie).toHaveBeenCalledTimes(1);
  });

  it('rechaza un código equivocado y cuenta el intento', async () => {
    const { service, db, challenge, response, request } = fixture({
      twoFactorEnabled: true,
    });
    challenge.findFirst.mockResolvedValue({
      id: CHALLENGE,
      userId: 'user-1',
      codeHash: `hash:otp:${CHALLENGE}:123456`,
    });

    await expect(
      service.verifyLogin(
        { challengeId: CHALLENGE, code: '000000' },
        response as never,
        request as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(challenge.update).toHaveBeenCalledTimes(1);
    expect(db.identity.session.create).not.toHaveBeenCalled();
  });

  it('no acepta un código que otra petición ya usó', async () => {
    const { service, db, challenge, response, request } = fixture({
      twoFactorEnabled: true,
    });
    challenge.findFirst.mockResolvedValue({
      id: CHALLENGE,
      userId: 'user-1',
      codeHash: `hash:otp:${CHALLENGE}:123456`,
    });
    challenge.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.verifyLogin(
        { challengeId: CHALLENGE, code: '123456' },
        response as never,
        request as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.identity.session.create).not.toHaveBeenCalled();
  });

  it('a quien no validó su celular le manda un SMS nuevo en vez de bloquearlo', async () => {
    const { service, db, response, request, integrations } = fixture({
      status: 'PENDING_VERIFICATION',
    });

    const result = await service.login(
      credentials,
      response as never,
      request as never,
    );

    expect(result).toHaveProperty('next', 'verify_phone');
    expect(integrations.sendOtp).toHaveBeenCalledWith(
      '+573001234567',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(db.identity.session.create).not.toHaveBeenCalled();
  });
});

describe('activar y desactivar los dos pasos', () => {
  it('solo se activa con el código que llegó al correo', async () => {
    const { service, db, challenge, request } = fixture();
    challenge.findFirst.mockResolvedValue({
      id: CHALLENGE,
      userId: 'user-1',
      codeHash: `hash:otp:${CHALLENGE}:123456`,
    });

    await expect(
      service.enableTwoFactor(
        account as never,
        { challengeId: CHALLENGE, code: '123456' },
        request as never,
      ),
    ).resolves.toEqual({ enabled: true });
    expect(db.identity.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ twoFactorEnabled: true }),
      }),
    );
  });

  it('se desactiva únicamente con la contraseña actual', async () => {
    const { service, db, request } = fixture({ twoFactorEnabled: true });

    await expect(
      service.disableTwoFactor(
        account as never,
        { password: 'otra' },
        request as never,
      ),
    ).rejects.toThrow('La contraseña no es correcta.');
    expect(db.identity.user.update).not.toHaveBeenCalled();

    await expect(
      service.disableTwoFactor(
        account as never,
        { password: 'Password12345' },
        request as never,
      ),
    ).resolves.toEqual({ enabled: false });
  });
});
