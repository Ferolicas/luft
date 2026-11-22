"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { DecisionForm, ExplanationView, useMatchingCatalog } from "@/components/admin/matching";
import { Badge, Button, ErrorBox, Facts, Field, FormActions, Loaded, Modal, PageHead, Panel, StatusBadge, useAction, useLoad } from "@/components/admin/ui";
import { cop, dateTime, percent, points } from "@/lib/admin/format";
import { get, send } from "@/lib/admin/http";
import { type DecisionBody, optionLabel, type StaffPresentationDetail } from "@/lib/admin/matching-types";
import { ROLE_LABEL } from "@/lib/admin/nav";

export default function PresentationPage() {
  const { id } = useParams<{ id: string }>();
  const { notify } = useConsole();
  const { catalog } = useMatchingCatalog();
  const presentation = useLoad(() => get<StaffPresentationDetail>(`/admin/matching/presentations/${id}`), [id]);
  const [dialog, setDialog] = useState<"present" | "decide" | null>(null);

  return (
    <Loaded loader={presentation} label="Cargando la presentación…">
      {(data) => (
        <>
          <PageHead
            back={{ href: "/admin/matching/presentaciones", label: "Presentaciones" }}
            eyebrow={`${data.institution.name} · ${data.product.name}`}
            title={data.user.fullName}
            description={<span className="cs-row"><StatusBadge value={data.status} text={data.statusLabel} /><span>Encaje {points(data.match.fitPercent, 0)}</span><StatusBadge value={data.match.status} />{data.requiresException && <Badge tone="warn">Requiere excepción</Badge>}</span>}
            actions={
              <>
                {data.allowedActions.includes("present") && <Button onClick={() => setDialog("present")}>Marcar como presentada</Button>}
                {data.allowedActions.includes("decide") && <Button onClick={() => setDialog("decide")}>Registrar decisión</Button>}
              </>
            }
          />
          {data.allowedActions.length === 0 && <p className="cs-note">{data.status === "REVOCADA" ? "La persona revocó su autorización: la copia de sus datos se destruyó y ya no se puede presentar." : "Esta presentación ya está cerrada: no admite más acciones."}</p>}
          <div className="cs-grid cs-grid-side">
            <div className="cs-stack">
              <Panel title="Datos autorizados" description="Es la copia exacta que la persona autorizó compartir. No incluye nada más.">
                {data.shared ? (
                  <div className="cs-stack" style={{ gap: 14 }}>
                    <Facts
                      columns={2}
                      items={[
                        { label: "Nombre", value: data.shared.applicant.fullName },
                        { label: "Documento", value: data.shared.applicant.document },
                        { label: "Celular", value: data.shared.applicant.phone },
                        { label: "Correo", value: data.shared.applicant.email },
                      ]}
                    />
                    <div className="cs-table-wrap">
                      <table className="cs-table cs-table-compact">
                        <caption>Hechos compartidos</caption>
                        <thead><tr><th scope="col">Dato</th><th scope="col">Valor compartido</th></tr></thead>
                        <tbody>{data.shared.facts.map((fact) => <tr key={fact.key}><td>{fact.label}</td><td><strong>{fact.display}</strong></td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                ) : <p className="cs-muted">No hay copia de datos disponible: la autorización fue revocada o la presentación se cerró sin aprobación.</p>}
              </Panel>
              <Panel title="Explicación del encaje" description={`Evaluado el ${dateTime(data.match.evaluatedAt)} con la versión ${data.policy.version} de la política.`}>
                <ExplanationView explanation={data.explanation} />
              </Panel>
            </div>
            <div className="cs-stack">
              <Panel title="Seguimiento">
                <Facts
                  columns={2}
                  items={[
                    { label: "Producto", value: <Link className="cs-link" href={`/admin/matching/productos/${data.product.id}`}>{data.product.name}</Link> },
                    { label: "Política", value: <Link className="cs-link" href={`/admin/matching/productos/versiones/${data.policy.versionId}`}>Versión {data.policy.version}</Link> },
                    { label: "Autorizada", value: dateTime(data.authorizedAt) },
                    { label: "Revocada", value: data.revokedAt ? dateTime(data.revokedAt) : null },
                    { label: "Presentada", value: data.presentedAt ? `${dateTime(data.presentedAt)}${data.presentedByName ? ` · ${data.presentedByName}` : ""}` : null },
                    { label: "Canal", value: data.presentationChannel },
                    { label: "Nota del envío", value: data.presentationNote, wide: true },
                    ...(data.requiresException ? [
                      { label: "Niveles de excepción", value: data.exceptionLevels.map((level) => optionLabel(catalog?.exceptionLevels, level)).join(", ") },
                      { label: "Excepción aprobada por", value: data.exceptionApprovedByName ? `${data.exceptionApprovedByName}${data.exceptionApprovedRole ? ` (${ROLE_LABEL[data.exceptionApprovedRole] ?? data.exceptionApprovedRole})` : ""}` : null },
                      { label: "Sustento de la excepción", value: data.exceptionNote, wide: true },
                    ] : []),
                    { label: "Decidida", value: data.decidedAt ? `${dateTime(data.decidedAt)}${data.decidedByName ? ` · ${data.decidedByName}` : ""}${data.decidedByRole ? ` (${ROLE_LABEL[data.decidedByRole] ?? data.decidedByRole})` : ""}` : null, wide: true },
                    ...(data.status === "APROBADA" ? [
                      { label: "Monto aprobado", value: cop(data.approvedAmountCOP) },
                      { label: "Tasa", value: `${percent(data.approvedRateEA)} E.A.` },
                      { label: "Plazo", value: `${data.approvedTermMonths} meses` },
                      { label: "Producto final", value: data.finalProductName },
                    ] : []),
                    { label: data.status === "APROBADA" ? "Observación" : "Motivo", value: data.decisionReason, wide: true },
                  ]}
                />
              </Panel>
              <Panel title="Autorización de la persona" description={`Versión ${data.authorization.version} · aceptada el ${dateTime(data.authorization.authorizedAt)}`}>
                <div className="cs-stack" style={{ gap: 10 }}>
                  <pre className="cs-pre">{data.authorization.text}</pre>
                  <div>
                    <strong className="cs-small">Alcance autorizado</strong>
                    <div className="cs-chips" style={{ marginTop: 6 }}>
                      {[...data.authorization.scope.identity, ...data.authorization.scope.facts, ...data.authorization.scope.match].map((item) => <span key={item.key} className="cs-chip">{item.label}</span>)}
                    </div>
                  </div>
                  <small className="cs-muted cs-small">Huella del texto: <span className="cs-mono">{data.authorization.textHash.slice(0, 16)}…</span></small>
                </div>
              </Panel>
            </div>
          </div>
          {dialog === "present" && (
            <PresentForm
              requiresException={data.requiresException}
              institutionName={data.institution.name}
              onClose={() => setDialog(null)}
              onSubmit={async (body) => { presentation.setData(await send<StaffPresentationDetail>("POST", `/admin/matching/presentations/${id}/present`, body)); notify("Presentación registrada. La entidad ya puede verla en su portal."); }}
            />
          )}
          {dialog === "decide" && (
            <DecisionForm
              productName={data.product.name}
              onClose={() => setDialog(null)}
              onSubmit={async (body: DecisionBody) => { presentation.setData(await send<StaffPresentationDetail>("POST", `/admin/matching/presentations/${id}/decision`, body)); notify("Decisión registrada."); }}
            />
          )}
        </>
      )}
    </Loaded>
  );
}

function PresentForm({ requiresException, institutionName, onClose, onSubmit }: { requiresException: boolean; institutionName: string; onClose: () => void; onSubmit: (body: { channel: string; note?: string; exceptionNote?: string }) => Promise<void> }) {
  const [channel, setChannel] = useState("");
  const [note, setNote] = useState("");
  const [exceptionNote, setExceptionNote] = useState("");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await action.run(() => onSubmit({ channel: channel.trim(), note: note.trim() || undefined, exceptionNote: exceptionNote.trim() || undefined }))) onClose();
  };
  return (
    <Modal title="Marcar como presentada" description={`Registra que el perfil ya se envió a ${institutionName}. Desde ese momento la entidad lo ve en su portal.`} onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <Field label="Canal del envío" required hint="Ej.: portal de la entidad, correo del convenio, radicación en oficina."><input value={channel} onChange={(event) => setChannel(event.target.value)} minLength={2} maxLength={80} required /></Field>
        <Field label="Nota" hint="Opcional."><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={2} /></Field>
        {requiresException && (
          <Field label="Sustento de la excepción" required hint="Este resultado tiene requisitos no cumplidos que admiten excepción. Explica por qué se presenta (mínimo 5 caracteres). Solo puede hacerlo quien tenga el nivel de aprobación exigido.">
            <textarea value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} minLength={5} maxLength={2000} rows={3} required />
          </Field>
        )}
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Registrar presentación" />
      </form>
    </Modal>
  );
}
