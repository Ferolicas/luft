import { api } from "./api";

const CLASSIFICATION_KEY = "luft_classification";
const BUREAU_KEY = "luft_bureau_consent";

export type Goal = "IMPROVE_SCORE" | "START" | "GUIDE_YOUTH";
export type CreditExperience = "UP_TO_DATE" | "LATE" | "NONE";

function read<T>(key: string): T | null {
  try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento no disponible */ }
}

export const pendingClassification = () => read<{ goal?: Goal; creditExperience?: CreditExperience }>(CLASSIFICATION_KEY) ?? {};
export const rememberClassification = (value: { goal?: Goal; creditExperience?: CreditExperience }) => write(CLASSIFICATION_KEY, { ...pendingClassification(), ...value });
export const rememberBureauConsent = (accepted: boolean) => write(BUREAU_KEY, accepted);

/**
 * Runs once the session exists (after phone verification): saves the answers
 * given before registering and, only if the person authorized it, requests the
 * initial bureau inquiry. Each step is independent and never blocks the next.
 */
export async function syncAfterSignup() {
  const classification = pendingClassification();
  if (classification.goal && classification.creditExperience) {
    try { await api("/luft/classification", { method: "PUT", body: JSON.stringify(classification) }); window.localStorage.removeItem(CLASSIFICATION_KEY); } catch { /* se puede responder luego desde el perfil */ }
  }
  if (read<boolean>(BUREAU_KEY)) {
    try {
      await api("/luft/consents", { method: "POST", body: JSON.stringify({ kind: "BUREAU_QUERY", accepted: true, version: "2026-09-01", deviceMeta: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }) });
      await api("/luft/score/initial", { method: "POST", body: JSON.stringify({ provider: "DATACREDITO" }) });
    } catch { /* la consulta se puede solicitar desde "Mi puntaje" */ }
    try { window.localStorage.removeItem(BUREAU_KEY); } catch { /* sin almacenamiento */ }
  }
}

export const longDate = (value: string | Date) => new Date(value).toLocaleDateString("es-CO", { day: "numeric", month: "long", timeZone: "UTC" });
export const shortDate = (value: string | Date) => new Date(value).toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "").replace(" de ", " ");
export const daysUntil = (value: string | Date) => Math.round((new Date(value).getTime() - Date.now()) / 86_400_000);
