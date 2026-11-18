"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Chip, Field, Header, Icon, OptionCard, Screen, Tip } from "@/components/luft/ui";
import { api, errorMessage, money } from "@/lib/api";
import { nextInstallment } from "@/lib/credit";
import { daysUntil, longDate } from "@/lib/journey";

export default function PayPage() {
  const { data } = useLuft();
  const next = nextInstallment(data.credit);
  const [bankCode, setBankCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");
  if (!next) return (
    <Screen><Header back="/app" title="Pagar cuota" subtitle="No tienes cuotas pendientes en este momento." /><div className="l-body"><Tip lufty title="Todo al día">{data.credit?.loan ? "Ya pagaste todas tus cuotas." : "Cuando tengas un crédito activo, aquí podrás pagar cada cuota."}</Tip></div><div className="l-footer"><Button variant="secondary" href="/app">Volver a mi inicio</Button></div></Screen>
  );
  const remaining = Number(next.amountCOP) - Number(next.paidCOP);
  const days = daysUntil(next.dueDate);
  async function pay() {
    setBusy(true); setFailure(""); setMessage("");
    try {
      const result = await api<{ redirectUrl?: string }>("/startif/payments/pse", { method: "POST", body: JSON.stringify({ installmentId: next!.id, bankCode }) });
      if (result.redirectUrl) window.location.assign(result.redirectUrl); else setMessage("El pago quedó creado. Esperando instrucciones del proveedor.");
    } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Header back="/app" title="Pagar cuota" subtitle={`Cuota ${next.sequence} de ${data.credit!.loan!.installments.length} de tu crédito LUFT`} />
      <div className="l-body">
        <Card className="l-center">
          <span className="l-overline" style={{ color: "var(--l-n-600)" }}>Total a pagar</span>
          <div className="l-big-number">{money(remaining)}</div>
          <span className="l-small">Vence el {longDate(next.dueDate)}{days >= 0 ? ` · ${days === 0 ? "hoy" : `en ${days} día${days === 1 ? "" : "s"}`}` : " · vencida"}</span>
          {days >= 0 && <div className="l-tip green" style={{ width: "100%", alignItems: "center" }}><Icon name="check_circle_fill" /><div className="l-grow">Si pagas a tiempo, tu racha de pagos sube a</div><Chip tone="amber" large icon="local_fire_department_fill">{data.progress.paymentStreak + 1}</Chip></div>}
        </Card>
        <strong style={{ fontWeight: 500 }}>Elige cómo pagar</strong>
        <div className="l-stack" role="radiogroup" aria-label="Medio de pago">
          <OptionCard icon="account_balance" title="PSE" description="Débito desde tu cuenta bancaria" selected onSelect={() => undefined} />
          <OptionCard icon="smartphone" title="Nequi" description="Próximamente" selected={false} onSelect={() => undefined} disabled state="dim" />
          <OptionCard icon="credit_card" title="Tarjeta débito" description="Próximamente" selected={false} onSelect={() => undefined} disabled state="dim" />
        </div>
        <Card className="tight"><Field label="Entidad financiera" hint="Código PSE de tu banco."><input value={bankCode} onChange={(event) => setBankCode(event.target.value)} placeholder="Código PSE de la entidad" required /></Field></Card>
        {message && <Alert type="info">{message}</Alert>}
        {failure && <Alert>{failure}</Alert>}
      </div>
      <div className="l-footer"><Button onClick={pay} disabled={busy || !bankCode.trim()}>{busy ? "Abriendo PSE…" : `Pagar ${money(remaining)}`}</Button><small><Icon name="lock" size={12} /> Pago seguro · El saldo se actualiza cuando el proveedor confirma el pago</small></div>
    </Screen>
  );
}
