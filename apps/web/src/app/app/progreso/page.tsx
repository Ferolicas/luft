"use client";

import Link from "next/link";
import { useLuft } from "@/components/luft/shell";
import { Bar, Card, Chip, Header, Icon, Lufty, Screen, Tip } from "@/components/luft/ui";
import { isSettled, nextInstallment } from "@/lib/credit";

const MEDAL = { blue: "blue", green: "green", gold: "gold", violet: "violet" } as const;

export default function ProgressPage() {
  const { data } = useLuft();
  const { progress, credit } = data;
  const installments = credit?.loan?.installments ?? [];
  const next = nextInstallment(credit);
  const percent = ((progress.xp - progress.floorXp) / (progress.nextLevelXp - progress.floorXp)) * 100;
  return (
    <Screen>
      <Header topTitle="Mi progreso">
        <div className="l-level-ring" style={{ "--p": percent } as React.CSSProperties}><Lufty tone="white" width={88} /></div>
        <span className="l-level-tag"><Icon name="verified_user" size={14} />NIVEL {progress.level}</span>
        <div style={{ fontSize: 24, fontWeight: 700, margin: "10px 0 14px" }}>{progress.title}</div>
      </Header>
      <div className="l-body tabbed" style={{ gap: 24 }}>
        <Card className="tight"><div className="l-stats">
          <div><span className="l-icon-box sm amber"><Icon name="local_fire_department_fill" size={16} /></span><strong>{progress.streakDays}</strong><small>Racha</small></div>
          <div><span className="l-icon-box sm violet"><Icon name="paid" size={16} /></span><strong>{progress.xp}</strong><small>XP total</small></div>
          <div><span className="l-icon-box sm"><Icon name="verified_user" size={16} /></span><strong>{progress.badgesEarned}/{progress.badges.length}</strong><small>Insignias</small></div>
        </div></Card>

        <section className="l-stack">
          <div className="l-section-title"><h2>Tu progreso</h2></div>
          <Card className="tight">
            <div className="l-row between"><Chip tone="blue" large icon="verified_user_fill">Nivel {progress.level}</Chip><Chip tone="amber" large icon="local_fire_department_fill">{progress.paymentStreak}</Chip></div>
            <Bar value={percent} tone="violet" label="Experiencia del nivel" />
            <span className="l-small">{progress.toNext} XP para el Nivel {progress.level + 1}</span>
            {installments.length > 0 ? <>
              <div className="l-ladder" aria-hidden="true">{installments.map((row, index) => <i key={row.id} className={isSettled(row) ? "paid" : row.id === next?.id ? "current" : index === installments.length - 1 ? "goal" : ""} style={{ height: `${28 + (index / Math.max(1, installments.length - 1)) * 72}%` }} />)}</div>
              <span className="l-small" style={{ fontWeight: 500 }}>{progress.installmentsPaid} de {progress.installmentsTotal} cuotas pagadas</span>
            </> : <span className="l-small">Cuando actives tu crédito verás aquí tu escalera de cuotas.</span>}
          </Card>
        </section>

        <section className="l-stack">
          <div className="l-section-title"><h2>Misiones de la semana</h2></div>
          <Card className="flush"><div className="l-list">{progress.missions.map((mission) => (
            <Link href={mission.href} key={mission.key}>
              <span className={`l-icon-box ${mission.done ? "green" : ""}`}><Icon name={mission.done ? "check_circle" : mission.key === "lesson" ? "eco" : mission.key === "profile" ? "person" : "account_balance_wallet"} /></span>
              <span className="l-grow"><strong>{mission.title}</strong><small>{mission.done ? "Lista" : mission.detail ?? "Pendiente"}</small></span>
              <Chip tone="violet" large icon="diamond_fill">+{mission.xp}</Chip>
            </Link>
          ))}</div></Card>
        </section>

        <section className="l-stack">
          <div className="l-section-title"><h2>Muro de logros</h2><Chip tone="blue">{progress.badgesEarned} de {progress.badges.length}</Chip></div>
          <Card><div className="l-medals">{progress.badges.map((badge) => (
            // eslint-disable-next-line @next/next/no-img-element
            <div key={badge.key} className={badge.earned ? "" : "locked"}><img src={`/luft/medal-${badge.earned ? MEDAL[badge.tone] : badge.progress ? "progress" : "locked"}.svg`} alt={badge.earned ? "Insignia obtenida" : "Insignia bloqueada"} /><strong>{badge.title}</strong><small style={badge.progress ? { color: "var(--l-amber-500)" } : undefined}>{badge.progress ?? badge.hint}</small></div>
          ))}</div></Card>
          <Tip>Ganas XP pagando a tiempo, tomando lecciones y completando tu perfil financiero.</Tip>
        </section>
      </div>
    </Screen>
  );
}
