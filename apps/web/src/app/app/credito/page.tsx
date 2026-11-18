"use client";

import { FormEvent, useEffect, useState } from "react";
import { firstName, useLuft } from "@/components/luft/shell";
import { SignaturePad } from "@/components/signature-pad";
import { Alert, Button, Card, Celebration, Checkbox, Chip, Field, Header, Icon, Lufty, OptionCard, Screen, Tip } from "@/components/luft/ui";
import { api, errorMessage, money } from "@/lib/api";
import { EXPERIENCE, GOALS } from "@/lib/classification";
import { isSettled, nextInstallment, statusLabel } from "@/lib/credit";
import { longDate, shortDate, type CreditExperience, type Goal } from "@/lib/journey";

const AMOUNT = 1_000_000;
const TERMS = [{ months: 6, note: "Terminas más rápido" }, { months: 9, note: "Equilibrado" }, { months: 12, note: "Cuota más ligera", recommended: true }];
const POSSIBILITIES = [
  ["vivienda", "Vivienda", "Un hogar propio", "Un buen historial puede facilitarte un crédito de vivienda."],
  ["vehiculo", "Vehículo", "Tu moto o tu carro", "Financiar un vehículo podría ser más accesible para ti."],
  ["viajes", "Viajes", "Ese viaje pendiente", "Más opciones para planear experiencias que hoy ves lejos."],
  ["emprender", "Emprendimiento", "Tu propio negocio", "El historial abre puertas cuando buscas capital para crecer."],
  ["estudios", "Estudios", "Seguir aprendiendo", "Opciones para financiar la formación que quieres."],
];
interface Quote { amountCOP: number; termMonths: number; monthlyRate: number; installments: Array<{ sequence: number; amountCOP: number; dueDate: string }> }

function Offer() {
  const { reload } = useLuft();
  const [step, setStep] = useState(1);
  const [quotes, setQuotes] = useState<Record<number, Quote>>({});
  const [term, setTerm] = useState(12);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    Promise.all(TERMS.map((item) => api<Quote>("/startif/quote", { method: "POST", body: JSON.stringify({ amountCOP: AMOUNT, termMonths: item.months }) })))
      .then((rows) => setQuotes(Object.fromEntries(rows.map((row) => [row.termMonths, row]))))
      .catch((cause) => setFailure(errorMessage(cause)));
  }, []);
  const quote = quotes[term];
  const first = quote?.installments[0];
  const last = quote?.installments.at(-1);
  async function accept() {
    setBusy(true); setFailure("");
    try {
      await api("/luft/consents", { method: "POST", body: JSON.stringify({ kind: "SCORE_SHARE_WITH_STARTIF", accepted: true, version: "2026-09-01" }) });
      await api("/startif/consents", { method: "POST", body: JSON.stringify({ accepted: true, version: "2026-09-01" }) });
      await api("/startif/applications", { method: "POST", body: JSON.stringify({ amountCOP: AMOUNT, termMonths: term }) });
      await reload();
    } catch (cause) { setFailure(errorMessage(cause)); setBusy(false); }
  }
  const head = [
    ["Abre nuevos caminos", "Un buen historial es una inversión en tus posibilidades. Mira lo que podría facilitarte."],
    ["Tu primer crédito", "Un monto pensado para empezar a construir tu historial."],
    ["Elige tu ritmo de pago", "Escoge un plazo que puedas pagar cómodamente cada mes."],
    ["Construye tu historial", "Cada cuota pagada a tiempo es un escalón más hacia un historial sólido."],
    ["Antes de aceptar", "Revisa tu crédito. Todo claro, sin letra pequeña."],
  ][step - 1];
  return (
    <Screen>
      <Header back={step === 1 ? "/app" : true} onBack={step === 1 ? undefined : () => setStep(step - 1)} progress={(step / 5) * 100} step={`Paso ${step} de 5`} title={head[0]} subtitle={head[1]} />
      <div className="l-body">
        {step === 1 && <>
          <div className="l-carousel">{POSSIBILITIES.map(([art, kind, title, text]) => (
            // eslint-disable-next-line @next/next/no-img-element
            <article className="l-poscard" key={art}><div className="art"><img src={`/luft/posibilidad-${art}.svg`} alt="" /></div><div className="copy"><span className="l-overline">{kind}</span><h3>{title}</h3><p className="l-small">{text}</p></div></article>
          ))}</div>
          <Card className="tight">
            <strong style={{ fontWeight: 500 }}>Paso a paso, así se construye</strong>
            <div className="l-steps3">
              <div><span><Lufty mood="neutral" width={24} /></span><strong>Hoy</strong><small>Tu punto de partida</small></div>
              <div><span><Icon name="check" /></span><strong>Mes a mes</strong><small>Cada pago a tiempo suma</small></div>
              <div><span><Icon name="flag" /></span><strong>Con el tiempo</strong><small>Más posibilidades</small></div>
            </div>
          </Card>
          <p className="l-fine">Son ejemplos, no promesas. El acceso a un crédito depende de cada entidad y de tu situación.</p>
        </>}
        {step === 2 && <>
          <Card className="l-center">
            <span className="l-overline" style={{ color: "var(--l-n-600)" }}>Tu crédito LUFT</span>
            <div className="l-big-number">{money(AMOUNT)}</div>
            <p className="l-muted">Sin tarjeta y sin suscripción. Lo pagas directamente a LUFT.</p>
            <div className="l-facts" style={{ width: "100%" }}>
              <div>Plazo<strong>6–12</strong>meses</div>
              <div>Primera cuota<strong>{quotes[12] ? money(quotes[12].installments[0].amountCOP) : "…"}</strong>a 12 meses</div>
              <div>Reporte<strong>Mensual</strong>a centrales</div>
            </div>
          </Card>
          <Tip lufty title="Cómo funciona">Cada cuota pagada a tiempo se reporta a las centrales de riesgo y fortalece tu historial.</Tip>
        </>}
        {step === 3 && <>
          <div className="l-stack" role="radiogroup" aria-label="Plazo">
            {TERMS.map((item) => { const row = quotes[item.months]; return (
              <OptionCard key={item.months} selected={term === item.months} onSelect={() => setTerm(item.months)} title={<>{item.months} meses {item.recommended && <Chip tone="green">Recomendado</Chip>}</>} description={item.note}
                trailing={<span className="l-amount">{row ? money(row.installments[0].amountCOP) : "…"}<small>primera cuota</small></span>} />
            ); })}
          </div>
          <Tip lufty title="Consejo LUFT">Busca que tu cuota no supere el 20% de lo que recibes al mes.</Tip>
          <p className="l-fine">Las cuotas bajan mes a mes. Valores estimados con una tasa del {quote ? (quote.monthlyRate * 100).toFixed(0) : 2}% mensual; verás la tasa y el costo total definitivos antes de firmar.</p>
        </>}
        {step === 4 && quote && <Card>
          <div><span className="l-overline">Tu plan</span><div style={{ fontSize: 18, fontWeight: 500 }}>{term} escalones, uno por mes</div></div>
          <div>
            <div className="l-ladder tall" aria-hidden="true">{quote.installments.map((row, index) => <i key={row.sequence} className={index === 0 ? "current" : index === term - 1 ? "goal" : ""} style={{ height: `${22 + (index / (term - 1)) * 78}%` }}>{index === term - 1 ? <Icon name="flag" size={14} /> : null}</i>)}</div>
            <div className="l-ladder-labels" aria-hidden="true">{quote.installments.map((row) => <span key={row.sequence}>{row.sequence}</span>)}</div>
          </div>
          <Chip tone="blue">Empieza aquí · Cuota 1 · {first ? shortDate(first.dueDate) : ""}</Chip>
          <div className="l-list" style={{ margin: "0 -16px" }}>
            <div><span className="l-icon-box amber"><Icon name="workspace_premium" /></span><span className="l-grow"><strong>Cuota 3 · Logro Constancia</strong><small>3 pagos seguidos a tiempo</small></span><Chip tone="blue">+50 XP c/u</Chip></div>
            <div><span className="l-icon-box violet"><Icon name="verified_user" /></span><span className="l-grow"><strong>Cuota {Math.ceil(term / 2)} · Medio camino</strong><small>Revisamos tu avance contigo</small></span></div>
            <div><span className="l-icon-box green"><Icon name="flag" /></span><span className="l-grow"><strong>Cuota {term} · Plan completado</strong><small>Un historial más sólido</small></span></div>
          </div>
        </Card>}
        {step === 5 && quote && <>
          <Card>
            <div className="l-row"><span className="l-icon-box"><Icon name="home" /></span><span><strong style={{ fontWeight: 500 }}>Crédito LUFT</strong><span className="l-small" style={{ display: "block" }}>Para construir tu historial</span></span></div>
            <div className="l-kv">
              <div>Monto<strong className="blue">{money(AMOUNT)}</strong></div>
              <div>Plazo<strong>{term} meses</strong></div>
              <div>Primera cuota*<strong>{first ? money(first.amountCOP) : ""}</strong></div>
              <div>Última cuota*<strong>{last ? money(last.amountCOP) : ""}</strong></div>
              <div>Fecha de la primera cuota*<strong>{first ? longDate(first.dueDate) : ""}</strong></div>
              <div>Reporte a centrales<strong>Cada mes</strong></div>
            </div>
          </Card>
          <Tip tone="amber" icon="warning" title="Es un crédito real">Debes pagar cada cuota. Los atrasos se reportan y pueden bajar tu puntaje.</Tip>
          <Checkbox checked={understood} onChange={setUnderstood} row>Entiendo que debo pagar cada cuota a tiempo y autorizo compartir mi diagnóstico con StartIF para estudiar la solicitud.</Checkbox>
          <p className="l-fine">*Valores estimados. La solicitud no implica aprobación; verás tasa, costo y plan definitivos antes de firmar.</p>
        </>}
        {failure && <Alert>{failure}</Alert>}
      </div>
      <div className="l-footer">
        {step < 5 ? <Button arrow disabled={step >= 3 && !quote} onClick={() => setStep(step + 1)}>{["Empezar a construirlo", "Elegir mi plazo", "Continuar", "Continuar"][step - 1]}</Button>
          : <><Button onClick={accept} disabled={!understood || busy}>{busy ? "Creando tu solicitud…" : "Aceptar mi crédito"}</Button><Button variant="secondary" href="/app">Ahora no, seguir explorando</Button></>}
        {step === 2 && <small>Crédito sujeto a la evaluación de LUFT</small>}
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
      <Header back="/app" title="Tu solicitud" subtitle={`${money(credit.amountCOP)} a ${credit.termMonths} meses`} />
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
  if (welcome) return (
    <Celebration badge="Insignia desbloqueada: Primer paso" title={`¡Lo lograste, ${firstName(user.fullName)}!`} text={`Tu crédito de ${money(loan.principalCOP)} está activo. Hoy empieza tu camino para construir historial.`}
      stats={[{ label: "Total XP", value: data.progress.xp, icon: "diamond_fill" }, { label: "Nivel", value: data.progress.level, icon: "verified_user_fill" }, { label: "1ª cuota", value: loan.installments[0] ? shortDate(loan.installments[0].dueDate) : "—", icon: "calendar_today" }]}
      barLabel={`Nivel ${data.progress.level} → Nivel ${data.progress.level + 1}`} barText={`${data.progress.xp} / ${data.progress.nextLevelXp} XP`} barValue={((data.progress.xp - data.progress.floorXp) / (data.progress.nextLevelXp - data.progress.floorXp)) * 100}
      mission={{ label: "Tu primera misión", text: "Una lección corta · +20 XP", icon: "school" }}>
      <Button variant="white" arrow href="/app" onClick={dismiss}>Ir a mi inicio</Button>
    </Celebration>
  );
  return (
    <Screen>
      <Header back="/app" title="Tu crédito LUFT" subtitle={`${data.progress.installmentsPaid} de ${loan.installments.length} cuotas pagadas`} />
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
      <Header back={goal ? true : "/app"} onBack={goal ? () => setGoal(null) : undefined} progress={goal ? 100 : 50} step={`Pregunta ${goal ? 2 : 1} de 2`} title={goal ? "¿Tienes o has tenido créditos a tu nombre?" : "¿Qué te gustaría lograr con LUFT?"} subtitle="Así adaptamos tu camino antes de mostrarte tu crédito." />
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
