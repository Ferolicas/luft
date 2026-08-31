import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly pepper: string;

  constructor(config: ConfigService) {
    this.pepper = config.getOrThrow<string>('AUTH_SECRET');
    this.key = createHash('sha256')
      .update(config.getOrThrow<string>('DATA_ENCRYPTION_KEY'))
      .digest();
  }

  hash(value: string) {
    return createHmac('sha256', this.pepper)
      .update(value.trim().toLowerCase())
      .digest('hex');
  }

  randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
  }

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string) {
    const [version, iv, tag, ciphertext] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext)
      throw new Error('Dato cifrado inválido');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  equals(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
