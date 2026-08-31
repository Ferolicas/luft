"use client";

import { ArrowRight, CheckCircle2, Compass, FileSearch, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { Notice, Spinner } from "@/components/status";
import { useDashboard } from "@/hooks/use-dashboard";
import { api, errorMessage } from "@/lib/api";

const questions = [
  ["planning", "Antes de gastar, suelo planear cómo usaré mi dinero."],
  ["consistency", "Mantengo mis compromisos de pago incluso cuando cambia el mes."],
  ["riskAwareness", "Comparo el costo total antes de aceptar una obligación."],
  ["savings", "Separo una parte de mis ingresos para metas o imprevistos."],
  ["income", "Conozco cuánto puedo comprometer sin afectar mis gastos básicos."],
];

export default function DiagnosticPage() {
  const { data, error, reload } = useDashboard(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [failure, setFailure] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setFailure(""); const form = new FormData(event.currentTarget); const answers = Object.fromEntries(questions.map(([key]) => [key, Number(form.get(key))])); try { await api("/luft/questionnaire", { method: "POST", body: JSON.stringify({ answers, version: "2026-09-01" }) }); setMessage("Listo. Ya construimos tu primer arquetipo."); await reload(); } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); } }
  async function score() { setBusy(true); setFailure(""); try { await api("/luft/consents", { method: "POST", body: JSON.stringify({ kind: "BUREAU_QUERY", accepted: true, version: "2026-09-01", deviceMeta: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }) }); await api("/luft/score/initial", { method: "POST", body: JSON.stringify({ provider: "DATACREDITO" }) }); setMessage("La consulta quedó en proceso. Te avisaremos aquí en tiempo real."); await reload(); } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); } }
  if (error) return <Notice type="error">{error}</Notice>; if (!data) return <Spinner label="Abriendo tu diagnóstico…" />;
  return <div className="inner-page"><header className="inner-heading"><div><span className="eyebrow"><Compass size={14} /> Diagnóstico LUFT</span><h1>Conocerte cambia el camino.</h1><p>No buscamos etiquetarte: buscamos darte un punto de partida claro.</p></div></header>{message && <Notice type="success">{message}</Notice>}{failure && <Notice type="error">{failure}</Notice>}
    {data.profile.archetype ? <section className="archetype-card"><div className="archetype-copy"><span>Tu arquetipo financiero</span><h2>{data.profile.archetype.toLowerCase()}</h2><p>Te mueve la curiosidad, aprendes probando y avanzas mejor cuando tienes una ruta visible. Convierte esa energía en constancia.</p><ul><li><CheckCircle2 /> Tienes apertura para aprender</li><li><CheckCircle2 /> Una meta clara potencia tus decisiones</li><li><CheckCircle2 /> La constancia será tu mejor señal</li></ul></div><Image src="/images/luft-explorer.png" alt="Arquetipo explorador" width={630} height={820} /></section> : <form className="questionnaire-card" onSubmit={submit}><div className="questionnaire-head"><span>Parte 1 de 1</span><h2>¿Cómo tomas decisiones con tu dinero?</h2><p>Desliza cada respuesta del 0 (nunca) al 10 (siempre).</p></div>{questions.map(([key, label], index) => <label className="range-question" key={key}><span><b>{String(index + 1).padStart(2, "0")}</b>{label}</span><div><small>Nunca</small><input name={key} type="range" min="0" max="10" defaultValue="5" /><small>Siempre</small></div></label>)}<button className="button" disabled={busy}>Descubrir mi arquetipo <ArrowRight size={18} /></button></form>}
    <section className="bureau-card"><div className="bureau-icon"><FileSearch /></div><div><span>Siguiente señal</span><h2>Consulta inicial de historial</h2><p>Solo la hacemos con tu autorización expresa. El resultado queda cifrado y se usa para tu diagnóstico.</p><div className="consent-points"><span><ShieldCheck /> Autorización independiente</span><span><ShieldCheck /> Trazabilidad de aceptación</span></div></div><div className="bureau-action">{data.scoreHistory[0] ? <span className={`state-badge state-${data.scoreHistory[0].status.toLowerCase()}`}>{data.scoreHistory[0].status.replaceAll("_", " ")}</span> : <button className="button" onClick={score} disabled={busy || !data.profile.archetype}>Autorizar y consultar</button>}</div></section>
  </div>;
}
