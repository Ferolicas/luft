/**
 * Tasa máxima legal (usura) a partir del interés bancario corriente que
 * certifica la Superintendencia Financiera y publica en datos abiertos.
 * La usura es 1,5 veces el interés bancario corriente (art. 305 del Código
 * Penal y art. 884 del Código de Comercio).
 */
export const LEGAL_RATE_CATEGORY = 'Crédito de consumo y ordinario';
export const LEGAL_RATE_MODALITY = 'CONSUMO Y ORDINARIO';
/** Conjunto «Tasa de interés bancario corriente - TIBC» de la Superfinanciera. */
export const LEGAL_RATE_DATASET =
  'https://www.datos.gov.co/resource/pare-7x5i.json';
/** Autor de los registros que carga el sistema, no una persona. */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export interface CertificationRow {
  resolucion?: unknown;
  vigencia_desde?: unknown;
  vigencia_hasta?: unknown;
  interes_bancario_corriente?: unknown;
  modalidad?: unknown;
}

export interface LegalRate {
  category: string;
  /** Fracción efectiva anual: 0.2834 es 28,34 %. */
  annualEffectiveRate: number;
  bankCurrentRate: number;
  /** Días calendario de Colombia, `YYYY-MM-DD`. */
  effectiveFrom: string;
  effectiveTo: string;
  resolution: string;
  sourceUrl: string;
}

const MIN_BANK_RATE_BP = 300;
const MAX_BANK_RATE_BP = 6000;
const MAX_PERIOD_DAYS = 100;

function day(value: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(String(value ?? ''));
  if (!match) return null;
  return Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)) ? null : match[1];
}

/** «18.89%» → 1889 puntos básicos, sin pasar por coma flotante. */
function basisPoints(value: unknown): number | null {
  const match = /^(\d{1,2})(?:[.,](\d{1,2}))?\s*%$/.exec(
    String(value ?? '').trim(),
  );
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/**
 * Convierte una fila certificada en la tasa máxima legal. Devuelve `null` si
 * la fila no es de la modalidad esperada o no supera las comprobaciones: ante
 * la duda no se carga nada y la aprobación sigue bloqueada.
 */
export function legalRateFromCertification(
  row: CertificationRow,
): LegalRate | null {
  if (String(row.modalidad ?? '').trim() !== LEGAL_RATE_MODALITY) return null;
  const resolution = String(row.resolucion ?? '').trim();
  if (!/^\d{1,6}$/.test(resolution)) return null;
  const effectiveFrom = day(row.vigencia_desde);
  const effectiveTo = day(row.vigencia_hasta);
  if (!effectiveFrom || !effectiveTo || effectiveTo < effectiveFrom)
    return null;
  const days =
    (Date.parse(`${effectiveTo}T00:00:00Z`) -
      Date.parse(`${effectiveFrom}T00:00:00Z`)) /
    86_400_000;
  if (days > MAX_PERIOD_DAYS) return null;
  const bank = basisPoints(row.interes_bancario_corriente);
  if (bank === null || bank < MIN_BANK_RATE_BP || bank > MAX_BANK_RATE_BP)
    return null;
  // 1,5 veces, redondeado a dos decimales de porcentaje como lo publica la
  // Superintendencia (18,89 % → 28,34 %).
  const usury = Math.round((bank * 3) / 2);
  return {
    category: LEGAL_RATE_CATEGORY,
    annualEffectiveRate: usury / 10_000,
    bankCurrentRate: bank / 10_000,
    effectiveFrom,
    effectiveTo,
    resolution,
    // La fila exacta: el número de resolución se repite entre años.
    sourceUrl: `${LEGAL_RATE_DATASET}?modalidad=${encodeURIComponent(LEGAL_RATE_MODALITY)}&vigencia_desde=${effectiveFrom}T00:00:00.000`,
  };
}

/** Tasas vigentes hoy o que empiezan después, de la más antigua a la más nueva. */
export function applicableLegalRates(
  rows: CertificationRow[],
  today: string,
): LegalRate[] {
  const byStart = new Map<string, LegalRate>();
  for (const row of rows) {
    const rate = legalRateFromCertification(row);
    if (rate && rate.effectiveTo >= today)
      byStart.set(rate.effectiveFrom, rate);
  }
  return [...byStart.values()].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
}
