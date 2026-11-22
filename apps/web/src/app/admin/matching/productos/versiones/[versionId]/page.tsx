"use client";

import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { useMatchingCatalog } from "@/components/admin/matching";
import { PolicyRuleForm } from "@/components/admin/policy-rule-form";
import { PolicySimulator } from "@/components/admin/policy-simulator";
import { Badge, Button, ConfirmDialog, ErrorBox, Facts, Field, FormActions, Loaded, Modal, PageHead, Panel, StatusBadge, useAction, useLoad } from "@/components/admin/ui";
import { dateTime, day, today } from "@/lib/admin/format";
import { get, send } from "@/lib/admin/http";
import { label } from "@/lib/admin/labels";
import { type MatchingCatalog, optionLabel, POLICY_FLOW, type PolicyStatus, type Rule, type RuleInput, type VersionDetail } from "@/lib/admin/matching-types";
import { can, ROLE_LABEL } from "@/lib/admin/nav";

const TRANSITION: Record<PolicyStatus, { button: string; title: string; done: string; note: "required" | "optional"; danger?: boolean }> = {
  REVISION: { button: "Enviar a revisión", title: "Enviar a revisión", done: "Versión enviada a revisión.", note: "optional" },
  BORRADOR: { button: "Devolver a borrador", title: "Devolver a borrador", done: "Versión devuelta a borrador.", note: "required" },
  APROBADA: { button: "Aprobar", title: "Aprobar la versión", done: "Versión aprobada.", note: "optional" },
  VIGENTE: { button: "Poner vigente", title: "Poner vigente la versión", done: "La versión quedó vigente.", note: "optional" },
  SUSPENDIDA: { button: "Suspender", title: "Suspender la versión", done: "Versión suspendida.", note: "required", danger: true },
  SUSTITUIDA: { button: "Sustituir", title: "Sustituir", done: "", note: "optional" },
};
const INDEPENDENCE_TEXT: Record<string, string> = { OTRO_ROL: "Aprobada por otra persona con otro rol", OTRA_PERSONA: "Aprobada por otra persona", MISMA_PERSONA: "Aprobada por la misma persona que la editó (no había otra disponible)" };
const kindTone = (kind: string) => (kind === "EXCLUSION" ? "bad" : kind === "PREFERENCIA" ? "info" : "neutral");

export default function PolicyVersionPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const router = useRouter();
  const { user, notify } = useConsole();
  const { catalog, problem } = useMatchingCatalog();
  const version = useLoad(() => get<VersionDetail>(`/admin/matching/versions/${versionId}`), [versionId]);
  const [ruleForm, setRuleForm] = useState<Rule | "new" | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [target, setTarget] = useState<PolicyStatus | null>(null);
  const [dialog, setDialog] = useState<"edit" | "clone" | "delete" | null>(null);
  const canWrite = can("writePolicies", user.role);

  return (
    <Loaded loader={version} label="Cargando la versión…">
      {(data) => {
        const editable = data.editable && canWrite;
        const flowIndex = POLICY_FLOW.indexOf(data.status);
        return (
          <>
            <PageHead
              back={{ href: `/admin/matching/productos/${data.productId}`, label: data.product.name }}
              eyebrow={`${data.product.institutionName} · ${optionLabel(catalog?.productKinds, data.product.kind)}`}
              title={`Política versión ${data.version}`}
              description={<span className="cs-row"><StatusBadge value={data.status} text={data.statusLabel} /><span>{data.rules.length} {data.rules.length === 1 ? "regla" : "reglas"}</span>{data.effectiveFrom && <span>Vigente desde {day(data.effectiveFrom)}{data.effectiveTo ? ` hasta ${day(data.effectiveTo)}` : ""}</span>}{data.clonedFromId && <Link className="cs-link" href={`/admin/matching/productos/versiones/${data.clonedFromId}`}>Clonada de otra versión</Link>}</span>}
              actions={canWrite && (
                <>
                  {data.allowedTransitions.map((status) => <Button key={status} variant={status === "BORRADOR" || status === "SUSPENDIDA" ? "ghost" : "primary"} className={status === "SUSPENDIDA" ? "cs-btn-danger-text" : ""} onClick={() => setTarget(status)}>{TRANSITION[status].button}</Button>)}
                  <Button variant="ghost" onClick={() => setDialog("clone")}><Copy size={15} /> Clonar</Button>
                  {data.editable && <Button variant="ghost" className="cs-btn-danger-text" onClick={() => setDialog("delete")}><Trash2 size={15} /> Eliminar borrador</Button>}
                </>
              )}
            />
            <ErrorBox problem={problem} />
            <div className="cs-steps" aria-label="Estado de la versión">
              {POLICY_FLOW.map((status, index) => (
                <span key={status} className="cs-row" style={{ gap: 0 }}>
                  {index > 0 && <i aria-hidden="true" />}
                  <span className={flowIndex > index || (flowIndex === -1) ? "done" : flowIndex === index ? "current" : ""}>{index + 1}. {optionLabel(catalog?.policyStatuses, status)}</span>
                </span>
              ))}
              {(data.status === "SUSTITUIDA" || data.status === "SUSPENDIDA") && <span className="cs-row" style={{ gap: 0 }}><i aria-hidden="true" /><span className="off">{data.statusLabel}</span></span>}
            </div>
            {data.status === "BORRADOR" && data.submissionIssues.length > 0 && (
              <div className="cs-note cs-note-warn">
                <strong>Para enviar a revisión falta:</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, listStyle: "disc" }}>{data.submissionIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              </div>
            )}
            {!data.editable && data.status !== "BORRADOR" && <p className="cs-note">Esta versión ya no es editable. Para cambiar sus reglas, clónala: el borrador nuevo no altera esta versión ni los resultados que la usaron.</p>}
            <div className="cs-grid cs-grid-side">
              <div className="cs-stack">
                <Panel
                  flush
                  title="Reglas"
                  description="Requisito: bloquea si no se cumple. Exclusión: causal de rechazo. Preferencia: solo suma al encaje."
                  actions={editable && catalog && <Button small onClick={() => setRuleForm("new")}><Plus size={15} /> Agregar regla</Button>}
                >
                  {data.rules.length === 0 ? <p className="cs-empty"><strong>Sin reglas</strong><span>{editable ? "Agrega la primera regla con el constructor: campo, operador y valor salen del catálogo del motor." : "Esta versión no tiene reglas."}</span></p> : (
                    <div className="cs-table-wrap">
                      <table className="cs-table">
                        <caption>Reglas de la versión</caption>
                        <thead><tr><th scope="col">#</th><th scope="col">Tipo</th><th scope="col">Regla</th><th scope="col" className="is-center">Peso</th><th scope="col">Tratamiento</th><th scope="col" /></tr></thead>
                        <tbody>
                          {[...data.rules].sort((a, b) => a.position - b.position).map((rule, index) => (
                            <tr key={rule.id}>
                              <td>{index + 1}</td>
                              <td><Badge tone={kindTone(rule.kind)}>{label(rule.kind)}</Badge></td>
                              <td><div className="cs-cell"><strong>{rule.label}</strong><small>{rule.summary}</small></div></td>
                              <td className="is-center">{rule.weight}</td>
                              <td><div className="cs-chips">{rule.internal && <Badge>Interna</Badge>}{rule.exceptionAllowed && <Badge tone="warn">Excepción: {optionLabel(catalog?.exceptionLevels, rule.exceptionApprovalLevel)}</Badge>}{!rule.internal && !rule.exceptionAllowed && <span className="cs-muted">Visible, sin excepción</span>}</div></td>
                              <td>{editable && catalog && <div className="cs-actions"><button type="button" className="cs-icon-btn" aria-label={`Editar regla ${index + 1}`} onClick={() => setRuleForm(rule)}><Pencil size={15} /></button><button type="button" className="cs-icon-btn" aria-label={`Eliminar regla ${index + 1}`} onClick={() => setRemoving(rule)}><Trash2 size={15} /></button></div>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
                {catalog && <PolicySimulator versionId={versionId} rules={data.rules} catalog={catalog} />}
              </div>
              <div className="cs-stack">
                <Panel title="Fuente y responsables" actions={editable && <Button small variant="ghost" onClick={() => setDialog("edit")}>Editar datos</Button>}>
                  <Facts
                    columns={2}
                    items={[
                      { label: "Fuente documental", value: <span style={{ fontWeight: 500 }}>{data.sourceDocument}</span>, wide: true },
                      { label: "Enlace", value: data.sourceUrl ? <a className="cs-link" href={data.sourceUrl} target="_blank" rel="noreferrer noopener">Abrir fuente</a> : null },
                      { label: "Responsable", value: data.responsibleName ?? data.createdByName },
                      { label: "Creada por", value: data.createdByName ? `${data.createdByName} · ${dateTime(data.createdAt)}` : dateTime(data.createdAt) },
                      { label: "Enviada a revisión", value: data.submittedAt ? `${data.submittedByName ?? ""} · ${dateTime(data.submittedAt)}` : null },
                      { label: "Aprobada por", value: data.approvedAt ? `${data.approvedByName ?? ""}${data.approvedByRole ? ` (${ROLE_LABEL[data.approvedByRole] ?? data.approvedByRole})` : ""} · ${dateTime(data.approvedAt)}` : null },
                      { label: "Independencia de la aprobación", value: data.approvalIndependence ? <Badge tone={data.approvalIndependence === "MISMA_PERSONA" ? "warn" : "good"}>{INDEPENDENCE_TEXT[data.approvalIndependence]}</Badge> : null },
                      { label: "Puesta vigente", value: data.activatedAt ? `${data.activatedByName ?? ""} · ${dateTime(data.activatedAt)}` : null },
                      { label: "Vigencia", value: data.effectiveFrom ? `${day(data.effectiveFrom)} → ${data.effectiveTo ? day(data.effectiveTo) : "sin fecha de fin"}` : data.effectiveTo ? `Hasta ${day(data.effectiveTo)}` : null },
                      ...(data.suspendedAt ? [{ label: "Suspendida", value: `${data.suspendedByName ?? ""} · ${dateTime(data.suspendedAt)}${data.suspensionReason ? ` — ${data.suspensionReason}` : ""}`, wide: true }] : []),
                      ...(data.supersededAt ? [{ label: "Sustituida", value: dateTime(data.supersededAt) }] : []),
                      { label: "Notas", value: data.notes ? <span style={{ fontWeight: 500 }}>{data.notes}</span> : null, wide: true },
                    ]}
                  />
                </Panel>
                <Panel title="Historial">
                  {data.history.length === 0 ? <p className="cs-muted">Sin eventos.</p> : (
                    <ol className="cs-timeline">
                      {[...data.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((event) => (
                        <li key={event.id}>
                          <strong>{event.toStatus && event.fromStatus !== event.toStatus ? `${event.fromStatus ? `${optionLabel(catalog?.policyStatuses, event.fromStatus)} → ` : ""}${optionLabel(catalog?.policyStatuses, event.toStatus)}` : label(event.action)}</strong>
                          <small>{dateTime(event.createdAt)} · {event.actorName ?? "Sistema"}{event.actorRole ? ` (${ROLE_LABEL[event.actorRole] ?? event.actorRole})` : ""}{event.toStatus && event.fromStatus !== event.toStatus ? ` · ${label(event.action)}` : ""}</small>
                          {event.note && <p>{event.note}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </Panel>
              </div>
            </div>
            {ruleForm && catalog && (
              <PolicyRuleForm
                catalog={catalog}
                rule={ruleForm === "new" ? null : ruleForm}
                onClose={() => setRuleForm(null)}
                onSubmit={async (input: RuleInput) => {
                  const next = ruleForm === "new" ? await send<VersionDetail>("POST", `/admin/matching/versions/${versionId}/rules`, input) : await send<VersionDetail>("PATCH", `/admin/matching/rules/${ruleForm.id}`, input);
                  version.setData(next);
                  setRuleForm(null);
                  notify(ruleForm === "new" ? "Regla agregada." : "Regla actualizada.");
                }}
              />
            )}
            {removing && (
              <ConfirmDialog title="Eliminar la regla" confirmLabel="Eliminar regla" danger onClose={() => setRemoving(null)} onConfirm={async () => { version.setData(await send<VersionDetail>("DELETE", `/admin/matching/rules/${removing.id}`)); notify("Regla eliminada."); }}>
                <p>Se eliminará «<strong>{removing.label}</strong>» de este borrador.</p>
              </ConfirmDialog>
            )}
            {target && <TransitionDialog version={data} target={target} catalog={catalog} onClose={() => setTarget(null)} onDone={(next) => { version.setData(next); notify(TRANSITION[target].done); }} />}
            {dialog === "edit" && <MetadataForm version={data} onClose={() => setDialog(null)} onSaved={(next) => { version.setData(next); setDialog(null); notify("Datos de la versión actualizados."); }} />}
            {dialog === "clone" && (
              <ConfirmDialog title="Clonar la versión" confirmLabel="Crear borrador clonado" onClose={() => setDialog(null)} onConfirm={async () => { const clone = await send<VersionDetail>("POST", `/admin/matching/versions/${versionId}/clone`); notify(`Borrador versión ${clone.version} creado con las reglas copiadas.`); router.push(`/admin/matching/productos/versiones/${clone.id}`); }}>
                <p>Se creará un <strong>borrador nuevo</strong> con las {data.rules.length} reglas de la versión {data.version}. Esta versión no cambia.</p>
              </ConfirmDialog>
            )}
            {dialog === "delete" && (
              <ConfirmDialog title="Eliminar el borrador" confirmLabel="Eliminar borrador" danger onClose={() => setDialog(null)} onConfirm={async () => { await send("DELETE", `/admin/matching/versions/${versionId}`); notify("Borrador eliminado."); router.push(`/admin/matching/productos/${data.productId}`); }}>
                <p>Se eliminará el borrador versión {data.version} con sus {data.rules.length} reglas. No se puede deshacer.</p>
              </ConfirmDialog>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

function TransitionDialog({ version, target, catalog, onClose, onDone }: { version: VersionDetail; target: PolicyStatus; catalog: MatchingCatalog | null; onClose: () => void; onDone: (next: VersionDetail) => void }) {
  const spec = TRANSITION[target];
  const [note, setNote] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState(version.effectiveTo ?? "");
  const action = useAction();
  const noteRequired = spec.note === "required";
  const noteError = note.trim().length > 0 && note.trim().length < 3 ? "Mínimo 3 caracteres." : null;
  const activating = target === "VIGENTE" && version.status === "APROBADA";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> = { to: target };
    if (note.trim()) body.note = note.trim();
    if (activating) { body.effectiveFrom = effectiveFrom; body.effectiveTo = effectiveTo || null; }
    if (await action.run(async () => onDone(await send<VersionDetail>("POST", `/admin/matching/versions/${version.id}/transition`, body)))) onClose();
  };
  return (
    <Modal title={spec.title} description={`Versión ${version.version} · ${version.statusLabel} → ${optionLabel(catalog?.policyStatuses, target)}`} size="sm" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-confirm-text">
          {target === "REVISION" && <p>La versión deja de ser editable y pasa a quien deba aprobarla. Si necesita cambios, se devuelve a borrador.</p>}
          {target === "APROBADA" && <p>Aprobar exige una persona distinta de quien creó o editó la versión, siempre que exista otra persona de riesgo o superadministración activa.</p>}
          {target === "BORRADOR" && <p>La versión vuelve a ser editable y pierde la aprobación que tuviera.</p>}
          {target === "VIGENTE" && <p>{activating ? <>Desde ahora el matching evaluará este producto con la <strong>versión {version.version}</strong>. La versión vigente anterior quedará sustituida; los resultados históricos conservan la suya.</> : <>La versión {version.version} volverá a usarse en el matching.</>}</p>}
          {target === "SUSPENDIDA" && <p>El producto dejará de evaluarse en el matching hasta que se reactive esta versión o se ponga vigente otra.</p>}
        </div>
        {activating && (
          <div className="cs-fields">
            <Field label="Vigente desde" required hint="No puede ser futura."><input type="date" value={effectiveFrom} max={today()} onChange={(event) => setEffectiveFrom(event.target.value)} required /></Field>
            <Field label="Vigente hasta" hint="Opcional."><input type="date" value={effectiveTo} min={effectiveFrom} onChange={(event) => setEffectiveTo(event.target.value)} /></Field>
          </div>
        )}
        <Field label={noteRequired ? "Motivo" : "Nota"} required={noteRequired} error={noteError} hint={noteRequired ? "Obligatorio. Queda en el historial." : "Opcional. Queda en el historial."}>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} required={noteRequired} />
        </Field>
        <ErrorBox problem={action.problem} />
        <div className="cs-form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.busy}>Cancelar</Button>
          <Button type="submit" variant={spec.danger ? "danger" : "primary"} disabled={action.busy || Boolean(noteError) || (noteRequired && note.trim().length < 3)}>{action.busy ? "Procesando…" : spec.button}</Button>
        </div>
      </form>
    </Modal>
  );
}

function MetadataForm({ version, onClose, onSaved }: { version: VersionDetail; onClose: () => void; onSaved: (next: VersionDetail) => void }) {
  const [sourceDocument, setSourceDocument] = useState(version.sourceDocument);
  const [sourceUrl, setSourceUrl] = useState(version.sourceUrl ?? "");
  const [notes, setNotes] = useState(version.notes ?? "");
  const [effectiveTo, setEffectiveTo] = useState(version.effectiveTo ?? "");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await action.run(async () => onSaved(await send<VersionDetail>("PATCH", `/admin/matching/versions/${version.id}`, { sourceDocument: sourceDocument.trim(), sourceUrl: sourceUrl.trim() || null, notes: notes.trim() || null, effectiveTo: effectiveTo || null })));
  };
  return (
    <Modal title="Datos de la versión" description="Solo se pueden cambiar mientras la versión está en borrador." onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <Field label="Fuente documental" required><textarea value={sourceDocument} onChange={(event) => setSourceDocument(event.target.value)} minLength={3} maxLength={2000} rows={2} required /></Field>
        <div className="cs-fields">
          <Field label="Enlace a la fuente"><input type="url" placeholder="https://…" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} maxLength={1000} /></Field>
          <Field label="Vigente hasta" hint="Opcional."><input type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} /></Field>
        </div>
        <Field label="Notas"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} rows={2} /></Field>
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Guardar" />
      </form>
    </Modal>
  );
}
