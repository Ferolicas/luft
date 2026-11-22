import { titleCase } from "./format";

export type Tone = "good" | "info" | "warn" | "bad" | "neutral";

/** Etiquetas en español para los estados que la API devuelve como códigos. */
const LABELS: Record<string, string> = {
  // Solicitudes y créditos STARTIF
  DRAFT: "Borrador",
  PENDING_KYC: "Pendiente de identidad",
  PENDING_CONSENT: "Pendiente de consentimiento",
  PENDING_SIGNATURE: "Pendiente de firma",
  PENDING_REVIEW: "En estudio",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  ACTIVE: "Vigente",
  COMPLETED: "Completado",
  DEFAULTED: "En mora",
  WRITTEN_OFF: "Castigado",
  CONFIGURATION_REQUIRED: "Falta configuración",
  SUSPENDED: "Suspendida",
  SUPERSEDED: "Sustituida",
  PENDING: "Pendiente",
  CANCELLED: "Cancelado",
  PROCESSING: "En proceso",
  FAILED: "Fallido",
  // Etapas del crédito
  borrador: "Borrador",
  solicitado: "Solicitado",
  en_estudio: "En estudio",
  aprobado: "Aprobado",
  firmado: "Firmado",
  desembolsado: "Desembolsado",
  vigente: "Vigente",
  pagado: "Pagado",
  mora: "En mora",
  castigado: "Castigado",
  rechazado: "Rechazado",
  // PQR
  OPEN: "Abierta",
  IN_REVIEW: "En revisión",
  WAITING_USER: "Esperando a la persona",
  RESOLVED: "Resuelta",
  CLOSED: "Cerrada",
  PETICION: "Petición",
  QUEJA: "Queja",
  RECLAMO: "Reclamo",
  CONSULTA: "Consulta",
  // Cuentas
  PENDING_VERIFICATION: "Sin verificar",
  // Desembolsos
  SERVICE_FINANCING: "Financiación del servicio",
  TRANSFER: "Giro de dinero",
  // Finalidades
  SERVICIO_LUFT: "Servicio LUFT",
  PROPOSITO_DEFINIDO: "Propósito definido",
  CONSOLIDACION_DEUDAS: "Consolidación de deudas",
  EDUCACION: "Educación",
  MOVILIDAD: "Movilidad",
  VIVIENDA: "Vivienda",
  EMPRENDIMIENTO: "Emprendimiento",
  OTRO: "Otro",
  // Reglas tributarias
  // (DRAFT, APPROVED, ACTIVE y SUPERSEDED ya están arriba)
  // Matching
  ELEGIBLE: "Elegible",
  CON_BRECHAS: "Con brechas",
  EXCLUIDO: "Excluido",
  CUMPLE: "Cumple",
  NO_CUMPLE: "No cumple",
  DATO_FALTANTE: "Dato faltante",
  EXCLUYE: "Excluye",
  REQUISITO: "Requisito",
  EXCLUSION: "Exclusión",
  PREFERENCIA: "Preferencia",
  OTRO_ROL: "Otro rol",
  OTRA_PERSONA: "Otra persona",
  MISMA_PERSONA: "Misma persona",
  POLICY_VERSION: "Versión de política",
  RULE_SET: "Conjunto de reglas",
  // Documentos
  TAX_RETURN: "Declaración de renta",
  BANK_STATEMENTS: "Extractos bancarios",
  SOCIAL_SECURITY: "Seguridad social",
  EMPLOYMENT_CERTIFICATE: "Certificado laboral",
  TAX_DECLARATION: "Declaración de renta",
  TAX_SUPPORT: "Soporte",
};

const TONES: Record<Tone, string[]> = {
  good: ["ACTIVE", "COMPLETED", "PAID", "RESOLVED", "VIGENTE", "APROBADA", "VERIFICADO", "ELEGIBLE", "CUMPLE", "VERIFIED", "vigente", "pagado", "desembolsado", "NO_REQUIERE"],
  info: ["PENDING_REVIEW", "IN_REVIEW", "REVISION", "PRESENTADA", "AUTORIZADA", "PROCESSING", "PRESENTADO", "OPEN", "APPROVED", "en_estudio", "aprobado", "firmado", "DOCUMENTO_CARGADO", "PREPARACION_GUIADA"],
  warn: ["PENDING", "DRAFT", "BORRADOR", "PENDING_KYC", "PENDING_SIGNATURE", "PENDING_CONSENT", "CON_BRECHAS", "SUSPENDED", "SUSPENDIDA", "WAITING_USER", "POSIBLE_OBLIGACION", "DATO_FALTANTE", "CONFIGURATION_REQUIRED", "PENDING_VERIFICATION", "DUE", "PARTIALLY_PAID", "solicitado", "borrador", "MISMA_PERSONA"],
  bad: ["REJECTED", "RECHAZADA", "DEFAULTED", "OVERDUE", "WRITTEN_OFF", "EXCLUIDO", "FAILED", "NO_CUMPLE", "EXCLUYE", "mora", "castigado", "rechazado"],
  neutral: [],
};
const TONE_BY_VALUE = new Map<string, Tone>(Object.entries(TONES).flatMap(([tone, values]) => values.map((value) => [value, tone as Tone] as const)));

export function label(value: string | null | undefined, overrides?: Record<string, string>) {
  if (!value) return "—";
  return overrides?.[value] ?? LABELS[value] ?? titleCase(value);
}

export function toneOf(value: string | null | undefined): Tone {
  return (value && TONE_BY_VALUE.get(value)) || "neutral";
}

export const APPLICATION_STATUSES = ["PENDING_REVIEW", "APPROVED", "ACTIVE", "REJECTED", "PENDING_KYC", "PENDING_SIGNATURE", "COMPLETED", "DEFAULTED", "WRITTEN_OFF", "DRAFT"];
export const LOAN_STATUS_LABEL: Record<string, string> = { ACTIVE: "Al día o vigente", DEFAULTED: "En mora", COMPLETED: "Pagado", WRITTEN_OFF: "Castigado" };
export const PRODUCT_STATUS_LABEL: Record<string, string> = { DRAFT: "Borrador", ACTIVE: "Vigente", SUSPENDED: "Suspendida", SUPERSEDED: "Sustituida" };
export const DISBURSEMENT_STATUS_LABEL: Record<string, string> = { PENDING: "Pendiente de giro", COMPLETED: "Registrado", CANCELLED: "Cancelado" };
export const USER_STATUS_LABEL: Record<string, string> = { ACTIVE: "Activa", SUSPENDED: "Suspendida", CLOSED: "Cerrada", PENDING_VERIFICATION: "Sin verificar" };
export const TAX_RULE_STATUS_LABEL: Record<string, string> = { DRAFT: "Borrador", APPROVED: "Aprobada", ACTIVE: "Vigente", SUPERSEDED: "Sustituida" };
