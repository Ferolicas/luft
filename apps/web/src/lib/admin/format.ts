const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const INTEGER = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Bogota" });
const DATE_TIME = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });
const DAY = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("es-CO", { month: "short", year: "numeric", timeZone: "UTC" });

const DASH = "—";
type Numeric = string | number | null | undefined;

const isBlank = (value: unknown): value is null | undefined | "" => value === null || value === undefined || value === "";

/** Pesos colombianos sin decimales; `—` cuando no hay valor. */
export function cop(value: Numeric) {
  // Mismo formato que `money()` de la app: `$600.000`, sin espacio tras el signo.
  return isBlank(value) || Number.isNaN(Number(value)) ? DASH : COP.format(Number(value)).replace(/\s/g, "");
}

export function integer(value: Numeric) {
  return isBlank(value) || Number.isNaN(Number(value)) ? DASH : INTEGER.format(Number(value));
}

/** Fracción (0.285) como porcentaje (28,5 %). */
export function percent(value: Numeric, digits = 2) {
  if (isBlank(value) || Number.isNaN(Number(value))) return DASH;
  return `${(Number(value) * 100).toLocaleString("es-CO", { maximumFractionDigits: digits })} %`;
}

/** Valor que ya viene en puntos porcentuales (42 → 42 %). */
export function points(value: Numeric, digits = 1) {
  if (isBlank(value) || Number.isNaN(Number(value))) return DASH;
  return `${Number(value).toLocaleString("es-CO", { maximumFractionDigits: digits })} %`;
}

export function decimal(value: Numeric, digits = 2) {
  if (isBlank(value) || Number.isNaN(Number(value))) return DASH;
  return Number(value).toLocaleString("es-CO", { maximumFractionDigits: digits });
}

function parse(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «22 nov 2026»: sin las preposiciones del formato largo, para que quepa en tablas. */
const compact = (text: string) => text.replace(/ de /g, " ");

/** Instante ISO como fecha en hora de Colombia. */
export function date(value: string | Date | null | undefined) {
  const parsed = parse(value);
  return parsed ? compact(DATE.format(parsed)) : DASH;
}

export function dateTime(value: string | Date | null | undefined) {
  const parsed = parse(value);
  return parsed ? compact(DATE_TIME.format(parsed)) : DASH;
}

/** Día calendario `YYYY-MM-DD` (sin zona horaria). */
export function day(value: string | null | undefined) {
  if (!value) return DASH;
  const parsed = parse(`${value.slice(0, 10)}T00:00:00Z`);
  return parsed ? compact(DAY.format(parsed)) : DASH;
}

/** Mes `YYYY-MM` como «nov 2026». */
export function month(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}/.test(value)) return value || DASH;
  const parsed = parse(`${value.slice(0, 7)}-01T00:00:00Z`);
  return parsed ? compact(MONTH.format(parsed)) : value;
}

export function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : DASH;
}

/** Hoy en Colombia como `YYYY-MM-DD`, para valores por defecto de campos de fecha. */
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

/** Convierte el valor de un `<input type="number">` en número, o `null` si está vacío. */
export function numberOrNull(value: string) {
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Porcentaje escrito por la persona (28,5) como fracción (0.285), sin ruido de coma flotante. */
export function fractionFromPercent(value: string) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Number((parsed / 100).toFixed(8));
}

/** Fracción (0.285) como texto editable en puntos porcentuales (28.5). */
export function percentInput(value: Numeric) {
  if (isBlank(value) || Number.isNaN(Number(value))) return "";
  return String(Number((Number(value) * 100).toFixed(6)));
}

export function titleCase(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
