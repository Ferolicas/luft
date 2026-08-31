import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaClient } from '../src/generated/identity/client';

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} es obligatorio`);
  return value;
};

const databaseUrl = required('IDENTITY_DATABASE_URL');
const encryptionSecret = required('DATA_ENCRYPTION_KEY');
const authSecret = required('AUTH_SECRET');
const email = required('INITIAL_ADMIN_EMAIL').toLowerCase();
const username = required('INITIAL_ADMIN_USERNAME').toLowerCase();
const password = required('INITIAL_ADMIN_PASSWORD');
const phone = required('INITIAL_ADMIN_PHONE');
const fullName = process.env.INITIAL_ADMIN_NAME ?? 'Administración LUFT';
const key = createHash('sha256').update(encryptionSecret).digest();
const hash = (value: string) => createHmac('sha256', authSecret).update(value.trim().toLowerCase()).digest('hex');
const encrypt = (value: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.'); };

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: 'identity' }) });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
  const marker = `PLATFORM_ADMIN:${email}`;
  const secureFields = { documentHash: hash(marker), documentCiphertext: encrypt(marker), addressCiphertext: encrypt('CUENTA_INTERNA_DE_PLATAFORMA'), documentIssuedAtCiphertext: encrypt('2026-09-01') };
  const user = await db.user.upsert({ where: { email }, create: { email, username, phone, fullName, stratum: 1, role: 'SUPERADMIN', status: 'ACTIVE', phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), passwordHash, ...secureFields }, update: { username, phone, fullName, role: 'SUPERADMIN', status: 'ACTIVE', passwordHash, ...secureFields } });
  await db.$disconnect();
  process.stdout.write(`Superadministración lista: ${user.email}\n`);
}

void main();
