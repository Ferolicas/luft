"use client";

import { useState } from "react";
import { cop, fmtDate, fmtShort, inDays, plural, send, todayISO, useAction } from "@/lib/v2/api";
import type { CardSimulation, CardsOverview, CardView, Guidance } from "@/lib/v2/types";
import { Alert, Button, Checkbox, Chip, Field, Icon, MoneyInput, Sheet, Tip} from "../ui";
import { Labeled } from "./household";
import { BAND_LABEL, bandTone, Facts, Meter, SheetHead } from "./kit";

export const cardName = (card: Pick<CardView, "issuer" | "alias" | "last4">) => `${card.alias || card.issuer}${card.last4 ? ` •••• ${card.last4}` : ""}`;
const TERMS = [1, 3, 6, 12, 24, 36];
const IMPACT = { FAVORABLE: ["green", "check_circle", "Compra manejable"], NEUTRAL: ["amber", "info", "Revisa antes de comprar"], RISK: ["red", "warning", "Compra de riesgo"] } as const;
const numberOr = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));

export function CardSheet({ card, onClose, onSaved }: { card: CardView | null; onClose: () => void; onSaved: (next: CardsOverview, message: string) => void }) {
  const [issuer, setIssuer] = useState(card?.issuer ?? "");
  const [alias, setAlias] = useState(card?.alias ?? "");
  const [last4, setLast4] = useState(card?.last4 ?? "");
  const [limit, setLimit] = useState<number | null>(card?.creditLimitCOP ?? null);
  const [used, setUsed] = useState<number | null>(card ? card.usedBalanceCOP : null);
  const [statementDay, setStatementDay] = useState(card ? String(card.statementDay) : "");
  const [paymentDay, setPaymentDay] = useState(card ? String(card.paymentDay) : "");
  const [minimum, setMinimum] = useState<number | null>(card?.minimumPaymentCOP ?? null);
  const [rate, setRate] = useState(card?.annualEffectiveRatePercent != null ? String(card.annualEffectiveRatePercent).replace(".", ",") : "");
  const action = useAction();
  const day = (value: string) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31; };
  const rateValue = numberOr(rate);
  const valid = issuer.trim().length >= 2 && Boolean(limit && limit > 0) && (used ?? 0) <= (limit ?? 0) && day(statementDay) && day(paymentDay) && (last4 === "" || /^\d{4}$/.test(last4)) && (rateValue === null || (rateValue >= 0 && rateValue <= 100));
  const save = () => action.run(async () => {
    const base = { issuer: issuer.trim(), creditLimitCOP: limit, usedBalanceCOP: used ?? 0, statementDay: Number(statementDay), paymentDay: Number(paymentDay) };
    if (card) onSaved(await send<CardsOverview>("PATCH", `/luft/cards/${card.id}`, { ...base, alias: alias.trim() || null, last4: last4 || null, minimumPaymentCOP: minimum, annualEffectiveRatePercent: rateValue }), "Tarjeta actualizada.");
    else onSaved(await send<CardsOverview>("POST", "/luft/cards", { ...base, ...(alias.trim() ? { alias: alias.trim() } : {}), ...(last4 ? { last4 } : {}), ...(minimum != null ? { minimumPaymentCOP: minimum } : {}), ...(rateValue != null ? { annualEffectiveRatePercent: rateValue } : {}) }), "Tarjeta registrada.");
  });
  const heading = card ? "Editar tarjeta" : "Registrar tarjeta";
  return (
    <Sheet title={heading} onClose={onClose}>
      <SheetHead title={heading}>Tú declaras estos datos. Nunca te pediremos el número completo, la clave ni el código de seguridad.</SheetHead>
      <div className="v2-form">
        <Field label="Banco o emisor" valid={issuer.trim().length >= 2}><input value={issuer} maxLength={80} placeholder="Ej.: Bancolombia" onChange={(event) => setIssuer(event.target.value)} /></Field>
        <div className="v2-form-row">
          <Field label={<>Alias <span className="v2-optional">(opcional)</span></>}><input value={alias} maxLength={60} placeholder="Ej.: Mi Visa" onChange={(event) => setAlias(event.target.value)} /></Field>
          <Field label={<>Últimos 4 <span className="v2-optional">(opcional)</span></>}><input value={last4} inputMode="numeric" maxLength={4} placeholder="0000" onChange={(event) => setLast4(event.target.value.replace(/\D/g, ""))} /></Field>
        </div>
        <Labeled label="Cupo total"><MoneyInput label="Cupo total" value={limit} onChange={setLimit} /></Labeled>
        <Labeled label="Saldo usado hoy" hint={(used ?? 0) > (limit ?? 0) && limit ? "El saldo usado no puede superar el cupo." : "Lo que debes hoy en la tarjeta."}><MoneyInput label="Saldo usado hoy" value={used} onChange={setUsed} placeholder="$ 0" /></Labeled>
        <div className="v2-form-row">
          <Field label="Día de corte" hint="Del 1 al 31"><input value={statementDay} inputMode="numeric" maxLength={2} placeholder="15" onChange={(event) => setStatementDay(event.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Día límite de pago" hint="Del 1 al 31"><input value={paymentDay} inputMode="numeric" maxLength={2} placeholder="28" onChange={(event) => setPaymentDay(event.target.value.replace(/\D/g, ""))} /></Field>
        </div>
        <Labeled label={<>Pago mínimo <span className="v2-optional">(opcional)</span></>}><MoneyInput label="Pago mínimo" value={minimum} onChange={setMinimum} /></Labeled>
        <Field label={<>Tasa efectiva anual % <span className="v2-optional">(opcional)</span></>} hint="Aparece en tu extracto. Con ella estimamos el costo de las compras a plazos."><input value={rate} inputMode="decimal" maxLength={6} placeholder="Ej.: 24,5" onChange={(event) => setRate(event.target.value.replace(/[^\d.,]/g, ""))} /></Field>
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!valid || action.busy} onClick={save}>{action.busy ? "Guardando…" : card ? "Guardar cambios" : "Registrar tarjeta"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

function TermPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="l-stack" style={{ gap: 8 }}>
      <span className="l-field"><span>Número de cuotas</span></span>
      <div className="v2-quick" role="group" aria-label="Número de cuotas">{TERMS.map((term) => <button type="button" key={term} aria-pressed={value === term} onClick={() => onChange(term)}>{term}</button>)}</div>
      <Field label="Otro plazo (1 a 60)"><input value={value || ""} inputMode="numeric" maxLength={2} onChange={(event) => onChange(Math.min(60, Number(event.target.value.replace(/\D/g, "")) || 0))} /></Field>
    </div>
  );
}

export function PurchaseSheet({ card, onClose, onSaved }: { card: CardView; onClose: () => void; onSaved: (next: CardsOverview, message: string) => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [installments, setInstallments] = useState(1);
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [advance, setAdvance] = useState(false);
  const [apply, setApply] = useState(true);
  const action = useAction();
  const valid = Boolean(amount && amount > 0) && installments >= 1 && description.trim().length >= 2 && Boolean(date);
  const save = () => action.run(async () => onSaved(await send<CardsOverview>("POST", `/luft/cards/${card.id}/purchases`, { amountCOP: amount, installments, purchasedAt: date, description: description.trim(), isCashAdvance: advance, applyToBalance: apply }), "Compra registrada."));
  return (
    <Sheet title="Registrar compra" onClose={onClose}>
      <SheetHead title="Registrar compra">{cardName(card)} · disponible {cop(card.summary.availableCOP)}</SheetHead>
      <div className="v2-form">
        <Labeled label="Valor de la compra"><MoneyInput label="Valor de la compra" value={amount} onChange={setAmount} /></Labeled>
        <Field label="¿Qué compraste?" valid={description.trim().length >= 2}><input value={description} maxLength={160} placeholder="Ej.: Portátil" onChange={(event) => setDescription(event.target.value)} /></Field>
        <Field label="Fecha de la compra"><input type="date" value={date} max={todayISO()} onChange={(event) => setDate(event.target.value)} /></Field>
        <TermPicker value={installments} onChange={setInstallments} />
        <Checkbox checked={advance} onChange={setAdvance}>Fue un avance en efectivo</Checkbox>
        <Checkbox checked={apply} onChange={setApply}>Sumar esta compra al saldo usado de la tarjeta</Checkbox>
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!valid || action.busy} onClick={save}>{action.busy ? "Guardando…" : "Registrar compra"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

export function SimulatorSheet({ card, onClose }: { card: CardView; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [installments, setInstallments] = useState(6);
  const [advance, setAdvance] = useState(false);
  const [result, setResult] = useState<CardSimulation | null>(null);
  const action = useAction();
  const simulate = () => action.run(async () => setResult(await send<CardSimulation>("POST", `/luft/cards/${card.id}/simulate`, { amountCOP: amount, installments, isCashAdvance: advance })));
  if (result) {
    const [tone, icon, title] = IMPACT[result.trajectory.impact];
    return (
      <Sheet title="Resultado de la simulación" onClose={onClose}>
        <SheetHead title={`${cop(result.amountCOP)} a ${plural(result.installments, "cuota", "cuotas")}`}>{cardName(card)}{result.isCashAdvance ? " · avance en efectivo" : ""}. No registra ninguna compra.</SheetHead>
        <div className="v2-shift" aria-label={`Tu uso del cupo pasaría de ${result.utilizationBeforePercent}% a ${result.utilizationAfterPercent}%`}>
          <div><strong>{result.utilizationBeforePercent}%</strong>uso hoy</div><Icon name="arrow_forward" /><div><strong>{result.utilizationAfterPercent}%</strong>uso después</div>
        </div>
        <Meter value={result.utilizationAfterPercent} band={result.bandAfter} label="Uso del cupo después de la compra" />
        <div className="v2-wrap"><Chip tone={bandTone(result.bandAfter)}>{BAND_LABEL[result.bandAfter]}</Chip>{result.exceedsLimit && <Chip tone="red">Supera tu cupo</Chip>}</div>
        <Tip tone={tone} icon={icon} title={title}>{result.trajectory.explanation}</Tip>
        <Facts items={[
          { label: result.installments === 1 ? "Pago" : "Primera cuota", value: cop(result.firstInstallmentCOP), hint: result.installments > 1 ? `Última: ${cop(result.lastInstallmentCOP)}` : undefined },
          { label: "Disponible después", value: cop(result.availableAfterCOP) },
          { label: "Intereses estimados", value: result.totalInterestCOP != null ? cop(result.totalInterestCOP) : "—", hint: result.rateKnown && result.monthlyRatePercent != null ? `Tasa mensual ${String(result.monthlyRatePercent).replace(".", ",")}%` : "Registra la tasa de tu tarjeta para estimarlos" },
          { label: "Total a pagar", value: result.totalCOP != null ? cop(result.totalCOP) : "—" },
          { label: "Compras a plazos a la vez", value: result.simultaneousDeferredPurchases },
          { label: "Peso en tu capacidad", value: result.installmentShareOfCapacityPercent != null ? `${result.installmentShareOfCapacityPercent}%` : "—", hint: result.installmentShareOfCapacityPercent != null ? "De tu capacidad mensual declarada" : "Completa ingresos y gastos en tu perfil" },
        ]} />
        <div className="v2-dates">
          <div><Icon name="calendar_today" /><span><strong>Corte: {fmtShort(result.statement.date)}</strong>{inDays(result.statement.days)}</span></div>
          <div><Icon name="schedule" /><span><strong>Pago: {fmtShort(result.payment.date)}</strong>{inDays(result.payment.days)}</span></div>
        </div>
        {result.warnings.map((warning) => <Alert key={warning} type="warning">{warning}</Alert>)}
        <p className="l-fine">{result.disclaimer}</p>
        <Button variant="secondary" onClick={() => setResult(null)}>Simular otra compra</Button>
        <button type="button" className="l-link-button" onClick={onClose}>Cerrar</button>
      </Sheet>
    );
  }
  return (
    <Sheet title="Simular una compra" onClose={onClose}>
      <SheetHead title="Simular una compra">{cardName(card)} · hoy usas el {card.summary.utilizationPercent}% del cupo. Mira cómo cambia antes de comprar.</SheetHead>
      <div className="v2-form">
        <Labeled label="Valor de la compra"><MoneyInput label="Valor de la compra" value={amount} onChange={setAmount} /></Labeled>
        <TermPicker value={installments} onChange={setInstallments} />
        <Checkbox checked={advance} onChange={setAdvance}>Es un avance en efectivo</Checkbox>
      </div>
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!amount || amount <= 0 || installments < 1 || action.busy} onClick={simulate}>{action.busy ? "Calculando…" : "Ver el efecto"}</Button>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

const SEVERITY_ICON = { INFO: "info", WARNING: "warning", ALERT: "gpp_maybe" } as const;
const RESPONSE = { ACCEPTED: ["green", "La seguiste"], DISMISSED: ["", "La descartaste"], RESOLVED: ["blue", "Dejó de aplicar"], SHOWN: ["amber", "Vigente"] } as const;
const EFFECT = { IMPROVED: ["green", "Tu uso del cupo bajó"], UNCHANGED: ["", "Tu uso del cupo siguió igual"], WORSENED: ["amber", "Tu uso del cupo subió"] } as const;

export function GuidanceCard({ item, busy, onRespond }: { item: Guidance; busy: boolean; onRespond: (decision: "accept" | "dismiss") => void }) {
  return (
    <article className={`v2-guidance ${item.severity.toLowerCase()}`}>
      <div className="head"><Icon name={SEVERITY_ICON[item.severity]} /><div><strong>{item.title}</strong><p>{item.body}</p></div></div>
      <div className="v2-actions">
        <button type="button" className="v2-mini ghost" disabled={busy} onClick={() => onRespond("accept")}><Icon name="check" size={16} />La voy a seguir</button>
        <button type="button" className="v2-mini ghost" disabled={busy} onClick={() => onRespond("dismiss")}>Descartar</button>
      </div>
    </article>
  );
}

export function GuidanceHistoryRow({ item }: { item: Guidance }) {
  const [tone, label] = RESPONSE[item.status];
  const effect = item.effectiveness ? EFFECT[item.effectiveness] : null;
  return (
    <div className="v2-contrib">
      <div className="row"><span><strong>{item.title}</strong><small>{fmtDate(item.shownAt)}{item.respondedAt ? ` · respondida el ${fmtDate(item.respondedAt)}` : ""}</small></span><Chip tone={tone}>{label}</Chip></div>
      <small className="l-small">{effect
        ? <>{effect[1]}: de {item.baselineUtilizationPercent}% a {item.measuredUtilizationPercent}%{item.measuredAt ? ` (medido el ${fmtDate(item.measuredAt)})` : ""}.</>
        : "Efectividad aún sin medir: se calcula con tu siguiente actualización de saldo."}</small>
    </div>
  );
}
