import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(16).optional(),
);

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);
const optionalUrl = z.preprocess(emptyAsUndefined, z.string().url().optional());
const optionalText = z.preprocess(
  emptyAsUndefined,
  z.string().min(1).max(500).optional(),
);

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    APP_URL: z.string().url(),
    LEGAL_DOCUMENTS_READY: z.enum(['true', 'false']).default('false'),
    REGISTRATION_MODE: z.enum(['closed', 'invite', 'public']).default('closed'),
    REGISTRATION_INVITE_CODE: optionalSecret,
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
    OPENFINANCE_ENABLED: z.enum(['true', 'false']).default('false'),
    OPENFINANCE_BASE_URL: optionalUrl,
    OPENFINANCE_CLIENT_ID: optionalText,
    OPENFINANCE_CLIENT_SECRET: optionalSecret,
    OPENFINANCE_WEBHOOK_SECRET: optionalSecret,
    OPENFINANCE_CONSENT_ENDPOINT: optionalText,
    OPENFINANCE_CONSENT_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(90),
  })
  .superRefine((environment, context) => {
    // Open Finance fails closed: enabling it without every credential is a
    // configuration error, never a partially working integration.
    if (environment.OPENFINANCE_ENABLED === 'true')
      for (const key of [
        'OPENFINANCE_BASE_URL',
        'OPENFINANCE_CLIENT_ID',
        'OPENFINANCE_CLIENT_SECRET',
        'OPENFINANCE_WEBHOOK_SECRET',
        'OPENFINANCE_CONSENT_ENDPOINT',
      ] as const)
        if (!environment[key])
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'es obligatorio cuando OPENFINANCE_ENABLED=true',
          });
    if (
      environment.REGISTRATION_MODE === 'invite' &&
      !environment.REGISTRATION_INVITE_CODE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['REGISTRATION_INVITE_CODE'],
        message:
          'es obligatorio y debe tener al menos 16 caracteres en modo invite',
      });
    }
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
