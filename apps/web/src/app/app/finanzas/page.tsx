"use client";

import Link from "next/link";
import { Alert, Chip, Header, Icon, Screen, Tip } from "@/components/luft/ui";
import { BAND_LABEL, bandTone, Meter, StatusChip } from "@/components/luft/v2/kit";
import { plural, useResource } from "@/lib/v2/api";
import { CONNECTION, CONNECTION_OPEN } from "@/lib/v2/labels";
import type { CardsOverview, CreditsView, OpenFinanceView } from "@/lib/v2/types";

const settled = (status: string) => status === "PAID" || status === "WAIVED";

export default function FinancePage() {
  const cards = useResource<CardsOverview>("/luft/cards/overview");
  const credits = useResource<CreditsView>("/startif/credits");
  const openFinance = useResource<OpenFinanceView>("/luft/open-finance");
  const totals = cards.data?.totals ?? null;
  const tip = cards.data?.recommendations[0] ?? null;
  const first = credits.data?.credits.find((credit) => credit.productCode === "BUILDER_1") ?? null;
  const secondCredit = credits.data?.credits.find((credit) => credit.productCode === "BUILDER_2") ?? null;
  const second = credits.data?.second ?? null;
  const rows = first?.loan?.installments ?? [];
  const paid = rows.filter((row) => settled(row.status)).length;
  const overdue = rows.some((row) => row.status === "OVERDUE");
  const connection = openFinance.data?.connections.find((item) => CONNECTION_OPEN.includes(item.status)) ?? null;
  const loading = <span className="l-small">Cargando…</span>;

  return (
    <Screen className="v2-wide">
      <Header back="/app" title="Mis finanzas" subtitle="Conecta fuentes, cuida tus tarjetas y sigue tus créditos antes de cada decisión." />
      <div className="l-body">
        <div className="v2-hub">
          <Link href="/app/finanzas/tarjetas" className="v2-hub-card">
            <div className="head"><span className="l-icon-box"><Icon name="credit_card" /></span><span className="l-grow"><strong>Orientador de tarjetas</strong><small>Cupo, plazos, fechas y simulador</small></span>{totals && <Chip tone={bandTone(totals.band)}>{BAND_LABEL[totals.band]}</Chip>}</div>
            <div className="l-stack">
              {cards.failure ? <Alert>{cards.failure}</Alert> : !cards.data ? loading : totals ? <>
                <div className="v2-big"><strong>{totals.utilizationPercent}%</strong><span>de uso en {plural(cards.data.cards.length, "tarjeta", "tarjetas")}</span></div>
                <Meter value={totals.utilizationPercent} band={totals.band} label="Uso total del cupo" />
                {tip ? <p className="l-muted"><strong style={{ fontWeight: 500, color: "var(--l-n-900)" }}>{tip.title}.</strong> {tip.body}</p> : <p className="l-muted">No tienes recomendaciones pendientes.</p>}
              </> : <p className="l-muted">Registra tu tarjeta para ver la salud de tu cupo y simular compras por monto y plazo. Nunca pedimos el número completo ni la clave.</p>}
            </div>
            <div className="foot"><span>{totals ? "Abrir orientador" : "Registrar mi tarjeta"}</span><Icon name="arrow_forward" /></div>
          </Link>

          <Link href="/app/finanzas/creditos" className="v2-hub-card">
            <div className="head"><span className="l-icon-box green"><Icon name="account_balance_wallet" /></span><span className="l-grow"><strong>Créditos constructores</strong><small>Historia controlada con StartIF</small></span></div>
            <div>
              {credits.failure ? <Alert>{credits.failure}</Alert> : !credits.data ? loading : <>
                <div className="v2-credit-row"><span className="n">1</span><span className="l-grow"><strong>{first?.productName ?? "Servicio LUFT"}</strong><small>{first?.loan ? `${paid} de ${rows.length} cuotas · ${paid === rows.length ? "pagado" : overdue ? "en mora" : "al día"}` : first ? "Solicitud en curso" : "Aún no lo has solicitado"}</small></span>{first?.loan && <Icon name={overdue ? "warning" : "check_circle"} />}</div>
                <div className={`v2-credit-row ${secondCredit || second?.eligible ? "" : "muted"}`}><span className="n">2</span><span className="l-grow"><strong>{secondCredit?.productName ?? second?.product?.name ?? "Consolidación o propósito definido"}</strong><small>{secondCredit ? "Solicitud o crédito en curso" : second?.eligible ? "Puedes solicitarlo" : `Disponible tras evaluación · ${second?.requirements.filter((item) => item.met).length ?? 0} de ${second?.requirements.length ?? 0} requisitos`}</small></span>{!secondCredit && !second?.eligible && <Icon name="lock" />}</div>
              </>}
            </div>
            <div className="foot"><span>Ver calendario y requisitos</span><Icon name="arrow_forward" /></div>
          </Link>

          <Link href="/app/finanzas/conexiones" className="v2-hub-card">
            <div className="head"><span className="l-icon-box violet"><Icon name="sync" /></span><span className="l-grow"><strong>Open Finance</strong><small>Lectura autorizada de tus cuentas</small></span>{openFinance.data && (connection ? <StatusChip tone={CONNECTION[connection.status][0]}>{CONNECTION[connection.status][1]}</StatusChip> : <Chip>Sin conectar</Chip>)}</div>
            <div className="l-stack">
              {openFinance.failure ? <Alert>{openFinance.failure}</Alert> : !openFinance.data ? loading : <>
                <p className="l-muted">{connection ? CONNECTION[connection.status][2] : "Autoriza temporalmente la lectura de las cuentas que elijas para observar ingresos, pagos recurrentes y capacidad."}</p>
                {!openFinance.data.available && <p className="l-small">Aún no está habilitado: falta el proveedor regulado. Puedes dejar registrada tu autorización.</p>}
                <span className="v2-private"><Icon name="lock" size={16} />{openFinance.data.notice}</span>
              </>}
            </div>
            <div className="foot"><span>{connection ? "Gestionar permisos" : "Autorizar una conexión"}</span><Icon name="arrow_forward" /></div>
          </Link>
        </div>
        {cards.data && <Tip icon="info">{cards.data.disclaimer}</Tip>}
      </div>
    </Screen>
  );
}
