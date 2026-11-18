"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { firstName, initials, useLuft } from "@/components/luft/shell";
import { Bar, Button, Card, Chip, Header, Icon, Lufty, Screen, Sheet, type IconName } from "@/components/luft/ui";
import { money } from "@/lib/api";
import { isSettled, nextInstallment, statusLabel } from "@/lib/credit";
import { daysUntil, longDate } from "@/lib/journey";

const TIPS: Array<{ title: string; text: string; icon: IconName; color: string; ink: string }> = [
  { title: "Paga antes de la fecha límite", text: "Programa un recordatorio 3 días antes. Pagar a tiempo es lo que más pesa en tu historial.", icon: "schedule", color: "var(--l-blue-500)", ink: "var(--l-blue-500)" },
  { title: "Usa menos del 30% de tu cupo", text: "Si tienes tarjeta, mantener su uso bajo muestra que manejas bien tu crédito.", icon: "percent", color: "var(--l-violet-400)", ink: "var(--l-violet-600)" },
  { title: "Evita pedir varios créditos a la vez", text: "Muchas solicitudes seguidas pueden verse como riesgo para las entidades.", icon: "gpp_maybe", color: "var(--l-green-300)", ink: "var(--l-green-500)" },
];
const INVITE_KEY = "luft_profile_invite_seen";

function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Buenos días," : hour < 19 ? "Buenas tardes," : "Buenas noches,"; }

export default function HomePage() {
  const { user, data } = useLuft();
  const { credit, progress, journey } = data;
  const next = nextInstallment(credit);
  const installments = credit?.loan?.installments ?? [];
  const [invite, setInvite] = useState(false);
  useEffect(() => { try { if (journey.percent === 0 && credit?.loan && !localStorage.getItem(INVITE_KEY)) setInvite(true); } catch { /* sin almacenamiento */ } }, [journey.percent, credit?.loan]);
  const closeInvite = () => { setInvite(false); try { localStorage.setItem(INVITE_KEY, "1"); } catch { /* sin almacenamiento */ } };
  const overdue = installments.some((row) => row.status === "OVERDUE");
  const days = next ? daysUntil(next.dueDate) : 0;
  const levelSpan = progress.nextLevelXp - progress.floorXp;

  return (
    <Screen>
      <Header>
        <div className="l-greeting">
          <span className="l-avatar">{initials(user.fullName)}</span>
          <span className="l-grow"><small>{greeting()}</small><strong>{firstName(user.fullName)}</strong></span>
          <Link href="/app/pqr" className="l-round" aria-label="Ayuda y solicitudes"><Icon name="help" /></Link>
        </div>
      </Header>
      <div className="l-body tabbed" style={{ gap: 28 }}>
        <Card>
          <div className="l-row between">
            <span className="l-row" style={{ gap: 8, fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}><span className="l-icon-box sm"><Icon name="account_balance_wallet" size={16} /></span>Tu crédito LUFT</span>
            {credit?.loan ? <Chip tone={overdue ? "red" : "green"} dot>{overdue ? "En mora" : next ? "Al día" : "Completado"}</Chip> : credit ? <Chip tone="blue" dot>{statusLabel(credit.status)}</Chip> : null}
          </div>
          {next ? <>
            <div><span className="l-small">Próxima cuota</span><div className="l-big-number">{money(next.amountCOP)}</div><span className="l-small" style={{ fontWeight: 500 }}>Vence el {longDate(next.dueDate)} · {days > 0 ? `en ${days} día${days === 1 ? "" : "s"}` : days === 0 ? "hoy" : `hace ${-days} día${days === -1 ? "" : "s"}`}</span></div>
            <div className="l-row" style={{ gap: 10 }}><Button variant="secondary" href="/app/historial">Ver mi historial</Button><Button href="/app/pagar">Pagar cuota</Button></div>
          </> : credit?.loan ? <>
            <div><div className="l-big-number" style={{ fontSize: 28 }}>¡Plan completado!</div><span className="l-muted">Pagaste todas tus cuotas. Tu historial lo refleja.</span></div>
            <Button variant="secondary" href="/app/historial">Ver mi historial</Button>
          </> : credit ? <>
            <div><div className="l-big-number" style={{ fontSize: 28 }}>{money(credit.amountCOP)}</div><span className="l-muted">Solicitud a {credit.termMonths} meses · {statusLabel(credit.status).toLowerCase()}</span></div>
            <Button href="/app/credito" arrow>Continuar mi solicitud</Button>
          </> : <>
            <div><div className="l-big-number" style={{ fontSize: 28 }}>Tu primer crédito</div><span className="l-muted">Un monto pensado para empezar a construir tu historial, paso a paso.</span></div>
            <div className="l-row" style={{ gap: 10 }}><Button variant="secondary" href="/app/puntaje">Mi puntaje</Button><Button href="/app/credito">Conocerlo</Button></div>
          </>}
        </Card>

        <nav className="l-shortcuts" aria-label="Accesos rápidos">
          <Link href={next ? "/app/pagar" : "/app/credito"}><span><Icon name="account_balance_wallet" size={24} /></span>{next ? "Pagar" : "Crédito"}</Link>
          <Link href="/app/historial"><span><Icon name="task" size={24} /></span>Historial</Link>
          <Link href="/app/aprender"><span><Icon name="eco" size={24} /></span>Aprender</Link>
          <Link href="/app/perfil"><span><Icon name="person" size={24} /></span>Mi perfil</Link>
        </nav>

        <section className="l-stack">
          <div className="l-section-title"><h2>Tu progreso</h2><Link href="/app/progreso">Ver todo</Link></div>
          <Card className="tight">
            <div className="l-row between"><Chip tone="blue" large icon="verified_user_fill">Nivel {progress.level}</Chip><Chip tone="amber" large icon="local_fire_department_fill">{progress.streakDays}</Chip></div>
            <Bar value={((progress.xp - progress.floorXp) / levelSpan) * 100} tone="violet" label="Experiencia del nivel" />
            <span className="l-small">{progress.toNext} XP para el Nivel {progress.level + 1}</span>
            {installments.length > 0 && <>
              <div className="l-ladder" aria-hidden="true">{installments.map((row, index) => <i key={row.id} className={isSettled(row) ? "paid" : row.id === next?.id ? "current" : index === installments.length - 1 ? "goal" : ""} style={{ height: `${28 + (index / Math.max(1, installments.length - 1)) * 72}%` }}>{isSettled(row) ? <Icon name="check" size={12} /> : index === installments.length - 1 ? <Icon name="flag" size={12} /> : null}</i>)}</div>
              <span className="l-small" style={{ fontWeight: 500 }}>{progress.installmentsPaid} de {progress.installmentsTotal} cuotas pagadas</span>
            </>}
          </Card>
        </section>

        <section className="l-stack">
          <div className="l-section-title"><div><h2>Tips de Lufty</h2><span className="l-small">Desliza para ver más</span></div></div>
          <div className="l-carousel">
            {TIPS.map((tip, index) => (
              <article className="l-tipcard" key={tip.title}>
                <div className="art" style={{ background: tip.color }}><Lufty mood={index === 0 ? "wink" : "happy"} tone="white" width={124} /><span><Icon name={tip.icon} size={28} /></span></div>
                <div className="copy"><span className="l-overline" style={{ color: tip.ink }}>Tip {index + 1} de {TIPS.length}</span><h3>{tip.title}</h3><p className="l-muted">{tip.text}</p></div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {invite && (
        <Sheet onClose={closeInvite} title="Dale más contexto a tu historial">
          <div style={{ borderRadius: 20, padding: "28px 20px", background: "var(--l-gradient)", color: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
            <strong style={{ flex: 1, fontSize: 20, lineHeight: "26px", fontWeight: 500 }}>Dale más contexto a tu historial</strong><Lufty tone="white" width={110} />
          </div>
          <p className="l-muted">Suma información que tu historial no muestra y las entidades pueden tener en cuenta al evaluarte.</p>
          <div className="l-tiles" style={{ gap: 8 }}>
            {([["home", "Vivienda"], ["verified_user", "Ocupación"], ["account_balance_wallet", "Mis ingresos"], ["trending_up", "Mis bienes"]] as Array<[IconName, string]>).map(([icon, label]) => <div key={label} style={{ boxShadow: "none", background: "var(--l-n-100)", display: "flex", alignItems: "center", fontSize: 14, color: "var(--l-n-900)" }}><Icon name={icon} className="l-link" />{label}</div>)}
          </div>
          <Button href="/app/perfil/financiero" arrow onClick={closeInvite}>Completar mi perfil</Button>
          <button className="l-link-button" onClick={closeInvite}>Más tarde</button>
          <p className="l-fine">No garantiza la aprobación de un crédito: cada entidad evalúa con sus propios criterios.</p>
        </Sheet>
      )}
    </Screen>
  );
}
