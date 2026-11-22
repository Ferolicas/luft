import type { OpenFinanceConnection } from "./types";

export type Tone = "" | "green" | "blue" | "amber" | "red" | "violet";

/** Estado de una conexión Open Finance: tono, etiqueta y explicación. */
export const CONNECTION: Record<OpenFinanceConnection["status"], [Tone, string, string]> = {
  PENDING: ["amber", "Solicitud registrada", "Tu solicitud está registrada y aún no se ha leído ninguna cuenta."],
  CONFIGURATION_REQUIRED: ["amber", "En espera del proveedor", "Tu autorización quedó registrada, pero la conexión no está habilitada: no se leyó ninguna cuenta."],
  AUTHORIZATION_PENDING: ["blue", "Falta autorizar en tu banco", "Termina la autorización en el sitio de tu entidad para activar la conexión."],
  ACTIVE: ["green", "Conectada", "Leemos solo lo que autorizaste, por el tiempo indicado."],
  REVOKED: ["", "Revocada", "Revocaste esta autorización. Ya no se lee información."],
  EXPIRED: ["", "Vencida", "La autorización venció. Puedes autorizar de nuevo."],
  FAILED: ["red", "No se pudo conectar", "La entidad no completó la conexión. Puedes intentarlo otra vez."],
};
export const CONNECTION_OPEN: string[] = ["PENDING", "CONFIGURATION_REQUIRED", "AUTHORIZATION_PENDING", "ACTIVE"];
