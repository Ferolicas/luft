"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Checkbox, Chip, Field, Header, Icon, Loading, Screen, Tip } from "@/components/luft/ui";
import { LEVEL_LABEL, PermissionsEditor } from "@/components/luft/v2/household";
import { ConsentBox } from "@/components/luft/v2/kit";
import { api } from "@/lib/api";
import { describeError, errorCode, fmtDate, forgetInvitation, pendingInvitation, rememberInvitation, send, useAction, useResource } from "@/lib/v2/api";
import type { InvitationPreview, Permissions } from "@/lib/v2/types";

const PRIVATE: Permissions = { routeProgress: "NONE", archetype: "NONE", learning: "NONE", credit: "NONE", score: "NONE" };
const CLOSED: Record<string, { title: string; text: string }> = {
  ACCEPTED: { title: "Esta invitación ya fue aceptada", text: "Cada invitación sirve una sola vez. Si era para ti, entra a tu cuenta y abre LUFT Familia." },
  REVOKED: { title: "Esta invitación fue cancelada", text: "Quien te invitó la canceló. Pídele un enlace nuevo si aún quieres unirte." },
  EXPIRED: { title: "Esta invitación venció", text: "Las invitaciones duran pocos días. Pídele un enlace nuevo a quien te invitó." },
};
const ROLE = {
  BENEFICIARY: { label: "Beneficiario con cupo", text: "Tendrás tu propia ruta LUFT completa dentro del plan del hogar. Tu cuenta, tu perfil y tus productos son solo tuyos." },
  SUPPORT: { label: "Red de apoyo", text: "Acompañas al hogar: puedes aportar a sus metas y ver solo lo que cada integrante autorice." },
} as const;

function Frame({ title, subtitle, chips, children, footer }: { title: string; subtitle?: string; chips?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Screen className="v2-invite">
      <Header back="/" title={title} subtitle={subtitle}>{chips && <div className="v2-header-chips" style={{ marginTop: 0, marginBottom: 14 }}>{chips}</div>}</Header>
      <div className="l-body">{children}</div>
      {footer && <div className="l-footer">{footer}</div>}
    </Screen>
  );
}

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const preview = useResource<InvitationPreview>(`/luft/invitations/${encodeURIComponent(token)}`);
  const [session, setSession] = useState<"unknown" | "yes" | "no">("unknown");
  const [mode, setMode] = useState<"choose" | "login">("choose");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState<Permissions>(PRIVATE);
  const [accepted, setAccepted] = useState(false);
  const [joined, setJoined] = useState(false);
  const [blocked, setBlocked] = useState("");
  const login = useAction();
  const accept = useAction();

  useEffect(() => {
    api("/auth/me").then(() => setSession("yes")).catch(() => setSession("no"));
  }, []);
  const status = preview.data?.status;
  useEffect(() => { if (status && status !== "PENDING" && pendingInvitation() === token) forgetInvitation(); }, [status, token]);

  if (preview.status === 404) return (
    <Frame title="No encontramos esta invitación" subtitle="Revisa que el enlace esté completo o pide uno nuevo a quien te invitó." footer={<><Button href="/login">Entrar a mi cuenta</Button><Button variant="secondary" href="/">Ir al inicio de LUFT</Button></>}>
      <Tip lufty title="El enlace no es válido">Puede estar incompleto o haber sido reemplazado por otro.</Tip>
    </Frame>
  );
  if (preview.failure) return (
    <Frame title="No pudimos abrir la invitación" footer={<Button variant="secondary" icon="sync" onClick={() => void preview.reload()}>Reintentar</Button>}>
      <Alert>{preview.failure}</Alert>
    </Frame>
  );
  if (!preview.data || session === "unknown") return <Screen className="v2-invite"><Loading label="Abriendo tu invitación…" /></Screen>;

  const invitation = preview.data;
  const role = ROLE[invitation.role];
  const chips = <><Chip icon="group">{invitation.householdName}</Chip><Chip>{role.label}</Chip></>;

  if (joined) return (
    <Frame title={`Ya haces parte de ${invitation.householdName}`} subtitle="Tu perfil sigue siendo solo tuyo." chips={chips} footer={<Button href="/app/familia" arrow>Abrir mi hogar</Button>}>
      <Tip tone="green" icon="check_circle" title="Invitación aceptada">Puedes cambiar lo que compartes cuando quieras desde LUFT Familia → Mis permisos.</Tip>
    </Frame>
  );
  if (invitation.status !== "PENDING") {
    const closed = CLOSED[invitation.status];
    return (
      <Frame title={closed.title} subtitle={closed.text} chips={chips} footer={session === "yes" ? <Button href="/app/familia" arrow>Ir a LUFT Familia</Button> : <><Button href="/login">Entrar a mi cuenta</Button><Button variant="secondary" href="/">Ir al inicio de LUFT</Button></>}>
        <Tip lufty>Las invitaciones son personales y de un solo uso para proteger la privacidad del hogar.</Tip>
      </Frame>
    );
  }

  const summary = (
    <Card>
      <span className="l-overline">Invitación a un hogar LUFT</span>
      <p className="v2-lead"><strong style={{ color: "var(--l-n-900)", fontWeight: 500 }}>{invitation.inviterFirstName}</strong> te invita a <strong style={{ color: "var(--l-n-900)", fontWeight: 500 }}>{invitation.householdName}</strong> como {role.label.toLowerCase()}. {role.text}</p>
      <ul className="l-checks">
        <li><Icon name="lock" />Se comparten apoyos y metas, no tu identidad financiera.</li>
        <li><Icon name="verified_user" />Tú decides qué métricas ve el hogar, una por una.</li>
        <li><Icon name="schedule" />El enlace vence el {fmtDate(invitation.expiresAt)}.</li>
      </ul>
    </Card>
  );

  if (session === "no") {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      void login.run(async () => { await send("POST", "/auth/login", { identifier, password }); setSession("yes"); });
    };
    return (
      <Frame title="Te invitaron a un hogar LUFT" subtitle={`${invitation.inviterFirstName} quiere que hagas parte de ${invitation.householdName}.`} chips={chips}>
        {summary}
        {mode === "choose" ? (
          <Card>
            <div><h2 className="v2-h3">Para aceptar necesitas tu cuenta LUFT</h2><p className="l-small" style={{ marginTop: 4 }}>Cada persona acepta sus propios términos. Guardamos esta invitación y volverás aquí al terminar.</p></div>
            <Button href="/empezar" arrow onClick={() => rememberInvitation(token)}>Crear mi cuenta</Button>
            <Button variant="secondary" onClick={() => { rememberInvitation(token); setMode("login"); }}>Ya tengo cuenta</Button>
          </Card>
        ) : (
          <Card>
            <form className="v2-form" onSubmit={submit}>
              <h2 className="v2-h3">Entra para aceptar la invitación</h2>
              {login.failure && <Alert>{login.failure}</Alert>}
              <Field label="Correo o usuario"><input name="identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></Field>
              <Field label="Contraseña"><input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
              <Button type="submit" arrow disabled={login.busy}>{login.busy ? "Entrando…" : "Entrar y continuar"}</Button>
              <button type="button" className="l-link-button" onClick={() => setMode("choose")}>Volver</button>
              <p className="l-fine"><Link className="l-link" href="/recuperar">¿Olvidaste tu contraseña?</Link></p>
            </form>
          </Card>
        )}
      </Frame>
    );
  }

  const confirm = () => accept.run(async () => {
    try {
      await send("POST", `/luft/invitations/${encodeURIComponent(token)}/accept`, { accepted: true, version: invitation.consent.version, permissions });
      forgetInvitation(); setJoined(true);
    } catch (cause) {
      const code = errorCode(cause);
      if (code === "already_in_household") { setBlocked(describeError(cause)); return; }
      if (code === "invitation_used" || code === "invitation_expired") { await preview.reload(); return; }
      throw cause;
    }
  });
  const sharing = Object.values(permissions).filter((level) => level !== "NONE").length;

  return (
    <Frame title={`Únete a ${invitation.householdName}`} subtitle={`${invitation.inviterFirstName} te invita como ${role.label.toLowerCase()}.`} chips={chips}>
      {summary}
      {blocked ? (
        <Card>
          <Tip tone="amber" icon="warning" title="Ya haces parte de otro hogar">{blocked}</Tip>
          <Button href="/app/familia" arrow>Ir a mi hogar actual</Button>
        </Card>
      ) : <>
        <Card>
          <div className="v2-card-head"><div><h2 className="v2-h3">Qué quieres compartir</h2><p className="l-small">Todo empieza privado. Puedes cambiarlo después. {sharing ? `Vas a compartir ${sharing} de 5 métricas.` : "Ahora mismo no compartes ninguna métrica."}</p></div></div>
          <PermissionsEditor value={permissions} labels={invitation.metricLabels} levels={invitation.shareLevels} onChange={(metric, level) => setPermissions((current) => ({ ...current, [metric]: level }))} />
          <div className="l-small"><strong style={{ fontWeight: 500 }}>{LEVEL_LABEL.NONE}:</strong> solo tú. <strong style={{ fontWeight: 500 }}>{LEVEL_LABEL.BENEFICIARIES}:</strong> el titular y los beneficiarios. <strong style={{ fontWeight: 500 }}>{LEVEL_LABEL.ALL}:</strong> incluye a la red de apoyo.</div>
        </Card>
        <Card>
          <ConsentBox text={invitation.consent.text} />
          <Checkbox checked={accepted} onChange={setAccepted}>Leí y acepto esta autorización (versión {invitation.consent.version}).</Checkbox>
          {accept.failure && <Alert>{accept.failure}</Alert>}
          <Button disabled={!accepted || accept.busy} onClick={confirm}>{accept.busy ? "Uniéndote…" : "Aceptar e ingresar al hogar"}</Button>
          <Link href="/app" className="l-link-button">Ahora no</Link>
        </Card>
      </>}
    </Frame>
  );
}
