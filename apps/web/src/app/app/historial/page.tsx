"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Button, Card, Chip, Header, Icon, Screen, Tip } from "@/components/luft/ui";
import { money } from "@/lib/api";
import { paidOnTime } from "@/lib/credit";
import { shortDate } from "@/lib/journey";

export default function HistoryPage() {
  const { data } = useLuft();
  const loan = data.credit?.loan;
  const [filter, setFilter] = useState<"all" | "payments" | "badges">("all");
  if (!loan) return <Screen><Header back="/app" title="Historial de pagos" subtitle="Todos los movimientos de tu crédito LUFT" /><div className="l-body"><Tip lufty title="Aún no hay movimientos">Cuando tengas un crédito activo verás aquí cada pago y cada logro.</Tip></div><div className="l-footer"><Button href="/app/credito" arrow>Conocer mi crédito</Button></div></Screen>;
  const paid = loan.installments.filter((row) => row.status === "PAID");
  const totalPaid = loan.installments.reduce((total, row) => total + Number(row.paidCOP), 0);
  const onTime = paid.length ? Math.round((paid.filter(paidOnTime).length / paid.length) * 100) : null;
  const earned = data.progress.badges.filter((badge) => badge.earned);
  const groups = new Map<string, typeof paid>();
  for (const row of [...paid].reverse()) { const label = new Date(row.paidAt ?? row.dueDate).toLocaleDateString("es-CO", { month: "long", year: "numeric" }); groups.set(label, [...(groups.get(label) ?? []), row]); }
  return (
    <Screen>
      <Header back="/app" title="Historial de pagos" subtitle="Todos los movimientos de tu crédito LUFT" />
      <div className="l-body">
        <Card className="l-center">
          <span className="l-small">Total pagado</span><div className="l-big-number">{money(totalPaid)}</div>
          {onTime != null && <Chip tone={onTime === 100 ? "green" : "amber"} icon="check_circle">{onTime}% de tus pagos a tiempo</Chip>}
          <hr className="l-divider" style={{ width: "100%" }} />
          <div className="l-stats" style={{ width: "100%" }}>
            <div><Chip tone="blue" large>{paid.length} de {loan.installments.length}</Chip><small>Cuotas pagadas</small></div>
            <div><Chip tone="amber" large icon="local_fire_department_fill">{data.progress.paymentStreak}</Chip><small>Racha de pagos</small></div>
            <div><Chip tone="violet" large icon="diamond_fill">{data.progress.xp}</Chip><small>XP ganados</small></div>
          </div>
        </Card>
        <div className="l-tiles">
          <div><span className="l-icon-box sm"><Icon name="paid" size={16} /></span>Monto del crédito<strong>{money(loan.principalCOP)}</strong></div>
          <div><span className="l-icon-box sm"><Icon name="schedule" size={16} /></span>Plazo<strong>{loan.installments.length} meses</strong></div>
          <div><span className="l-icon-box sm"><Icon name="calculate" size={16} /></span>Cuotas restantes<strong>{loan.installments.length - paid.length}</strong></div>
          <div><span className="l-icon-box sm"><Icon name="trending_up" size={16} /></span>Te falta<strong>{money(loan.outstandingBalanceCOP)}</strong></div>
        </div>
        <div className="l-pills" role="group" aria-label="Filtrar movimientos">{([["all", "Todos"], ["payments", "Pagos"], ["badges", "Logros"]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        {filter !== "badges" && (paid.length === 0 ? <Tip lufty title="Aún no registras pagos">Tu primera cuota aparecerá aquí apenas el proveedor confirme el pago.</Tip> : [...groups.entries()].map(([label, rows]) => (
          <section className="l-stack" key={label} style={{ gap: 8 }}>
            <span className="l-overline" style={{ color: "var(--l-n-600)" }}>{label}</span>
            <Card className="flush"><div className="l-list">{rows.map((row) => <div key={row.id}><span className="l-icon-box green"><Icon name="check_circle" /></span><span className="l-grow"><strong>Cuota {row.sequence} de {loan.installments.length}</strong><small>{row.paidAt ? `Pagada el ${shortDate(row.paidAt)}` : `Vencía el ${shortDate(row.dueDate)}`}</small>{paidOnTime(row) ? <Chip tone="green">A tiempo</Chip> : <Chip tone="amber">Fuera de fecha</Chip>}</span><strong>-{money(row.paidCOP)}</strong></div>)}</div></Card>
          </section>
        )))}
        {filter !== "payments" && earned.length > 0 && <section className="l-stack" style={{ gap: 8 }}>
          <span className="l-overline" style={{ color: "var(--l-n-600)" }}>Logros</span>
          <Card className="flush"><div className="l-list">{earned.map((badge) => <div key={badge.key}><span className="l-icon-box violet"><Icon name="workspace_premium" /></span><span className="l-grow"><strong>Insignia {badge.title}</strong><small>{badge.hint}</small></span></div>)}</div></Card>
        </section>}
      </div>
    </Screen>
  );
}
