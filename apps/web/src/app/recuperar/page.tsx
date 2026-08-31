"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth-card";
import { Notice } from "@/components/status";
import { api, errorMessage } from "@/lib/api";

export default function RecoveryPage() {
  const router = useRouter(); const [challengeId, setChallengeId] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [delivery, setDelivery] = useState("");
  async function request(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget); try { const result = await api<{ challengeId: string; delivery: string }>("/auth/password-reset/request", { method: "POST", body: JSON.stringify({ identifier: form.get("identifier") }) }); setChallengeId(result.challengeId); setDelivery(result.delivery); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function reset(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget); try { await api("/auth/password-reset/verify", { method: "POST", body: JSON.stringify({ challengeId, code: form.get("code"), password: form.get("password") }) }); router.push("/login"); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <AuthFrame title="Recupera tu acceso" description="Validaremos tu celular antes de aceptar una contraseña nueva.">{error && <Notice type="error">{error}</Notice>}{delivery === "configuration_required" && <Notice type="warning">El proveedor SMS está pendiente de credenciales; la solicitud quedó registrada pero no podemos entregar el código todavía.</Notice>}{!challengeId ? <form className="auth-form" onSubmit={request}><label>Correo o usuario<input name="identifier" autoComplete="username" required /></label><button className="button button-full" disabled={busy}>{busy ? "Solicitando…" : "Enviar código"}</button></form> : <form className="auth-form" onSubmit={reset}><label>Código de 6 dígitos<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label><label>Contraseña nueva<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label><button className="button button-full" disabled={busy}>{busy ? "Actualizando…" : "Cambiar contraseña"}</button></form>}</AuthFrame>;
}
