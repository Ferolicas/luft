"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Bar, Button, Card, Chip, Field, Header, Icon, MoneyInput, Screen, Sheet, Tip} from "@/components/luft/ui";
import { Labeled } from "@/components/luft/v2/household";
import { Facts, Fold, PageState, SheetHead, StatusChip } from "@/components/luft/v2/kit";
import { ApiError } from "@/lib/api";
import { cop, describeError, errorCode, fmtDate, inDays, percentText, send, useAction, useResource } from "@/lib/v2/api";
import type { CreditInstallment, CreditsView, CreditView } from "@/lib/v2/types";

type Tone = "" | "green" | "blue" | "amber" | "red" | "violet";
const STAGE: Record<string, [Tone, string]> = {
  borrador: ["", "Solicitud iniciada"], solicitado: ["blue", "Solicitado"], en_estudio: ["violet", "En estudio"], aprobado: ["green", "Aprobado"], rechazado: ["red", "No aprobado"],
  firmado: ["blue", "Firmado"], desembolsado: ["blue", "Desembolsado"], vigente: ["green", "Vigente"], pagado: ["green", "Pagado"], mora: ["red", "En mora"], castigado: ["red", "Castigado"],
};
const INSTALLMENT: Record<string, [Tone, string]> = { PENDING: ["", "Pendiente"], DUE: ["blue", "Por pagar"], PARTIALLY_PAID: ["amber", "Pago parcial"], PAID: ["green", "Pagada"], OVERDUE: ["red", "En mora"], WAIVED: ["green", "Condonada"] };
const settled = (row: CreditInstallment) => row.status === "PAID" || row.status === "WAIVED";
const dueDate = (value: string) => fmtDate(String(value).slice(0, 10));
const daysTo = (value: string) => Math.round((new Date(String(value).slice(0, 10)).getTime() - Date.now()) / 86_400_000);
const PURPOSE_LABEL: Record<string, string> = { SERVICIO_LUFT: "Financia tu servicio LUFT" };

function query(purpose: string, description: string, amount: number | null) {
  const params = new URLSearchParams();
  if (purpose) params.set("purpose", purpose);
  if (purpose === "OTRO" && description.trim()) params.set("purposeDescription", description.trim());
  if (amount) params.set("amountCOP", String(amount));
  const text = params.toString();
  return `/startif/credits${text ? `?${text}` : ""}`;
}

export default function CreditsPage() {
  const { notify, reload: reloadDashboard } = useLuft();
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [applied, setApplied] = useState({ purpose: "", description: "", amount: null as number | null });
  const credits = useResource<CreditsView>(query(applied.purpose, applied.description, applied.amount));
  const [prepay, setPrepay] = useState<CreditView | null>(null);
  const request = useAction();
  const data = credits.data;
  if (!data) return <PageState title="Créditos constructores" back="/app/finanzas" failure={credits.failure} onRetry={credits.reload} label="Revisando tus créditos…" />;

  const { second } = data;
  const product = second.product;
  const purposeLabels = new Map(second.purposes.map((item) => [item.code, item.label]));
  const descriptionOk = purpose !== "OTRO" || description.trim().length >= 10;
  const pendingCheck = purpose !== applied.purpose || description !== applied.description || amount !== applied.amount;
  const hasRange = Boolean(product && product.minAmountCOP !== product.maxAmountCOP);
  const met = second.requirements.filter((item) => item.met).length;
  const secondOpen = data.credits.some((credit) => credit.productCode === "BUILDER_2" && !["rechazado", "pagado"].includes(credit.stage ?? ""));
  const check = () => setApplied({ purpose, description, amount });
  const apply = () => request.run(async () => {
    await send("POST", "/startif/applications", { productCode: "BUILDER_2", purpose, ...(purpose === "OTRO" ? { purposeDescription: description.trim() } : {}), ...(hasRange && amount ? { amountCOP: amount } : {}) });
    notify("Solicitud creada. Continúa con tu validación y tu firma."); await Promise.all([credits.reload(), reloadDashboard()]);
  });

  return (
    <Screen className="v2-wide">
      <Header back="/app/finanzas" title="Créditos constructores" subtitle="Historia controlada: primero demuestras, luego avanzas." />
      <div className="l-body">
        <div className="v2-cols even">
          <div className="v2-main">
            {data.credits.length === 0 ? (
              <Card>
                <div className="v2-credit-row"><span className="n">1</span><span className="l-grow"><strong>Servicio LUFT</strong><small>Aún no lo has solicitado</small></span></div>
                <p className="v2-lead">Tu primer crédito financia el servicio LUFT y permite observar tu primer comportamiento de pago. El monto, el plazo y las cuotas son fijos y los verás antes de aceptar.</p>
                <Button href="/app/credito" arrow>Conocer mi primer crédito</Button>
              </Card>
            ) : data.credits.map((credit, index) => <CreditCard key={credit.id} credit={credit} index={index} purposeLabel={purposeLabels.get(credit.purpose ?? "") ?? PURPOSE_LABEL[credit.purpose ?? ""] ?? ""} onPrepay={() => setPrepay(credit)} />)}
          </div>

          <aside className="v2-side">
            <Card>
              <div className="v2-card-head">
                <div className="l-row"><span className="l-icon-box violet"><Icon name="trending_up" /></span><div><h3>Crédito 2 · {product?.name ?? "Consolidación o propósito definido"}</h3><p className="l-small">{met} de {second.requirements.length} requisitos cumplidos</p></div></div>
                <Chip tone={second.eligible ? "green" : ""} icon={second.eligible ? undefined : "lock"}>{second.eligible ? "Puedes solicitarlo" : "Bloqueado"}</Chip>
              </div>
              <p className="v2-lead">Solo se abre después de verificar tu comportamiento en el crédito 1, una finalidad válida, tu capacidad disponible y que no haya sobreendeudamiento. Nunca se aprueba solo para subir un puntaje.</p>
              <ul className="v2-reqs">{second.requirements.map((item) => (
                <li key={item.code} className={item.met ? "met" : ""}><span className="mark"><Icon name={item.met ? "check" : "close"} size={14} /></span><span><strong>{item.label}</strong><small>{item.met ? "Cumplido" : "No cumplido"}{item.detail ? ` · ${item.detail}` : ""}</small></span></li>
              ))}</ul>
              {product && (
                <Facts items={[
                  { label: hasRange ? "Monto evaluado" : "Monto", value: cop(product.amountCOP), hint: hasRange ? `Entre ${cop(product.minAmountCOP)} y ${cop(product.maxAmountCOP)}` : undefined },
                  { label: "Plazo", value: `${product.termMonths} meses`, hint: `Tasa ${percentText(product.monthlyRate)} mensual` },
                  { label: "Primera cuota", value: cop(product.firstInstallmentCOP), hint: `Última: ${cop(product.lastInstallmentCOP)}` },
                  { label: "Total a pagar", value: cop(product.totalCOP), hint: `Intereses ${cop(product.totalInterestCOP)}` },
                ]} />
              )}
            </Card>

            {secondOpen ? <Tip icon="schedule" title="Ya tienes una solicitud de crédito 2 en curso">Continúala desde su tarjeta. Mientras esté en curso no puedes pedir otra.</Tip> : <Card>
              <div className="v2-card-head"><div><h3>¿Para qué lo usarías?</h3><p className="l-small">La finalidad hace parte de la evaluación y queda registrada en tu solicitud.</p></div></div>
              <div className="v2-form">
                <Field label="Finalidad" trailing={<Icon name="keyboard_arrow_down" />}>
                  <select value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="">Elige una finalidad</option>{second.purposes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
                </Field>
                {purpose === "OTRO" && <Field label="Describe la finalidad" hint={descriptionOk ? undefined : "Escribe al menos 10 caracteres."}><input value={description} maxLength={300} onChange={(event) => setDescription(event.target.value)} /></Field>}
                {hasRange && product && <Labeled label="Monto que necesitas" hint={`Entre ${cop(product.minAmountCOP)} y ${cop(product.maxAmountCOP)}`}><MoneyInput label="Monto que necesitas" value={amount} onChange={setAmount} /></Labeled>}
              </div>
              {credits.failure && <Alert>{credits.failure}</Alert>}
              {request.failure && <Alert>{request.failure}</Alert>}
              {pendingCheck || !applied.purpose
                ? <Button variant="secondary" disabled={!purpose || !descriptionOk} onClick={check}>Revisar requisitos con esta finalidad</Button>
                : second.eligible
                  ? <Button arrow disabled={request.busy} onClick={apply}>{request.busy ? "Creando solicitud…" : "Solicitar crédito 2"}</Button>
                  : <Tip tone="amber" icon="lock" title="Aún no puedes solicitarlo">Revisa arriba los requisitos que faltan. Cuando los cumplas, vuelve y elige tu finalidad.</Tip>}
              <p className="l-fine">Solicitarlo no garantiza su aprobación: StartIF estudia cada solicitud.</p>
            </Card>}
          </aside>
        </div>
      </div>
      {prepay?.loan && <PrepaySheet credit={prepay} onClose={() => setPrepay(null)} />}
    </Screen>
  );
}

function CreditCard({ credit, index, purposeLabel, onPrepay }: { credit: CreditView; index: number; purposeLabel: string; onPrepay: () => void }) {
  const [tone, label] = STAGE[credit.stage ?? ""] ?? ["blue", credit.status];
  const loan = credit.loan ?? null;
  const rows = loan?.installments ?? [];
  const paid = rows.filter(settled).length;
  const next = rows.find((row) => !settled(row));
  const overdue = rows.some((row) => row.status === "OVERDUE");
  const open = ["borrador", "solicitado", "en_estudio", "aprobado", "firmado"].includes(credit.stage ?? "");
  const name = credit.productName ?? (credit.productCode === "BUILDER_2" ? "Crédito constructor 2" : "Servicio LUFT");
  return (
    <Card>
      <div className="v2-card-head">
        <div className="l-row"><span className="v2-credit-row" style={{ padding: 0 }}><span className="n">{index + 1}</span></span><div><h3>{name}</h3><p className="l-small">{purposeLabel || "Crédito constructor"}{credit.purposeDescription ? ` · ${credit.purposeDescription}` : ""} · {cop(credit.amountCOP)} a {credit.termMonths} meses</p></div></div>
        <StatusChip tone={tone}>{label}</StatusChip>
      </div>
      {loan ? <>
        <div className="l-stack" style={{ gap: 6 }}>
          <div className="l-row between"><span className="l-small" style={{ fontWeight: 500 }}>{paid} de {rows.length} cuotas pagadas</span><span className="l-small">{next ? (overdue ? "Tienes cuotas en mora" : "Al día") : "Plan completado"}</span></div>
          <Bar value={rows.length ? (paid / rows.length) * 100 : 0} tone={overdue ? "amber" : "green"} label={`Avance de pago de ${name}`} />
        </div>
        <Facts items={[
          { label: "Saldo de capital", value: cop(loan.outstandingBalanceCOP), hint: `De ${cop(loan.principalCOP)}` },
          next ? { label: "Próxima cuota", value: cop(Number(next.amountCOP) - Number(next.paidCOP)), hint: `${dueDate(next.dueDate)} · ${inDays(daysTo(next.dueDate))}` } : { label: "Próxima cuota", value: "—", hint: "No tienes cuotas pendientes" },
        ]} />
        <Fold summary={`Calendario de pagos (${rows.length} cuotas)`} open={index === 0}>
          <div className="v2-schedule">{rows.map((row) => {
            const [rowTone, rowLabel] = INSTALLMENT[row.status] ?? ["", row.status];
            return (
              <div key={row.id} className={settled(row) ? "paid" : ""}>
                <span className="seq">{settled(row) ? <Icon name="check" size={14} /> : row.sequence}</span>
                <span><strong>{cop(row.amountCOP)}</strong><small>{dueDate(row.dueDate)}{row.principalCOP != null ? ` · capital ${cop(row.principalCOP)} + interés ${cop(row.interestCOP ?? 0)}` : ""}</small></span>
                <StatusChip tone={rowTone}>{rowLabel}</StatusChip>
              </div>
            );
          })}</div>
        </Fold>
        {next && <div className="l-row" style={{ gap: 10 }}><Button variant="secondary" onClick={onPrepay}>Abonar a capital</Button><Button href="/app/pagar">Pagar cuota</Button></div>}
        {!next && <Tip tone="green" icon="check_circle" title="Crédito pagado">Terminaste tu plan de pagos. Este comportamiento queda en tu historia.</Tip>}
      </> : credit.stage === "rechazado" ? (
        <Tip tone="amber" icon="info" title="Esta solicitud no fue aprobada">Puedes revisar el detalle y tus opciones en la pantalla de tu crédito.</Tip>
      ) : credit.disbursement?.status === "PENDING" ? (
        <Tip icon="schedule" title="Aprobado: desembolso en trámite">Tu plan de pagos empieza a contar desde la fecha del giro.</Tip>
      ) : null}
      {!loan && open && <Button href="/app/credito" arrow>Continuar mi solicitud</Button>}
    </Card>
  );
}

function PrepaySheet({ credit, onClose }: { credit: CreditView; onClose: () => void }) {
  const loan = credit.loan!;
  const balance = Number(loan.outstandingBalanceCOP);
  const [amount, setAmount] = useState<number | null>(null);
  const [bank, setBank] = useState("");
  const [pending, setPending] = useState("");
  const [created, setCreated] = useState(false);
  const action = useAction();
  const pay = () => action.run(async () => {
    setPending("");
    try {
      const result = await send<{ redirectUrl?: string }>("POST", "/startif/payments/pse", { kind: "PREPAYMENT", loanId: loan.id, amountCOP: amount, bankCode: bank.trim() });
      if (result.redirectUrl) window.location.assign(result.redirectUrl); else setCreated(true);
    } catch (cause) {
      if (errorCode(cause) === "configuration_required") { setPending(describeError(cause)); return; }
      if (cause instanceof ApiError && errorCode(cause) === "prepayment_exceeds_balance") throw new Error(`El abono no puede superar tu saldo de capital (${cop(Number(cause.body.maxCOP ?? balance))}).`);
      throw cause;
    }
  });
  return (
    <Sheet title="Abono anticipado a capital" onClose={onClose}>
      <SheetHead title="Abono anticipado a capital">Va completo a capital y recalcula tus cuotas pendientes. Saldo de capital hoy: {cop(balance)}.</SheetHead>
      <div className="v2-form">
        <Labeled label="Valor del abono" hint={amount && amount > balance ? "No puede superar tu saldo de capital." : "Necesitas estar al día para abonar."}><MoneyInput label="Valor del abono" value={amount} onChange={setAmount} /></Labeled>
        <Field label="Entidad financiera" hint="Código PSE de tu banco."><input value={bank} placeholder="Código PSE de la entidad" onChange={(event) => setBank(event.target.value)} /></Field>
      </div>
      {pending && <Tip tone="amber" icon="warning" title="El pago en línea aún no está habilitado">{pending} Tu abono no se registró ni se cobró nada.</Tip>}
      {created && <Alert type="info">El abono quedó creado. Tu saldo se actualiza cuando el proveedor confirme el pago.</Alert>}
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!amount || amount <= 0 || amount > balance || !bank.trim() || action.busy} onClick={pay}>{action.busy ? "Abriendo PSE…" : amount ? `Abonar ${cop(amount)}` : "Abonar a capital"}</Button>
      <p className="l-fine"><Icon name="lock" size={12} /> Pago seguro por PSE · LUFT nunca te pide claves bancarias</p>
      <button type="button" className="l-link-button" onClick={onClose}>Cerrar</button>
    </Sheet>
  );
}
