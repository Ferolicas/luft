"use client";

import Link from "next/link";
import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Bar, Button, Card, Checkbox, Chip, Field, Header, Icon, MoneyInput, Screen, Sheet, Tip, type IconName } from "@/components/luft/ui";
import { Labeled } from "@/components/luft/v2/household";
import { ConfirmSheet, Empty, Facts, Fold, PageState, SheetHead, StatusChip, Steps } from "@/components/luft/v2/kit";
import { cop, errorCode, fmtDate, fmtMonth, plural, send, todayISO, useAction, useResource } from "@/lib/v2/api";
import type { LifeProject, ProjectKind, ProjectsView, RouteOverview } from "@/lib/v2/types";

const KIND_ICON: Record<ProjectKind, IconName> = { EDUCACION: "school", MOVILIDAD: "speed", VIVIENDA: "home", EMPRENDIMIENTO: "work", OTRO: "flag" };
const STATUS = { ACTIVE: ["blue", "Activo"], PAUSED: ["amber", "En pausa"], COMPLETED: ["green", "Cumplido"] } as const;
type Open = { kind: "new" } | { kind: "edit" | "save" | "delete"; project: LifeProject } | null;

export default function ProjectsPage() {
  const { notify, reload: reloadDashboard } = useLuft();
  const resource = useResource<ProjectsView>("/luft/projects");
  const route = useResource<RouteOverview>("/luft/route");
  const [open, setOpen] = useState<Open>(null);
  const action = useAction();
  const data = resource.data;
  if (!data) return <PageState title="Mis proyectos" back="/app" failure={resource.failure} onRetry={resource.reload} label="Abriendo tus proyectos…" />;
  const applied = (next: ProjectsView, message: string) => { resource.setData(next); setOpen(null); notify(message); void reloadDashboard(); void route.reload(); };
  const mutate = (work: () => Promise<ProjectsView>, message: string) => action.run(async () => applied(await work(), message));
  const active = data.projects.filter((project) => project.status !== "COMPLETED");
  const done = data.projects.filter((project) => project.status === "COMPLETED");

  return (
    <Screen className="v2-wide">
      <Header back="/app" title="Mis proyectos" subtitle="Tu identidad financiera sirve para algo: ponle nombre, monto y fecha a tus metas de vida." />
      <div className="l-body">
        <Card className="tight">
          <div className="v2-cycle-banner"><span className="l-icon-box violet"><Icon name="sync" /></span><div className="l-grow"><span className="l-overline" style={{ color: "var(--l-violet-600)" }}>Ciclo continuo</span><p className="v2-h3">{data.cycle.map((step) => step.label).join(" → ")}</p></div></div>
          <p className="l-small">LUFT no termina con tu primer producto: cada proyecto abre un nuevo ciclo de aprendizaje, evidencia y acceso, siempre con tu consentimiento.</p>
        </Card>
        {action.failure && !open && <Alert>{action.failure}</Alert>}
        {data.projects.length === 0 ? (
          <Card><Empty title="Crea tu primer proyecto de vida" action={<Button icon="add" onClick={() => setOpen({ kind: "new" })}>Nuevo proyecto</Button>}>Estudios, vivienda, movilidad, tu negocio u otra meta. Te mostramos cuánto ahorrar al mes, si tu capacidad lo cubre y qué aprender para lograrlo.</Empty></Card>
        ) : <>
          <div className="v2-grid2">{active.map((project) => <ProjectCard key={project.id} project={project} busy={action.busy} onOpen={(kind) => setOpen({ kind, project })} onStatus={(status, message) => mutate(() => send<ProjectsView>("PATCH", `/luft/projects/${project.id}`, { status }), message)} />)}</div>
          {done.length > 0 && <Fold summary={`Proyectos cumplidos (${done.length})`}><div className="v2-grid2">{done.map((project) => <ProjectCard key={project.id} project={project} busy={action.busy} onOpen={(kind) => setOpen({ kind, project })} onStatus={(status, message) => mutate(() => send<ProjectsView>("PATCH", `/luft/projects/${project.id}`, { status }), message)} />)}</div></Fold>}
        </>}
      </div>
      {data.projects.length > 0 && <div className="l-footer"><Button icon="add" onClick={() => setOpen({ kind: "new" })}>Nuevo proyecto</Button></div>}

      {(open?.kind === "new" || open?.kind === "edit") && <ProjectSheet project={open.kind === "edit" ? open.project : null} view={data} canOpenRoute={Boolean(route.data?.route.canStartNewRoute)} allowedKinds={route.data?.category.projectKinds ?? null} onClose={() => setOpen(null)} onSaved={applied} />}
      {open?.kind === "save" && <SavingsSheet project={open.project} onClose={() => setOpen(null)} onSaved={applied} />}
      {open?.kind === "delete" && (
        <ConfirmSheet title={`¿Eliminar «${open.project.title}»?`} confirm="Sí, eliminar proyecto" danger busy={action.busy} failure={action.failure} onClose={() => setOpen(null)} onConfirm={() => mutate(() => send<ProjectsView>("DELETE", `/luft/projects/${open.project.id}`), "Proyecto eliminado.")}>
          <p>Se borra el plan de este proyecto. Tus ahorros reales, tu ruta y tu perfil no cambian.</p>
        </ConfirmSheet>
      )}
    </Screen>
  );
}

function ProjectCard({ project, busy, onOpen, onStatus }: { project: LifeProject; busy: boolean; onOpen: (kind: "edit" | "save" | "delete") => void; onStatus: (status: "ACTIVE" | "PAUSED" | "COMPLETED", message: string) => void }) {
  const { plan } = project;
  const [tone, label] = STATUS[project.status];
  const completed = project.status === "COMPLETED";
  const source = plan.capacitySource === "PROJECT" ? "Declarada para este proyecto" : plan.capacitySource === "PROFILE" ? "Según tu perfil financiero" : "Completa ingresos y gastos en tu perfil";
  return (
    <article className="l-card">
      <div className="v2-project-head">
        <span className="l-icon-box"><Icon name={KIND_ICON[project.kind] ?? "flag"} size={24} /></span>
        <div className="l-grow"><h3>{project.title}</h3><p className="l-small">{project.kindLabel} · {completed && project.completedAt ? `cumplido el ${fmtDate(project.completedAt)}` : `meta para ${fmtMonth(project.targetDate)}`}</p></div>
        <StatusChip tone={tone}>{label}</StatusChip>
      </div>
      <div className="v2-goal">
        <div className="amounts"><strong>{cop(project.savedCOP)}</strong><span>ahorrados de {cop(project.targetCOP)}</span></div>
        <Bar value={plan.progressPercent} tone="green" label={`Avance de ${project.title}`} />
      </div>
      {!completed && <>
        <Facts items={[
          { label: "Ahorro mensual necesario", value: cop(plan.requiredMonthlySavingCOP), hint: `Faltan ${cop(plan.remainingCOP)} en ${plural(plan.monthsRemaining, "mes", "meses")}` },
          { label: "Tu capacidad mensual", value: plan.declaredCapacityCOP != null ? cop(plan.declaredCapacityCOP) : "—", hint: source },
          ...(plan.monthlyGapCOP ? [{ label: "Brecha mensual", value: cop(plan.monthlyGapCOP), hint: "Lo que te falta cada mes" }] : []),
          ...(plan.suggestedTargetDate ? [{ label: "Fecha sugerida", value: fmtMonth(plan.suggestedTargetDate), hint: "Con tu capacidad actual" }] : []),
        ]} />
        <Tip tone={plan.feasible === true ? "green" : plan.feasible === false ? "amber" : ""} icon={plan.feasible === true ? "check_circle" : plan.feasible === false ? "warning" : "info"} title={plan.feasible === true ? "Tu plan es alcanzable" : plan.feasible === false ? "Tu plan necesita un ajuste" : "Aún no podemos evaluar tu plan"}>{plan.message}</Tip>
      </>}
      <div className="l-stack" style={{ gap: 8 }}><span className="l-small" style={{ fontWeight: 500 }}>Ciclo del proyecto · {project.cycle.label}</span><Steps items={project.cycle.steps} label={`Ciclo de ${project.title}`} /></div>
      {project.routeId && <span className="v2-private"><Icon name="flag" size={16} /><span>Este proyecto abrió una ruta propia. <Link className="l-link" href="/app/ruta">Ver mi ruta</Link></span></span>}
      {!completed && project.recommendedModules.length > 0 && (
        <Fold summary={`Qué aprender para lograrlo (${project.recommendedModules.filter((module) => module.completed).length} de ${project.recommendedModules.length})`}>
          <div className="l-list" style={{ margin: "0 -16px" }}>{project.recommendedModules.map((module) => <Link key={module.slug} href={module.href}><span className={`l-lesson-num ${module.completed ? "done" : ""}`}>{module.completed ? <Icon name="check" size={14} /> : <Icon name="school" size={14} />}</span><span className="l-grow"><strong>{module.title}</strong><small>{module.completed ? "Módulo completado" : "Módulo recomendado"}</small></span><Icon name="chevron_right" /></Link>)}</div>
        </Fold>
      )}
      <div className="v2-actions">
        {project.status === "ACTIVE" && <button type="button" className="v2-mini" onClick={() => onOpen("save")}><Icon name="add" size={16} />Registrar ahorro</button>}
        {!completed && <button type="button" className="v2-mini ghost" onClick={() => onOpen("edit")}>Editar</button>}
        {project.status === "ACTIVE" && <button type="button" className="v2-mini ghost" disabled={busy} onClick={() => onStatus("PAUSED", "Proyecto en pausa.")}><Icon name="pause" size={16} />Pausar</button>}
        {project.status === "PAUSED" && <button type="button" className="v2-mini" disabled={busy} onClick={() => onStatus("ACTIVE", "Proyecto reanudado.")}>Reanudar</button>}
        {!completed && <button type="button" className="v2-mini ok" disabled={busy} onClick={() => onStatus("COMPLETED", "¡Proyecto cumplido!")}><Icon name="check" size={16} />Marcar cumplido</button>}
        {completed && <button type="button" className="v2-mini ghost" disabled={busy} onClick={() => onStatus("ACTIVE", "Proyecto reabierto.")}>Reabrir</button>}
        <button type="button" className="v2-mini danger" onClick={() => onOpen("delete")}>Eliminar</button>
      </div>
    </article>
  );
}

function ProjectSheet({ project, view, canOpenRoute, allowedKinds, onClose, onSaved }: { project: LifeProject | null; view: ProjectsView; canOpenRoute: boolean; allowedKinds: string[] | null; onClose: () => void; onSaved: (next: ProjectsView, message: string) => void }) {
  const [kind, setKind] = useState<ProjectKind | null>(project?.kind ?? null);
  const [title, setTitle] = useState(project?.title ?? "");
  const [target, setTarget] = useState<number | null>(project?.targetCOP ?? null);
  const [saved, setSaved] = useState<number | null>(project ? project.savedCOP : null);
  const [capacity, setCapacity] = useState<number | null>(project?.monthlyCapacityCOP ?? null);
  const [date, setDate] = useState(project?.targetDate ?? "");
  const [openRoute, setOpenRoute] = useState(false);
  const action = useAction();
  const valid = Boolean(kind) && title.trim().length >= 3 && Boolean(target && target > 0) && Boolean(date) && (saved ?? 0) <= (target ?? 0);
  const save = () => action.run(async () => {
    try {
      if (project) onSaved(await send<ProjectsView>("PATCH", `/luft/projects/${project.id}`, { title: title.trim(), targetCOP: target, savedCOP: saved ?? 0, monthlyCapacityCOP: capacity, targetDate: date }), "Proyecto actualizado.");
      else onSaved(await send<ProjectsView>("POST", "/luft/projects", { kind, title: title.trim(), targetCOP: target, savedCOP: saved ?? 0, ...(capacity != null ? { monthlyCapacityCOP: capacity } : {}), targetDate: date, openRoute }), openRoute ? "Proyecto creado con una ruta nueva." : "Proyecto creado.");
    } catch (cause) { if (errorCode(cause) === "route_in_progress") setOpenRoute(false); throw cause; }
  });
  const heading = project ? "Editar proyecto" : "Nuevo proyecto de vida";
  return (
    <Sheet title={heading} onClose={onClose}>
      <SheetHead title={heading}>Con el monto y la fecha calculamos cuánto ahorrar al mes y lo comparamos con tu capacidad.</SheetHead>
      <div className="v2-form">
        {!project && <div className="l-stack" style={{ gap: 8 }}><span className="l-field"><span>¿Qué quieres lograr?</span></span><div className="v2-kinds" role="radiogroup" aria-label="Tipo de proyecto">{view.kinds.map((item) => <button type="button" role="radio" aria-checked={kind === item.code} key={item.code} onClick={() => setKind(item.code)}><Icon name={KIND_ICON[item.code] ?? "flag"} />{item.label}</button>)}</div>{kind && allowedKinds && !allowedKinds.includes(kind) && <span className="l-hint">Tu categoría actual no se enfoca en este tipo de proyecto, pero puedes crearlo igual.</span>}</div>}
        <Field label="Nombre del proyecto" valid={title.trim().length >= 3}><input value={title} maxLength={160} placeholder="Ej.: Mi primera vivienda" onChange={(event) => setTitle(event.target.value)} /></Field>
        <Labeled label="¿Cuánto necesitas?"><MoneyInput label="¿Cuánto necesitas?" value={target} onChange={setTarget} /></Labeled>
        <Labeled label={<>Ya tengo ahorrado <span className="v2-optional">(opcional)</span></>} hint={(saved ?? 0) > (target ?? 0) && target ? "No puede superar el monto del proyecto." : undefined}><MoneyInput label="Ya tengo ahorrado" value={saved} onChange={setSaved} placeholder="$ 0" /></Labeled>
        <Field label="¿Para cuándo?"><input type="date" value={date} min={todayISO()} onChange={(event) => setDate(event.target.value)} /></Field>
        <Labeled label={<>Puedo ahorrar al mes <span className="v2-optional">(opcional)</span></>} hint={view.profileCapacityCOP != null ? `Si lo dejas vacío usamos la capacidad de tu perfil: ${cop(view.profileCapacityCOP)}.` : "Si lo dejas vacío usamos la de tu perfil financiero cuando la completes."}><MoneyInput label="Puedo ahorrar al mes" value={capacity} onChange={setCapacity} /></Labeled>
        {!project && (canOpenRoute
          ? <Checkbox checked={openRoute} onChange={setOpenRoute}>Abrir una ruta nueva para este proyecto (tu ruta actual se cierra y queda en tu historial).</Checkbox>
          : <span className="v2-private"><Icon name="info" size={16} />Podrás abrir una ruta propia para un proyecto cuando tu ruta actual llegue a tu perfil final.</span>)}
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!valid || action.busy} onClick={save}>{action.busy ? "Guardando…" : project ? "Guardar cambios" : "Crear proyecto"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

function SavingsSheet({ project, onClose, onSaved }: { project: LifeProject; onClose: () => void; onSaved: (next: ProjectsView, message: string) => void }) {
  const [saved, setSaved] = useState<number | null>(project.savedCOP);
  const action = useAction();
  const save = () => action.run(async () => onSaved(await send<ProjectsView>("PATCH", `/luft/projects/${project.id}`, { savedCOP: saved ?? 0 }), "Ahorro actualizado."));
  return (
    <Sheet title="Registrar ahorro" onClose={onClose}>
      <SheetHead title="¿Cuánto llevas ahorrado?">{project.title} · meta de {cop(project.targetCOP)}. Escribe el total que tienes hoy para este proyecto.</SheetHead>
      <Labeled label="Total ahorrado hoy" hint={(saved ?? 0) > project.targetCOP ? "No puede superar el monto del proyecto." : undefined}><MoneyInput label="Total ahorrado hoy" value={saved} onChange={setSaved} placeholder="$ 0" /></Labeled>
      <div className="v2-wrap"><Chip>Antes: {cop(project.savedCOP)}</Chip></div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={(saved ?? 0) > project.targetCOP || action.busy} onClick={save}>{action.busy ? "Guardando…" : "Guardar ahorro"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}
