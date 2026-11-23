/**
 * Reglas puras de la gestión de cobro: cuándo se puede contactar a una persona
 * (Ley 2300 de 2023), el aviso previo al reporte negativo (Ley 1266 de 2008,
 * art. 12, y Ley 2157 de 2021) y los textos que se envían. Nada aquí toca la
 * base de datos ni envía mensajes.
 */
const DAY_MS = 86_400_000;
const BOGOTA_OFFSET_MS = 5 * 60 * 60_000;

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Domingo de Pascua (algoritmo gregoriano anónimo). */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Los festivos que la Ley 51 de 1983 traslada al lunes siguiente. */
function nextMonday(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 1 ? day : addDays(day, (8 - weekday) % 7);
}

/** Festivos de Colombia de un año, como días `YYYY-MM-DD`. */
export function colombianHolidays(year: number): Set<string> {
  const fixed = ['01-01', '05-01', '07-20', '08-07', '12-08', '12-25'];
  const moved = ['01-06', '03-19', '06-29', '08-15', '10-12', '11-01', '11-11'];
  const easter = easterSunday(year);
  return new Set([
    ...fixed.map((date) => `${year}-${date}`),
    ...moved.map((date) => nextMonday(`${year}-${date}`)),
    addDays(easter, -3), // Jueves Santo
    addDays(easter, -2), // Viernes Santo
    addDays(easter, 43), // Ascensión
    addDays(easter, 64), // Corpus Christi
    addDays(easter, 71), // Sagrado Corazón
  ]);
}

/**
 * Franja en la que la ley permite contactar ese día, en horas de Colombia:
 * lunes a viernes de 7 a 19, sábados de 8 a 15, nunca domingos ni festivos.
 */
export function contactHours(day: string): { from: number; to: number } | null {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (weekday === 0) return null;
  if (colombianHolidays(Number(day.slice(0, 4))).has(day)) return null;
  return weekday === 6 ? { from: 8, to: 15 } : { from: 7, to: 19 };
}

/** ¿Se puede contactar en este instante? */
export function canContactNow(now: Date): boolean {
  const local = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  const hours = contactHours(local.toISOString().slice(0, 10));
  if (!hours) return false;
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  return hour >= hours.from && hour < hours.to;
}

export const PRIOR_NOTICES_REQUIRED = 2;
export const PRIOR_NOTICE_DAYS = 20;

export interface SentNotice {
  sequence: number;
  /** Día calendario de Colombia en que se envió. */
  sentOn: string;
}

/**
 * Avisos que cuentan para la mora actual: los enviados desde que venció la
 * cuota más antigua que sigue sin pagar. Si la persona se pone al día y vuelve
 * a atrasarse, los avisos anteriores ya no sirven.
 */
export function noticesForCurrentDelinquency(
  notices: SentNotice[],
  earliestOverdueDue: string,
): SentNotice[] {
  return notices
    .filter((notice) => notice.sentOn > earliestOverdueDue)
    .sort((a, b) => a.sentOn.localeCompare(b.sentOn));
}

/**
 * Qué aviso previo toca enviar hoy, si alguno. Se envían dos, en días
 * distintos, para cubrir también las obligaciones pequeñas que la Ley 2157
 * obliga a comunicar dos veces.
 */
export function priorNoticeDue(
  current: SentNotice[],
  today: string,
): 1 | 2 | null {
  if (current.length === 0) return 1;
  if (current.length === 1 && current[0].sentOn < today) return 2;
  return null;
}

/**
 * Primer día en que la ley permite el reporte negativo: pasados 20 días
 * calendario completos desde el último aviso. `null` si faltan avisos.
 */
export function negativeReportAllowedFrom(
  current: SentNotice[],
): string | null {
  if (current.length < PRIOR_NOTICES_REQUIRED) return null;
  return addDays(
    current[PRIOR_NOTICES_REQUIRED - 1].sentOn,
    PRIOR_NOTICE_DAYS + 1,
  );
}

/** Recordatorio de pago: el día del vencimiento, al día siguiente y cada 5 días. */
export function reminderDue(input: {
  dueToday: boolean;
  maxDaysOverdue: number;
}): boolean {
  if (input.maxDaysOverdue <= 0) return input.dueToday;
  return input.maxDaysOverdue === 1 || input.maxDaysOverdue % 5 === 0;
}

const pesos = (value: number | bigint) =>
  `$${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(value))}`;
const longDate = (day: string) =>
  new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));

export interface OverdueLine {
  sequence: number;
  dueDate: string;
  pendingCOP: number | bigint;
}

/** Texto del aviso previo al reporte negativo. Es la evidencia que se guarda. */
export function priorNoticeText(input: {
  firstName: string;
  sequence: 1 | 2;
  loanReference: string;
  overdue: OverdueLine[];
  /** Día del envío, en Colombia. */
  sentOn: string;
  host: string;
}): { subject: string; text: string } {
  const total = input.overdue.reduce(
    (sum, row) => sum + Number(row.pendingCOP),
    0,
  );
  const deadline = addDays(input.sentOn, PRIOR_NOTICE_DAYS);
  const lines = input.overdue.map(
    (row) =>
      `Cuota ${row.sequence}, vencida el ${longDate(row.dueDate)}: ${pesos(row.pendingCOP)}`,
  );
  return {
    subject:
      input.sequence === 1
        ? 'Aviso previo a reporte en centrales de riesgo'
        : 'Segundo aviso previo a reporte en centrales de riesgo',
    text: [
      `Hola, ${input.firstName}:`,
      `Tu crédito ${input.loanReference} tiene cuotas vencidas sin pagar por ${pesos(total)}:`,
      ...lines,
      `Te avisamos, como lo exige el artículo 12 de la Ley 1266 de 2008, que si la obligación sigue en mora pasados veinte (20) días calendario desde este aviso, es decir después del ${longDate(deadline)}, reportaremos esa información negativa a los operadores DataCrédito Experian y TransUnion (CIFIN).`,
      `Durante ese plazo puedes pagar desde https://${input.host}/app/pagar para que el reporte no se haga, o controvertir la obligación por Ayuda y PQR en https://${input.host}/app/pqr si consideras que el valor o la mora no son correctos.`,
      input.sequence === 1
        ? 'Recibirás un segundo aviso antes de cualquier reporte.'
        : 'Este es el segundo y último aviso antes del reporte.',
      'Tureporte S.A.S. · LUFT',
    ].join('\n\n'),
  };
}

export function reminderText(input: {
  firstName: string;
  dueToday: boolean;
  maxDaysOverdue: number;
  host: string;
}): { subject: string; text: string } {
  const overdue = input.maxDaysOverdue > 0;
  return {
    subject: overdue
      ? 'Tienes una cuota LUFT vencida'
      : 'Hoy vence tu cuota LUFT',
    text: [
      `Hola, ${input.firstName}:`,
      overdue
        ? `Tu cuota lleva ${input.maxDaysOverdue} ${input.maxDaysOverdue === 1 ? 'día' : 'días'} vencida.`
        : 'Tu cuota vence hoy.',
      `Revisa el valor y paga por PSE en https://${input.host}/app/pagar.`,
    ].join('\n\n'),
  };
}

/** Convierte el texto guardado en un correo sencillo. */
export function textToHtml(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c">${text
    .split('\n\n')
    .map(
      (block) =>
        `<p style="margin:0 0 14px;line-height:1.6">${escape(block).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')}</div>`;
}
