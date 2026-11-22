"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { firstName, useLuft } from "@/components/luft/shell";
import { SignaturePad } from "@/components/signature-pad";
import { Alert, Button, Card, Carousel, Celebration, Checkbox, Chip, Field, Header, Icon, Luft, Lufty, OptionCard, Screen, Staircase, Tip } from "@/components/luft/ui";
import { api, errorMessage, money } from "@/lib/api";
import { EXPERIENCE, GOALS } from "@/lib/classification";
import { installmentsLabel, isSettled, nextInstallment, planMilestones, planSteps, statusLabel } from "@/lib/credit";
import { longDate, monthName, monthYear, shortDate, shortDateYear, type CreditExperience, type Goal } from "@/lib/journey";
import { lessonXp } from "@/lib/lessons";
import type { CreditProductCode, CreditQuote, Plan, PlansData } from "@/lib/types";

/** The first builder credit finances the LUFT service; amount, term and rate live in the product (API). */
const PRODUCT: CreditProductCode = "BUILDER_1";
const STEPS = 6;
const POSSIBILITIES = [
  ["vivienda", "Vivienda", "Un hogar propio", "Un buen historial puede facilitarte un crédito de vivienda."],
  ["vehiculo", "Vehículo", "Tu moto o tu carro", "Financiar un vehículo podría ser más accesible para ti."],
  ["viajes", "Viajes", "Ese viaje pendiente", "Más opciones para planear experiencias que hoy ves lejos."],
  ["emprender", "Emprendimiento", "Tu propio negocio", "El historial abre puertas cuando buscas capital para crecer."],
  ["estudios", "Estudios", "Seguir aprendiendo", "Opciones para financiar la formación que quieres."],
];
const SERVICE = ["Diagnóstico de tu punto de partida", "Academia LUFT con lecciones cortas", "Acompañamiento para tu perfil financiero", "Reporte mensual de tus pagos a las centrales de riesgo"];
const percent = (rate: number) => new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 2 }).format(rate).replace(/\s/g, "");

function Offer() {
  const { reload } = useLuft();
  const [step, setStep] = useState(1);
  const [quote, setQuote] = useState<CreditQuote | null>(null);
  const [quoteFailure, setQuoteFailure] = useState("");
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const loadQuote = useCallback(() => {
    setQuoteFailure("");
    api<CreditQuote>("/startif/quote", { method: "POST", body: JSON.stringify({ productCode: PRODUCT }) }).then(setQuote).catch((cause) => setQuoteFailure(errorMessage(cause)));
  }, []);
  useEffect(() => {
    loadQuote();
    // Si los planes no responden, el paso 2 explica el servicio sin mostrar precios.
    api<PlansData>("/luft/plans").then((result) => setPlans(result.plans)).catch(() => setPlans([]));
  }, [loadQuote]);
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  const rows = quote?.installments ?? [];
  const first = rows[0];
  const last = rows.at(-1);
  const count = quote?.termMonths ?? 0;
  const decreasing = rows.length > 1 && rows.every((row, index) => index === 0 || row.amountCOP < rows[index - 1].amountCOP);
  const highest = Math.max(1, ...rows.map((row) => row.amountCOP));
  const milestones = planMilestones(count);
  const plan = plans?.find((item) => item.code === "INDIVIDUAL") ?? plans?.[0] ?? null;

  async function accept() {
    setBusy(true); setFailure("");
    try {
      await api("/luft/consents", { method: "POST", body: JSON.stringify({ kind: "SCORE_SHARE_WITH_STARTIF", accepted: true, version: "2026-09-01" }) });
      await api("/startif/consents", { method: "POST", body: JSON.stringify({ accepted: true, version: "2026-09-01" }) });
      await api("/startif/applications", { method: "POST", body: JSON.stringify({ productCode: PRODUCT }) });
      await reload();
    } catch (cause) { setFailure(errorMessage(cause)); setBusy(false); }
  }
  const heads: Array<[React.ReactNode, React.ReactNode]> = [
    ["Abre nuevos caminos", "Un buen historial es una inversión en tus posibilidades. Mira lo que podría facilitarte."],
    ["Tu plan LUFT", "Esto es lo que financia tu primer crédito."],
    ["Tu primer crédito", <>Un monto pensado para <br />empezar a construir tu historial.</>],
    [count ? `Tu plan de ${installmentsLabel(count)}` : "Tu plan de cuotas", decreasing ? "Pagas más al inicio y menos al final." : "Un plan claro, cuota a cuota."],
    ["Construye tu historial", "Cada cuota pagada a tiempo es un escalón más hacia un historial sólido."],
    ["Antes de aceptar", "Revisa tu crédito. Todo claro, sin letra pequeña."],
  ];
  const head = heads[step - 1];
  const needsQuote = step >= 3;
  return (
    <Screen>
      <Header back={step === 1 ? "/app" : true} onBack={step === 1 ? undefined : () => setStep(step - 1)} progress={(step / STEPS) * 100} step={`Paso ${step} de ${STEPS}`} title={head[0]} subtitle={head[1]} />
      <div className="l-body">
        {step === 1 && <>
          <Carousel label="Lo que un buen historial podría facilitarte">{POSSIBILITIES.map(([art, kind, title, text]) => (
            // eslint-disable-next-line @next/next/no-img-element
            <article className="l-poscard" key={art}><div className="art"><img src={`/luft/posibilidad-${art}.svg`} alt="" /></div><div className="copy"><span className="l-overline">{kind}</span><h3>{title}</h3><p className="l-small">{text}</p></div></article>
          ))}</Carousel>
          <Card className="tight">
            <strong style={{ fontWeight: 500 }}>Paso a paso, así se construye</strong>
            <div className="l-steps3">
              <div><span><Lufty width={26} motion="hop soft" /></span><strong>Hoy</strong><small>Tu punto de<br />partida</small></div>
              <div><span><Icon name="check" size={16} /></span><strong>Mes a mes</strong><small>Cada pago a<br />tiempo suma</small></div>
              <div><span><Icon name="flag" size={16} /></span><strong>Con el tiempo</strong><small>Más<br />posibilidades</small></div>
            </div>
          </Card>
          <p className="l-fine">Son ejemplos, no promesas. El acceso a un crédito depende de cada entidad y de tu situación.</p>
        </>}
        {step === 2 && <>
          <Card>
            <div className="l-row"><span className="l-icon-box"><Icon name="workspace_premium" size={24} /></span><div className="l-grow"><span className="l-overline">Lo que financia tu crédito</span><div style={{ fontSize: 18, fontWeight: 500 }}>{plan ? `Plan ${plan.name}` : quote?.product.name ?? "Servicio LUFT"}</div></div></div>
            {plan ? <>
              <p className="l-muted">{plan.description}</p>
              <div className="l-price"><span className="l-big-number">{money(plan.pricePerSeatCOP)}</span>{plan.discountPercent > 0 && <s>{money(plan.basePriceCOP)}</s>}<span className="l-small">Precio por persona</span></div>
            </> : plans === null ? <p className="l-muted" role="status">Consultando tu plan…</p> : quote?.product.purpose ? <p className="l-muted">{quote.product.purpose}</p> : null}
            <hr className="l-divider" />
            <ul className="l-checks">{SERVICE.map((item) => <li key={item}><Icon name="check_circle" />{item}</li>)}</ul>
          </Card>
          <Tip lufty title="¿Por qué con un crédito?">En lugar de pagar el servicio de contado, lo pagas en cuotas. Cada cuota pagada a tiempo se reporta y construye tu historial.</Tip>
        </>}
        {/* Sin la cotización del producto no se puede seguir: se explica y se ofrece reintentar. */}
        {step >= 2 && !quote && quoteFailure && <><Alert>No pudimos consultar las condiciones de tu crédito. {quoteFailure}</Alert><button type="button" className="l-link-button" onClick={loadQuote}>Reintentar</button></>}
        {needsQuote && !quote && !quoteFailure && <p className="l-muted" role="status" style={{ padding: "32px 0", textAlign: "center" }}>Consultando las condiciones de tu crédito…</p>}
        {step === 3 && quote && <>
          <Card className="l-center">
            <span className="l-small" style={{ letterSpacing: ".04em" }}>Tu crédito <Luft /></span>
            <div className="l-big-number">{money(quote.amountCOP)}</div>
            <p className="l-muted" style={{ textWrap: "balance" }}>Sin tarjeta y sin suscripción. Lo pagas directamente a <Luft />.</p>
            <div className="l-facts" style={{ width: "100%" }}>
              <div>Plazo<strong>{count}</strong>{count === 1 ? "mes" : "meses"}<span className="viz bars" aria-hidden="true">{Array.from({ length: Math.max(12, count) }, (_, index) => <i key={index} className={index < count ? "on" : ""} />)}</span></div>
              <div>{decreasing ? "Primera cuota" : "Cuota"}<strong>{money(quote.firstInstallmentCOP)}</strong>{decreasing ? "baja cada mes" : "al mes"}<span className="viz blocks" aria-hidden="true"><i /><i /><i /></span></div>
              <div>Reporte<strong>Mensual</strong>a centrales<span className="viz line" aria-hidden="true"><svg viewBox="0 0 78 22" preserveAspectRatio="none" fill="none"><path d="M1 19l22-4 20 2 33-12v17H1z" fill="#35c77a" fillOpacity=".14" /><path d="M1 19l22-4 20 2 33-12" stroke="#35c77a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg></span></div>
            </div>
          </Card>
          <Tip lufty title="Cómo funciona">Cada cuota pagada a tiempo se reporta a las centrales de riesgo y fortalece tu historial.</Tip>
        </>}
        {step === 4 && quote && first && last && <>
          <Card>
            <div><span className="l-overline" style={{ letterSpacing: ".06em" }}>Tu plan de pagos</span><h2 className="l-plan-title">{installmentsLabel(count)}</h2><p className="l-muted" style={{ marginTop: 6 }}>{decreasing ? "Bajan cada mes. " : ""}La primera se paga el {shortDateYear(first.dueDate)} y la última en {monthYear(last.dueDate)}.</p></div>
            <ol className="l-plan-bars">{rows.map((row, index) => (
              <li key={row.sequence} className={index === 0 ? "first" : ""}><span>{monthName(row.dueDate)}</span><span className="track"><i style={{ width: `calc((100% - 92px) * ${(row.amountCOP / highest).toFixed(4)})` }} /><strong>{money(row.amountCOP)}</strong></span></li>
            ))}</ol>
          </Card>
          {decreasing && <div className="l-why"><span><Icon name="trending_up" /></span><div><strong>¿Por qué pagas más al inicio?</strong><p>Pagar más en los primeros meses reduce tu deuda más rápido y muestra que puedes cumplir con pagos altos. Las últimas cuotas son las más livianas.</p></div></div>}
        </>}
        {step === 5 && quote && first && <Card>
          <div><span className="l-overline">Tu plan</span><div style={{ fontSize: 18, fontWeight: 500 }}>{count} escalones, uno por mes</div></div>
          <Staircase full steps={planSteps(count, 0, 1)} callout={{ overline: "Empieza aquí", text: `Cuota 1 · ${shortDate(first.dueDate)}` }} goal="Meta" label={`Escalera de ${installmentsLabel(count)}: empiezas en la cuota 1 y la meta es la cuota ${count}`} />
          <hr className="l-divider" />
          <ul className="l-milestones">
            {milestones.constancy && <li><span className="l-icon-box amber"><Icon name="workspace_premium" /></span><span><strong>Cuota {milestones.constancy} · Logro Constancia</strong><small>{milestones.constancy} pagos seguidos a tiempo</small></span></li>}
            {milestones.review && <li><span className="l-icon-box violet"><Icon name="verified_user" /></span><span><strong>Cuota {milestones.review} · Cada vez más cerca</strong><small>Revisamos tu avance contigo</small></span></li>}
            <li><span className="l-icon-box green"><Icon name="flag" /></span><span><strong>Cuota {milestones.goal} · Plan completado</strong><small>Un historial más sólido</small></span></li>
          </ul>
        </Card>}
        {step === 6 && quote && first && <>
          <Card>
            <div className="l-row"><span className="l-icon-box"><Icon name="account_balance_wallet" /></span><span><strong style={{ fontWeight: 500 }}>{quote.product.name}</strong><span className="l-small" style={{ display: "block" }}>{quote.product.purpose}</span></span></div>
            <div className="l-kv">
              <div>Monto<strong className="blue">{money(quote.amountCOP)}</strong></div>
              <div>Plazo<strong>{installmentsLabel(count)} mensuales</strong></div>
              <div>Primera cuota<strong>{money(quote.firstInstallmentCOP)}</strong></div>
              <div>Última cuota<strong>{money(quote.lastInstallmentCOP)}</strong></div>
              <div>Tasa de interés<strong>{percent(quote.monthlyRate)} mensual</strong></div>
              <div>Intereses del plan<strong>{money(quote.totalInterestCOP)}</strong></div>
              <div>Total a pagar<strong>{money(quote.totalCOP)}</strong></div>
              <div>Fecha de la primera cuota*<strong>{longDate(first.dueDate)}</strong></div>
              <div>Reporte a centrales<strong>Cada mes</strong></div>
            </div>
          </Card>
          <Tip tone="amber" icon="warning" title="Es un crédito real">Debes pagar cada cuota. Los atrasos se reportan y pueden bajar tu puntaje.</Tip>
          <Checkbox checked={understood} onChange={setUnderstood} row>Entiendo que debo pagar cada cuota a tiempo y autorizo compartir mi diagnóstico con StartIF para estudiar la solicitud.</Checkbox>
          <p className="l-fine">*{quote.note} La solicitud no implica aprobación; verás el plan definitivo antes de firmar.</p>
        </>}
        {failure && <Alert>{failure}</Alert>}
      </div>
      <div className="l-footer">
        {step < STEPS ? <Button arrow disabled={step >= 2 && !quote} onClick={() => setStep(step + 1)}>{["Empezar a construirlo", "Continuar", "Ver mi plan de pago", "Continuar", "Continuar"][step - 1]}</Button>
          : <><Button onClick={accept} disabled={!quote || !understood || busy}>{busy ? "Creando tu solicitud…" : "Aceptar mi crédito"}</Button><Button variant="secondary" href="/app">Ahora no, seguir explorando</Button></>}
        {step === 3 && <small>Crédito sujeto a la evaluación de <Luft /></small>}
      </div>
    </Screen>
  );
}

function Application() {
  const { data, reload } = useLuft();
  const credit = data.credit!;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [challenge, setChallenge] = useState("");
  const [signature, setSignature] = useState("");
  const [accepted, setAccepted] = useState(false);
  async function run(action: () => Promise<string | void>) { setBusy(true); setFailure(""); setMessage(""); try { const text = await action(); if (text) setMessage(text); await reload(); } catch (cause) { setFailure(errorMessage(cause)); await reload(); } finally { setBusy(false); } }
  const kyc = () => run(async () => { const result = await api<{ verificationUrl?: string }>(`/startif/applications/${credit.id}/kyc`, { method: "POST" }); if (result.verificationUrl) { window.location.assign(result.verificationUrl); return; } return "Validación iniciada. Te avisaremos cuando cambie su estado."; });
  const otp = () => run(async () => { const result = await api<{ challengeId: string }>(`/startif/applications/${credit.id}/signature-otp`, { method: "POST" }); setChallenge(result.challengeId); return "Enviamos el código de firma a tu celular registrado."; });
  const sign = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!signature) return setFailure("Dibuja tu firma antes de continuar."); const code = new FormData(event.currentTarget).get("code"); void run(async () => { await api(`/startif/applications/${credit.id}/sign`, { method: "POST", body: JSON.stringify({ signatureData: signature, challengeId: challenge, code, accepted: true }) }); return "Pagaré firmado. Tu solicitud pasó a revisión."; }); };
  const kycStatus = credit.kycProcesses?.[0]?.status;
  const needsKyc = ["PENDING_KYC", "CONFIGURATION_REQUIRED"].includes(credit.status);
  const needsSignature = credit.status === "PENDING_SIGNATURE";
  const stage = needsKyc ? 1 : needsSignature ? 2 : 3;
  const steps = [["Solicitud creada", "Recibimos tu solicitud"], ["Validación de identidad", kycStatus ? statusLabel(kycStatus) : "Confirma que eres tú"], ["Firma del pagaré", "Firma electrónica con código"], ["Revisión y desembolso", "Te avisamos en tiempo real"]];
  return (
    <Screen>
      <Header back="/app" title="Tu solicitud" subtitle={`${money(credit.amountCOP)} en ${installmentsLabel(credit.termMonths)}`} />
      <div className="l-body">
        <Card>
          <div className="l-row between"><strong style={{ fontWeight: 500 }}>Estado</strong><Chip tone={credit.status === "REJECTED" ? "red" : "blue"} dot>{statusLabel(credit.status)}</Chip></div>
          <div className="l-list" style={{ margin: "0 -16px" }}>{steps.map(([title, text], index) => <div key={title}><span className={`l-lesson-num ${index < stage ? "done" : ""}`}>{index < stage ? <Icon name="check" size={16} /> : index + 1}</span><span className="l-grow"><strong>{title}</strong><small>{text}</small></span>{index === stage && <Chip tone="blue">Ahora</Chip>}</div>)}</div>
        </Card>
        {message && <Alert type="success">{message}</Alert>}
        {failure && <Alert>{failure}</Alert>}
        {credit.status === "CONFIGURATION_REQUIRED" && <Tip tone="amber" icon="warning" title="Validación pendiente de habilitar">El proveedor de verificación de identidad aún no está conectado. Tu solicitud queda guardada y podrás continuar apenas lo esté.</Tip>}
        {needsSignature && <Card as="div">
          <div><strong style={{ fontWeight: 500 }}>Firma tu pagaré</strong><p className="l-muted" style={{ marginTop: 4 }}>Guardamos los trazos, el dispositivo, el documento íntegro y el código como evidencia de tu firma.</p></div>
          {!challenge ? <Button onClick={otp} disabled={busy}>Solicitar código de firma</Button> : <form className="l-stack" onSubmit={sign}>
            <SignaturePad onChange={setSignature} />
            <Field label="Código de firma"><input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></Field>
            <Checkbox checked={accepted} onChange={setAccepted} required>Acepto firmar electrónicamente el pagaré y declaro que revisé su contenido.</Checkbox>
            <Button type="submit" disabled={busy || !accepted}>Firmar y enviar a revisión</Button>
          </form>}
        </Card>}
        {!needsKyc && !needsSignature && credit.status !== "REJECTED" && <Tip lufty title="Estamos revisando tu solicitud">Cada cambio se registra y te llega en tiempo real. No tienes que hacer nada más por ahora.</Tip>}
        {credit.status === "REJECTED" && <Tip lufty title="Esta vez no fue posible">Sigue construyendo hábitos con LUFT: completa tu perfil financiero y las lecciones para volver a intentarlo más adelante.</Tip>}
      </div>
      <div className="l-footer">{needsKyc ? <Button arrow onClick={kyc} disabled={busy}>{busy ? "Abriendo…" : "Validar mi identidad"}</Button> : <Button variant="secondary" href="/app">Volver a mi inicio</Button>}</div>
    </Screen>
  );
}

function Loan() {
  const { user, data } = useLuft();
  const credit = data.credit!; const loan = credit.loan!;
  const key = `luft_loan_welcome_${loan.id}`;
  const [welcome, setWelcome] = useState(false);
  useEffect(() => { try { setWelcome(!localStorage.getItem(key)); } catch { /* sin almacenamiento */ } }, [key]);
  const dismiss = () => { try { localStorage.setItem(key, "1"); } catch { /* sin almacenamiento */ } setWelcome(false); };
  const next = nextInstallment(credit);
  // Activar el crédito da una insignia, no XP: la XP solo se gana con las lecciones.
  if (welcome) return (
    <Celebration badge="Insignia desbloqueada: Primer paso" title={`¡Lo lograste, ${firstName(user.fullName)}!`} text={`Tu crédito de ${money(loan.principalCOP)} está activo. Hoy empieza tu camino para construir historial.`}
      stats={[{ label: "Cuotas", value: loan.installments.length, icon: "calendar_today" }, { label: "Insignias", value: data.progress.badgesEarned, icon: "workspace_premium_fill" }, { label: "1ª cuota", value: loan.installments[0] ? shortDate(loan.installments[0].dueDate) : "—", icon: "schedule" }]}
      next={{ label: "Tu primera misión", text: `Una lección corta · +${lessonXp(data.progress)} XP`, icon: "school" }}>
      <Button variant="white" arrow href="/app" onClick={dismiss}>Ir a mi inicio</Button>
    </Celebration>
  );
  return (
    <Screen>
      <Header back="/app" title="Tu crédito LUFT" subtitle={`${data.progress.installmentsPaid} de ${installmentsLabel(loan.installments.length)} pagadas`} />
      <div className="l-body">
        <Card className="l-center"><span className="l-small">Saldo pendiente</span><div className="l-big-number">{money(loan.outstandingBalanceCOP)}</div><span className="l-small">de {money(loan.principalCOP)}</span></Card>
        <Card className="flush"><div className="l-list">{loan.installments.map((row) => <div key={row.id}><span className={`l-lesson-num ${isSettled(row) ? "done" : ""}`}>{isSettled(row) ? <Icon name="check" size={16} /> : row.sequence}</span><span className="l-grow"><strong>Cuota {row.sequence} · {money(row.amountCOP)}</strong><small>Vence el {longDate(row.dueDate)}</small></span><Chip tone={row.status === "PAID" ? "green" : row.status === "OVERDUE" ? "red" : row.id === next?.id ? "blue" : ""} dot>{statusLabel(row.status)}</Chip></div>)}</div></Card>
      </div>
      <div className="l-footer">{next ? <Button href="/app/pagar">Pagar cuota {next.sequence}</Button> : <Button variant="secondary" href="/app/historial">Ver mi historial</Button>}</div>
    </Screen>
  );
}

/** People who registered without the guided start answer the two questions here. */
function Classify() {
  const { reload } = useLuft();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [failure, setFailure] = useState("");
  async function save(creditExperience: CreditExperience) {
    setFailure("");
    try { await api("/luft/classification", { method: "PUT", body: JSON.stringify({ goal, creditExperience }) }); await reload(); } catch (cause) { setFailure(errorMessage(cause)); }
  }
  return (
    <Screen>
      <Header back={goal ? true : "/app"} onBack={goal ? () => setGoal(null) : undefined} progress={goal ? 100 : 50} step={`Pregunta ${goal ? 2 : 1} de 2`} title={goal ? "¿Tienes o has tenido créditos a tu nombre?" : <>¿Qué te gustaría lograr con <Luft />?</>} subtitle="Así adaptamos tu camino antes de mostrarte tu crédito." />
      <div className="l-body">
        <div className="l-stack" role="radiogroup" aria-label="Opciones">
          {goal ? EXPERIENCE.map((item) => <OptionCard key={item.value} icon={item.icon} title={item.title} description={item.text} selected={false} onSelect={() => save(item.value)} />)
            : GOALS.map((item) => <OptionCard key={item.value} icon={item.icon} title={item.title} description={item.text} selected={false} onSelect={() => setGoal(item.value)} />)}
        </div>
        {failure && <Alert>{failure}</Alert>}
      </div>
      <div className="l-footer"><small>Toca una opción para continuar</small></div>
    </Screen>
  );
}

export default function CreditPage() {
  const { data } = useLuft();
  if (!data.credit && !data.profile.archetype) return <Classify />;
  if (!data.credit) return <Offer />;
  return data.credit.loan ? <Loan /> : <Application />;
}
