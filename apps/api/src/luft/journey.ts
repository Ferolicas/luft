import { z } from 'zod';

/**
 * Pure rules for the guided LUFT journey: classification, financial profile
 * sections, tax-filing orientation and the gamified progress summary.
 * Nothing here touches the database or any third party.
 */

const cop = z.coerce.number().int().min(0).max(100_000_000_000);

export const classificationSchema = z.object({
  goal: z.enum(['IMPROVE_SCORE', 'START', 'GUIDE_YOUTH']),
  creditExperience: z.enum(['UP_TO_DATE', 'LATE', 'NONE']),
});
export type Classification = z.infer<typeof classificationSchema>;

export const sectionSchemas = {
  employment: z.object({
    situation: z.enum([
      'EMPLEADO',
      'INDEPENDIENTE',
      'ESTUDIANTE',
      'PENSIONADO',
      'HOGAR',
      'SIN_EMPLEO',
    ]),
    contractType: z.enum([
      'LABORAL',
      'PRESTACION_SERVICIOS',
      'OBRA_LABOR',
      'APRENDIZAJE',
      'NO_APLICA',
    ]),
    occupation: z.string().trim().min(2).max(120),
    company: z.string().trim().max(160).optional().default(''),
  }),
  income: z.object({
    sources: z
      .array(
        z.object({
          kind: z.enum([
            'SALARIO',
            'VENTAS',
            'ARRIENDOS',
            'PENSION',
            'HONORARIOS',
            'INTERESES',
            'OTROS',
          ]),
          monthlyCOP: cop,
        }),
      )
      .min(1)
      .max(7),
    withholding: z.boolean().nullable().optional().default(null),
  }),
  assets: z.object({
    items: z
      .array(
        z.object({
          kind: z.enum([
            'AHORROS',
            'VIVIENDA',
            'VEHICULOS',
            'INVERSIONES',
            'EXTERIOR',
          ]),
          valueCOP: cop,
        }),
      )
      .max(5),
  }),
  debts: z.object({
    cardSpendMonthlyCOP: cop,
    totalDebtCOP: cop,
    fixedExpensesMonthlyCOP: cop,
    expenseKinds: z
      .array(
        z.enum([
          'VIVIENDA',
          'SERVICIOS',
          'COMIDA',
          'TRANSPORTE',
          'SALUD',
          'EDUCACION',
        ]),
      )
      .max(6)
      .default([]),
  }),
  recurring: z.object({
    paysRent: z.boolean(),
    rentMonthlyCOP: cop.optional().default(0),
    socialSecurity: z.enum(['EMPLEADO', 'INDEPENDIENTE', 'NO_COTIZO']),
    otherPayments: z
      .array(z.enum(['CELULAR', 'SUSCRIPCIONES', 'GIMNASIO', 'MANUTENCION']))
      .max(4)
      .default([]),
  }),
} as const;

export type SectionKey = keyof typeof sectionSchemas;
export const SECTION_KEYS = Object.keys(sectionSchemas) as SectionKey[];
export type FinancialContext = {
  [K in SectionKey]?: z.infer<(typeof sectionSchemas)[K]>;
};

export const DOCUMENT_KINDS = [
  'TAX_RETURN',
  'BANK_STATEMENTS',
  'SOCIAL_SECURITY',
  'EMPLOYMENT_CERTIFICATE',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const MAX_DOCUMENTS_PER_KIND = 3;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface StoredDocument {
  id: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
}

/** The four blocks shown in "Mi perfil financiero". Each one weighs 25%. */
export function profileBlocks(
  sections: Partial<Record<SectionKey, string>>,
  documents: StoredDocument[],
) {
  const has = (key: SectionKey) => Boolean(sections[key]);
  const kinds = new Set(documents.map((item) => item.kind));
  const blocks = {
    work: has('employment') && has('income'),
    wealth: has('assets') && has('debts'),
    habits: has('recurring'),
    documents: DOCUMENT_KINDS.every((kind) => kinds.has(kind)),
  };
  const done = Object.values(blocks).filter(Boolean).length;
  return { blocks, completed: done, total: 4, percent: done * 25 };
}

/** Detects the real type from the first bytes; the declared type is never trusted. */
export function sniffMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString('latin1') === '%PDF-'
  )
    return 'application/pdf';
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  return null;
}

/**
 * A versioned set of tax thresholds for one taxable year. The values live in
 * the database (`TaxRuleVersion`); staff add and approve each year.
 */
export interface TaxRule {
  id: string;
  taxYear: number;
  version: number;
  uvtCOP: number;
  wealthUvt: number;
  incomeUvt: number;
  cardSpendUvt: number;
  purchasesUvt: number;
  depositsUvt: number;
  sourceDocument: string;
  effectiveFrom: string;
}

export const TAX_DISCLAIMER =
  'Este diagnóstico es una orientación a partir de lo que declaraste. No es una determinación definitiva: la obligación real se confirma en la revisión con un profesional y con las reglas aplicables a tu caso.';

/** The taxable year a diagnosis refers to: the last one that already closed. */
export function targetTaxYear(now: Date = new Date()) {
  return now.getUTCFullYear() - 1;
}

export function formatCOP(value: number) {
  return `$${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/**
 * Orientation only (not tax advice). Applies the thresholds of the given rule
 * version and explains, criterion by criterion, why a review is suggested.
 * Without an active rule for the year nothing is evaluated.
 */
export function taxCheck(
  context: FinancialContext,
  rule: TaxRule | null,
  taxYear: number = rule?.taxYear ?? targetTaxYear(),
) {
  if (!rule)
    return {
      taxYear,
      uvtCOP: 0,
      ready: false,
      available: false,
      mayHaveToFile: false,
      criteria: [] as Array<{
        key: string;
        label: string;
        valueCOP: number;
        limitCOP: number;
        limitUvt: number;
        exceeds: boolean;
        explanation: string;
      }>,
      rule: null,
      reasons: [] as string[],
      summary: `Aún no tenemos reglas tributarias aprobadas para el año gravable ${taxYear}. Cuando el equipo las publique evaluaremos tu caso.`,
      disclaimer: TAX_DISCLAIMER,
    };
  const { uvtCOP } = rule;
  const monthlyIncome = (context.income?.sources ?? []).reduce(
    (total, row) => total + row.monthlyCOP,
    0,
  );
  const wealth = (context.assets?.items ?? []).reduce(
    (total, row) => total + row.valueCOP,
    0,
  );
  const card = (context.debts?.cardSpendMonthlyCOP ?? 0) * 12;
  const spend = card + (context.debts?.fixedExpensesMonthlyCOP ?? 0) * 12;
  const income = monthlyIncome * 12;
  const uvt = (value: number) => formatCOP(value).slice(1);
  const row = (
    key: string,
    label: string,
    valueCOP: number,
    limitUvt: number,
  ) => {
    const limitCOP = limitUvt * uvtCOP;
    const exceeds = valueCOP > limitCOP;
    return {
      key,
      label,
      valueCOP,
      limitCOP,
      limitUvt,
      exceeds,
      explanation: `${label}: declaraste ${formatCOP(valueCOP)} y el tope del año gravable ${rule.taxYear} es ${uvt(limitUvt)} UVT (${formatCOP(limitCOP)}, con la UVT en ${formatCOP(uvtCOP)}). ${exceeds ? 'Supera el tope, por eso sugerimos una revisión.' : 'No supera el tope.'}`,
    };
  };
  const criteria = [
    row('wealth', 'Patrimonio bruto al 31 dic', wealth, rule.wealthUvt),
    row('income', 'Ingresos brutos del año', income, rule.incomeUvt),
    row('card', 'Consumos con tarjeta de crédito', card, rule.cardSpendUvt),
    row('spend', 'Compras y consumos totales', spend, rule.purchasesUvt),
    row('deposits', 'Consignaciones e inversiones', income, rule.depositsUvt),
  ];
  const ready = Boolean(context.income && context.assets && context.debts);
  const exceeded = criteria.filter((item) => item.exceeds);
  const mayHaveToFile = ready && exceeded.length > 0;
  return {
    taxYear: rule.taxYear,
    uvtCOP,
    ready,
    available: true,
    mayHaveToFile,
    criteria,
    rule: {
      id: rule.id,
      taxYear: rule.taxYear,
      version: rule.version,
      uvtCOP,
      sourceDocument: rule.sourceDocument,
      effectiveFrom: rule.effectiveFrom,
    },
    reasons: mayHaveToFile ? exceeded.map((item) => item.explanation) : [],
    summary: !ready
      ? 'Completa ingresos, patrimonio y deudas en tu perfil financiero para evaluar tu caso.'
      : mayHaveToFile
        ? `Podrías estar obligado a declarar renta por el año gravable ${rule.taxYear}: ${exceeded.length === 1 ? 'un criterio supera' : `${exceeded.length} criterios superan`} el tope (regla v${rule.version}).`
        : `Con lo que declaraste no superas los topes del año gravable ${rule.taxYear} (regla v${rule.version}).`,
    disclaimer: TAX_DISCLAIMER,
  };
}

export interface ProgressInput {
  completedLessons: number;
  completedModules: number;
  lessonsThisWeek: number;
  streakDays: number;
  creditActive: boolean;
  installments: Array<{
    sequence: number;
    status: string;
    dueDate: Date | string;
    paidAt?: Date | string | null;
  }>;
  profileBlocksCompleted: number;
  documentsUploaded: number;
}

/**
 * XP is earned only with academic courses (lessons and modules). Paying
 * installments, activating the credit or completing the profile still unlock
 * badges and missions, but they never add XP.
 */
const XP = {
  lesson: 20,
  module: 30,
} as const;

/** Level 2 starts at 200 XP, level 3 at 500 XP, then 400 XP per level. */
export function levelFor(xp: number) {
  const floors = [0, 200, 500];
  let level = 1;
  while (xp >= (floors[level] ?? 500 + (level - 2) * 400)) level += 1;
  const floor = floors[level - 1] ?? 500 + (level - 3) * 400;
  const next = floors[level] ?? 500 + (level - 2) * 400;
  return { level, floorXp: floor, nextLevelXp: next, toNext: next - xp };
}

const LEVEL_TITLES = [
  'Explorador financiero',
  'Constructor de historial',
  'Pagador constante',
  'Estratega financiero',
];

export function progressSummary(input: ProgressInput) {
  const day = (value: Date | string) =>
    new Date(value).toISOString().slice(0, 10);
  const ordered = [...input.installments].sort(
    (a, b) => a.sequence - b.sequence,
  );
  const paid = ordered.filter((row) => row.status === 'PAID');
  const onTime = (row: (typeof ordered)[number]) =>
    row.status === 'PAID' &&
    Boolean(row.paidAt) &&
    day(row.paidAt as Date | string) <= day(row.dueDate);
  let paymentStreak = 0;
  for (const row of ordered) {
    if (row.status !== 'PAID') break;
    paymentStreak = onTime(row) ? paymentStreak + 1 : 0;
  }
  const total = ordered.length;
  const next = ordered.find((row) => !['PAID', 'WAIVED'].includes(row.status));
  const profileComplete = input.profileBlocksCompleted >= 4;
  const xp =
    input.completedLessons * XP.lesson + input.completedModules * XP.module;
  const level = levelFor(xp);
  const badge = (
    key: string,
    title: string,
    hint: string,
    earned: boolean,
    tone: 'blue' | 'green' | 'gold' | 'violet',
    progress?: string,
  ) => ({
    key,
    title,
    hint,
    earned,
    tone,
    progress: earned ? undefined : progress,
  });
  const badges = [
    badge(
      'first-step',
      'Primer paso',
      'Crédito activo',
      input.creditActive,
      'blue',
    ),
    badge('on-time', 'A tiempo', 'Primera cuota', paid.some(onTime), 'green'),
    badge(
      'streak-2',
      'Racha x2',
      '2 pagos seguidos',
      paymentStreak >= 2,
      'gold',
      paymentStreak ? `${paymentStreak} de 2 pagos` : undefined,
    ),
    badge(
      'constancy',
      'Constancia',
      '3 cuotas a tiempo',
      paymentStreak >= 3,
      'gold',
      paymentStreak ? `${Math.min(paymentStreak, 3)} de 3 cuotas` : undefined,
    ),
    badge(
      'profile',
      'Perfil completo',
      '4 secciones',
      profileComplete,
      'violet',
      input.profileBlocksCompleted
        ? `${input.profileBlocksCompleted} de 4`
        : undefined,
    ),
    badge(
      'reader',
      'Lector',
      '3 lecciones',
      input.completedLessons >= 3,
      'blue',
      input.completedLessons ? `${input.completedLessons} de 3` : undefined,
    ),
    badge(
      'student',
      'Estudioso',
      'Un módulo completo',
      input.completedModules >= 1,
      'violet',
    ),
    badge('level-2', 'Nivel 2', '200 XP', level.level >= 2, 'blue'),
    badge(
      'halfway',
      'Medio camino',
      'Mitad de tus cuotas',
      total > 0 && paid.length >= Math.ceil(total / 2),
      'green',
    ),
    badge(
      'documents',
      'Respaldado',
      '4 documentos',
      input.documentsUploaded >= 4,
      'violet',
      input.documentsUploaded
        ? `${Math.min(input.documentsUploaded, 4)} de 4`
        : undefined,
    ),
    badge(
      'no-pauses',
      'Sin pausas',
      '6 pagos a tiempo',
      paymentStreak >= 6,
      'gold',
    ),
    badge(
      'goal',
      'Meta cumplida',
      'Última cuota',
      total > 0 && paid.length === total,
      'green',
    ),
  ];
  const missions = [
    {
      key: 'lesson',
      title: 'Completa una lección',
      xp: XP.lesson,
      done: input.lessonsThisWeek > 0,
      href: '/app/aprender',
    },
    {
      key: 'profile',
      title: 'Avanza en tu perfil financiero',
      xp: 0,
      done: profileComplete,
      detail: `${input.profileBlocksCompleted} de 4`,
      href: '/app/perfil/financiero',
    },
    ...(next
      ? [
          {
            key: 'installment',
            title: `Paga tu cuota ${next.sequence} a tiempo`,
            xp: 0,
            done: false,
            detail: `Vence el ${new Date(next.dueDate).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`,
            href: '/app/pagar',
          },
        ]
      : []),
  ];
  return {
    xp,
    ...level,
    title: LEVEL_TITLES[Math.min(level.level, LEVEL_TITLES.length) - 1],
    streakDays: input.streakDays,
    paymentStreak,
    installmentsPaid: paid.length,
    installmentsTotal: total,
    badges,
    badgesEarned: badges.filter((item) => item.earned).length,
    missions,
  };
}

/**
 * Dashboard rule: when a loan still has unpaid installments, that credit is
 * the one shown; otherwise the most recent application.
 */
export function pickDashboardCredit<
  T extends {
    createdAt: Date | string;
    loan?: { installments: Array<{ status: string }> } | null;
  },
>(applications: T[]): T | null {
  const newestFirst = [...applications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return (
    newestFirst.find((application) =>
      application.loan?.installments.some(
        (installment) => !['PAID', 'WAIVED'].includes(installment.status),
      ),
    ) ??
    newestFirst[0] ??
    null
  );
}
