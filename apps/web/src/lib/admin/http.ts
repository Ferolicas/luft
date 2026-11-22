import { api, ApiError } from "@/lib/api";

export { api, ApiError };

/** Respuesta paginada de los listados de administración (25 por página). */
export interface Paged<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

/** Error de la API en una forma que la interfaz puede mostrar completa. */
export interface Problem {
  status: number;
  code: string | null;
  message: string;
  issues: string[];
  body: Record<string, unknown>;
}

const percent = (value: unknown) =>
  typeof value === "number" ? `${(value * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} %` : "—";

/** Textos claros para los códigos que la API devuelve sin mensaje o con un mensaje técnico. */
const CODE_TEXT: Record<string, (body: Record<string, unknown>) => string> = {
  legal_rate_required: () =>
    "No hay una tasa máxima legal (usura) vigente. Regístrala en «Tasa legal» antes de aprobar: toda aprobación se compara contra ese tope.",
  rate_exceeds_legal_limit: (body) =>
    `La tasa del producto equivale a ${percent(body.requestedAnnualEffective)} efectiva anual y supera la tasa máxima legal vigente (${percent(body.legalAnnualEffective)} E.A.). No se puede aprobar ni activar a esa tasa.`,
  rate_exceeds_signed_note: (body) =>
    `La tasa no puede superar la del pagaré que la persona firmó (${percent(body.signedMonthlyRate)} mensual).`,
  rate_required: () => "La solicitud no tiene tasa de producto. No se puede aprobar sin tasa.",
  product_incomplete: () => "La versión no tiene todas sus condiciones definidas. Completa lo que falta en una versión nueva.",
  loan_not_defaulted: () => "Solo se puede castigar un crédito que está en mora.",
  reference_already_registered: () => "Esa referencia ya está registrada en otro desembolso.",
  institution_link_required: () => "Tu cuenta todavía no está vinculada a una entidad financiera.",
  ally_link_required: () => "Tu cuenta todavía no está vinculada a un aliado.",
  independent_approval_required: () =>
    "Quien creó o editó esta versión no puede aprobarla: la aprobación debe hacerla otra persona de riesgo o superadministración.",
};

const STATUS_TEXT: Record<number, string> = {
  401: "Tu sesión no tiene permiso para esta acción o ya venció.",
  403: "No tienes permiso para esta acción.",
  404: "No encontramos el registro solicitado.",
  429: "Se hicieron demasiadas peticiones en poco tiempo. Espera un momento y vuelve a intentarlo.",
  502: "El servicio no respondió. Intenta de nuevo en unos segundos.",
  503: "El servicio no está disponible en este momento.",
};

/** La API a veces nombra el campo técnico entre paréntesis («(requirements.maxDebtToMonthlyIncome)»): en pantalla sobra. */
export const plainIssue = (issue: string) => issue.replace(/\s*\((?:requirements\.)?[a-z]+[A-Z][A-Za-z.]*\)/g, "");

function issueText(issue: unknown): string | null {
  if (typeof issue === "string") return plainIssue(issue);
  if (issue && typeof issue === "object") {
    const record = issue as Record<string, unknown>;
    const path = Array.isArray(record.path) ? record.path.join(".") : typeof record.path === "string" ? record.path : "";
    const message = typeof record.message === "string" ? record.message : "";
    if (!message && !path) return null;
    return path ? `${path}: ${message}` : message;
  }
  return null;
}

/** Normaliza cualquier error (API, red, inesperado) a código + mensaje + detalles. */
export function problemOf(error: unknown): Problem {
  if (error instanceof ApiError) {
    const nested = error.body.response && typeof error.body.response === "object" ? (error.body.response as Record<string, unknown>) : null;
    const body = nested ?? error.body;
    const code = typeof body.code === "string" ? body.code : null;
    const rawMessage = Array.isArray(body.message) ? body.message.join(" · ") : typeof body.message === "string" ? body.message : "";
    const technical = !rawMessage || /Exception|Unauthorized|Forbidden|Too Many Requests|Internal server error|Not Found|Bad Request/i.test(rawMessage);
    const mapped = code && CODE_TEXT[code] ? CODE_TEXT[code](body) : null;
    const message = mapped ?? (technical ? (STATUS_TEXT[error.status] ?? "No pudimos completar la solicitud.") : rawMessage);
    const issues = Array.isArray(body.issues) ? body.issues.map(issueText).filter((item): item is string => Boolean(item)) : [];
    return { status: error.status, code, message, issues, body };
  }
  if (error instanceof TypeError)
    return { status: 0, code: null, message: "No hay conexión con el servidor. Revisa tu red e intenta de nuevo.", issues: [], body: {} };
  return { status: 0, code: null, message: error instanceof Error ? error.message : "Ocurrió un error inesperado.", issues: [], body: {} };
}

export const get = <T>(path: string) => api<T>(path);
export const send = <T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/** Arma una cadena de consulta omitiendo los valores vacíos. */
export function query(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Descarga un archivo protegido por sesión y lo entrega al navegador. */
export async function download(path: string, fileName: string) {
  const response = await fetch(`/api${path}`, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, (await response.json().catch(() => ({}))) as Record<string, unknown>);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
