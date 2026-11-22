"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Chip, Header, Icon, Screen, Tip, formatCOP } from "@/components/luft/ui";
import { CardSheet, GuidanceCard, GuidanceHistoryRow, PurchaseSheet, SimulatorSheet, cardName } from "@/components/luft/v2/cards";
import { BAND_LABEL, bandTone, ConfirmSheet, Empty, Facts, Fold, Meter, PageState, SectionTitle } from "@/components/luft/v2/kit";
import { fmtDate, fmtDay, inDays, plural, send, useAction, useResource } from "@/lib/v2/api";
import type { CardsOverview, CardView } from "@/lib/v2/types";

type Open = { kind: "new" } | { kind: "edit" | "purchase" | "simulate" | "delete"; card: CardView } | null;

export default function CardsPage() {
  const { notify } = useLuft();
  const overview = useResource<CardsOverview>("/luft/cards/overview");
  const [open, setOpen] = useState<Open>(null);
  const action = useAction();
  const data = overview.data;
  if (!data) return <PageState title="Orientador de tarjetas" back="/app/finanzas" failure={overview.failure} onRetry={overview.reload} label="Revisando tus tarjetas…" />;
  const applied = (next: CardsOverview, message: string) => { overview.setData(next); setOpen(null); notify(message); };
  const mutate = (work: () => Promise<CardsOverview>, message: string) => action.run(async () => applied(await work(), message));
  const { totals, capacity } = data;

  return (
    <Screen className="v2-wide">
      <Header back="/app/finanzas" title="Orientador de tarjetas" subtitle="Cuida tu cupo, tus plazos y tus fechas antes de cada compra." />
      <div className="l-body">
        {data.cards.length === 0 ? (
          <Card><Empty title="Registra tu primera tarjeta" action={<Button icon="add" onClick={() => setOpen({ kind: "new" })}>Registrar tarjeta</Button>}>Con el cupo, el saldo y tus fechas de corte y pago te mostramos la salud de tu cupo y simulamos compras. Nunca pedimos el número completo ni la clave.</Empty></Card>
        ) : (
          <div className="v2-cols">
            <div className="v2-main">
              {totals && (
                <Card>
                  <div className="v2-card-head"><div><span className="l-overline">Salud de tu cupo</span><div className="v2-big"><strong>{totals.utilizationPercent}%</strong><span>de uso en {plural(data.cards.length, "tarjeta", "tarjetas")}</span></div></div><Chip tone={bandTone(totals.band)}>{BAND_LABEL[totals.band]}</Chip></div>
                  <Meter value={totals.utilizationPercent} band={totals.band} label="Uso total del cupo" />
                  <Facts columns={3} items={[
                    { label: "Cupo total", value: formatCOP(totals.creditLimitCOP) },
                    { label: "Usado", value: formatCOP(totals.usedBalanceCOP) },
                    { label: "Disponible", value: formatCOP(totals.availableCOP) },
                  ]} />
                  <Facts items={[
                    { label: "Cuotas de compras al mes", value: formatCOP(totals.monthlyInstallmentsCOP), hint: `${plural(data.obligations, "obligación simultánea", "obligaciones simultáneas")}` },
                    { label: "Capacidad disponible", value: capacity ? formatCOP(capacity.availableCOP) : "—", hint: capacity ? `Ingresos ${formatCOP(capacity.monthlyIncomeCOP)} − compromisos ${formatCOP(capacity.monthlyCommitmentsCOP)}` : "Completa ingresos y gastos en tu perfil" },
                  ]} />
                </Card>
              )}

              <SectionTitle action={<button type="button" onClick={() => setOpen({ kind: "new" })}>Agregar tarjeta</button>}>Tus tarjetas</SectionTitle>
              {action.failure && !open && <Alert>{action.failure}</Alert>}
              {data.cards.map((card) => (
                <Card key={card.id}>
                  <div className="v2-card-head">
                    <div className="l-row"><span className="l-icon-box"><Icon name="credit_card" /></span><div><h3>{cardName(card)}</h3><p className="l-small">{card.alias ? `${card.issuer} · ` : ""}Declarada por ti · actualizada el {fmtDate(card.updatedAt)}</p></div></div>
                    <Chip tone={bandTone(card.summary.band)}>{card.summary.utilizationPercent}%</Chip>
                  </div>
                  <Meter value={card.summary.utilizationPercent} band={card.summary.band} label={`Uso del cupo de ${cardName(card)}`} />
                  <div className="l-row between"><span className="l-muted">Usado {formatCOP(card.usedBalanceCOP)} de {formatCOP(card.creditLimitCOP)}</span><strong style={{ fontSize: 14, fontWeight: 500 }}>Disponible {formatCOP(card.summary.availableCOP)}</strong></div>
                  <div className="v2-dates">
                    <div><Icon name="calendar_today" /><span><strong>Corte: {fmtDay(card.summary.statement.date)}</strong>{inDays(card.summary.statement.days)}</span></div>
                    <div><Icon name="schedule" /><span><strong>Pago: {fmtDay(card.summary.payment.date)}</strong>{inDays(card.summary.payment.days)}</span></div>
                  </div>
                  <div className="l-kv">
                    <div>Compras a plazos vigentes<strong>{card.summary.deferredPurchases}{card.summary.longestTermMonths ? ` · la más larga a ${card.summary.longestTermMonths} meses` : ""}</strong></div>
                    <div>Cuotas de compras al mes<strong>{formatCOP(card.summary.monthlyInstallmentsCOP)}</strong></div>
                    {card.summary.cashAdvances > 0 && <div>Avances en efectivo<strong>{card.summary.cashAdvances}</strong></div>}
                    <div>Pago mínimo<strong>{card.minimumPaymentCOP != null ? formatCOP(card.minimumPaymentCOP) : "Sin registrar"}</strong></div>
                    <div>Tasa efectiva anual<strong>{card.annualEffectiveRatePercent != null ? `${String(card.annualEffectiveRatePercent).replace(".", ",")}%` : "Sin registrar"}</strong></div>
                  </div>
                  <Button icon="calculate" onClick={() => setOpen({ kind: "simulate", card })}>Simular una compra</Button>
                  <div className="v2-actions">
                    <button type="button" className="v2-mini" onClick={() => setOpen({ kind: "purchase", card })}><Icon name="add" size={16} />Registrar compra</button>
                    <button type="button" className="v2-mini ghost" onClick={() => setOpen({ kind: "edit", card })}>Editar</button>
                    <button type="button" className="v2-mini danger" onClick={() => setOpen({ kind: "delete", card })}>Eliminar</button>
                  </div>
                  {card.purchases.length > 0 && (
                    <Fold summary={`Compras registradas (${card.purchases.length})`}>
                      <div className="v2-docs">{card.purchases.map((purchase) => (
                        <div className="v2-doc" key={purchase.id}>
                          <span className="l-grow"><strong>{purchase.description} · {formatCOP(purchase.amountCOP)}</strong><small>{fmtDate(purchase.purchasedAt)} · {purchase.isCashAdvance ? "avance · " : ""}{purchase.installments === 1 ? "1 cuota" : `faltan ${purchase.remainingInstallments} de ${purchase.installments} cuotas`}</small></span>
                          <button type="button" className="v2-icon-btn danger" disabled={action.busy} aria-label={`Eliminar la compra ${purchase.description}`} onClick={() => mutate(() => send<CardsOverview>("DELETE", `/luft/cards/${card.id}/purchases/${purchase.id}`), "Compra eliminada.")}><Icon name="delete" size={18} /></button>
                        </div>
                      ))}</div>
                    </Fold>
                  )}
                </Card>
              ))}
            </div>

            <aside className="v2-side">
              <Card>
                <div className="v2-card-head"><div><h3>Recomendaciones para ti</h3><p className="l-small">Según tu cupo, tus plazos y tus fechas.</p></div></div>
                {data.recommendations.length === 0
                  ? <p className="l-muted">No tienes recomendaciones pendientes. Aparecen cuando cambia tu uso del cupo o se acerca una fecha.</p>
                  : data.recommendations.map((item) => <GuidanceCard key={item.id} item={item} busy={action.busy} onRespond={(decision) => mutate(() => send<CardsOverview>("POST", `/luft/cards/guidance/${item.id}/${decision}`), decision === "accept" ? "Anotado: la vas a seguir." : "Recomendación descartada.")} />)}
                <Tip icon="info">{data.disclaimer}</Tip>
              </Card>
              <Card>
                <div className="v2-card-head"><div><h3>Historial de recomendaciones</h3><p className="l-small">Qué hiciste y qué pasó después con tu uso del cupo.</p></div></div>
                {data.history.length === 0 ? <p className="l-muted">Aún no has respondido recomendaciones.</p> : <div className="v2-contribs">{data.history.map((item) => <GuidanceHistoryRow key={item.id} item={item} />)}</div>}
              </Card>
            </aside>
          </div>
        )}
        {data.cards.length === 0 && <Tip icon="info">{data.disclaimer}</Tip>}
      </div>

      {open?.kind === "new" && <CardSheet card={null} onClose={() => setOpen(null)} onSaved={applied} />}
      {open?.kind === "edit" && <CardSheet card={open.card} onClose={() => setOpen(null)} onSaved={applied} />}
      {open?.kind === "purchase" && <PurchaseSheet card={open.card} onClose={() => setOpen(null)} onSaved={applied} />}
      {open?.kind === "simulate" && <SimulatorSheet card={open.card} onClose={() => setOpen(null)} />}
      {open?.kind === "delete" && (
        <ConfirmSheet title={`¿Eliminar ${cardName(open.card)}?`} confirm="Sí, eliminar tarjeta" danger busy={action.busy} failure={action.failure} onClose={() => setOpen(null)} onConfirm={() => mutate(() => send<CardsOverview>("DELETE", `/luft/cards/${open.card.id}`), "Tarjeta eliminada.")}>
          <p>Se borran sus compras registradas y sus recomendaciones pendientes. No afecta tu tarjeta real ni tu banco.</p>
        </ConfirmSheet>
      )}
    </Screen>
  );
}
