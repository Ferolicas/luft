/**
 * Texto del pagaré que firma la persona. Es puro: el mismo insumo produce
 * siempre el mismo documento, y su hash queda en `SignatureEnvelope`.
 */
import { scheduleTotals, type ScheduleRow } from './credit-calculator';

export const PROMISSORY_NOTE_VERSION = '2026-11-22';

const money = (value: number) =>
  `$${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

const percent = (value: number) =>
  `${(value * 100)
    .toFixed(4)
    .replace(/\.?0+$/, '')
    .replace('.', ',')} %`;

export function promissoryNoteText(input: {
  applicationId: string;
  product: { code: string; name: string; version: number | null };
  purpose: string;
  purposeDescription?: string | null;
  principalCOP: number;
  termMonths: number;
  monthlyRate: number;
  geometricDecrease: number;
  quotedOn: string;
  installments: ScheduleRow[];
}): string {
  const totals = scheduleTotals(input.installments);
  const plan = input.installments.map(
    (row) =>
      `${row.sequence}. Vence ${row.dueDate} · Cuota ${money(row.amountCOP)} · Capital ${money(row.principalCOP)} · Interés ${money(row.interestCOP)} · Saldo ${money(row.closingBalanceCOP)}`,
  );
  return [
    `PAGARÉ STARTIF ${input.applicationId}`,
    `Versión del documento: ${PROMISSORY_NOTE_VERSION}`,
    `Producto: ${input.product.name} (${input.product.code}${input.product.version ? `, versión ${input.product.version}` : ''})`,
    `Finalidad: ${input.purpose}${input.purposeDescription ? ` — ${input.purposeDescription}` : ''}`,
    `Capital: ${money(input.principalCOP)} COP`,
    `Plazo: ${input.termMonths} cuotas mensuales`,
    `Tasa de interés: ${percent(input.monthlyRate)} mensual vencida`,
    `Sistema de amortización: gradiente geométrico decreciente del ${percent(input.geometricDecrease)} mensual (cada cuota es menor que la anterior)`,
    '',
    `Plan de cuotas cotizado el ${input.quotedOn}:`,
    ...plan,
    '',
    `Total de intereses: ${money(totals.totalInterestCOP)} COP`,
    `Total a pagar: ${money(totals.totalCOP)} COP`,
    '',
    'Las fechas de vencimiento son estimadas: se cuentan mes a mes desde la activación o el desembolso del crédito y el plan definitivo conserva los mismos valores.',
    'La tasa de interés nunca podrá superar el límite legal vigente; si la tasa aprobada es menor, el plan se recalcula a favor del deudor.',
    'El deudor puede hacer abonos anticipados a capital en cualquier momento, sin penalidad; las cuotas pendientes se recalculan con la misma tasa y el mismo gradiente.',
  ].join('\n');
}
