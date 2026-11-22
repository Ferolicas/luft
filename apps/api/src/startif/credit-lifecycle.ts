/**
 * Reglas puras del ciclo de vida del crédito StartIF: estados, transiciones
 * permitidas y mora. Nada aquí toca la base de datos.
 *
 * Especificación V2:
 *   borrador → solicitado → en_estudio → aprobado | rechazado → firmado →
 *   desembolsado → vigente → pagado | mora | castigado
 *
 * En StartIF el pagaré se firma antes del estudio (con el plan cotizado), así
 * que una solicitud aprobada ya está firmada.
 */
import { toIsoDate } from './credit-calculator';

export const CREDIT_STATUSES = [
  'DRAFT',
  'PENDING_KYC',
  'PENDING_CONSENT',
  'PENDING_SIGNATURE',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'ACTIVE',
  'COMPLETED',
  'DEFAULTED',
  'CONFIGURATION_REQUIRED',
  'WRITTEN_OFF',
] as const;
export type CreditStatusName = (typeof CREDIT_STATUSES)[number];

export const CREDIT_STAGES = [
  'borrador',
  'solicitado',
  'en_estudio',
  'aprobado',
  'rechazado',
  'firmado',
  'desembolsado',
  'vigente',
  'pagado',
  'mora',
  'castigado',
] as const;
export type CreditStage = (typeof CREDIT_STAGES)[number];

const TRANSITIONS: Record<CreditStatusName, readonly CreditStatusName[]> = {
  DRAFT: ['PENDING_CONSENT', 'PENDING_KYC'],
  PENDING_CONSENT: ['PENDING_KYC'],
  PENDING_KYC: ['PENDING_SIGNATURE', 'CONFIGURATION_REQUIRED'],
  CONFIGURATION_REQUIRED: ['PENDING_KYC', 'PENDING_SIGNATURE'],
  PENDING_SIGNATURE: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['APPROVED', 'ACTIVE', 'REJECTED'],
  // Aprobado con giro pendiente: se activa al registrar el desembolso real o
  // se cierra si finanzas cancela el giro.
  APPROVED: ['ACTIVE', 'REJECTED'],
  REJECTED: [],
  ACTIVE: ['COMPLETED', 'DEFAULTED'],
  DEFAULTED: ['ACTIVE', 'COMPLETED', 'WRITTEN_OFF'],
  // Un crédito castigado solo sale de ese estado si se recupera por completo.
  WRITTEN_OFF: ['COMPLETED'],
  // Un reembolso del proveedor de pagos reabre un crédito ya pagado.
  COMPLETED: ['ACTIVE', 'DEFAULTED'],
};

export function canTransition(from: string, to: string): boolean {
  const allowed: readonly string[] | undefined =
    TRANSITIONS[from as CreditStatusName];
  return Boolean(allowed?.includes(to));
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to))
    throw new Error(`Transición de estado inválida: ${from} → ${to}`);
}

/** Estados en los que la persona tiene una solicitud o un crédito en curso. */
const IN_PROGRESS: readonly CreditStatusName[] = [
  'DRAFT',
  'PENDING_CONSENT',
  'PENDING_KYC',
  'CONFIGURATION_REQUIRED',
  'PENDING_SIGNATURE',
  'PENDING_REVIEW',
  'APPROVED',
  'ACTIVE',
  'DEFAULTED',
  'WRITTEN_OFF',
];

export function isInProgress(status: string): boolean {
  return (IN_PROGRESS as readonly string[]).includes(status);
}

/** Estados previos a la decisión: la misma solicitud puede retomarse. */
const RESUMABLE: readonly CreditStatusName[] = [
  'DRAFT',
  'PENDING_CONSENT',
  'PENDING_KYC',
  'CONFIGURATION_REQUIRED',
  'PENDING_SIGNATURE',
];

export function isResumable(status: string): boolean {
  return (RESUMABLE as readonly string[]).includes(status);
}

/** Traduce el estado técnico a la etapa de la especificación funcional. */
export function creditStage(input: {
  status: string;
  signed?: boolean;
  disbursed?: boolean;
}): CreditStage {
  switch (input.status) {
    case 'DRAFT':
      return 'borrador';
    case 'PENDING_CONSENT':
    case 'PENDING_KYC':
    case 'CONFIGURATION_REQUIRED':
    case 'PENDING_SIGNATURE':
      return 'solicitado';
    case 'PENDING_REVIEW':
      return 'en_estudio';
    case 'APPROVED':
      if (input.disbursed) return 'desembolsado';
      return input.signed === false ? 'aprobado' : 'firmado';
    case 'REJECTED':
      return 'rechazado';
    case 'ACTIVE':
      return 'vigente';
    case 'COMPLETED':
      return 'pagado';
    case 'DEFAULTED':
      return 'mora';
    case 'WRITTEN_OFF':
      return 'castigado';
    default:
      throw new Error(`Estado de crédito desconocido: ${input.status}`);
  }
}

/** Fecha calendario de Colombia (UTC−5, sin horario de verano). */
export function bogotaDate(now: Date): string {
  return new Date(now.getTime() - 5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Interpreta una fecha escrita por el staff. `YYYY-MM-DD` es un día calendario
 * de Colombia (se fija al mediodía local); un instante ISO completo se respeta.
 */
export function colombiaDateInput(value: string): {
  date: string;
  instant: Date;
} {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = toIsoDate(text);
    return { date, instant: new Date(`${date}T12:00:00-05:00`) };
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) throw new Error('Fecha inválida');
  return { date: bogotaDate(instant), instant };
}

/** Días calendario transcurridos desde el vencimiento (0 si aún no vence). */
export function daysOverdue(dueDate: Date | string, today: Date | string) {
  const due = Date.parse(`${toIsoDate(dueDate)}T00:00:00Z`);
  const now = Date.parse(`${toIsoDate(today)}T00:00:00Z`);
  return Math.max(0, Math.round((now - due) / 86_400_000));
}

const SETTLED = ['PAID', 'WAIVED'];

export function isSettled(status: string): boolean {
  return SETTLED.includes(status);
}

/** Estado que corresponde a una cuota sin pagar según su vencimiento. */
export function openInstallmentStatus(input: {
  dueDate: Date | string;
  paidCOP: number | bigint;
  today: Date | string;
}): 'PARTIALLY_PAID' | 'OVERDUE' | 'DUE' | 'PENDING' {
  const late = daysOverdue(input.dueDate, input.today) > 0;
  if (late) return 'OVERDUE';
  if (BigInt(input.paidCOP) > 0n) return 'PARTIALLY_PAID';
  return toIsoDate(input.dueDate) === toIsoDate(input.today)
    ? 'DUE'
    : 'PENDING';
}

export type LoanStatusName =
  'ACTIVE' | 'DEFAULTED' | 'COMPLETED' | 'WRITTEN_OFF';

/**
 * Estado del préstamo según sus cuotas.
 * - Todas pagadas → COMPLETED.
 * - Castigado → sigue castigado hasta que se pague todo.
 * - Entra en mora cuando una cuota lleva `defaultAfterDays` o más días vencida.
 * - Sale de mora solo al ponerse al día (ninguna cuota vencida sin pagar).
 */
export function resolveLoanStatus(input: {
  current: string;
  installments: Array<{ status: string; dueDate: Date | string }>;
  today: Date | string;
  defaultAfterDays: number;
}): LoanStatusName {
  const open = input.installments.filter((row) => !isSettled(row.status));
  if (input.installments.length > 0 && open.length === 0) return 'COMPLETED';
  if (input.current === 'WRITTEN_OFF') return 'WRITTEN_OFF';
  const oldest = open.reduce(
    (max, row) => Math.max(max, daysOverdue(row.dueDate, input.today)),
    0,
  );
  if (oldest >= Math.max(1, input.defaultAfterDays)) return 'DEFAULTED';
  if (input.current === 'DEFAULTED' && oldest > 0) return 'DEFAULTED';
  return 'ACTIVE';
}
