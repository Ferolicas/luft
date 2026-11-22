"use client";

import { useRef, useState } from "react";
import { FILE_ACCEPT, fileProblem, fmtDate, plural, send, uploadFile, useAction } from "@/lib/v2/api";
import type { Contribution, HouseholdBoard, HouseholdMember, InvitationCreated, MemberRole, Metric, Permissions, PlanCode, PlanView, SharedGoal, ShareLevel, SubscriptionView } from "@/lib/v2/types";
import { Alert, Bar, Button, Chip, Field, Icon, MoneyInput, OptionCard, Segmented, Sheet, Tip, formatCOP } from "../ui";
import { ConfirmSheet, SheetHead, StatusChip } from "./kit";

export const ROLE_LABEL: Record<MemberRole, string> = { OWNER: "Titular del hogar", BENEFICIARY: "Beneficiario con cupo", SUPPORT: "Red de apoyo" };
export const LEVEL_LABEL: Record<ShareLevel, string> = { NONE: "Nadie", BENEFICIARIES: "Con ruta", ALL: "Todos" };
export const METRICS: Metric[] = ["routeProgress", "archetype", "learning", "credit", "score"];
const GOAL_KINDS = ["Educación", "Vivienda", "Movilidad", "Emprendimiento", "Emergencias", "Otro"];
const DELIVERY: Record<string, string> = {
  SENT: "Enviamos la invitación por este canal.",
  CONFIGURATION_REQUIRED: "El envío automático aún no está habilitado: comparte tú el enlace.",
  FAILED: "No pudimos enviarla por este canal: comparte tú el enlace.",
};
const CHANNEL: Record<string, string> = { EMAIL: "Correo", WHATSAPP: "WhatsApp", LINK: "Enlace" };

export function Labeled({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return <label className="l-field"><span>{label}</span>{children}{hint && <span className="l-hint">{hint}</span>}</label>;
}

/** Selector de plan con cupos y precio de la API. */
export function PlanPicker({ plans, code, seats, onChange }: { plans: PlanView[]; code: PlanCode | null; seats: number; onChange: (code: PlanCode, seats: number) => void }) {
  const selected = plans.find((plan) => plan.code === code);
  return (
    <div className="l-stack">
      <div className="v2-plans" role="radiogroup" aria-label="Planes">
        {plans.map((plan) => (
          <button type="button" role="radio" aria-checked={plan.code === code} key={plan.code} className="v2-plan" onClick={() => onChange(plan.code, plan.minSeats)}>
            <strong>{plan.name}</strong>
            <span className="seats">{plan.minSeats === plan.maxSeats ? plural(plan.maxSeats, "identidad", "identidades") : `De ${plan.minSeats} a ${plan.maxSeats} identidades`}</span>
            <span className="desc">{plan.description}</span>
            <span className="price">{formatCOP(plan.pricePerSeatCOP)}<small>por identidad{plan.discountPercent > 0 ? ` · ${plan.discountPercent}% menos` : ""}</small></span>
          </button>
        ))}
      </div>
      {selected && selected.minSeats !== selected.maxSeats && (
        <div className="l-row between">
          <span className="l-muted">¿Cuántas identidades incluye?</span>
          <div className="v2-stepper">
            <button type="button" aria-label="Quitar una identidad" disabled={seats <= selected.minSeats} onClick={() => onChange(selected.code, seats - 1)}>−</button>
            <strong aria-live="polite">{seats}</strong>
            <button type="button" aria-label="Agregar una identidad" disabled={seats >= selected.maxSeats} onClick={() => onChange(selected.code, seats + 1)}>+</button>
          </div>
        </div>
      )}
      {selected && <div className="l-total"><span>Total del plan · {plural(seats, "identidad", "identidades")}</span><strong>{formatCOP(selected.pricePerSeatCOP * seats)}</strong></div>}
    </div>
  );
}

export function PlanSheet({ subscription, onClose, onSaved }: { subscription: SubscriptionView; onClose: () => void; onSaved: (next: SubscriptionView) => void }) {
  const [code, setCode] = useState<PlanCode | null>(subscription.subscription?.planCode ?? null);
  const [seats, setSeats] = useState(subscription.subscription?.seats ?? 1);
  const action = useAction();
  const save = () => action.run(async () => onSaved({ ...subscription, ...(await send<SubscriptionView>("POST", "/luft/subscription", { planCode: code, seats })) }));
  return (
    <Sheet title="Cambiar de plan" onClose={onClose}>
      <SheetHead title="Cambiar de plan">{subscription.note}</SheetHead>
      <PlanPicker plans={subscription.plans} code={code} seats={seats} onChange={(nextCode, nextSeats) => { setCode(nextCode); setSeats(nextSeats); }} />
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!code || action.busy} onClick={save}>{action.busy ? "Guardando…" : "Guardar plan"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

/** Una métrica de otro integrante: solo se pinta si la API la entregó (es decir, si fue autorizada). */
function MetricRow({ metric, member, label }: { metric: Metric; member: HouseholdMember; label: string }) {
  const { metrics } = member;
  if (metric === "routeProgress") {
    const value = metrics.routeProgress;
    return <div className="v2-metric"><div className="row"><span>{label}</span><strong>{value ? `${value.percent}%` : "Sin ruta activa"}</strong></div>{value && <><Bar value={value.percent} label={`Avance de ${member.firstName}`} /><span>Etapa: {value.stageLabel}</span></>}</div>;
  }
  if (metric === "archetype") {
    const value = metrics.archetype;
    return <div className="v2-metric"><div className="row"><span>Categoría</span><strong>{value?.categoryBrand ?? "Sin categoría"}</strong></div><div className="row"><span>Arquetipo</span><strong>{value?.archetypeName ?? "Por definir"}</strong></div></div>;
  }
  if (metric === "learning") {
    const value = metrics.learning;
    return <div className="v2-metric"><div className="row"><span>{label}</span><strong>{value ? `${plural(value.lessonsCompleted, "lección", "lecciones")} · ${plural(value.modulesCompleted, "módulo", "módulos")}` : "Sin actividad"}</strong></div></div>;
  }
  if (metric === "credit") {
    const value = metrics.credit;
    return <div className="v2-metric"><div className="row"><span>Crédito constructor</span><strong>{value ? `${value.installmentsPaid} de ${value.installmentsTotal} cuotas · ${value.upToDate ? "al día" : "con atraso"}` : "Sin crédito activo"}</strong></div></div>;
  }
  const value = metrics.score;
  return <div className="v2-metric"><div className="row"><span>Puntaje</span><strong>{value ? value.value : "Sin consulta"}</strong></div></div>;
}

export function MemberCard({ member, labels, canRemove, onRemove, onPermissions }: { member: HouseholdMember; labels: Record<Metric, string>; canRemove: boolean; onRemove: () => void; onPermissions: () => void }) {
  const shared = METRICS.filter((metric) => metric in member.metrics);
  return (
    <article className="v2-member">
      <div className="who">
        <span className="l-avatar">{member.firstName.slice(0, 1).toUpperCase()}</span>
        <span className="l-grow"><strong>{member.firstName}{member.isSelf ? " (tú)" : ""}</strong><small>{ROLE_LABEL[member.role]} · desde el {fmtDate(member.joinedAt)}</small></span>
        {canRemove && <button type="button" className="v2-icon-btn danger" aria-label={`Retirar a ${member.firstName} del hogar`} onClick={onRemove}><Icon name="close" size={18} /></button>}
      </div>
      {member.isSelf ? (
        <div className="l-row between"><span className="v2-private"><Icon name="lock" size={16} />Los demás solo ven lo que autorizas.</span><button type="button" className="v2-mini" onClick={onPermissions}>Mis permisos</button></div>
      ) : shared.length === 0 ? (
        <span className="v2-private"><Icon name="lock" size={16} />No comparte métricas contigo. Su perfil es privado.</span>
      ) : (
        <div className="v2-metrics">{shared.map((metric) => <MetricRow key={metric} metric={metric} member={member} label={labels[metric]} />)}</div>
      )}
    </article>
  );
}

export function InviteSheet({ board, onClose, onCreated }: { board: HouseholdBoard; onClose: () => void; onCreated: () => void }) {
  const seatsLeft = board.seats?.available ?? 0;
  const [role, setRole] = useState<"BENEFICIARY" | "SUPPORT">(seatsLeft > 0 ? "BENEFICIARY" : "SUPPORT");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const action = useAction();
  const digits = phone.replace(/\D/g, "");
  const phoneValid = digits.length === 0 || digits.length === 10;
  const create = () => action.run(async () => {
    const result = await send<InvitationCreated>("POST", "/luft/household/invitations", { role, ...(name.trim().length >= 2 ? { inviteeName: name.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), ...(digits.length === 10 ? { phone: `+57${digits}` } : {}) });
    setCreated(result); onCreated();
  });
  const copy = async () => { if (!created) return; try { await navigator.clipboard.writeText(created.link); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { action.setFailure("No pudimos copiar el enlace. Selecciónalo y cópialo manualmente."); } };
  const share = async () => { if (!created) return; try { await navigator.share({ title: "Invitación a mi hogar LUFT", text: `Te invito a ${board.household?.name ?? "mi hogar"} en LUFT.`, url: created.link }); } catch { /* la persona canceló */ } };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (created) return (
    <Sheet title="Invitación creada" onClose={onClose}>
      <SheetHead title="Invitación creada">Comparte este enlace con {created.invitation.inviteeName ?? "la persona"}. Vence el {fmtDate(created.invitation.expiresAt)}.</SheetHead>
      <div className="v2-linkbox">
        <code>{created.link}</code>
        <div className="v2-actions">
          <button type="button" className="v2-mini ghost" onClick={copy}><Icon name={copied ? "check" : "description"} size={16} />{copied ? "Enlace copiado" : "Copiar enlace"}</button>
          {canShare && <button type="button" className="v2-mini ghost" onClick={share}><Icon name="ios_share" size={16} />Compartir</button>}
        </div>
      </div>
      <Tip tone="amber" icon="lock" title="Guarda el enlace ahora">Por seguridad no lo volveremos a mostrar. Si lo pierdes, cancela la invitación y crea otra.</Tip>
      {created.delivery.length > 0 && <div className="l-stack" style={{ gap: 8 }}>{created.delivery.map((entry) => <div className="l-row" key={entry.channel} style={{ alignItems: "flex-start" }}><StatusChip tone={entry.status === "SENT" ? "green" : "amber"}>{CHANNEL[entry.channel] ?? entry.channel}</StatusChip><span className="l-small l-grow">{DELIVERY[entry.status] ?? entry.status}</span></div>)}</div>}
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button onClick={onClose}>Listo</Button>
    </Sheet>
  );

  return (
    <Sheet title="Invitar a mi hogar" onClose={onClose}>
      <SheetHead title="Invitar a mi hogar">Cada persona acepta sus propios términos y decide qué comparte. Nadie ve tu perfil por estar en el hogar.</SheetHead>
      <div className="l-stack" role="radiogroup" aria-label="Tipo de invitación">
        <OptionCard icon="person" title="Beneficiario con cupo" description={seatsLeft > 0 ? `Tendrá su propia ruta completa. Usa 1 de tus ${plural(seatsLeft, "cupo disponible", "cupos disponibles")}.` : "No tienes cupos disponibles: cambia a Dúo o Familia para invitar con ruta."} selected={role === "BENEFICIARY"} disabled={seatsLeft < 1} state={seatsLeft < 1 ? "dim" : undefined} onSelect={() => setRole("BENEFICIARY")} />
        <OptionCard icon="favorite_fill" title="Red de apoyo" description="Aporta a las metas y ve solo lo que cada quien autorice. No usa cupo." selected={role === "SUPPORT"} onSelect={() => setRole("SUPPORT")} />
      </div>
      <div className="v2-form">
        <Field label={<>Nombre <span className="v2-optional">(opcional)</span></>}><input value={name} maxLength={80} autoComplete="off" onChange={(event) => setName(event.target.value)} /></Field>
        <Field label={<>Correo <span className="v2-optional">(opcional)</span></>} hint="Si lo escribes, intentamos enviarle la invitación."><input type="email" value={email} maxLength={160} autoComplete="off" onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label={<>Celular <span className="v2-optional">(opcional)</span></>} hint={phoneValid ? "Número colombiano de 10 dígitos." : "Escribe los 10 dígitos del celular."}><input type="tel" inputMode="numeric" value={phone} maxLength={13} placeholder="300 123 4567" autoComplete="off" onChange={(event) => setPhone(event.target.value)} /></Field>
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={action.busy || !phoneValid} onClick={create}>{action.busy ? "Creando…" : "Crear invitación"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

export function GoalSheet({ goal, onClose, onSaved }: { goal: SharedGoal | null; onClose: () => void; onSaved: (board: HouseholdBoard, message: string) => void }) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [kind, setKind] = useState(goal?.kind ?? "");
  const [target, setTarget] = useState<number | null>(goal?.targetCOP ?? null);
  const [date, setDate] = useState(goal?.targetDate ?? "");
  const action = useAction();
  const valid = title.trim().length >= 3 && Boolean(target && target > 0);
  const save = () => action.run(async () => {
    if (goal) onSaved(await send<HouseholdBoard>("PATCH", `/luft/household/goals/${goal.id}`, { title: title.trim(), targetCOP: target, targetDate: date || null }), "Meta actualizada.");
    else onSaved(await send<HouseholdBoard>("POST", "/luft/household/goals", { title: title.trim(), targetCOP: target, ...(kind ? { kind } : {}), ...(date ? { targetDate: date } : {}) }), "Meta creada.");
  });
  const setStatus = (status: "ACTIVE" | "COMPLETED" | "CANCELLED", message: string) => action.run(async () => onSaved(await send<HouseholdBoard>("PATCH", `/luft/household/goals/${goal!.id}`, { status }), message));
  const heading = goal ? "Editar meta" : "Nueva meta compartida";
  return (
    <Sheet title={heading} onClose={onClose}>
      <SheetHead title={heading}>{goal ? "Solo tú, que la creaste, puedes cambiarla." : "Todos en el hogar podrán verla y aportar. Tú confirmas los aportes que recibas."}</SheetHead>
      <div className="v2-form">
        <Field label="Nombre de la meta" valid={title.trim().length >= 3}><input value={title} maxLength={160} placeholder="Ej.: Semestre 2027-1" onChange={(event) => setTitle(event.target.value)} /></Field>
        {!goal && <Field label={<>Tipo <span className="v2-optional">(opcional)</span></>} trailing={<Icon name="keyboard_arrow_down" />}><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Sin clasificar</option>{GOAL_KINDS.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>}
        <Labeled label="Monto de la meta"><MoneyInput label="Monto de la meta" value={target} onChange={setTarget} /></Labeled>
        <Field label={<>Fecha objetivo <span className="v2-optional">(opcional)</span></>}><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!valid || action.busy} onClick={save}>{action.busy ? "Guardando…" : goal ? "Guardar cambios" : "Crear meta"}</Button>
      {goal && <div className="v2-actions" style={{ justifyContent: "center" }}>
        {goal.status === "ACTIVE" ? <button type="button" className="v2-mini ok" disabled={action.busy} onClick={() => setStatus("COMPLETED", "Meta marcada como cumplida.")}><Icon name="check" size={16} />Marcar como cumplida</button> : <button type="button" className="v2-mini" disabled={action.busy} onClick={() => setStatus("ACTIVE", "Meta reactivada.")}>Reactivar meta</button>}
        <button type="button" className="v2-mini danger" disabled={action.busy} onClick={() => setStatus("CANCELLED", "Meta cancelada.")}><Icon name="delete" size={16} />Cancelar meta</button>
      </div>}
      <button type="button" className="l-link-button" onClick={onClose}>Cerrar</button>
    </Sheet>
  );
}

export function ContributionSheet({ goal, onClose, onSaved }: { goal: SharedGoal; onClose: () => void; onSaved: (message: string) => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();
  const choose = (list: FileList | null) => { const picked = list?.[0] ?? null; const reason = picked ? fileProblem(picked) : ""; setProblem(reason); setFile(reason ? null : picked); if (input.current) input.current.value = ""; };
  const save = () => action.run(async () => {
    const result = await send<{ contributionId: string }>("POST", `/luft/household/goals/${goal.id}/contributions`, { amountCOP: amount, ...(note.trim() ? { note: note.trim() } : {}) });
    if (file) {
      try { await uploadFile(`/luft/household/contributions/${result.contributionId}/support`, file); }
      catch { onSaved("Aporte registrado, pero el soporte no se pudo cargar. Adjúntalo desde la meta."); return; }
    }
    onSaved(goal.isMine ? "Aporte registrado y confirmado." : `Aporte declarado. ${goal.ownerName} lo confirmará cuando lo reciba.`);
  });
  return (
    <Sheet title="Declarar un aporte" onClose={onClose}>
      <SheetHead title={`Aportar a ${goal.title}`}>{goal.isMine ? "Como la meta es tuya, tu aporte queda confirmado de una vez." : `Declaras lo que entregaste; ${goal.ownerName} lo confirma o lo rechaza. LUFT no mueve dinero.`}</SheetHead>
      <div className="v2-form">
        <Labeled label="Valor del aporte"><MoneyInput label="Valor del aporte" value={amount} onChange={setAmount} /></Labeled>
        <Field label={<>Nota <span className="v2-optional">(opcional)</span></>}><input value={note} maxLength={280} placeholder="Ej.: Transferencia del 20 de noviembre" onChange={(event) => setNote(event.target.value)} /></Field>
        <input ref={input} type="file" accept={FILE_ACCEPT} hidden onChange={(event) => choose(event.target.files)} />
        {file
          ? <div className="v2-doc"><span className="l-icon-box sm"><Icon name="description" size={16} /></span><span className="l-grow"><strong>{file.name}</strong><small>Soporte del aporte</small></span><button type="button" className="v2-icon-btn danger" aria-label="Quitar soporte" onClick={() => setFile(null)}><Icon name="close" size={18} /></button></div>
          : <button type="button" className="v2-mini ghost" onClick={() => input.current?.click()}><Icon name="upload" size={16} />Adjuntar soporte (opcional)</button>}
        {problem && <Alert>{problem}</Alert>}
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!amount || amount <= 0 || action.busy} onClick={save}>{action.busy ? "Registrando…" : "Declarar aporte"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

const CONTRIBUTION = { DECLARED: ["amber", "Por confirmar"], CONFIRMED: ["green", "Confirmado"], REJECTED: ["red", "Rechazado"] } as const;

function ContributionRow({ item, goalIsMine, busy, onResolve, onAttach }: { item: Contribution; goalIsMine: boolean; busy: boolean; onResolve: (decision: "confirm" | "reject") => void; onAttach: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState("");
  const [tone, label] = CONTRIBUTION[item.status];
  const choose = (list: FileList | null) => { const picked = list?.[0]; if (input.current) input.current.value = ""; if (!picked) return; const reason = fileProblem(picked); setProblem(reason); if (!reason) onAttach(picked); };
  return (
    <div className="v2-contrib">
      <div className="row"><span><strong>{formatCOP(item.amountCOP)}</strong><small>{item.isMine ? "Tú" : item.contributorName} · {fmtDate(item.declaredAt)}{item.note ? ` · ${item.note}` : ""}</small></span><StatusChip tone={tone}>{label}</StatusChip></div>
      {(item.canResolve && item.status === "DECLARED") || item.hasSupport || (item.isMine && item.status === "DECLARED") ? (
        <div className="v2-actions">
          {item.canResolve && item.status === "DECLARED" && <><button type="button" className="v2-mini ok" disabled={busy} onClick={() => onResolve("confirm")}><Icon name="check" size={16} />Confirmar</button><button type="button" className="v2-mini danger" disabled={busy} onClick={() => onResolve("reject")}>Rechazar</button></>}
          {item.hasSupport && (item.isMine || goalIsMine) && <a className="v2-mini ghost" href={`/api/luft/household/contributions/${item.id}/support`} target="_blank" rel="noreferrer"><Icon name="visibility" size={16} />Ver soporte</a>}
          {item.isMine && !item.hasSupport && item.status === "DECLARED" && <><input ref={input} type="file" accept={FILE_ACCEPT} hidden onChange={(event) => choose(event.target.files)} /><button type="button" className="v2-mini ghost" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={16} />Adjuntar soporte</button></>}
        </div>
      ) : null}
      {problem && <Alert>{problem}</Alert>}
    </div>
  );
}

export function GoalCard({ goal, canContribute, busy, onContribute, onEdit, onResolve, onAttach }: { goal: SharedGoal; canContribute: boolean; busy: boolean; onContribute: () => void; onEdit: () => void; onResolve: (id: string, decision: "confirm" | "reject") => void; onAttach: (id: string, file: File) => void }) {
  return (
    <article className="l-card v2-goal">
      <div className="v2-card-head">
        <div><h3>{goal.title}</h3><p className="l-small">{goal.kind ? `${goal.kind} · ` : ""}{goal.isMine ? "Meta tuya" : `Meta de ${goal.ownerName}`}{goal.targetDate ? ` · para el ${fmtDate(goal.targetDate)}` : ""}</p></div>
        <Chip tone={goal.status === "COMPLETED" || goal.reached ? "green" : "blue"}>{goal.status === "COMPLETED" ? "Cumplida" : goal.reached ? "Monto alcanzado" : "Activa"}</Chip>
      </div>
      <div className="amounts"><strong>{formatCOP(goal.confirmedCOP)}</strong><span>de {formatCOP(goal.targetCOP)}{goal.pendingCOP > 0 ? <><br />{formatCOP(goal.pendingCOP)} por confirmar</> : null}</span></div>
      <Bar value={goal.percent} tone="green" label={`Avance de ${goal.title}`} />
      {goal.contributions.length > 0
        ? <div className="v2-contribs">{goal.contributions.map((item) => <ContributionRow key={item.id} item={item} goalIsMine={goal.isMine} busy={busy} onResolve={(decision) => onResolve(item.id, decision)} onAttach={(file) => onAttach(item.id, file)} />)}</div>
        : <p className="l-small">Aún no hay aportes. Solo cuentan en el avance los confirmados.</p>}
      <div className="v2-actions">
        {canContribute && goal.status === "ACTIVE" && <button type="button" className="v2-mini" onClick={onContribute}><Icon name="add" size={16} />Declarar aporte</button>}
        {goal.isMine && <button type="button" className="v2-mini ghost" onClick={onEdit}>Editar meta</button>}
      </div>
    </article>
  );
}

/** Qué comparto: un nivel por métrica. Guarda cada cambio de inmediato. */
export function PermissionsEditor({ value, labels, levels, disabled, onChange }: { value: Permissions; labels: Record<Metric, string>; levels: ShareLevel[]; disabled?: boolean; onChange: (metric: Metric, level: ShareLevel) => void }) {
  return (
    <div>
      {METRICS.map((metric) => (
        <div className="v2-perm" key={metric}>
          <span>{labels[metric]}</span>
          <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <Segmented label={`Con quién comparto: ${labels[metric]}`} value={value[metric]} options={levels.map((level) => ({ value: level, label: LEVEL_LABEL[level] }))} onChange={(level) => onChange(metric, level)} />
          </fieldset>
        </div>
      ))}
    </div>
  );
}

export { ConfirmSheet };
