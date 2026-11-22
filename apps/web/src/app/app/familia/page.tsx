"use client";

import Link from "next/link";
import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Checkbox, Chip, Field, Header, Icon, Screen, Segmented, Tip} from "@/components/luft/ui";
import { PendingInvitation } from "@/components/luft/v2";
import { ContributionSheet, GoalCard, GoalSheet, InviteSheet, MemberCard, PermissionsEditor, PlanPicker, PlanSheet, ROLE_LABEL } from "@/components/luft/v2/household";
import { ConfirmSheet, ConsentBox, Empty, Facts, PageState, SectionTitle, StatusChip } from "@/components/luft/v2/kit";
import { cop, errorCode, fmtDate, plural, send, uploadFile, useAction, useResource } from "@/lib/v2/api";
import type { HouseholdBoard, HouseholdMember, Metric, PlanCode, SharedGoal, ShareLevel, SubscriptionView } from "@/lib/v2/types";

type Tab = "hogar" | "metas" | "permisos";
const INVITATION = { PENDING: ["amber", "Pendiente"], ACCEPTED: ["green", "Aceptada"], REVOKED: ["", "Cancelada"], EXPIRED: ["red", "Vencida"] } as const;
const PRINCIPLES = [
  "Cada integrante conserva su cuenta, su expediente, su puntaje, sus productos y su matching.",
  "Solo se comparten las métricas que cada persona autorice, una por una.",
  "Las metas y los aportes sí son del hogar: ahí está el apoyo.",
];

export default function FamilyPage() {
  const { notify } = useLuft();
  const board = useResource<HouseholdBoard>("/luft/household");
  const subscription = useResource<SubscriptionView>("/luft/subscription");
  if (!board.data) return <PageState title="LUFT Familia" back="/app" failure={board.failure} onRetry={board.reload} label="Abriendo tu hogar…" />;
  const refresh = (next?: HouseholdBoard, message?: string) => { if (next) board.setData(next); else void board.reload(); void subscription.reload(); if (message) notify(message); };
  return board.data.household
    ? <Household board={board.data} subscription={subscription.data} onSubscription={(next) => { subscription.setData(next); void board.reload(); notify("Plan actualizado."); }} refresh={refresh} />
    : <Onboarding board={board.data} subscription={subscription} refresh={refresh} />;
}

function Onboarding({ board, subscription, refresh }: { board: HouseholdBoard; subscription: ReturnType<typeof useResource<SubscriptionView>>; refresh: (next?: HouseholdBoard, message?: string) => void }) {
  const { notify } = useLuft();
  const current = subscription.data?.subscription ?? null;
  const [choice, setChoice] = useState<{ code: PlanCode; seats: number } | null>(null);
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const plan = useAction();
  const create = useAction();
  const code = choice?.code ?? current?.planCode ?? null;
  const seats = choice?.seats ?? current?.seats ?? 1;
  const changed = choice !== null && (choice.code !== current?.planCode || choice.seats !== current?.seats);
  const savePlan = () => plan.run(async () => { const next = await send<SubscriptionView>("POST", "/luft/subscription", { planCode: code, seats }); subscription.setData({ ...subscription.data!, ...next }); setChoice(null); notify("Plan guardado."); });
  const createHousehold = () => create.run(async () => refresh(await send<HouseholdBoard>("POST", "/luft/household", { name: name.trim(), accepted: true }), "Tu hogar quedó creado."));
  return (
    <Screen className="v2-wide">
      <Header back="/app" title="LUFT Familia" subtitle="Comparte apoyos y metas, no tu identidad financiera." />
      <div className="l-body">
        <div className="v2-cols">
          <div className="v2-main">
            <Card>
              <span className="l-overline">Un hogar, identidades independientes</span>
              <ul className="l-checks">{PRINCIPLES.map((text) => <li key={text}><Icon name="check_circle" />{text}</li>)}</ul>
            </Card>
            <PendingInvitation />
            <Card>
              <div className="v2-card-head"><div><h3>1. Elige tu plan</h3><p className="l-small">Define cuántas rutas completas incluye tu paquete.</p></div>{current && <Chip tone={current.status === "ACTIVE" ? "green" : "blue"}>{current.status === "ACTIVE" ? "Plan activo" : "Plan elegido"}</Chip>}</div>
              {subscription.failure ? <Alert>{subscription.failure}</Alert> : !subscription.data ? <span className="l-small">Cargando planes…</span> : <>
                <PlanPicker plans={subscription.data.plans} code={code} seats={seats} onChange={(nextCode, nextSeats) => setChoice({ code: nextCode, seats: nextSeats })} />
                <p className="l-small">{subscription.data.note} Elegirlo aquí no genera ningún cobro.</p>
                {plan.failure && <Alert>{plan.failure}</Alert>}
                {(changed || !current) && <Button variant="secondary" small disabled={!code || plan.busy} onClick={savePlan}>{plan.busy ? "Guardando…" : "Guardar este plan"}</Button>}
              </>}
            </Card>
          </div>
          <aside className="v2-side">
            <Card>
              <div className="v2-card-head"><div><h3>2. Crea tu hogar</h3><p className="l-small">Luego podrás invitar integrantes con ruta o como red de apoyo, incluso con el plan Individual.</p></div></div>
              <Field label="Nombre del hogar" valid={name.trim().length >= 2}><input value={name} maxLength={80} placeholder="Ej.: Familia Oliveros" onChange={(event) => setName(event.target.value)} /></Field>
              <ConsentBox text={board.consent.text} />
              <Checkbox checked={accepted} onChange={setAccepted}>Leí y acepto esta autorización (versión {board.consent.version}).</Checkbox>
              {create.failure && <Alert>{create.failure}</Alert>}
              <Button disabled={name.trim().length < 2 || !accepted || create.busy} onClick={createHousehold}>{create.busy ? "Creando…" : "Crear mi hogar"}</Button>
            </Card>
          </aside>
        </div>
      </div>
    </Screen>
  );
}

function Household({ board, subscription, onSubscription, refresh }: { board: HouseholdBoard; subscription: SubscriptionView | null; onSubscription: (next: SubscriptionView) => void; refresh: (next?: HouseholdBoard, message?: string) => void }) {
  const household = board.household!;
  const me = board.me!;
  const isOwner = household.isOwner;
  const [tab, setTab] = useState<Tab>("hogar");
  const [sheet, setSheet] = useState<"" | "invite" | "plan" | "goal" | "rename" | "leave">("");
  const [goal, setGoal] = useState<SharedGoal | null>(null);
  const [contribute, setContribute] = useState<SharedGoal | null>(null);
  const [removing, setRemoving] = useState<HouseholdMember | null>(null);
  const [name, setName] = useState(household.name);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const action = useAction();
  const close = () => { setSheet(""); setGoal(null); setContribute(null); setRemoving(null); action.setFailure(""); };
  const run = (work: () => Promise<HouseholdBoard>, message: string) => action.run(async () => { const next = await work(); close(); refresh(next, message); });
  const setPermission = (metric: Metric, level: ShareLevel) => action.run(async () => {
    try { refresh(await send<HouseholdBoard>("PUT", "/luft/household/permissions", { [metric]: level }), "Permisos actualizados."); setConsentNeeded(false); }
    catch (cause) { if (errorCode(cause) === "consent_required") setConsentNeeded(true); throw cause; }
  });
  const reauthorize = () => action.run(async () => { await send("POST", "/luft/consents", { kind: "HOUSEHOLD_SHARING", accepted: true, version: board.consent.version }); setConsentNeeded(false); refresh(undefined, "Autorización renovada. Ya puedes elegir qué compartes."); });
  const attach = (id: string, file: File) => action.run(async () => { await uploadFile(`/luft/household/contributions/${id}/support`, file); refresh(undefined, "Soporte cargado."); });
  const pending = board.invitations.filter((invitation) => invitation.status === "PENDING");
  const activeGoals = board.goals.filter((item) => item.status === "ACTIVE").length;
  const stats = board.board;

  return (
    <Screen className="v2-wide">
      <Header back="/app" title={household.name} subtitle={`${plural(board.members.length, "integrante", "integrantes")} · ${plural(activeGoals, "meta activa", "metas activas")}`}>
        <div className="v2-header-chips" style={{ marginTop: 0, marginBottom: 14 }}><Chip icon="lock">LUFT Familia · privado</Chip></div>
      </Header>
      <div className="l-body">
        <Card className="tight">
          <Segmented<Tab> label="Secciones del hogar" value={tab} onChange={setTab} options={[{ value: "hogar", label: "Hogar" }, { value: "metas", label: `Metas${board.goals.length ? ` (${board.goals.length})` : ""}` }, { value: "permisos", label: "Mis permisos" }]} />
          <span className="v2-private"><Icon name="verified_user" size={16} />Se comparten apoyos y metas, no la identidad financiera de nadie.</span>
        </Card>
        {action.failure && !sheet && !goal && !contribute && !removing && <Alert>{action.failure}</Alert>}

        {tab === "hogar" && (
          <div className="v2-cols">
            <div className="v2-main">
              {stats && (
                <Card>
                  <div className="v2-card-head"><div><h3>Tablero del hogar</h3><p className="l-small">Solo suma lo que cada integrante autorizó compartir contigo.</p></div></div>
                  <Facts items={[
                    { label: "Integrantes", value: stats.members, hint: `${stats.beneficiaries} con ruta · ${stats.support} de apoyo` },
                    { label: "Avance promedio de ruta", value: stats.routeProgress ? `${stats.routeProgress.averagePercent}%` : "—", hint: stats.routeProgress ? `Lo ${stats.routeProgress.sharedBy === 1 ? "comparte 1 integrante" : `comparten ${stats.routeProgress.sharedBy} integrantes`}` : "Nadie lo comparte contigo" },
                    { label: "Aprendizaje", value: stats.learning ? plural(stats.learning.lessonsCompleted, "lección", "lecciones") : "—", hint: stats.learning ? `${plural(stats.learning.modulesCompleted, "módulo", "módulos")} · ${stats.learning.sharedBy === 1 ? "1 integrante" : `${stats.learning.sharedBy} integrantes`}` : "Nadie lo comparte contigo" },
                    { label: "Créditos al día", value: stats.credit ? `${stats.credit.upToDate} de ${stats.credit.sharedBy}` : "—", hint: stats.credit ? "Entre quienes lo comparten" : "Nadie lo comparte contigo" },
                  ]} />
                </Card>
              )}
              <SectionTitle>Integrantes</SectionTitle>
              <div className="v2-members grid">
                {board.members.map((member) => <MemberCard key={member.memberId} member={member} labels={board.metricLabels} canRemove={isOwner && !member.isSelf} onRemove={() => setRemoving(member)} onPermissions={() => setTab("permisos")} />)}
              </div>
            </div>
            <aside className="v2-side">
              {isOwner && board.seats && (
                <Card>
                  <div className="v2-card-head"><div><h3>Cupos de tu plan</h3><p className="l-small">{subscription?.subscription ? `Plan ${subscription.plans.find((plan) => plan.code === subscription.subscription!.planCode)?.name ?? ""} · ${cop(subscription.subscription.totalCOP)}` : "Plan Individual"}</p></div>{subscription?.subscription && <Chip tone={subscription.subscription.status === "ACTIVE" ? "green" : "blue"}>{subscription.subscription.status === "ACTIVE" ? "Activo" : "Elegido"}</Chip>}</div>
                  <Facts columns={3} items={[{ label: "Total", value: board.seats.total }, { label: "En uso", value: board.seats.used }, { label: "Disponibles", value: board.seats.available }]} />
                  <div className="v2-actions">
                    <button type="button" className="v2-mini" onClick={() => setSheet("invite")}><Icon name="add" size={16} />Invitar</button>
                    {subscription && <button type="button" className="v2-mini ghost" onClick={() => setSheet("plan")}>Cambiar plan</button>}
                  </div>
                </Card>
              )}
              {isOwner && (
                <Card>
                  <div className="v2-card-head"><div><h3>Invitaciones</h3><p className="l-small">{pending.length ? `${plural(pending.length, "pendiente", "pendientes")} de aceptar` : "Ninguna pendiente"}</p></div></div>
                  {board.invitations.length === 0 ? <p className="l-muted">Invita a alguien con ruta propia o como red de apoyo. Cada persona acepta sus propios términos.</p> : (
                    <div className="l-list" style={{ margin: "0 -16px" }}>{board.invitations.map((invitation) => {
                      const [tone, label] = INVITATION[invitation.status];
                      return (
                        <div key={invitation.id}>
                          <span className="l-grow"><strong>{invitation.inviteeName ?? "Persona invitada"}</strong><small>{ROLE_LABEL[invitation.role]} · {invitation.status === "PENDING" ? `vence el ${fmtDate(invitation.expiresAt)}` : `creada el ${fmtDate(invitation.createdAt)}`}</small></span>
                          <StatusChip tone={tone}>{label}</StatusChip>
                          {invitation.status === "PENDING" && <button type="button" className="v2-icon-btn danger" aria-label={`Cancelar la invitación de ${invitation.inviteeName ?? "la persona invitada"}`} disabled={action.busy} onClick={() => run(() => send<HouseholdBoard>("DELETE", `/luft/household/invitations/${invitation.id}`), "Invitación cancelada.")}><Icon name="close" size={18} /></button>}
                        </div>
                      );
                    })}</div>
                  )}
                </Card>
              )}
              {!isOwner && <Tip icon="group" title={`Participas como ${ROLE_LABEL[me.role].toLowerCase()}`}>{me.role === "SUPPORT" ? "Puedes aportar a las metas y ver solo lo que cada integrante autorice." : "Tienes tu propia ruta LUFT dentro del plan del hogar. Tu perfil sigue siendo solo tuyo."}</Tip>}
            </aside>
          </div>
        )}

        {tab === "metas" && <>
          <SectionTitle action={me.role !== "SUPPORT" ? <button type="button" onClick={() => setSheet("goal")}>Nueva meta</button> : undefined}>Metas compartidas</SectionTitle>
          {board.goals.length === 0 ? (
            <Card><Empty title="Aún no hay metas en tu hogar" action={me.role !== "SUPPORT" ? <Button small icon="add" onClick={() => setSheet("goal")}>Crear la primera meta</Button> : undefined}>{me.role === "SUPPORT" ? "Cuando alguien con ruta cree una meta, podrás aportar a ella desde aquí." : "Una meta junta los aportes de tu hogar para un propósito: un semestre, un arriendo, un fondo de emergencias."}</Empty></Card>
          ) : (
            <div className="v2-grid2">{board.goals.map((item) => <GoalCard key={item.id} goal={item} canContribute busy={action.busy} onContribute={() => setContribute(item)} onEdit={() => setGoal(item)} onAttach={attach}
              onResolve={(id, decision) => run(() => send<HouseholdBoard>("POST", `/luft/household/contributions/${id}/${decision}`), decision === "confirm" ? "Aporte confirmado." : "Aporte rechazado.")} />)}</div>
          )}
          <Tip icon="info" title="Los aportes se declaran, no se transfieren aquí">LUFT lleva la cuenta de lo que cada quien dice haber aportado y de lo que el dueño de la meta confirma. El dinero se mueve por fuera.</Tip>
        </>}

        {tab === "permisos" && (
          <div className="v2-cols even">
            <div className="v2-main">
              <Card>
                <div className="v2-card-head"><div><h3>Qué comparto con mi hogar</h3><p className="l-small">Privado por defecto. Cámbialo cuando quieras; se guarda al instante.</p></div></div>
                {consentNeeded && <Tip tone="amber" icon="warning" title="Retiraste tu autorización para compartir"><span style={{ display: "block", marginBottom: 8 }}>Para compartir métricas vuelve a aceptarla.</span><button type="button" className="v2-mini" disabled={action.busy} onClick={reauthorize}>Aceptar de nuevo</button></Tip>}
                <PermissionsEditor value={me.permissions} labels={board.metricLabels} levels={board.shareLevels} disabled={action.busy} onChange={setPermission} />
                <div className="l-small"><strong style={{ fontWeight: 500 }}>Nadie:</strong> solo tú. <strong style={{ fontWeight: 500 }}>Con ruta:</strong> el titular y los beneficiarios. <strong style={{ fontWeight: 500 }}>Todos:</strong> incluye a la red de apoyo.</div>
              </Card>
            </div>
            <aside className="v2-side">
              <Card>
                <div className="v2-card-head"><div><h3>Mi participación</h3><p className="l-small">{ROLE_LABEL[me.role]}{me.seatAssigned ? " · con cupo asignado" : ""}</p></div></div>
                <ConsentBox title={`Autorización que aceptaste (versión ${board.consent.version})`} text={board.consent.text} />
                <p className="l-small">Puedes retirar esta autorización en <Link className="l-link" href="/app/perfil/privacidad">Privacidad y autorizaciones</Link>.</p>
                <div className="v2-actions">
                  {isOwner && <button type="button" className="v2-mini ghost" onClick={() => setSheet("rename")}>Cambiar nombre del hogar</button>}
                  <button type="button" className="v2-mini danger" onClick={() => setSheet("leave")}><Icon name="logout" size={16} />{isOwner ? "Cerrar el hogar" : "Salir del hogar"}</button>
                </div>
              </Card>
            </aside>
          </div>
        )}
      </div>

      {sheet === "invite" && <InviteSheet board={board} onClose={close} onCreated={() => refresh()} />}
      {sheet === "plan" && subscription && <PlanSheet subscription={subscription} onClose={close} onSaved={(next) => { close(); onSubscription(next); }} />}
      {(sheet === "goal" || goal) && <GoalSheet goal={goal} onClose={close} onSaved={(next, message) => { close(); refresh(next, message); }} />}
      {contribute && <ContributionSheet goal={contribute} onClose={close} onSaved={(message) => { close(); refresh(undefined, message); }} />}
      {removing && (
        <ConfirmSheet title={`¿Retirar a ${removing.firstName} del hogar?`} confirm="Sí, retirar" danger busy={action.busy} failure={action.failure} onClose={close} onConfirm={() => run(() => send<HouseholdBoard>("DELETE", `/luft/household/members/${removing.memberId}`), `${removing.firstName} ya no hace parte del hogar.`)}>
          <p>Dejará de ver las metas y lo que el hogar comparte. Su cuenta, su perfil y sus productos no se afectan.</p>
        </ConfirmSheet>
      )}
      {sheet === "leave" && (
        <ConfirmSheet title={isOwner ? "¿Cerrar tu hogar?" : "¿Salir de este hogar?"} confirm={isOwner ? "Sí, cerrar el hogar" : "Sí, salir del hogar"} danger busy={action.busy} failure={action.failure} onClose={close} onConfirm={() => run(() => send<HouseholdBoard>("POST", "/luft/household/leave"), isOwner ? "Cerraste tu hogar." : "Saliste del hogar.")}>
          <p>{isOwner ? "Para cerrarlo no puede quedar ningún otro integrante: retíralos primero. Las invitaciones pendientes se cancelan." : "Dejarás de compartir tus métricas y de ver las metas del hogar."}</p>
          <p>Tu cuenta, tu ruta y tu perfil siguen intactos.</p>
        </ConfirmSheet>
      )}
      {sheet === "rename" && (
        <ConfirmSheet title="Cambiar nombre del hogar" confirm="Guardar nombre" busy={action.busy} failure={action.failure} onClose={close} onConfirm={() => { if (name.trim().length >= 2) void run(() => send<HouseholdBoard>("PATCH", "/luft/household", { name: name.trim() }), "Nombre actualizado."); }}>
          <Field label="Nombre del hogar" valid={name.trim().length >= 2}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></Field>
        </ConfirmSheet>
      )}
    </Screen>
  );
}
