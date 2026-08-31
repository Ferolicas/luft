import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4003),
  IDENTITY_DATABASE_URL: z.string().startsWith('postgresql://'),
  LUFT_DATABASE_URL: z.string().startsWith('postgresql://'),
  STARTIF_DATABASE_URL: z.string().startsWith('postgresql://'),
  AUDIT_DATABASE_URL: z.string().startsWith('postgresql://'),
  SCORING_DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  AUTH_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  DATA_ENCRYPTION_KEY: z.string().min(32),
  INTERNAL_SERVICE_TOKEN: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().default('luft_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  FINANCIAL_RECORD_RETENTION_YEARS: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().default('LUFT'),
  WEBAUTHN_ORIGIN: z.string().url(),
  INTEGRATIONS_MODE: z
    .enum(['live', 'configuration_required'])
    .default('configuration_required'),
  PRIVATE_STORAGE_PATH: z.string().min(1),
});

export type Environment = z.infer<typeof schema> & Record<string, unknown>;

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return { ...input, ...result.data } as Environment;
}
