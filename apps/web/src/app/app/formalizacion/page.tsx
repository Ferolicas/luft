"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Bar, Button, Card, Checkbox, Chip, Header, Icon, OptionCard, Screen, Tip} from "@/components/luft/ui";
import { ConfirmSheet, ConsentBox, FilePicker, Fold, PageState, StatusChip, Steps } from "@/components/luft/v2/kit";
import { fileSize } from "@/lib/profile";
import { cop, fmtDate, fmtDateTime, send, uploadFile, useAction, useResource } from "@/lib/v2/api";
import type { CasePhase, CaseStatus, FormalizationView, TaxAnswers, VaultDocument } from "@/lib/v2/types";

const PHASES: Array<{ key: CasePhase; label: string }> = [
  { key: "DIAGNOSIS", label: "Diagnóstico" },
  { key: "DRAFT", label: "Borrador" },
  { key: "REVIEW", label: "Revisión" },
  { key: "SIGNATURE_AND_FILING", label: "Presentación" },
  { key: "VERIFIED_EVIDENCE", label: "Verificada" },
];
const STATUS_TONE: Record<CaseStatus, "" | "green" | "blue" | "amber" | "violet"> = { SIN_EVALUAR: "", NO_REQUIERE: "green", POSIBLE_OBLIGACION: "amber", DOCUMENTO_CARGADO: "blue", PREPARACION_GUIADA: "blue", REVISION: "violet", PRESENTADO: "blue", VERIFICADO: "green" };
const GROUPS: Array<{ key: keyof TaxAnswers; title: string; options: Array<[string, string]> }> = [
  { key: "incomes", title: "¿Qué ingresos tuviste ese año?", options: [["SALARIO", "Salario"], ["HONORARIOS", "Honorarios"], ["ARRIENDOS", "Arriendos"], ["INTERESES", "Intereses"]] },
  { key: "holdings", title: "¿Qué bienes o deudas tenías?", options: [["VIVIENDA", "Vivienda"], ["VEHICULO", "Vehículo"], ["INVERSIONES", "Inversiones"], ["HIPOTECA", "Hipoteca"]] },
  { key: "deductions", title: "¿Qué deducciones aplican?", options: [["PERSONAS_A_CARGO", "Personas a cargo"], ["PREPAGADA", "Medicina prepagada"], ["PENSION_VOLUNTARIA", "Pensión voluntaria"], ["CUENTA_AFC", "Cuenta AFC"]] },
];
const EVENT: Record<string, string> = {
  DIAGNOSED: "Diagnóstico actualizado",
  ANSWERED_ALREADY_FILED: "Indicaste que ya la presentaste",
  GUIDED_PREPARATION_STARTED: "Empezaste la preparación guiada",
  DECLARATION_UPLOADED: "Cargaste tu declaración",
  DECLARATION_REMOVED: "Retiraste tu declaración",
  SUBMITTED_FOR_REVIEW: "Enviaste tu caso a revisión",
  DIAN_CHANNEL_REQUESTED: "Pediste presentar por el canal de la DIAN",
  OBSERVED: "El profesional dejó una observación",
  REVIEW_APPROVED: "El profesional aprobó la revisión",
  MARKED_FILED: "Se registró la presentación",
  VERIFIED: "Se verificó la presentación",
};
const ACTOR = { USER: "Tú", STAFF: "Profesional LUFT", SYSTEM: "LUFT" } as const;
const EMPTY: TaxAnswers = { incomes: [], holdings: [], deductions: [] };

export default function FormalizationPage() {
  const { reload: reloadDashboard, notify } = useLuft();
  const resource = useResource<FormalizationView>("/luft/formalization");
  const action = useAction();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState<TaxAnswers | null>(null);
  const [upload, setUpload] = useState<{ kind: "declaration" | "support"; percent: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const view = resource.data;
  if (!view) return <PageState title="Formalización tributaria" back="/app/ruta" failure={resource.failure} onRetry={resource.reload} label="Revisando tu caso…" />;

  const { diagnosis, consent, actions, documents } = view;
  const item = view.case;
  const can = (name: (typeof actions)[number]) => actions.includes(name);
  const apply = (next: FormalizationView, message?: string) => { resource.setData(next); if (message) notify(message); void reloadDashboard(); };
  const phaseIndex = PHASES.findIndex((phase) => phase.key === item.phase);
  const steps = PHASES.map((phase, index) => ({ ...phase, status: item.status === "VERIFICADO" || index < phaseIndex ? ("DONE" as const) : index === phaseIndex ? ("CURRENT" as const) : ("PENDING" as const) }));
  const declarations = documents.filter((doc) => doc.purpose === "TAX_DECLARATION");
  const supports = documents.filter((doc) => doc.purpose === "TAX_SUPPORT");
  const preparation = draft ?? item.preparation ?? EMPTY;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(item.preparation ?? EMPTY);
  const history = [...view.history].sort((a, b) => b.at.localeCompare(a.at));
  const observation = ["DOCUMENTO_CARGADO", "PREPARACION_GUIADA", "REVISION"].includes(item.status) && history[0]?.actor === "STAFF" && history[0].note ? history[0] : null;
  const asking = can("ANSWER_FILED") && (item.alreadyFiled === null || changing);
  const uploading = item.status === "DOCUMENTO_CARGADO" || (item.alreadyFiled === true && !asking);
  const guided = item.path === "GUIDED" && item.status !== "SIN_EVALUAR";

  const sendAnswer = () => action.run(async () => {
    const next = await send<FormalizationView>("POST", "/luft/formalization/answer", { alreadyFiled: answer, authorization: true });
    setChanging(false); setAnswer(null);
    apply(next, answer ? "Listo. Ahora sube tu declaración." : "Empezaste la preparación guiada.");
  });
  const savePreparation = () => action.run(async () => { const next = await send<FormalizationView>("PUT", "/luft/formalization/preparation", preparation); setDraft(null); apply(next, "Guardamos tu preparación."); });
  const toggle = (key: keyof TaxAnswers, value: string) => setDraft({ ...preparation, [key]: preparation[key].includes(value) ? preparation[key].filter((entry) => entry !== value) : [...preparation[key], value] });
  const sendFile = (kind: "declaration" | "support", file: File) => action.run(async () => {
    setUpload({ kind, percent: 0 });
    try { const next = await uploadFile<FormalizationView>(`/luft/formalization/documents/${kind}`, file, (percent) => setUpload({ kind, percent })); apply(next, kind === "declaration" ? "Declaración cargada." : "Soporte cargado."); }
    finally { setUpload(null); }
  });
  const removeDocument = (id: string) => action.run(async () => apply(await send<FormalizationView>("DELETE", `/luft/formalization/documents/${id}`), "Documento retirado."));
  const diagnose = () => action.run(async () => apply(await send<FormalizationView>("POST", "/luft/formalization/diagnose"), "Diagnóstico actualizado."));
  const submit = () => action.run(async () => { const next = await send<FormalizationView>("POST", "/luft/formalization/submit"); setConfirm(false); apply(next, "Tu caso quedó en revisión profesional."); });

  const documentRow = (doc: VaultDocument) => (
    <div className="v2-doc" key={doc.id}>
      <span className="l-icon-box sm"><Icon name="description" size={16} /></span>
      <span className="l-grow"><strong>{doc.fileName}</strong><small>{fileSize(doc.sizeBytes)} · {fmtDate(doc.uploadedAt)}</small></span>
      <a className="v2-icon-btn" href={`/api/luft/formalization/documents/${doc.id}/file`} target="_blank" rel="noreferrer" aria-label={`Ver ${doc.fileName}`}><Icon name="visibility" size={18} /></a>
      {can("DELETE_DOCUMENT") && <button type="button" className="v2-icon-btn danger" onClick={() => removeDocument(doc.id)} disabled={action.busy} aria-label={`Retirar ${doc.fileName}`}><Icon name="delete" size={18} /></button>}
    </div>
  );

  const diagnosisCard = (
            <Card>
              <div className="v2-card-head"><div><h3>Diagnóstico</h3><p className="l-small">{item.diagnosedAt ? `Actualizado el ${fmtDate(item.diagnosedAt)}` : "Aún sin evaluar"}</p></div>{diagnosis.ready && diagnosis.available && <Chip tone={diagnosis.mayHaveToFile ? "amber" : "green"}>{diagnosis.mayHaveToFile ? "Posible obligación" : "Sin alerta"}</Chip>}</div>
              <p className="v2-lead">{diagnosis.summary}</p>
              {diagnosis.ready && diagnosis.available && (
                <div className="v2-criteria">{diagnosis.criteria.map((criterion) => (
                  <div className={`v2-criterion ${criterion.exceeds ? "over" : ""}`} key={criterion.key}>
                    <div className="row"><strong>{criterion.label}</strong><span>{cop(criterion.valueCOP)}</span></div>
                    <Bar value={(criterion.valueCOP / criterion.limitCOP) * 100} tone={criterion.exceeds ? "amber" : "green"} label={criterion.label} />
                    <small>Tope: {cop(criterion.limitCOP)} ({new Intl.NumberFormat("es-CO").format(criterion.limitUvt)} UVT) · {criterion.exceeds ? "supera el tope" : "no supera el tope"}</small>
                  </div>
                ))}</div>
              )}
              {!diagnosis.ready && diagnosis.available && <Button small href="/app/perfil/financiero" arrow>Completar mi perfil financiero</Button>}
              <Tip tone="amber" icon="info" title="Es una orientación, no una determinación">{diagnosis.disclaimer}</Tip>
              {diagnosis.rule && (
                <Fold summary={`Regla aplicada: año ${diagnosis.rule.taxYear} · versión ${diagnosis.rule.version}`}>
                  <div className="l-kv">
                    <div>Valor de la UVT<strong>{cop(diagnosis.rule.uvtCOP)}</strong></div>
                    <div>Vigente desde<strong>{fmtDate(diagnosis.rule.effectiveFrom)}</strong></div>
                  </div>
                  <p className="l-small">{diagnosis.rule.sourceDocument}</p>
                  {diagnosis.criteria.map((criterion) => <p className="l-small" key={criterion.key}>{criterion.explanation}</p>)}
                </Fold>
              )}
              {can("DIAGNOSE") && diagnosis.ready && <div className="v2-actions"><button type="button" className="v2-mini" onClick={diagnose} disabled={action.busy}><Icon name="sync" size={16} />Actualizar diagnóstico</button></div>}
            </Card>
  );

  return (
    <Screen className="v2-wide">
      <Header back="/app/ruta" topTitle={`Año gravable ${item.taxYear}`} title="Formalización tributaria" subtitle="Una orientación para dejar tu situación al día. Es un medio para fortalecer tu perfil.">
        <Steps items={steps} label="Fases de tu caso" />
      </Header>
      <div className="l-body">
        <div className="v2-cols">
          <div className="v2-main">
            <Card>
              <div className="v2-card-head"><span className="l-overline">Tu caso</span><StatusChip tone={STATUS_TONE[item.status]}>{item.statusLabel}</StatusChip></div>
              <StatusBlock view={view} />
              {observation && <Tip tone="amber" icon="warning" title="Observación del profesional">{observation.note}<span style={{ display: "block", marginTop: 4 }}>{fmtDateTime(observation.at)} · Corrige lo indicado y vuelve a enviar tu caso.</span></Tip>}
              {action.failure && <Alert>{action.failure}</Alert>}
            </Card>

            {item.phase === "DIAGNOSIS" && diagnosisCard}

            {asking && (
              <Card>
                <div><h3 className="v2-h3">¿Ya presentaste tu declaración de renta del año gravable {item.taxYear}?</h3>{item.status === "NO_REQUIERE" && <p className="l-small" style={{ marginTop: 4 }}>No es un paso obligatorio de tu ruta. Si la presentaste o quieres prepararla, puedes continuar.</p>}</div>
                <div className="l-stack" role="radiogroup" aria-label="¿Ya presentaste tu declaración?">
                  <OptionCard icon="upload" title="Sí, ya la presenté" description="Sube el formulario para que un profesional lo revise." selected={answer === true} onSelect={() => setAnswer(true)} />
                  <OptionCard icon="calculate" title="No, quiero prepararla aquí" description="Te guiamos para reunir ingresos, bienes y deducciones." selected={answer === false} onSelect={() => setAnswer(false)} />
                </div>
                {consent.granted
                  ? <Tip tone="green" icon="check_circle" title="Autorización vigente">Ya autorizaste el tratamiento de tu declaración y tus soportes.</Tip>
                  : <><ConsentBox text={consent.text} /><Checkbox checked={authorized} onChange={setAuthorized}>Leí y acepto esta autorización (versión {consent.version}).</Checkbox></>}
                <Button arrow disabled={answer === null || (!consent.granted && !authorized) || action.busy} onClick={sendAnswer}>{action.busy ? "Guardando…" : "Continuar"}</Button>
                {changing && <button type="button" className="l-link-button" onClick={() => setChanging(false)}>Cancelar</button>}
              </Card>
            )}

            {uploading && (
              <Card>
                <div className="v2-card-head"><div><h3>Tu declaración presentada</h3><p className="l-small">{declarations.length} de {view.limits.declarations} archivos</p></div>{can("ANSWER_FILED") && !changing && <button type="button" className="v2-mini ghost" onClick={() => setChanging(true)}>Cambiar respuesta</button>}</div>
                {declarations.length > 0 && <div className="v2-docs">{declarations.map(documentRow)}</div>}
                {can("UPLOAD_DECLARATION") && declarations.length < view.limits.declarations && <FilePicker label={declarations.length ? "Agregar otro archivo de la declaración" : "Sube tu declaración (formulario 210)"} busy={upload?.kind === "declaration"} progress={upload?.kind === "declaration" ? upload.percent : null} onFile={(file) => sendFile("declaration", file)} />}
              </Card>
            )}

            {guided && (
              <Card>
                <div className="v2-card-head"><div><h3>Preparación guiada</h3><p className="l-small">Marca lo que aplica a tu año gravable {item.taxYear}. Necesitas al menos un ingreso.</p></div></div>
                {GROUPS.map((group) => (
                  <fieldset className="v2-group" key={group.key} disabled={!can("SAVE_PREPARATION")}>
                    <legend>{group.title}</legend>
                    <div className="v2-checks">{group.options.map(([value, label]) => <Checkbox key={value} row checked={preparation[group.key].includes(value)} onChange={() => toggle(group.key, value)}>{label}</Checkbox>)}</div>
                  </fieldset>
                ))}
                {can("SAVE_PREPARATION") && <Button variant={dirty ? "primary" : "secondary"} small disabled={!dirty || action.busy} onClick={savePreparation}>{dirty ? "Guardar preparación" : item.preparation ? "Preparación guardada" : "Marca lo que aplica"}</Button>}
                {can("UPLOAD_DECLARATION") && <Fold summary="¿Ya la presentaste? Sube la declaración"><FilePicker label="Sube tu declaración (formulario 210)" busy={upload?.kind === "declaration"} progress={upload?.kind === "declaration" ? upload.percent : null} onFile={(file) => sendFile("declaration", file)} /><span className="l-small">Al subirla, tu caso pasa a «Declaración cargada».</span></Fold>}
              </Card>
            )}

            {(guided || uploading || supports.length > 0) && consent.granted && (
              <Card>
                <div className="v2-card-head"><div><h3>Soportes</h3><p className="l-small">{supports.length} de {view.limits.supports} · certificados de ingresos, extractos, facturas</p></div></div>
                {supports.length > 0 ? <div className="v2-docs">{supports.map(documentRow)}</div> : <p className="l-muted">Aún no has cargado soportes. Ayudan al profesional a revisar tu caso.</p>}
                {can("UPLOAD_SUPPORT") && supports.length < view.limits.supports && <FilePicker label="Agregar un soporte" busy={upload?.kind === "support"} progress={upload?.kind === "support" ? upload.percent : null} onFile={(file) => sendFile("support", file)} />}
                <span className="v2-private"><Icon name="lock" size={16} />Tus archivos se guardan cifrados y solo los ve el profesional que revisa tu caso.</span>
              </Card>
            )}
          </div>

          <aside className="v2-side">
            {item.phase !== "DIAGNOSIS" && diagnosisCard}

            <Card>
              <div className="v2-card-head"><h3>Línea de tiempo</h3></div>
              {history.length === 0 ? <p className="l-muted">Tu caso aún no tiene movimientos.</p> : (
                <ol className="v2-timeline">{history.map((event) => (
                  <li key={event.id}>
                    <strong>{EVENT[event.action] ?? event.toLabel}</strong>
                    <small>{fmtDateTime(event.at)} · {ACTOR[event.actor]}{event.from !== event.to ? ` · ${event.toLabel}` : ""}</small>
                    {event.note && <div className="note"><b>{event.action === "OBSERVED" ? "Observación del profesional" : event.actor === "STAFF" ? "Nota del profesional" : "Nota"}</b>{event.note}</div>}
                  </li>
                ))}</ol>
              )}
            </Card>

            <Card className="tight">
              <span className="l-overline" style={{ color: "var(--l-n-600)" }}>Lo que hoy no hace LUFT</span>
              {!view.extraction.available && <Tip tone="amber" icon="description" title="Lectura automática de la declaración">{view.extraction.message}</Tip>}
              {!view.dian.available && <Tip tone="amber" icon="account_balance" title="Presentación ante la DIAN">{view.dian.message}</Tip>}
            </Card>
          </aside>
        </div>
      </div>
      {can("SUBMIT_FOR_REVIEW") && <div className="l-footer"><Button arrow disabled={action.busy || dirty} onClick={() => setConfirm(true)}>Enviar a revisión profesional</Button>{dirty && <small>Guarda tu preparación antes de enviarla.</small>}</div>}
      {confirm && (
        <ConfirmSheet title="¿Enviar tu caso a revisión?" confirm="Sí, enviar a revisión" busy={action.busy} failure={action.failure} onConfirm={submit} onClose={() => setConfirm(false)}>
          <p>Un profesional revisará {item.status === "DOCUMENTO_CARGADO" ? "tu declaración" : "tu preparación"} y tus soportes. Mientras esté en revisión no podrás cambiar los documentos.</p>
          <p>Si falta algo, te dejará una observación y el caso volverá a ti.</p>
        </ConfirmSheet>
      )}
    </Screen>
  );
}

function StatusBlock({ view }: { view: FormalizationView }) {
  const { status, taxYear, reviewApproved, formNumber, filedAt, verifiedAt, submittedAt, reviewApprovedAt } = view.case;
  const { diagnosis } = view;
  if (status === "SIN_EVALUAR") return diagnosis.available
    ? <><h2 className="v2-title">Completa tu perfil para hacer el diagnóstico</h2><p className="v2-lead">Necesitamos tus ingresos, tu patrimonio y tus deudas para compararlos con los topes del año gravable {taxYear}.</p></>
    : <><h2 className="v2-title">Aún no hay regla publicada para este año</h2><p className="v2-lead">{diagnosis.summary}</p></>;
  if (status === "NO_REQUIERE") return <><h2 className="v2-title">No parece que debas declarar renta</h2><p className="v2-lead">Con lo que declaraste no superas los topes del año gravable {taxYear}. Este paso de tu ruta queda al día; si tus datos cambian, actualiza el diagnóstico.</p></>;
  if (status === "POSIBLE_OBLIGACION") return <>
    <h2 className="v2-title">Es posible que debas declarar renta</h2>
    <p className="v2-lead">Tus datos superan {diagnosis.criteria.filter((criterion) => criterion.exceeds).length === 1 ? "un tope" : `${diagnosis.criteria.filter((criterion) => criterion.exceeds).length} topes`} del año gravable {taxYear}. Mira el detalle en el diagnóstico y revisemos tu caso paso a paso.</p>
  </>;
  if (status === "DOCUMENTO_CARGADO") return <><h2 className="v2-title">Tu declaración está cargada</h2><p className="v2-lead">Agrega los soportes que tengas y envíala a revisión profesional cuando esté completa.</p></>;
  if (status === "PREPARACION_GUIADA") return <><h2 className="v2-title">Estás preparando tu declaración</h2><p className="v2-lead">Marca lo que aplica a tu año, sube tus soportes y envía tu caso a un profesional para que lo revise.</p></>;
  if (status === "REVISION") return reviewApproved
    ? <><h2 className="v2-title">Revisión aprobada: falta presentarla</h2><p className="v2-lead">El profesional aprobó tu caso{reviewApprovedAt ? ` el ${fmtDate(reviewApprovedAt)}` : ""}. La declaración se presenta por los canales de la DIAN y aquí registramos el número de formulario.</p></>
    : <><h2 className="v2-title">Un profesional está revisando tu caso</h2><p className="v2-lead">Lo enviaste{submittedAt ? ` el ${fmtDate(submittedAt)}` : ""}. Te avisaremos cuando haya una respuesta o una observación.</p></>;
  if (status === "PRESENTADO") return <>
    <h2 className="v2-title">Declaración presentada</h2>
    <div className="l-kv"><div>Número de formulario<strong>{formNumber ?? "—"}</strong></div><div>Fecha de presentación<strong>{fmtDate(filedAt) || "—"}</strong></div></div>
    <p className="v2-lead">Falta la verificación final del profesional para que cuente como evidencia en tu perfil.</p>
  </>;
  return <>
    <h2 className="v2-title">Formalización verificada</h2>
    <div className="l-kv"><div>Número de formulario<strong>{formNumber ?? "—"}</strong></div><div>Presentada el<strong>{fmtDate(filedAt) || "—"}</strong></div><div>Verificada el<strong>{fmtDate(verifiedAt) || "—"}</strong></div></div>
    <Tip tone="green" icon="verified_user" title="Ya es evidencia de tu perfil">Tu declaración verificada suma a las evidencias de tu ruta.</Tip>
  </>;
}
