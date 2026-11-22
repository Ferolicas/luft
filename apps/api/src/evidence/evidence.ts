import type { SectionKey, StoredDocument } from '../luft/journey';

/**
 * Pure derivation of verifiable evidence from real facts. Every evidence keeps
 * its owner, source, date, validity and validation status. The same facts
 * always produce the same drafts, so the sync is idempotent.
 */

export const EVIDENCE_TYPES = [
  'IDENTITY_VERIFIED',
  'BUREAU_INQUIRY',
  'PROFILE_SECTION',
  'DOCUMENT_UPLOADED',
  'LESSON_COMPLETED',
  'MODULE_COMPLETED',
  'INSTALLMENT_ON_TIME',
  'TAX_CASE_VERIFIED',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_SOURCES = [
  'KYC_PROVIDER',
  'CREDIT_BUREAU',
  'SELF_DECLARED',
  'USER_DOCUMENT',
  'LUFT_ACADEMY',
  'STARTIF',
  'PROFESSIONAL_REVIEW',
] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCES)[number];

/** VERIFIED: validated by a third party, the system or a professional. */
export type EvidenceStatus =
  'VERIFIED' | 'DECLARED' | 'PENDING' | 'WITHDRAWN' | 'EXPIRED';

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSourceKind, string> = {
  KYC_PROVIDER: 'Validación de identidad',
  CREDIT_BUREAU: 'Central de riesgo',
  SELF_DECLARED: 'Declarado por ti',
  USER_DOCUMENT: 'Documento que cargaste',
  LUFT_ACADEMY: 'Academia LUFT',
  STARTIF: 'StartIF',
  PROFESSIONAL_REVIEW: 'Revisión profesional',
};

/**
 * Operational validity windows (days). A bureau inquiry and a supporting
 * document describe a moment in time and stop counting after the window.
 */
export const EVIDENCE_VALIDITY_DAYS = {
  BUREAU_INQUIRY: 180,
  DOCUMENT_UPLOADED: 90,
} as const;

export interface EvidenceDraft {
  type: EvidenceType;
  sourceKind: EvidenceSourceKind;
  sourceRef: string;
  label: string;
  status: 'VERIFIED' | 'DECLARED' | 'PENDING';
  occurredAt: Date;
  validUntil: Date | null;
  validatedBy: string | null;
  consentKind: string | null;
  value: Record<string, unknown> | null;
  sensitive: boolean;
}

export interface EvidenceFacts {
  kyc: Array<{
    id: string;
    provider: string;
    status: string;
    completedAt: Date | null;
  }>;
  inquiries: Array<{
    id: string;
    type: string;
    provider: string;
    status: string;
    score: number | null;
    existingHistory: boolean | null;
    completedAt: Date | null;
  }>;
  sections: Partial<Record<SectionKey, string>>;
  documents: StoredDocument[];
  modules: Array<{
    id: string;
    title: string;
    lessons: Array<{ key: string; title: string }>;
  }>;
  lessons: Array<{ moduleId: string; lessonKey: string; completedAt: Date }>;
  installments: Array<{
    id: string;
    sequence: number;
    status: string;
    dueDate: Date;
    paidAt: Date | null;
  }>;
  taxCase: {
    id: string;
    taxYear: number;
    status: string;
    verifiedAt: Date | null;
    verifiedBy: string | null;
  } | null;
}

const SECTION_LABELS: Record<SectionKey, string> = {
  employment: 'Situación laboral declarada',
  income: 'Ingresos declarados',
  assets: 'Patrimonio declarado',
  debts: 'Deudas y gastos declarados',
  recurring: 'Hábitos de pago declarados',
};

const DOCUMENT_LABELS: Record<string, string> = {
  TAX_RETURN: 'Declaración de renta cargada',
  BANK_STATEMENTS: 'Extractos bancarios cargados',
  SOCIAL_SECURITY: 'Planilla de seguridad social cargada',
  EMPLOYMENT_CERTIFICATE: 'Certificado laboral cargado',
};

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);
const day = (value: Date) => value.toISOString().slice(0, 10);

export function buildEvidence(facts: EvidenceFacts): EvidenceDraft[] {
  const drafts: EvidenceDraft[] = [];
  const push = (
    draft: Omit<
      EvidenceDraft,
      'validUntil' | 'validatedBy' | 'consentKind' | 'value' | 'sensitive'
    > &
      Partial<EvidenceDraft>,
  ) =>
    drafts.push({
      validUntil: null,
      validatedBy: null,
      consentKind: null,
      value: null,
      sensitive: false,
      ...draft,
    });

  for (const process of facts.kyc)
    if (process.status === 'COMPLETED' && process.completedAt)
      push({
        type: 'IDENTITY_VERIFIED',
        sourceKind: 'KYC_PROVIDER',
        sourceRef: `kyc:${process.id}`,
        label: 'Identidad validada',
        status: 'VERIFIED',
        occurredAt: process.completedAt,
        validatedBy: process.provider,
        consentKind: 'STARTIF_CREDIT',
      });

  for (const inquiry of facts.inquiries)
    if (inquiry.status === 'COMPLETED' && inquiry.completedAt)
      push({
        type: 'BUREAU_INQUIRY',
        sourceKind: 'CREDIT_BUREAU',
        sourceRef: `inquiry:${inquiry.id}`,
        label:
          inquiry.type === 'FINAL'
            ? 'Consulta final en central de riesgo'
            : 'Consulta inicial en central de riesgo',
        status: 'VERIFIED',
        occurredAt: inquiry.completedAt,
        validUntil: addDays(
          inquiry.completedAt,
          EVIDENCE_VALIDITY_DAYS.BUREAU_INQUIRY,
        ),
        validatedBy: inquiry.provider,
        consentKind: 'BUREAU_QUERY',
        value: {
          inquiryType: inquiry.type,
          score: inquiry.score,
          existingHistory: inquiry.existingHistory,
        },
        sensitive: true,
      });

  for (const [key, savedAt] of Object.entries(facts.sections) as Array<
    [SectionKey, string | undefined]
  >)
    if (savedAt)
      push({
        type: 'PROFILE_SECTION',
        sourceKind: 'SELF_DECLARED',
        sourceRef: `section:${key}`,
        label: SECTION_LABELS[key] ?? 'Sección del perfil declarada',
        status: 'DECLARED',
        occurredAt: new Date(savedAt),
        consentKind: 'DATA_PROCESSING',
        value: { section: key },
      });

  for (const document of facts.documents) {
    const uploadedAt = new Date(document.uploadedAt);
    push({
      type: 'DOCUMENT_UPLOADED',
      sourceKind: 'USER_DOCUMENT',
      sourceRef: `document:${document.id}`,
      label: DOCUMENT_LABELS[document.kind] ?? 'Documento cargado',
      status: 'PENDING',
      occurredAt: uploadedAt,
      validUntil: addDays(uploadedAt, EVIDENCE_VALIDITY_DAYS.DOCUMENT_UPLOADED),
      consentKind: 'DATA_PROCESSING',
      value: { kind: document.kind, sha256: document.sha256 },
    });
  }

  const completed = new Map<string, Date>();
  for (const lesson of facts.lessons)
    completed.set(`${lesson.moduleId}:${lesson.lessonKey}`, lesson.completedAt);
  for (const module of facts.modules) {
    const dates: Date[] = [];
    for (const lesson of module.lessons) {
      const completedAt = completed.get(`${module.id}:${lesson.key}`);
      if (!completedAt) continue;
      dates.push(completedAt);
      push({
        type: 'LESSON_COMPLETED',
        sourceKind: 'LUFT_ACADEMY',
        sourceRef: `lesson:${module.id}:${lesson.key}`,
        label: `Lección completada: ${lesson.title}`.slice(0, 200),
        status: 'VERIFIED',
        occurredAt: completedAt,
        validatedBy: 'SYSTEM',
        value: { moduleId: module.id, lessonKey: lesson.key },
      });
    }
    if (module.lessons.length > 0 && dates.length === module.lessons.length)
      push({
        type: 'MODULE_COMPLETED',
        sourceKind: 'LUFT_ACADEMY',
        sourceRef: `module:${module.id}`,
        label: `Módulo completado: ${module.title}`.slice(0, 200),
        status: 'VERIFIED',
        occurredAt: new Date(Math.max(...dates.map((date) => date.getTime()))),
        validatedBy: 'SYSTEM',
        value: { moduleId: module.id },
      });
  }

  for (const installment of facts.installments)
    if (
      installment.status === 'PAID' &&
      installment.paidAt &&
      day(installment.paidAt) <= day(installment.dueDate)
    )
      push({
        type: 'INSTALLMENT_ON_TIME',
        sourceKind: 'STARTIF',
        sourceRef: `installment:${installment.id}`,
        label: `Cuota ${installment.sequence} pagada a tiempo`,
        status: 'VERIFIED',
        occurredAt: installment.paidAt,
        validatedBy: 'STARTIF',
        consentKind: 'STARTIF_CREDIT',
        value: { sequence: installment.sequence },
      });

  if (facts.taxCase?.status === 'VERIFICADO' && facts.taxCase.verifiedAt)
    push({
      type: 'TAX_CASE_VERIFIED',
      sourceKind: 'PROFESSIONAL_REVIEW',
      sourceRef: `tax-case:${facts.taxCase.id}`,
      label: `Declaración de renta ${facts.taxCase.taxYear} verificada`,
      status: 'VERIFIED',
      occurredAt: facts.taxCase.verifiedAt,
      validatedBy: facts.taxCase.verifiedBy,
      consentKind: 'TAX_ASSISTANCE',
      value: { taxYear: facts.taxCase.taxYear },
    });

  return drafts;
}

/** Status shown to the user: an evidence past its validity counts as expired. */
export function effectiveStatus(
  evidence: { status: string; validUntil: Date | null },
  now: Date = new Date(),
): EvidenceStatus {
  if (
    evidence.status !== 'WITHDRAWN' &&
    evidence.validUntil &&
    evidence.validUntil.getTime() < now.getTime()
  )
    return 'EXPIRED';
  return evidence.status as EvidenceStatus;
}

export function countVerified(
  evidences: Array<{ status: string; validUntil: Date | null }>,
  now: Date = new Date(),
) {
  return evidences.filter((item) => effectiveStatus(item, now) === 'VERIFIED')
    .length;
}
