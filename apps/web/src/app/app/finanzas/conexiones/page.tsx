"use client";

import Link from "next/link";
import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Checkbox, Chip, Field, Header, Icon, Screen, Tip } from "@/components/luft/ui";
import { ConfirmSheet, ConsentBox, PageState, StatusChip } from "@/components/luft/v2/kit";
import { ApiError } from "@/lib/api";
import { describeError, errorCode, fmtDate, send, useAction, useResource } from "@/lib/v2/api";
import { CONNECTION, CONNECTION_OPEN as OPEN } from "@/lib/v2/labels";
import type { OpenFinanceConnection, OpenFinanceView } from "@/lib/v2/types";


export default function ConnectionsPage() {
  const { notify } = useLuft();
  const resource = useResource<OpenFinanceView>("/luft/open-finance");
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [institution, setInstitution] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState("");
  const [revoking, setRevoking] = useState<OpenFinanceConnection | null>(null);
  const action = useAction();
  const data = resource.data;
  if (!data) return <PageState title="Open Finance" back="/app/finanzas" failure={resource.failure} onRetry={resource.reload} label="Revisando tus conexiones…" />;

  const selected = scopes ?? data.scopes.map((scope) => scope.code);
  const toggle = (code: string) => setScopes(selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]);
  const active = data.connections.filter((connection) => OPEN.includes(connection.status));
  const past = data.connections.filter((connection) => !OPEN.includes(connection.status));
  const authorize = () => action.run(async () => {
    setPending("");
    try {
      const result = await send<{ redirectUrl?: string }>("POST", "/luft/open-finance/connections", { accepted: true, version: data.consent.version, scopes: selected, ...(institution.trim().length >= 2 ? { institution: institution.trim() } : {}) });
      if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
    } catch (cause) {
      if (!(cause instanceof ApiError) || errorCode(cause) !== "configuration_required") throw cause;
      setPending(describeError(cause));
    }
    setAccepted(false); await resource.reload();
  });
  const revoke = () => action.run(async () => { const next = await send<OpenFinanceView & { providerRevoked: boolean }>("POST", `/luft/open-finance/connections/${revoking!.id}/revoke`); resource.setData(next); setRevoking(null); notify("Autorización revocada."); });

  return (
    <Screen className="v2-wide">
      <Header back="/app/finanzas" title="Open Finance" subtitle="Tu información, bajo tu control. Tú decides qué se lee y por cuánto tiempo." />
      <div className="l-body">
        <div className="v2-cols even">
          <div className="v2-main">
            <Card>
              <div className="v2-card-head"><div className="l-row"><span className="l-icon-box"><Icon name="sync" /></span><div><h3>Estado del servicio</h3><p className="l-small">Lectura autorizada de cuentas con un proveedor regulado</p></div></div><Chip tone={data.available ? "green" : "amber"}>{data.available ? "Disponible" : "No habilitado"}</Chip></div>
              {data.message && <Tip tone="amber" icon="warning" title="Conexión aún no habilitada">{data.message}</Tip>}
              <Tip icon="lock" title={data.notice}>La autorización se hace en el sitio de tu entidad. LUFT solo recibe la información que elijas.</Tip>
            </Card>

            <Card>
              <div className="v2-card-head"><div><h3>Tus conexiones</h3><p className="l-small">{active.length ? `${active.length} en curso` : "Ninguna en curso"}</p></div></div>
              {data.connections.length === 0 ? <p className="l-muted">Aún no has autorizado ninguna conexión.</p> : [...active, ...past].map((connection) => {
                const [tone, label, text] = CONNECTION[connection.status];
                return (
                  <div className="v2-member" key={connection.id}>
                    <div className="l-row between"><strong style={{ fontSize: 15, fontWeight: 500 }}>{connection.institution ?? "Entidad por elegir"}</strong><StatusChip tone={tone}>{label}</StatusChip></div>
                    <p className="l-small">{text}</p>
                    <div className="v2-wrap">{connection.scopes.map((scope) => <Chip key={scope.code}>{scope.label}</Chip>)}</div>
                    <span className="l-small">Solicitada el {fmtDate(connection.requestedAt)}{connection.revokedAt ? ` · revocada el ${fmtDate(connection.revokedAt)}` : connection.expiresAt ? ` · autorización hasta el ${fmtDate(connection.expiresAt)}` : ""}{connection.lastSyncAt ? ` · última lectura el ${fmtDate(connection.lastSyncAt)}` : ""}</span>
                    {OPEN.includes(connection.status) && <div className="v2-actions"><button type="button" className="v2-mini danger" onClick={() => setRevoking(connection)}>Revocar autorización</button></div>}
                  </div>
                );
              })}
            </Card>
          </div>

          <aside className="v2-side">
            <Card>
              <div className="v2-card-head"><div><h3>Autorizar una conexión</h3><p className="l-small">Elige qué puede leer LUFT. La autorización dura {data.consent.days} días y puedes revocarla antes.</p></div></div>
              <fieldset className="v2-group">
                <legend>Qué autorizas a leer</legend>
                <div className="l-stack" style={{ gap: 10 }}>{data.scopes.map((scope) => <Checkbox key={scope.code} row checked={selected.includes(scope.code)} onChange={() => toggle(scope.code)}>{scope.label}</Checkbox>)}</div>
              </fieldset>
              <Field label={<>Entidad <span className="v2-optional">(opcional)</span></>}><input value={institution} maxLength={120} placeholder="Ej.: tu banco principal" onChange={(event) => setInstitution(event.target.value)} /></Field>
              <ConsentBox text={data.consent.text} />
              <Checkbox checked={accepted} onChange={setAccepted}>Leí y acepto esta autorización (versión {data.consent.version}).</Checkbox>
              {pending && <Tip tone="amber" icon="warning" title="Tu autorización quedó registrada, sin conexión">{pending}</Tip>}
              {action.failure && !revoking && <Alert>{action.failure}</Alert>}
              <Button disabled={!accepted || selected.length === 0 || action.busy} onClick={authorize}>{action.busy ? "Registrando…" : "Autorizar conexión"}</Button>
              <p className="l-fine">Gestiona todas tus autorizaciones en <Link className="l-link" href="/app/perfil/privacidad">Privacidad</Link>.</p>
            </Card>
          </aside>
        </div>
      </div>
      {revoking && (
        <ConfirmSheet title="¿Revocar esta autorización?" confirm="Sí, revocar" danger busy={action.busy} failure={action.failure} onClose={() => setRevoking(null)} onConfirm={revoke}>
          <p>Dejaremos de leer la información de {revoking.institution ?? "esta conexión"} y la solicitud queda cerrada. Puedes autorizar de nuevo cuando quieras.</p>
        </ConfirmSheet>
      )}
    </Screen>
  );
}
