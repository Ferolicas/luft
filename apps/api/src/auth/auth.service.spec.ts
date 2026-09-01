import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

jest.mock('../common/audit.service', () => ({ AuditService: class {} }));
jest.mock('../common/crypto.service', () => ({ CryptoService: class {} }));
jest.mock('../database/database.service', () => ({
  DatabaseService: class {},
}));

import { AuthService } from './auth.service';

const validRegistration = {
  fullName: 'Dueño de Pruebas',
  document: '1234567890',
  documentIssuedAt: '2020-01-01',
  phone: '+573001234567',
  email: 'owner@example.com',
  address: 'Calle 10 # 20-30',
  stratum: 3,
  username: 'owner.test',
  password: 'Password12345',
  consentAccepted: true,
  consentVersion: '2026-09-01-restaurar',
};

function fixture(environment: Record<string, string> = {}) {
  const createChallenge = jest.fn().mockImplementation(({ data }) => ({
    id: data.id,
    expiresAt: data.expiresAt,
  }));
  const findUser = jest.fn();
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          LEGAL_DOCUMENTS_READY: 'true',
          REGISTRATION_MODE: 'invite',
          REGISTRATION_INVITE_CODE: 'private-owner-code',
          ...environment,
        })[key],
    ),
  };
  const crypto = {
    hash: jest.fn((value: string) => `hash:${value.trim().toLowerCase()}`),
    equals: jest.fn((left: string, right: string) => left === right),
  };
  const db = {
    identity: {
      user: { findFirst: findUser },
      otpChallenge: { create: createChallenge },
    },
  };
  const integrations = {
    status: jest.fn(() => ({ sms: false })),
    sendOtp: jest.fn().mockResolvedValue({
      status: 'configuration_required',
      provider: 'SMS',
    }),
  };
  const service = new AuthService(
    db as never,
    crypto as never,
    { record: jest.fn() } as never,
    integrations as never,
    config as never,
  );
  return { service, createChallenge, findUser, integrations };
}

describe('AuthService pilot registration', () => {
  it('rejects an invalid invite before querying personal records', async () => {
    const { service, findUser } = fixture();

    await expect(
      service.register(
        { ...validRegistration, inviteCode: 'wrong-owner-code' },
        { ip: '127.0.0.1', get: jest.fn() } as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUser).not.toHaveBeenCalled();
  });

  it('refuses public registration while SMS is not configured', async () => {
    const { service, findUser } = fixture({ REGISTRATION_MODE: 'public' });

    await expect(
      service.register(validRegistration, {
        ip: '127.0.0.1',
        get: jest.fn(),
      } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(findUser).not.toHaveBeenCalled();
  });

  it('reveals an OTP only for an invited pilot when SMS is missing', async () => {
    const { service } = fixture();

    const hidden = await service.issueOtp(
      'user-id',
      '+573001234567',
      'PHONE_VERIFICATION',
    );
    const pilot = await service.issueOtp(
      'user-id',
      '+573001234567',
      'PHONE_VERIFICATION',
      true,
    );

    expect(hidden).not.toHaveProperty('testCode');
    expect(pilot).toHaveProperty('testCode');
    expect(pilot.testCode).toMatch(/^\d{6}$/);
  });

  it('never reveals an OTP when the SMS provider accepted delivery', async () => {
    const { service, integrations } = fixture();
    integrations.sendOtp.mockResolvedValueOnce({
      status: 'ready',
      provider: 'SMS',
    });

    const result = await service.issueOtp(
      'user-id',
      '+573001234567',
      'PHONE_VERIFICATION',
      true,
    );

    expect(result).not.toHaveProperty('testCode');
  });
});
