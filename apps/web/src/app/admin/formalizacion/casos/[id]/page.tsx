"use client";

import { Download } from "lucide-react";
import { useParams } from "next/navigation";
import { type FormEvent, Fragment, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { Badge, Button, ConfirmDialog, ErrorBox, Facts, Field, FormActions, Loaded, Modal, PageHead, Panel, StatusBadge, useAction, useLoad } from "@/components/admin/ui";
import { cop, dateTime, day, integer, today } from "@/lib/admin/format";
import { ACTOR_LABEL, type CaseAction, type CaseDetail, HISTORY_LABEL, PATH_LABEL } from "@/lib/admin/formalization-types";
import { download, get, send } from "@/lib/admin/http";
import { label, TAX_RULE_STATUS_LABEL } from "@/lib/admin/labels";

const STEPS = [
  { key: "DIAGNOSIS", label: "Diagnóstico" },
  { key: "DRAFT", label: "Borrador" },
  { key: "REVIEW", label: "Revisión" },
  { key: "SIGNATURE_AND_FILING", label: "Firma y presentación" },
  { key: "VERIFIED_EVIDENCE", label: "Evidencia verificada" },
];
const ANSWER_LABEL: Record<string, string> = { SALARIO: "Salario", HONORARIOS: "Honorarios", ARRIENDOS: "Arriendos", INTERESES: "Intereses", VIVIENDA: "Vivienda", VEHICULO: "Vehículo", INVERSIONES: "Inversiones", HIPOTECA: "Hipoteca" };
const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { notify } = useConsole();
  const detail = useLoad(() => get<CaseDetail>(`/admin/formalization/cases/${id}`), [id]);
  const [dialog, setDialog] = useState<CaseAction | null>(null);
  const files = useAction();

  const act = async (path: string, body: unknown, message: string) => {
    const next = await send<CaseDetail>("POST", `/admin/formalization/cases/${id}/${path}`, body);
    detail.setData(next);
    notify(message);
  };

  return (
    <Loaded loader={detail} label="Cargando el caso…">
      {(data) => {
        const stepIndex = STEPS.findIndex((step) => step.key === data.case.phase);
        const can = (action: CaseAction) => data.actions.includes(action);
        return (
          <>
            <PageHead
              back={{ href: "/admin/formalizacion/casos", label: "Casos de formalización" }}
              eyebrow={`Año gravable ${data.case.taxYear}`}
              title={data.user?.fullName ?? "Caso de formalización"}
              description={<span className="cs-row"><StatusBadge value={data.case.status} text={data.case.statusLabel} />{data.case.path && <Badge>{PATH_LABEL[data.case.path]}</Badge>}{data.case.reviewApproved && <Badge tone="good">Revisión aprobada</Badge>}</span>}
              actions={
                <>
                  {can("OBSERVE") && <Button variant="ghost" onClick={() => setDialog("OBSERVE")}>Devolver con observaciones</Button>}
                  {can("APPROVE") && <Button onClick={() => setDialog("APPROVE")}>Aprobar revisión</Button>}
                  {can("MARK_FILED") && <Button onClick={() => setDialog("MARK_FILED")}>Registrar presentación</Button>}
                  {can("VERIFY") && <Button onClick={() => setDialog("VERIFY")}>Verificar evidencia</Button>}
                </>
              }
            />
            <div className="cs-steps" aria-label="Fase del caso">
              {STEPS.map((step, index) => (
                <Fragment key={step.key}>
                  {index > 0 && <i aria-hidden="true" />}
                  <span className={index < stepIndex ? "done" : index === stepIndex ? "current" : ""}>{index + 1}. {step.label}</span>
                </Fragment>
              ))}
            </div>
            {data.actions.length === 0 && <p className="cs-note">{data.case.status === "VERIFICADO" ? "Caso cerrado: la evidencia quedó verificada y se incorporó al perfil de la persona." : "Este caso está del lado de la persona: no hay acciones de revisión disponibles en su estado actual."}</p>}
            <div className="cs-grid cs-grid-side">
              <div className="cs-stack">
                <Panel title="Diagnóstico de posible obligación" description={data.diagnosis?.summary}>
                  {data.diagnosis ? (
                    <div className="cs-stack" style={{ gap: 10 }}>
                      <div className="cs-table-wrap">
                        <table className="cs-table cs-table-compact">
                          <caption>Criterios del diagnóstico</caption>
                          <thead><tr><th scope="col">Criterio</th><th scope="col" className="is-right">Declarado</th><th scope="col" className="is-right">Tope</th><th scope="col">Resultado</th></tr></thead>
                          <tbody>
                            {data.diagnosis.criteria.map((criterion) => (
                              <tr key={criterion.key} title={criterion.explanation}>
                                <td>{criterion.label}</td>
                                <td className="is-right">{cop(criterion.valueCOP)}</td>
                                <td className="is-right">{cop(criterion.limitCOP)}<div className="cs-muted cs-small">{integer(criterion.limitUvt)} UVT</div></td>
                                <td><Badge tone={criterion.exceeds ? "warn" : "good"}>{criterion.exceeds ? "Supera el tope" : "No supera"}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="cs-note cs-note-warn">{data.diagnosis.disclaimer}</p>
                    </div>
                  ) : <p className="cs-muted">El caso aún no tiene diagnóstico.</p>}
                </Panel>
                <Panel title="Documentos" description="Cada descarga queda registrada en la auditoría.">
                  <ErrorBox problem={files.problem} />
                  {data.documents.length === 0 ? <p className="cs-muted">La persona no ha cargado documentos.</p> : (
                    <div className="cs-table-wrap">
                      <table className="cs-table cs-table-compact">
                        <caption>Documentos del caso</caption>
                        <thead><tr><th scope="col">Archivo</th><th scope="col">Tipo</th><th scope="col">Cargado</th><th scope="col" /></tr></thead>
                        <tbody>
                          {data.documents.map((document) => (
                            <tr key={document.id}>
                              <td><strong>{document.fileName}</strong><div className="cs-muted cs-small">{size(document.sizeBytes)} · SHA-256 <span className="cs-mono">{document.sha256.slice(0, 12)}…</span></div></td>
                              <td>{label(document.purpose)}</td>
                              <td>{dateTime(document.uploadedAt)}</td>
                              <td className="is-right"><Button small variant="ghost" disabled={files.busy} onClick={() => void files.run(() => download(`/admin/formalization/cases/${id}/documents/${document.id}/file`, document.fileName))}><Download size={14} /> Descargar</Button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
                {data.case.preparation && (
                  <Panel title="Preparación guiada" description="Lo que la persona respondió para preparar su declaración.">
                    <Facts
                      columns={3}
                      items={[
                        { label: "Ingresos", value: data.case.preparation.incomes.map((item) => ANSWER_LABEL[item] ?? label(item)).join(", ") },
                        { label: "Patrimonio y deudas", value: data.case.preparation.holdings.map((item) => ANSWER_LABEL[item] ?? label(item)).join(", ") },
                        { label: "Deducciones", value: data.case.preparation.deductions.map((item) => ANSWER_LABEL[item] ?? label(item)).join(", ") },
                      ]}
                    />
                  </Panel>
                )}
              </div>
              <div className="cs-stack">
                <Panel title="Persona y caso">
                  <Facts
                    columns={2}
                    items={[
                      { label: "Nombre", value: data.user?.fullName },
                      { label: "Correo", value: data.user?.email },
                      { label: "Celular", value: data.user?.phone },
                      { label: "¿Ya declaró?", value: data.case.alreadyFiled === null ? "Sin respuesta" : data.case.alreadyFiled ? "Sí" : "No" },
                      { label: "Diagnosticado", value: dateTime(data.case.diagnosedAt) },
                      { label: "Enviado a revisión", value: dateTime(data.case.submittedAt) },
                      { label: "Revisión aprobada", value: data.case.reviewApprovedAt ? dateTime(data.case.reviewApprovedAt) : "—" },
                      { label: "Formulario presentado", value: data.case.formNumber ? `${data.case.formNumber} · ${day(data.case.filedAt)}` : "—" },
                      { label: "Verificado", value: data.case.verifiedAt ? dateTime(data.case.verifiedAt) : "—" },
                    ]}
                  />
                </Panel>
                {data.rule && (
                  <Panel title="Regla aplicada">
                    <Facts
                      columns={2}
                      items={[
                        { label: "Año y versión", value: `${data.rule.taxYear} · v${data.rule.version}` },
                        { label: "Estado", value: <StatusBadge value={data.rule.status} labels={TAX_RULE_STATUS_LABEL} /> },
                        { label: "UVT", value: cop(data.rule.uvtCOP) },
                        { label: "Vigente desde", value: day(data.rule.effectiveFrom) },
                        { label: "Fuente documental", value: <span style={{ fontWeight: 500 }}>{data.rule.sourceDocument}</span>, wide: true },
                      ]}
                    />
                  </Panel>
                )}
                <Panel title="Historial">
                  <ol className="cs-timeline">
                    {[...data.history].reverse().map((event) => (
                      <li key={event.id}>
                        <strong>{HISTORY_LABEL[event.action] ?? label(event.action)}</strong>
                        <small>{dateTime(event.at)} · {ACTOR_LABEL[event.actor] ?? event.actor}{event.toLabel && event.from !== event.to ? ` · pasa a «${event.toLabel}»` : ""}</small>
                        {event.note && <p>{event.note}</p>}
                      </li>
                    ))}
                  </ol>
                </Panel>
              </div>
            </div>
            {dialog === "OBSERVE" && (
              <ConfirmDialog
                title="Devolver con observaciones"
                confirmLabel="Devolver a la persona"
                reason={{ label: "Observaciones para la persona", min: 10, placeholder: "Ej.: el formulario cargado corresponde a otro año gravable; por favor carga el del año 2025." }}
                onClose={() => setDialog(null)}
                onConfirm={(note) => act("observe", { note }, "Caso devuelto a la persona con observaciones.")}
              >
                <p>El caso vuelve a la persona para que lo corrija y lo envíe de nuevo. Verá tu observación en su app.</p>
              </ConfirmDialog>
            )}
            {dialog === "APPROVE" && (
              <ConfirmDialog
                title="Aprobar la revisión profesional"
                confirmLabel="Aprobar revisión"
                reason={{ label: "Nota de la revisión", min: 0, optional: true, placeholder: "Opcional." }}
                onClose={() => setDialog(null)}
                onConfirm={(note) => act("approve", note ? { note } : {}, "Revisión aprobada. Ya se puede registrar la presentación.")}
              >
                <p>Confirmas que revisaste los documentos y el diagnóstico de <strong>{data.user?.fullName}</strong>. Después podrás registrar la presentación real ante la DIAN.</p>
              </ConfirmDialog>
            )}
            {dialog === "VERIFY" && (
              <ConfirmDialog
                title="Verificar la evidencia"
                confirmLabel="Verificar y cerrar el caso"
                reason={{ label: "Nota de verificación", min: 0, optional: true, placeholder: "Opcional." }}
                onClose={() => setDialog(null)}
                onConfirm={(note) => act("verify", note ? { note } : {}, "Evidencia verificada. El caso quedó cerrado.")}
              >
                <p>La declaración presentada (formulario <strong>{data.case.formNumber}</strong>) pasará a ser evidencia verificada del perfil de la persona. Esta acción cierra el caso.</p>
              </ConfirmDialog>
            )}
            {dialog === "MARK_FILED" && <FiledForm onClose={() => setDialog(null)} onSubmit={(body) => act("filed", body, "Presentación registrada.")} />}
          </>
        );
      }}
    </Loaded>
  );
}

function FiledForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (body: { formNumber: string; filedAt: string; note?: string }) => Promise<void> }) {
  const [formNumber, setFormNumber] = useState("");
  const [filedAt, setFiledAt] = useState(today());
  const [note, setNote] = useState("");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await action.run(() => onSubmit({ formNumber: formNumber.trim(), filedAt, note: note.trim() || undefined }))) onClose();
  };
  return (
    <Modal title="Registrar la presentación" description="Solo registra una declaración que realmente se presentó ante la DIAN." onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields">
          <Field label="Número de formulario" required hint="De 6 a 40 caracteres: letras, números o guiones."><input value={formNumber} onChange={(event) => setFormNumber(event.target.value)} pattern="[0-9A-Za-z\-]{6,40}" required /></Field>
          <Field label="Fecha de presentación" required hint="No puede ser futura."><input type="date" value={filedAt} max={today()} onChange={(event) => setFiledAt(event.target.value)} required /></Field>
          <Field label="Nota" wide hint="Opcional."><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} rows={2} /></Field>
        </div>
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Registrar presentación" />
      </form>
    </Modal>
  );
}
