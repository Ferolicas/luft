"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Chip, Field, Header, Icon, MoneyInput, Screen, Tip } from "@/components/luft/ui";
import { Labeled } from "@/components/luft/v2/household";
import { ConfirmSheet, Empty, Facts, ListRow, PageState, SectionTitle, StatusChip } from "@/components/luft/v2/kit";
import { AuthorizeSheet, PRESENTATION, ResultCard } from "@/components/luft/v2/matching";
import { api } from "@/lib/api";
import { cop, fmtDate, fmtDateTime, plural, send, useAction, useResource } from "@/lib/v2/api";
import type { MatchHistory, MatchingView, MatchResult, Presentation, RunView } from "@/lib/v2/types";

/** La clasificación (que define el arquetipo) se responde en Mi ruta. */
const readinessHref = (item: { code: string; href: string }) => (item.code === "ARCHETYPE" ? "/app/ruta" : item.href);

export default function OpportunitiesPage() {
  const { notify, reload: reloadDashboard } = useLuft();
  const latest = useResource<MatchingView>("/matching");
  const presentations = useResource<{ items: Presentation[] }>("/matching/presentations");
  const history = useResource<MatchHistory>("/matching/history");
  const [amount, setAmount] = useState<number | null>(null);
  const [term, setTerm] = useState("");
  const [past, setPast] = useState<RunView | null>(null);
  const [authorizing, setAuthorizing] = useState<MatchResult | null>(null);
  const [revoking, setRevoking] = useState<Presentation | null>(null);
  const run = useAction();
  const action = useAction();
  const data = latest.data;
  if (!data) return <PageState title="Oportunidades" back="/app" failure={latest.failure} onRetry={latest.reload} label="Revisando tus oportunidades…" />;

  const { readiness } = data;
  const view = past ?? data;
  const declared = readiness.declared;
  const declaredCount = [declared.birthDate, declared.city, declared.department, declared.activityStartDate].filter(Boolean).length;
  const termValue = Number(term);
  const termValid = term === "" || (Number.isInteger(termValue) && termValue >= 1 && termValue <= 360);
  const refresh = async () => { await Promise.all([latest.reload(), presentations.reload(), history.reload()]); if (past?.run) setPast(await api<RunView>(`/matching/runs/${past.run.id}`)); };
  const execute = () => run.run(async () => {
    const result = await send<RunView>("POST", "/matching/run", { ...(amount ? { requestedAmountCOP: amount } : {}), ...(term ? { requestedTermMonths: termValue } : {}) });
    latest.setData({ ...result, readiness }); setPast(null);
    notify(`Evaluamos ${plural(result.run?.productsEvaluated ?? 0, "producto", "productos")} con las políticas vigentes.`);
    void history.reload(); void presentations.reload(); void reloadDashboard();
  });
  const openRun = (id: string) => action.run(async () => { if (id === data.run?.id) { setPast(null); return; } setPast(await api<RunView>(`/matching/runs/${id}`)); window.scrollTo({ top: 0, behavior: "smooth" }); });
  const revoke = () => action.run(async () => { const next = await send<Presentation>("POST", `/matching/results/${revoking!.resultId}/revoke`); setRevoking(null); notify(next.status === "DESISTIDA" ? "Desististe del proceso." : "Autorización revocada."); await refresh(); });
  const tracked = presentations.data?.items ?? [];

  return (
    <Screen className="v2-wide">
      <Header back="/app" title="Oportunidades" subtitle="Productos de entidades aliadas comparados con tu perfil, explicados criterio por criterio." />
      <div className="l-body">
        <div className="v2-cols">
          <div className="v2-main">
            {!readiness.ready && (
              <Card>
                <div className="v2-card-head"><div><h3>Antes de buscar, completa esto</h3><p className="l-small">Sin estos datos no podemos comparar tu perfil con ninguna política.</p></div><Chip tone="amber">{plural(readiness.missing.length, "pendiente", "pendientes")}</Chip></div>
                <div className="l-list" style={{ margin: "0 -16px" }}>{readiness.missing.map((item) => <ListRow key={item.code} icon={item.kind === "CONSENT" ? "verified_user" : "person"} tone="amber" title={item.label} text={item.kind === "CONSENT" ? "Autorización" : "Perfil"} href={readinessHref(item)} />)}</div>
              </Card>
            )}

            <Card>
              <div className="v2-card-head"><div><h3>{data.run ? "Buscar de nuevo" : "Busca tus oportunidades"}</h3><p className="l-small">Opcional: di cuánto necesitas y a qué plazo para afinar el encaje.</p></div></div>
              <div className="v2-form-row">
                <Labeled label="Monto deseado"><MoneyInput label="Monto deseado" value={amount} onChange={setAmount} placeholder="$ 0" /></Labeled>
                <Field label="Plazo en meses" hint={termValid ? undefined : "Entre 1 y 360."}><input value={term} inputMode="numeric" maxLength={3} placeholder="12" onChange={(event) => setTerm(event.target.value.replace(/\D/g, ""))} /></Field>
              </div>
              {run.failure && <Alert>{run.failure}</Alert>}
              <Button icon="search" disabled={!readiness.ready || !termValid || run.busy} onClick={execute}>{run.busy ? "Comparando con las políticas…" : data.run ? "Actualizar mis oportunidades" : "Buscar oportunidades"}</Button>
              <p className="l-fine">{data.disclaimer}</p>
            </Card>

            {past?.run && (
              <div className="v2-banner"><Icon name="schedule" /><span className="l-grow"><strong>Estás viendo la búsqueda del {fmtDateTime(past.run.createdAt)}</strong>Sus resultados conservan la política que estaba vigente ese día.</span><button type="button" className="v2-mini" onClick={() => setPast(null)}>Ver la más reciente</button></div>
            )}

            {view.run ? <>
              <SectionTitle>{past ? "Resultados de esa búsqueda" : "Tus resultados"}</SectionTitle>
              <Card className="tight">
                <Facts columns={3} items={[{ label: "Cumples criterios", value: view.run.summary.eligible }, { label: "Con brechas", value: view.run.summary.withGaps }, { label: "No aplican hoy", value: view.run.summary.excluded }]} />
                <span className="l-small">{plural(view.run.productsEvaluated, "producto evaluado", "productos evaluados")} el {fmtDateTime(view.run.createdAt)}{view.run.requestedAmountCOP ? ` · ${cop(view.run.requestedAmountCOP)}` : ""}{view.run.requestedTermMonths ? ` a ${view.run.requestedTermMonths} meses` : ""} · motor {view.run.engineVersion}</span>
              </Card>
              {action.failure && !revoking && <Alert>{action.failure}</Alert>}
              {view.results.length === 0
                ? <Card><Empty title="Aún no hay productos para comparar" lufty>Cuando una entidad aliada publique una política vigente, aparecerá aquí con su explicación.</Empty></Card>
                : view.results.map((result, index) => <ResultCard key={result.id} result={result} open={index === 0} busy={action.busy} onAuthorize={() => setAuthorizing(result)} onRevoke={() => result.presentation && setRevoking(result.presentation)} />)}
            </> : readiness.ready && (
              <Card><Empty title="Todavía no has hecho una búsqueda">Comparamos tu perfil con la política vigente de cada producto y te mostramos el porcentaje de encaje, las reglas que cumples, las brechas y las exclusiones.</Empty></Card>
            )}
          </div>

          <aside className="v2-side">
            <Card>
              <div className="v2-card-head"><div><h3>Datos que tú declaras</h3><p className="l-small">Edad, ubicación y antigüedad: varias políticas los piden.</p></div><Chip tone={declaredCount === 4 ? "green" : "amber"}>{declaredCount} de 4</Chip></div>
              <div className="l-kv">
                <div>Fecha de nacimiento<strong>{fmtDate(declared.birthDate) || "Sin declarar"}</strong></div>
                <div>Departamento<strong>{declared.department ?? "Sin declarar"}</strong></div>
                <div>Ciudad<strong>{declared.city ?? "Sin declarar"}</strong></div>
                <div>Inicio de tu actividad actual<strong>{fmtDate(declared.activityStartDate) || "Sin declarar"}</strong></div>
              </div>
              <Button variant="secondary" small href="/app/oportunidades/datos">{declaredCount ? "Actualizar mis datos" : "Completar mis datos"}</Button>
            </Card>

            <Card>
              <div className="v2-card-head"><div><h3>Mis presentaciones</h3><p className="l-small">Lo que autorizaste presentar y qué decidió cada entidad.</p></div></div>
              {presentations.failure ? <Alert>{presentations.failure}</Alert> : tracked.length === 0 ? <p className="l-muted">Aún no has autorizado presentar tu perfil a ninguna entidad.</p> : (
                <div className="v2-contribs">{tracked.map((item) => (
                  <div className="v2-contrib" key={item.id}>
                    <div className="row"><span><strong>{item.product.name}</strong><small>{item.institution.name} · autorizada el {fmtDate(item.authorizedAt)}</small></span><StatusChip tone={PRESENTATION[item.status]}>{item.statusLabel}</StatusChip></div>
                    {item.status === "APROBADA" && <small className="l-small">Aprobado: {item.approvedAmountCOP != null ? cop(item.approvedAmountCOP) : "monto por confirmar"}{item.approvedTermMonths ? ` a ${item.approvedTermMonths} meses` : ""}.</small>}
                    {item.decisionReason && item.status !== "APROBADA" && <small className="l-small">Motivo: {item.decisionReason}</small>}
                    {item.canRevoke && <div className="v2-actions"><button type="button" className="v2-mini danger" onClick={() => setRevoking(item)}>{item.status === "PRESENTADA" ? "Desistir" : "Revocar"}</button></div>}
                  </div>
                ))}</div>
              )}
            </Card>

            <Card>
              <div className="v2-card-head"><div><h3>Historial de búsquedas</h3><p className="l-small">Cada una guarda la versión de política que usó.</p></div></div>
              {history.failure ? <Alert>{history.failure}</Alert> : !history.data?.items.length ? <p className="l-muted">Aquí quedarán tus búsquedas anteriores.</p> : (
                <div className="l-list" style={{ margin: "0 -16px" }}>{history.data.items.map((item) => (
                  <button type="button" key={item.id} onClick={() => openRun(item.id)} aria-current={view.run?.id === item.id ? "true" : undefined}>
                    <span className="l-grow"><strong>{fmtDateTime(item.createdAt)}{item.id === data.run?.id ? " · más reciente" : ""}</strong><small>{plural(item.productsEvaluated, "producto", "productos")} · {item.summary.eligible} cumplen · {item.summary.withGaps} con brechas · {item.summary.excluded} no aplican</small></span>
                    {view.run?.id === item.id ? <Chip tone="blue">Viendo</Chip> : <Icon name="chevron_right" />}
                  </button>
                ))}</div>
              )}
              {history.data && history.data.total > history.data.items.length && <span className="l-small">Mostramos las {history.data.items.length} más recientes de {history.data.total}.</span>}
            </Card>

            <Tip icon="info" title="Sin promesas de aprobación">{data.disclaimer}</Tip>
          </aside>
        </div>
      </div>

      {authorizing && <AuthorizeSheet result={authorizing} onClose={() => setAuthorizing(null)} onDone={async (presentation) => { setAuthorizing(null); notify(`Autorizaste presentar tu perfil a ${presentation.institution.name}.`); await refresh(); }} />}
      {revoking && (
        <ConfirmSheet title={revoking.status === "PRESENTADA" ? "¿Desistir de este proceso?" : "¿Revocar esta autorización?"} confirm={revoking.status === "PRESENTADA" ? "Sí, desistir" : "Sí, revocar"} danger busy={action.busy} failure={action.failure} onClose={() => setRevoking(null)} onConfirm={revoke}>
          <p>{revoking.status === "PRESENTADA" ? `${revoking.institution.name} ya recibió los datos que autorizaste. Al desistir, el proceso se cierra y la entidad deja de evaluarlo.` : `Aún no hemos presentado tus datos a ${revoking.institution.name}. Al revocar se destruye la copia preparada para compartir.`}</p>
        </ConfirmSheet>
      )}
    </Screen>
  );
}
