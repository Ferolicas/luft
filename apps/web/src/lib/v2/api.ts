"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";

/** Código de negocio de un error de la API (`{ code, message }`), o cadena vacía. */
export function errorCode(error: unknown): string {
  if (!(error instanceof ApiError)) return "";
  const nested = error.body.response;
  if (nested && typeof nested === "object" && "code" in nested) return String((nested as { code: unknown }).code);
  return typeof error.body.code === "string" ? error.body.code : "";
}

/** Mensaje legible: prioriza el detalle por campo de un 400 de validación. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError && Array.isArray(error.body.issues) && error.body.issues.length) {
    const issues = error.body.issues as Array<{ path?: unknown; message?: unknown }>;
    const text = issues.map((issue) => String(issue.message ?? "")).filter(Boolean).slice(0, 3).join(" · ");
    if (text) return text;
  }
  return errorMessage(error);
}

export const send = <T,>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/** Carga un recurso de la API con estados honestos de carga y error, y permite recargarlo o reemplazarlo. */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState(0);
  const current = useRef(path);
  const load = useCallback(async () => {
    if (!path) return null;
    current.current = path;
    try {
      const next = await api<T>(path);
      if (current.current !== path) return null;
      setData(next); setFailure(""); setStatus(200);
      return next;
    } catch (cause) {
      if (current.current !== path) return null;
      setFailure(describeError(cause)); setStatus(cause instanceof ApiError ? cause.status : 0);
      return null;
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, setData, failure, status, reload: load };
}

/** Ejecuta una mutación con bandera de ocupado y mensaje de error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setFailure("");
    try { return await action(); }
    catch (cause) { setFailure(describeError(cause)); return undefined; }
    finally { setBusy(false); }
  }, []);
  return { busy, failure, setFailure, run };
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/** Valida el archivo en el navegador con los mismos límites de la API. Devuelve el motivo o cadena vacía. */
export function fileProblem(file: File): string {
  if (!FILE_TYPES.includes(file.type)) return "Solo aceptamos archivos PDF, JPG o PNG.";
  if (file.size > MAX_FILE_BYTES) return "El archivo supera los 10 MB.";
  if (file.size === 0) return "El archivo está vacío.";
  return "";
}

/** Subida binaria cruda con `X-File-Name`, como la exige la API. Devuelve el cuerpo JSON de la respuesta. */
export function uploadFile<T>(path: string, file: File, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api${path}`);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(request.responseText) as Record<string, unknown>; } catch { /* respuesta sin cuerpo */ }
      if (request.status >= 200 && request.status < 300) resolve(body as T);
      else reject(new ApiError(request.status, Object.keys(body).length ? body : { message: "No pudimos cargar el archivo." }));
    };
    request.onerror = () => reject(new Error("Se interrumpió la conexión. Intenta de nuevo."));
    request.send(file);
  });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Fechas de calendario ("YYYY-MM-DD") se leen en UTC; los instantes, en la zona de la persona. */
function parts(value: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-CO", { ...options, ...(DATE_ONLY.test(value) ? { timeZone: "UTC" } : {}) });
}
export const fmtDate = (value: string | null | undefined) => (value ? parts(value, { day: "numeric", month: "short", year: "numeric" }).replaceAll(".", "") : "");
export const fmtDay = (value: string | null | undefined) => (value ? parts(value, { day: "numeric", month: "long" }) : "");
export const fmtMonth = (value: string | null | undefined) => (value ? parts(value, { month: "long", year: "numeric" }) : "");
export const fmtDateTime = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${fmtDate(value)}, ${date.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })}`;
};
/** Pesos colombianos sin salto de línea entre el signo y la cifra. */
export const cop = (value: number | string | null | undefined) => `$\u00a0${new Intl.NumberFormat("es-CO").format(Number(value ?? 0))}`;
export const fmtShort = (value: string | null | undefined) => (value ? parts(value, { day: "numeric", month: "short" }).replaceAll(".", "") : "");
export const todayISO = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
export const inDays = (days: number) => (days === 0 ? "hoy" : days === 1 ? "mañana" : days > 1 ? `en ${days} días` : days === -1 ? "ayer" : `hace ${-days} días`);
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const percentText = (fraction: number | null | undefined) => (fraction == null ? "" : `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(fraction * 100)}%`);

/** Enlace de invitación pendiente de aceptar: sobrevive al registro y a la verificación del celular. */
const INVITE_KEY = "luft_pending_invitation";
export const rememberInvitation = (token: string) => { try { window.localStorage.setItem(INVITE_KEY, token); } catch { /* sin almacenamiento */ } };
export const pendingInvitation = (): string | null => { try { return window.localStorage.getItem(INVITE_KEY); } catch { return null; } };
export const forgetInvitation = () => { try { window.localStorage.removeItem(INVITE_KEY); } catch { /* sin almacenamiento */ } };
