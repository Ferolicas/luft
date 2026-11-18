"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Field, Header, Screen, Tip } from "@/components/luft/ui";
import { api, errorMessage } from "@/lib/api";

export default function AccountPage() {
  const { user } = useLuft();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<string | void>) { setBusy(true); setFailure(""); setMessage(""); try { const text = await action(); if (text) setMessage(text); } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); } }
  const passkey = () => run(async () => {
    const first = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/passkeys/registration-options", { method: "POST" });
    const response = await startRegistration({ optionsJSON: first.options });
    await api("/auth/passkeys/registration-verification", { method: "POST", body: JSON.stringify({ challengeId: first.challengeId, response }) });
    return "Tu llave de acceso quedó registrada en este dispositivo.";
  });
  const push = () => run(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador no admite notificaciones push.");
    if ((await Notification.requestPermission()) !== "granted") throw new Error("No autorizaste las notificaciones.");
    const config = await api<{ enabled: boolean; publicKey: string | null }>("/luft/push/config");
    if (!config.enabled || !config.publicKey) throw new Error("Las notificaciones aún no están habilitadas en el servidor.");
    const registration = await navigator.serviceWorker.ready;
    const normalized = config.publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(config.publicKey.length / 4) * 4, "=");
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)) });
    await api("/luft/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
    return "Notificaciones activadas en este dispositivo.";
  });
  const password = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const target = event.currentTarget; const form = new FormData(target); const next = String(form.get("newPassword") ?? "");
    if (next !== form.get("confirmPassword")) return setFailure("Las contraseñas nuevas no coinciden.");
    void run(async () => { await api("/auth/password", { method: "PATCH", body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: next }) }); target.reset(); return "Contraseña actualizada. Las demás sesiones fueron cerradas."; });
  };
  const close = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(async () => { await api("/auth/account", { method: "DELETE", body: JSON.stringify({ password: form.get("password"), confirmation: form.get("confirmation") }) }); router.replace("/"); router.refresh(); });
  };
  return (
    <Screen>
      <Header back="/app/perfil" title="Mi cuenta" subtitle="Tus datos, tu acceso y tus avisos." />
      <div className="l-body">
        {message && <Alert type="success">{message}</Alert>}
        {failure && <Alert>{failure}</Alert>}
        <Card>
          <strong style={{ fontWeight: 500 }}>Datos personales</strong>
          <div className="l-kv"><div>Nombre<strong>{user.fullName}</strong></div><div>Correo<strong>{user.email}</strong></div><div>Usuario<strong>@{user.username}</strong></div><div>Estrato<strong>{user.stratum}</strong></div></div>
          <Tip icon="verified_user">Para corregir datos de identidad, crea una solicitud en Ayuda y PQR. Así conservamos la trazabilidad.</Tip>
        </Card>
        <Card>
          <strong style={{ fontWeight: 500 }} id="seguridad">Seguridad y acceso</strong>
          <p className="l-muted">Usa huella, rostro o PIN del dispositivo. La biometría nunca sale de tu equipo.</p>
          <Button variant="secondary" icon="lock" onClick={passkey} disabled={busy}>Registrar llave de acceso</Button>
          <Button variant="secondary" icon="notifications" onClick={push} disabled={busy}>Activar notificaciones</Button>
        </Card>
        <Card as="div">
          <form className="l-stack" onSubmit={password} style={{ gap: 16 }}>
            <strong style={{ fontWeight: 500 }}>Cambiar contraseña</strong>
            <Field label="Contraseña actual"><input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
            <Field label="Nueva contraseña" hint="Mínimo 12 caracteres."><input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></Field>
            <Field label="Confirmar nueva contraseña"><input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></Field>
            <Button type="submit" disabled={busy}>Actualizar contraseña</Button>
          </form>
        </Card>
        <Card as="div">
          <form className="l-stack" onSubmit={close} style={{ gap: 16 }}>
            <strong style={{ fontWeight: 500, color: "var(--l-red-500)" }}>Cerrar mi cuenta</strong>
            <p className="l-muted">Si tienes registros financieros, la ley exige conservarlos; en ese caso la cuenta se cierra y se bloquea el acceso.</p>
            <Field label="Contraseña actual"><input name="password" type="password" autoComplete="current-password" required /></Field>
            <Field label="Escribe ELIMINAR MI CUENTA"><input name="confirmation" autoComplete="off" pattern="ELIMINAR MI CUENTA" required /></Field>
            <Button type="submit" variant="secondary" icon="delete" disabled={busy}>Cerrar cuenta definitivamente</Button>
          </form>
        </Card>
      </div>
    </Screen>
  );
}
