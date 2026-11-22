"use client";

import Link from "next/link";
import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Chip, Header, Icon, Screen, Segmented, Sheet, Tip } from "@/components/luft/ui";
import { Empty, ListRow, PageState, SectionTitle, SheetHead, StatusChip } from "@/components/luft/v2/kit";
import { ApiError } from "@/lib/api";
import { describeError, errorCode, fmtDate, plural, send, useAction, useResource } from "@/lib/v2/api";
import type { ConsentItem, ConsentRevoked, ConsentsView } from "@/lib/v2/types";

type Domain = "ALL" | "LUFT" | "STARTIF";
const STATUS = { ACTIVE: ["green", "Vigente"], REVOKED: ["", "Revocada"], EXPIRED: ["amber", "Vencida"], SUPERSEDED: ["", "Reemplazada"] } as const;
const DOMAIN = { LUFT: "LUFT", STARTIF: "StartIF" } as const;
const EFFECT: Record<string, string> = {
  bureau_queries_blocked: "No haremos consultas nuevas en centrales de riesgo.",
  new_credit_applications_blocked: "No podrás iniciar solicitudes de crédito nuevas hasta autorizar de nuevo.",
  household_sharing_stopped: "Dejaste de compartir todas tus métricas con tu hogar.",
  open_finance_connections_revoked: "Se cancelaron tus conexiones Open Finance.",
  tax_documents_blocked: "No podrás cargar más documentos tributarios hasta autorizar de nuevo.",
  non_essential_communications_stopped: "Dejarás de recibir comunicaciones que no sean esenciales para el servicio.",
};

export default function PrivacyPage() {
  const { notify } = useLuft();
  const resource = useResource<ConsentsView>("/luft/consents");
  const [domain, setDomain] = useState<Domain>("ALL");
  const [revoking, setRevoking] = useState<ConsentItem | null>(null);
  const [closure, setClosure] = useState<{ message: string; href: string } | null>(null);
  const [result, setResult] = useState<ConsentRevoked | null>(null);
  const action = useAction();
  const data = resource.data;
  if (!data) return <PageState title="Privacidad y autorizaciones" back="/app/perfil" failure={resource.failure} onRetry={resource.reload} label="Buscando tus autorizaciones…" />;

  const items = data.items.filter((item) => domain === "ALL" || item.domain === domain);
  const current = items.filter((item) => item.status === "ACTIVE");
  const past = items.filter((item) => item.status !== "ACTIVE");
  const close = () => { setRevoking(null); setClosure(null); action.setFailure(""); };
  const revoke = () => action.run(async () => {
    try {
      const next = await send<ConsentRevoked>("POST", `/luft/consents/${revoking!.id}/revoke`);
      resource.setData(next); setResult(next); setRevoking(null); notify("Autorización revocada.");
    } catch (cause) {
      if (cause instanceof ApiError && errorCode(cause) === "account_closure_required") { setClosure({ message: describeError(cause), href: typeof cause.body.href === "string" ? cause.body.href : "/app/perfil/cuenta" }); return; }
      if (errorCode(cause) === "already_revoked") { await resource.reload(); setRevoking(null); return; }
      throw cause;
    }
  });

  return (
    <Screen className="v2-wide">
      <Header back="/app/perfil" title="Privacidad y autorizaciones" subtitle="Qué autorizaste, para qué y hasta cuándo. Tú decides." />
      <div className="l-body">
        <div className="v2-cols">
          <div className="v2-main">
            <Card className="tight"><Segmented<Domain> label="Filtrar por dominio" value={domain} onChange={setDomain} options={[{ value: "ALL", label: "Todas" }, { value: "LUFT", label: "LUFT" }, { value: "STARTIF", label: "StartIF" }]} /></Card>
            {result && (
              <Tip tone="green" icon="check_circle" title={`Revocaste: ${result.revoked.title}`}>
                {result.effect}
                {result.effects.filter((code) => EFFECT[code]).length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.effects.filter((code) => EFFECT[code]).map((code) => <li key={code}>{EFFECT[code]}</li>)}</ul>}
              </Tip>
            )}
            <SectionTitle>Vigentes ({current.length})</SectionTitle>
            {current.length === 0 ? <Card><Empty title="No tienes autorizaciones vigentes aquí" lufty={false} icon="verified_user">Cuando autorices algo en este dominio, aparecerá con su finalidad y su alcance.</Empty></Card>
              : current.map((item) => <ConsentCard key={item.id} item={item} onRevoke={() => { setResult(null); setRevoking(item); }} />)}
            {past.length > 0 && <>
              <SectionTitle>Historial ({past.length})</SectionTitle>
              {past.map((item) => <ConsentCard key={item.id} item={item} />)}
            </>}
          </div>
          <aside className="v2-side">
            <Card>
              <div className="v2-card-head"><div><h3>Responsable de tus datos</h3><p className="l-small">{data.controller}</p></div><span className="l-icon-box"><Icon name="verified_user" /></span></div>
              <p className="v2-lead">{data.controller} es el responsable del tratamiento de tus datos en LUFT. Los datos de tu crédito los trata StartIF con sus propias autorizaciones.</p>
              <Button variant="secondary" small href={data.policyUrl} external icon="description">Leer la política de privacidad</Button>
            </Card>
            <Card className="flush">
              <div className="l-list">
                <ListRow icon="help" title="Ejercer mis derechos" text="Conocer, actualizar, rectificar o suprimir tus datos" href="/app/pqr" />
                <ListRow icon="balance" title="Habeas data" text="Cómo protegemos tu información" href="/legal/habeas-data" />
                <ListRow icon="person" title="Mi cuenta" text="Datos personales y cierre de cuenta" href="/app/perfil/cuenta" />
              </div>
            </Card>
          </aside>
        </div>
      </div>

      {revoking && !closure && (
        <Sheet title="Revocar autorización" onClose={close}>
          <SheetHead title={`¿Revocar «${revoking.title}»?`}>Esto es lo que pasa si la revocas:</SheetHead>
          <Tip tone="amber" icon="warning" title="Efecto de revocarla">{revoking.revokeEffect}</Tip>
          <p className="l-small">La revocatoria queda registrada con fecha y hora. Lo que ya se hizo mientras estuvo vigente no se deshace.</p>
          {action.failure && <Alert>{action.failure}</Alert>}
          <div className="v2-danger"><Button disabled={action.busy} onClick={revoke}>{action.busy ? "Revocando…" : "Sí, revocar autorización"}</Button></div>
          <button type="button" className="l-link-button" onClick={close}>Cancelar</button>
        </Sheet>
      )}
      {closure && (
        <Sheet title="Requiere cerrar la cuenta" onClose={close}>
          <SheetHead title="Esta autorización es la base del servicio" />
          <Tip tone="amber" icon="info" title="Para retirarla debes cerrar tu cuenta">{closure.message}</Tip>
          <Button href={closure.href} arrow>Ir a mi cuenta</Button>
          <button type="button" className="l-link-button" onClick={close}>Ahora no</button>
        </Sheet>
      )}
    </Screen>
  );
}

function ConsentCard({ item, onRevoke }: { item: ConsentItem; onRevoke?: () => void }) {
  const [tone, label] = STATUS[item.status];
  const active = item.status === "ACTIVE";
  return (
    <Card>
      <div className="v2-card-head"><div><h3>{item.title}</h3><p className="l-small">{DOMAIN[item.domain]} · versión {item.version}</p></div><StatusChip tone={tone}>{label}</StatusChip></div>
      <p className="v2-lead">{item.purpose}</p>
      {item.scope.length > 0 && <div><span className="l-small" style={{ fontWeight: 500 }}>Alcance ({plural(item.scope.length, "dato", "datos")})</span><div className="v2-wrap" style={{ marginTop: 6 }}>{item.scope.map((entry) => <Chip key={entry}>{entry}</Chip>)}</div></div>}
      <div className="l-kv">
        <div>Autorizada el<strong>{fmtDate(item.acceptedAt)}</strong></div>
        {item.expiresAt && <div>{item.status === "EXPIRED" ? "Venció el" : "Vence el"}<strong>{fmtDate(item.expiresAt)}</strong></div>}
        {item.revokedAt && <div>Revocada el<strong>{fmtDate(item.revokedAt)}</strong></div>}
      </div>
      {active && onRevoke && (item.revocable
        ? <div className="v2-actions"><button type="button" className="v2-mini danger" onClick={onRevoke}>Revocar</button></div>
        : item.domain === "STARTIF"
          ? <span className="v2-private"><Icon name="lock" size={16} />La gestiona StartIF y está ligada a tu crédito. Para pedir cambios, usa Ayuda y PQR.</span>
          : <span className="v2-private"><Icon name="info" size={16} /><span>{item.revokeEffect} <Link className="l-link" href="/app/perfil/cuenta">Ir a mi cuenta</Link></span></span>)}
    </Card>
  );
}
