"use client";

import { useCallback, useEffect, useState } from "react";
import type { IconName } from "@/components/luft/icon-data";
import { api, errorMessage } from "./api";
import type { DocumentKind, FinancialProfileData, SectionKey } from "./types";

/** Loads the decrypted financial profile and saves one section at a time. */
export function useFinancialProfile() {
  const [profile, setProfile] = useState<FinancialProfileData | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<FinancialProfileData>("/luft/financial-profile").then(setProfile).catch((cause) => setFailure(errorMessage(cause))); }, []);
  const save = useCallback(async (section: SectionKey, body: unknown) => {
    setBusy(true); setFailure("");
    try { const next = await api<FinancialProfileData>(`/luft/financial-profile/${section}`, { method: "PUT", body: JSON.stringify(body) }); setProfile(next); return next; }
    catch (cause) { setFailure(errorMessage(cause)); return null; } finally { setBusy(false); }
  }, []);
  return { profile, failure, busy, save };
}

export const BLOCKS: Array<{ key: "work" | "wealth" | "habits" | "documents"; title: string; icon: IconName; href: string; note?: string }> = [
  { key: "work", title: "Trabajo e ingresos", icon: "work", href: "/app/perfil/financiero/trabajo" },
  { key: "wealth", title: "Patrimonio y deudas", icon: "paid", href: "/app/perfil/financiero/patrimonio" },
  { key: "habits", title: "Hábitos de pago", icon: "receipt_long", href: "/app/perfil/financiero/habitos" },
  { key: "documents", title: "Documentos", icon: "description", href: "/app/perfil/financiero/documentos", note: "4 documentos" },
];

export const DOCUMENTS: Array<{ kind: DocumentKind; slug: string; title: string; note: string; icon: IconName; uploading: string }> = [
  { kind: "TAX_RETURN", slug: "declaracion-de-renta", title: "Declaración de renta", note: "Último año gravable", icon: "calculate", uploading: "Subiendo tu declaración" },
  { kind: "BANK_STATEMENTS", slug: "extractos-bancarios", title: "Extractos bancarios", note: "Últimos 3 meses", icon: "task", uploading: "Subiendo tus extractos" },
  { kind: "SOCIAL_SECURITY", slug: "seguridad-social", title: "Seguridad social", note: "Planillas de 3 meses", icon: "verified_user", uploading: "Subiendo tus planillas" },
  { kind: "EMPLOYMENT_CERTIFICATE", slug: "certificado-laboral", title: "Certificado laboral", note: "Constancia laboral", icon: "work", uploading: "Subiendo tu certificado" },
];

export const fileSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
