"use client";

import Link from "next/link";
import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Bar, Button, Card, Chip, Field, Header, Icon, OptionCard, Screen, Sheet, Tip } from "@/components/luft/ui";
import { V2_LINKS } from "@/components/luft/v2";
import { Empty, Fold, PageState, SectionTitle, SheetHead, StatusChip } from "@/components/luft/v2/kit";
import { EXPERIENCE, GOALS } from "@/lib/classification";
import type { CreditExperience, Goal } from "@/lib/journey";
import { fmtDate, plural, send, useAction, useResource } from "@/lib/v2/api";
import type { ArchetypeBasis, ArchetypeHistory, Category, EvidenceList, RouteOverview, RouteStage, RouteStageItem } from "@/lib/v2/types";

const BASIS: Record<ArchetypeBasis, string> = {
  RULES: "Lo asignan reglas que leen tus respuestas y tus evidencias.",
  LEGACY_EQUIVALENCE: "Viene de la equivalencia con tu perfil anterior, mientras reunimos más información.",
  DEFAULT: "Es el arquetipo inicial de tu categoría, mientras reunimos más información.",
};
const STAGE_REASON: Record<string, string> = {
  account_created: "Creaste tu cuenta",
  classification_and_bureau_completed: "Completaste tu clasificación y tu consulta en centrales",
  formalization_started: "Empezaste tu formalización",
  formalization_settled: "Dejaste tu formalización al día",
  credit_1_requested: "Solicitaste tu crédito constructor 1",
  credit_1_active: "Tu crédito 1 quedó activo",
  credit_1_paid: "Terminaste de pagar tu crédito 1",
  final_profile_ready: "Tu perfil final quedó listo",
  matching_available: "Ya tienes oportunidades para revisar",
  life_project_started: "Creaste un proyecto de vida",
  passed_by_later_evidence: "Etapa superada por evidencias posteriores",
};
const ARCHETYPE_REASON: Record<string, string> = {
  classification: "Respondiste tu clasificación",
  category_change: "Cambiaste de categoría",
  questionnaire: "Actualizaste tu perfil financiero",
  formalization: "Avanzaste en tu formalización",
  lesson_completed: "Completaste una lección",
  household_joined: "Te uniste a un hogar",
  life_project: "Creaste o cambiaste un proyecto",
  profile_document: "Cargaste un documento",
  new_route: "Abriste una nueva ruta",
};
const EVIDENCE_STATUS = { VERIFIED: ["green", "Verificada"], DECLARED: ["blue", "Declarada"], PENDING: ["amber", "Pendiente"], EXPIRED: ["red", "Vencida"] } as const;
const STAGE_STATUS = { DONE: ["green", "Completada"], CURRENT: ["blue", "En curso"], PENDING: ["", "Pendiente"] } as const;
const ORIGIN: Record<string, string> = { INITIAL: "Ruta inicial", LIFE_STAGE: "Nueva etapa de vida", PROJECT: "Ruta por proyecto" };

export default function RoutePage() {
  const { reload: reloadDashboard, notify } = useLuft();
  const route = useResource<RouteOverview>("/luft/route");
  const evidence = useResource<EvidenceList>("/luft/evidence");
  const archetypes = useResource<ArchetypeHistory>("/luft/route/archetypes");
  const [sheet, setSheet] = useState<"" | "classify" | "category" | "new-route">("");
  const data = route.data;
  if (!data) return <PageState title="Mi ruta" back="/app" failure={route.failure} onRetry={route.reload} label="Trazando tu ruta…" />;

  const applied = (next: RouteOverview, message: string) => {
    route.setData(next); setSheet(""); notify(message);
    void archetypes.reload(); void evidence.reload(); void reloadDashboard();
  };
  const { category, archetype, nextStep } = data;
  const current = data.stages.find((stage) => stage.status === "CURRENT");
  const pastArchetypes = (archetypes.data?.items ?? []).filter((item) => !item.current);

  return (
    <Screen className="v2-wide">
      <Header back="/app" title="Mi ruta" subtitle={category.messages.nextStep}>
        <div className="v2-header-chips" style={{ marginTop: 0, marginBottom: 14 }}><Chip>{ORIGIN[data.route.origin] ?? "Ruta"}{data.route.title ? ` · ${data.route.title}` : ""}</Chip></div>
      </Header>
      <div className="l-body">
        <div className="v2-cols">
          <div className="v2-main">
            <Card>
              <div className="v2-identity" id="identidad">
                <div>
                  <span className="l-overline"><Icon name="school" size={14} />Categoría</span>
                  <strong>{category.brand}</strong>
                  <small>{category.label} · {category.chosenByUser ? "elegida por ti" : "sugerida por tus respuestas"}</small>
                </div>
                <div className="archetype">
                  <span className="l-overline"><Icon name="diamond_fill" size={14} />Arquetipo</span>
                  <strong>{archetype?.name ?? "Por definir"}</strong>
                  <small>{archetype ? `Versión ${archetype.version} · desde el ${fmtDate(archetype.assignedAt)}` : "Se asigna con tu clasificación"}</small>
                </div>
              </div>
              <div className="l-stack" style={{ gap: 6 }}>
                <div className="l-row between"><span className="l-small" style={{ fontWeight: 500 }}>Etapa {current?.title ?? data.route.stageLabel}</span><strong style={{ fontSize: 14 }}>{data.route.progressPercent}%</strong></div>
                <Bar value={data.route.progressPercent} label="Avance de tu ruta" />
              </div>
              <p className="v2-lead">{category.description} La categoría define tu servicio; el arquetipo personaliza tu ruta y puede cambiar con nuevas evidencias.</p>
              {data.route.categoryLocked
                ? <span className="v2-private"><Icon name="lock" size={16} />Tu categoría quedó fija al iniciar tu primer crédito de esta ruta.</span>
                : <div className="v2-actions"><button type="button" className="v2-mini" onClick={() => setSheet("category")}><Icon name="sync" size={16} />Cambiar categoría</button></div>}
            </Card>

            {nextStep ? (
              <Card className="v2-next">
                <span className="l-overline">Tu siguiente paso</span>
                <h3>{nextStep.title}</h3>
                <p>{nextStep.description}</p>
                {nextStep.key === "classification"
                  ? <Button variant="white" arrow onClick={() => setSheet("classify")}>Responder dos preguntas</Button>
                  : <Button variant="white" arrow href={nextStep.href}>Continuar</Button>}
              </Card>
            ) : <Tip tone="green" icon="check_circle" title="Vas al día con tu ruta">No tienes pasos pendientes en este momento. Tu ruta sigue activa: cada proyecto abre un nuevo ciclo.</Tip>}

            <SectionTitle>Las 5 etapas</SectionTitle>
            {data.stages.map((stage, index) => <StageCard key={stage.key} stage={stage} index={index} onClassify={() => setSheet("classify")} />)}
          </div>

          <aside className="v2-side">
            <Card>
              <div className="v2-card-head"><div><h3>Por qué este arquetipo</h3><p className="l-small">Categoría y arquetipo son cosas distintas.</p></div>{archetype && <Chip tone="violet">Dinámico</Chip>}</div>
              {archetype ? <>
                <p className="v2-lead">{archetype.description}</p>
                <Tip icon="info"><span style={{ display: "block", fontSize: 14, lineHeight: "19px", color: "var(--l-n-900)", marginBottom: 4 }}>{archetype.summary}</span>{BASIS[archetype.basis]}</Tip>
                {archetype.matched.length > 0 && <ul className="l-checks">{archetype.matched.map((match) => <li key={match.fact}><Icon name="check_circle" /><span><strong style={{ display: "block", fontWeight: 500, color: "var(--l-n-900)" }}>{match.label}</strong><span className="l-small">{match.factLabel}</span></span></li>)}</ul>}
              </> : (
                <Empty title="Aún no tienes arquetipo" lufty={false} icon="diamond_fill" action={<Button small onClick={() => setSheet("classify")}>Responder dos preguntas</Button>}>Con tus dos respuestas de clasificación te ubicamos en un arquetipo dentro de {category.brand}.</Empty>
              )}
              {archetypes.failure && <Alert>{archetypes.failure}</Alert>}
              {pastArchetypes.length > 0 && (
                <Fold summary={`Historial de arquetipos (${pastArchetypes.length} anterior${pastArchetypes.length === 1 ? "" : "es"})`}>
                  <ol className="v2-timeline">{(archetypes.data?.items ?? []).map((item) => (
                    <li key={item.id}>
                      <strong>{item.name} · v{item.version}{item.current ? " (actual)" : ""}</strong>
                      <small>{fmtDate(item.assignedAt)}{item.supersededAt ? ` – ${fmtDate(item.supersededAt)}` : ""}{item.reason && ARCHETYPE_REASON[item.reason] ? ` · ${ARCHETYPE_REASON[item.reason]}` : ""}</small>
                      <small>{item.summary}</small>
                    </li>
                  ))}</ol>
                </Fold>
              )}
            </Card>

            <Card>
              <div className="v2-card-head"><div><h3>Evidencias de tu perfil</h3><p className="l-small">{data.evidence.verified} verificada{data.evidence.verified === 1 ? "" : "s"} de {plural(data.evidence.total, "registrada", "registradas")}</p></div><span className="l-icon-box green"><Icon name="verified_user" /></span></div>
              {evidence.failure ? <Alert>{evidence.failure}</Alert> : !evidence.data ? <span className="l-small">Cargando evidencias…</span> : evidence.data.items.length === 0
                ? <Empty title="Todavía no hay evidencias" lufty={false}>Cada paso de tu ruta deja una evidencia con su fuente y su fecha.</Empty>
                : <div className="l-list" style={{ margin: "0 -16px" }}>{evidence.data.items.map((item) => {
                  const [tone, label] = EVIDENCE_STATUS[item.status] ?? ["", item.status];
                  return <div key={item.id}><span className="l-grow"><strong>{item.label}</strong><small>{item.sourceLabel} · {fmtDate(item.occurredAt)}{item.validUntil ? ` · vigente hasta el ${fmtDate(item.validUntil)}` : ""}</small></span><StatusChip tone={tone}>{label}</StatusChip></div>;
                })}</div>}
              <span className="v2-private"><Icon name="lock" size={16} /><span>Solo lo verificado por una fuente cuenta como verificado. <Link className="l-link" href="/app/perfil/privacidad">Tú controlas los permisos.</Link></span></span>
            </Card>

            <Card>
              <div className="v2-card-head"><div><h3>Historial de tu ruta</h3><p className="l-small">Empezó el {fmtDate(data.route.startedAt)}</p></div></div>
              {data.history.length === 0 ? <p className="l-muted">Aún no hay cambios de etapa. Aparecerán aquí a medida que avances.</p> : (
                <ol className="v2-timeline">{[...data.history].reverse().map((step) => <li key={`${step.to}-${step.at}`}><strong>{step.toLabel}</strong><small>{fmtDate(step.at)}{step.reason && STAGE_REASON[step.reason] ? ` · ${STAGE_REASON[step.reason]}` : ""}</small></li>)}</ol>
              )}
              {data.previousRoutes.length > 0 && (
                <Fold summary={`Rutas anteriores (${data.previousRoutes.length})`}>
                  <div className="l-list" style={{ margin: "0 -16px" }}>{data.previousRoutes.map((item) => <div key={item.id}><span className="l-grow"><strong>{item.title ?? item.categoryBrand}</strong><small>{item.categoryBrand} · {fmtDate(item.startedAt)}{item.closedAt ? ` – ${fmtDate(item.closedAt)}` : ""}</small></span></div>)}</div>
                </Fold>
              )}
              {data.route.canStartNewRoute
                ? <Button variant="secondary" small icon="add" onClick={() => setSheet("new-route")}>Iniciar nueva ruta</Button>
                : <span className="l-small">Podrás abrir una nueva ruta cuando esta llegue a tu perfil final.</span>}
            </Card>
          </aside>
        </div>

        <SectionTitle>Todo lo que hace parte de tu ruta</SectionTitle>
        <nav className="v2-links" aria-label="Secciones de tu ruta">
          {V2_LINKS.filter((link) => link.href !== "/app/ruta").map((link) => <Link key={link.href} href={link.href}><span className="l-icon-box"><Icon name={link.icon} /></span><span>{link.label}<small style={{ display: "block" }}>{link.text}</small></span></Link>)}
        </nav>
      </div>

      {sheet === "classify" && <ClassifySheet onClose={() => setSheet("")} onDone={async () => { const next = await route.reload(); if (next) applied(next, "Listo: ya tienes categoría y arquetipo."); else setSheet(""); }} />}
      {sheet === "category" && <CategorySheet mode="change" current={category.code} onClose={() => setSheet("")} onDone={(next) => applied(next, `Tu categoría ahora es ${next.category.brand}.`)} />}
      {sheet === "new-route" && <CategorySheet mode="new" current={category.code} onClose={() => setSheet("")} onDone={(next) => applied(next, "Abriste una nueva ruta.")} />}
    </Screen>
  );
}

function StageCard({ stage, index, onClassify }: { stage: RouteStage; index: number; onClassify: () => void }) {
  const [tone, label] = STAGE_STATUS[stage.status];
  const done = stage.items.filter((item) => item.done).length;
  return (
    <details className={`l-card v2-stage ${stage.status.toLowerCase()}`} open={stage.status === "CURRENT" || undefined}>
      <summary>
        <span className="num">{stage.status === "DONE" ? <Icon name="check" size={18} /> : index + 1}</span>
        <span className="l-grow"><strong>{stage.title}</strong><small>{stage.description} · {done} de {stage.items.length}</small></span>
        <StatusChip tone={tone}>{label}</StatusChip>
        <Icon name="keyboard_arrow_down" />
      </summary>
      <ul className="v2-items">{stage.items.map((item) => <StageItem key={item.key} item={item} onClassify={onClassify} />)}</ul>
    </details>
  );
}

function StageItem({ item, onClassify }: { item: RouteStageItem; onClassify: () => void }) {
  const content = <>
    <span className="state">{item.done ? <Icon name="check" size={14} /> : item.waiting ? <Icon name="schedule" size={14} /> : null}</span>
    <span className="l-grow"><strong>{item.label}</strong>{(item.detail || item.waiting) && <small>{item.waiting ? `En espera${item.detail ? ` · ${item.detail}` : ""}` : item.detail}</small>}</span>
    {item.optional && <Chip>Opcional</Chip>}
  </>;
  const className = item.done ? "done" : item.waiting ? "waiting" : "";
  const here = item.href === "/app/ruta";
  if (here && item.key === "classification" && !item.done) return <li className={className}><button type="button" onClick={onClassify}>{content}<Icon name="chevron_right" className="go" /></button></li>;
  if (here) return <li className={className}><a href="#identidad">{content}</a></li>;
  return <li className={className}><Link href={item.href}>{content}<Icon name="chevron_right" className="go" /></Link></li>;
}

function ClassifySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [experience, setExperience] = useState<CreditExperience | null>(null);
  const [step, setStep] = useState(1);
  const action = useAction();
  const save = () => action.run(async () => { await send("PUT", "/luft/classification", { goal, creditExperience: experience }); await onDone(); });
  return (
    <Sheet title="Clasificación inicial" onClose={onClose}>
      <SheetHead title={step === 1 ? "¿Qué quieres lograr con LUFT?" : "¿Has tenido créditos o tarjetas?"}>Pregunta {step} de 2. Con tus respuestas definimos tu categoría sugerida y tu arquetipo.</SheetHead>
      <div className="l-stack" role="radiogroup" aria-label={step === 1 ? "Tu objetivo" : "Tu experiencia con crédito"}>
        {step === 1
          ? GOALS.map((option) => <OptionCard key={option.value} icon={option.icon} title={option.title} description={option.text} selected={goal === option.value} onSelect={() => setGoal(option.value)} />)
          : EXPERIENCE.map((option) => <OptionCard key={option.value} icon={option.icon} title={option.title} description={option.text} selected={experience === option.value} onSelect={() => setExperience(option.value)} />)}
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      {step === 1
        ? <Button arrow disabled={!goal} onClick={() => setStep(2)}>Siguiente</Button>
        : <Button disabled={!experience || action.busy} onClick={save}>{action.busy ? "Guardando…" : "Conocer mi arquetipo"}</Button>}
      <button type="button" className="l-link-button" onClick={step === 1 ? onClose : () => setStep(1)}>{step === 1 ? "Ahora no" : "Volver"}</button>
    </Sheet>
  );
}

function CategorySheet({ mode, current, onClose, onDone }: { mode: "change" | "new"; current: string; onClose: () => void; onDone: (next: RouteOverview) => void }) {
  const catalog = useResource<{ categories: Category[] }>("/luft/categories");
  const [code, setCode] = useState(current);
  const [title, setTitle] = useState("");
  const action = useAction();
  const save = () => action.run(async () => {
    const next = mode === "change"
      ? await send<RouteOverview>("PUT", "/luft/route/category", { categoryCode: code })
      : await send<RouteOverview>("POST", "/luft/routes", { categoryCode: code, ...(title.trim().length >= 3 ? { title: title.trim() } : {}) });
    onDone(next);
  });
  const heading = mode === "change" ? "Elige tu categoría" : "Inicia una nueva ruta";
  return (
    <Sheet title={heading} onClose={onClose}>
      <SheetHead title={heading}>{mode === "change" ? "Una identidad, distintos momentos de vida. Al cambiarla recalculamos tu arquetipo; tu historial se conserva." : "Tu ruta actual se cierra y queda en tu historial. La nueva empieza con la categoría que elijas."}</SheetHead>
      {catalog.failure ? <Alert>{catalog.failure}</Alert> : !catalog.data ? <span className="l-small">Cargando categorías…</span> : (
        <div className="l-stack" role="radiogroup" aria-label="Categorías">
          {catalog.data.categories.map((item) => <OptionCard key={item.code} title={`${item.brand} · ${item.label}`} description={<>{item.description}<br />Arquetipos: {item.archetypes.map((entry) => entry.name).join(", ")}.</>} selected={code === item.code} onSelect={() => setCode(item.code)} />)}
        </div>
      )}
      {mode === "new" && <Field label={<>Nombre de la ruta <span className="v2-optional">(opcional)</span></>}><input value={title} maxLength={160} placeholder="Ej.: Mi etapa como independiente" onChange={(event) => setTitle(event.target.value)} /></Field>}
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={action.busy || !catalog.data || (mode === "change" && code === current)} onClick={save}>{action.busy ? "Guardando…" : mode === "change" ? "Usar esta categoría" : "Iniciar nueva ruta"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}
