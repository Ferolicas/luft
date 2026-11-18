"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Bar, Button, Card, Checkbox, Chip, Header, Icon, Lufty, ScoreGauge, scoreBand, Screen, Tip } from "@/components/luft/ui";
import { api, errorMessage } from "@/lib/api";

const PROVIDERS: Record<string, string> = { DATACREDITO: "Datacrédito", TRANSUNION: "TransUnion" };

export default function ScorePage() {
  const { data, reload } = useLuft();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [accepted, setAccepted] = useState(false);
  const inquiry = data.scoreHistory[0] as (typeof data.scoreHistory)[number] & { provider?: string } | undefined;
  const score = data.profile.currentScore ?? data.scoreHistory.find((row) => row.score != null)?.score ?? null;
  const band = score == null ? null : scoreBand(score);
  const pending = !score && inquiry && ["PENDING", "PROCESSING"].includes(inquiry.status);
  const blocked = !score && inquiry?.status === "CONFIGURATION_REQUIRED";
  const canRequest = !score && (!inquiry || inquiry.status === "FAILED");

  async function request() {
    setBusy(true); setFailure("");
    try {
      await api("/luft/consents", { method: "POST", body: JSON.stringify({ kind: "BUREAU_QUERY", accepted: true, version: "2026-09-01", deviceMeta: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }) });
      await api("/luft/score/initial", { method: "POST", body: JSON.stringify({ provider: "DATACREDITO" }) });
      await reload();
    } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <Screen>
      <Header back="/app" title={score ? "¡Ya conocemos tu puntaje!" : "Tu camino empieza aquí"} subtitle={score ? "Este es tu punto de partida. Vamos a subirlo juntos." : "Conoce tu situación crediticia y descubre cómo avanzar con LUFT."} />
      <div className="l-body">
        <Card className="l-center">
          <ScoreGauge score={score} />
          {band ? <Chip tone={band.tone} dot>{band.label}</Chip> : pending ? <Chip tone="blue" dot>Consulta en proceso</Chip> : blocked ? <Chip tone="amber" dot>Consulta pendiente de habilitar</Chip> : <Chip dot>Aún sin consultar</Chip>}
          {inquiry?.provider && score != null && <span className="l-small l-row" style={{ gap: 6 }}><Icon name="verified_user" size={14} />Fuente: {PROVIDERS[inquiry.provider] ?? inquiry.provider}</span>}
        </Card>

        {score != null && band && <>
          <Card className="tight">
            <div className="l-row between"><span className="l-row" style={{ gap: 10 }}><Chip tone="blue" large icon="verified_user_fill">Nivel {data.progress.level}</Chip><strong style={{ fontWeight: 500 }}>Punto de partida</strong></span><span className="l-small">{score}/950</span></div>
            <Bar value={((score - 150) / 800) * 100} label="Posición de tu puntaje" />
            <span className="l-small">Cada cuota pagada a tiempo y cada hábito constante ayudan a moverlo.</span>
          </Card>
          {band.tone === "red" && <div className="l-tiles">
            <div><strong style={{ fontSize: 14 }}><Icon name="calendar_today" size={16} /> Conoce tu situación</strong>Identifica qué puede estar afectando tu historial.</div>
            <div><strong style={{ fontSize: 14 }}><Icon name="bar_chart" size={16} /> Mejora tus hábitos</strong>Construye hábitos de pago responsables con LUFT.</div>
          </div>}
          <div className="l-says"><Lufty width={72} /><div className="bubble">{band.tone === "green" ? "¡Vas muy bien! Te muestro cómo mantenerlo y aprovecharlo." : "Muchos empiezan aquí. Te mostraré cómo subirlo paso a paso."}</div></div>
        </>}

        {pending && <Tip lufty title="Estamos consultando tu historial">Te avisaremos aquí mismo cuando llegue el resultado. Mientras tanto puedes seguir explorando.</Tip>}
        {blocked && <Tip tone="amber" icon="warning" title="Tu autorización quedó registrada">La conexión con el operador de información aún no está habilitada. Haremos la consulta apenas lo esté; no tienes que hacer nada más.</Tip>}
        {canRequest && <Card>
          <div><strong style={{ fontSize: 16, fontWeight: 500 }}>Consulta tu historial</strong><p className="l-muted" style={{ marginTop: 4 }}>Solo la hacemos con tu autorización expresa. El resultado queda cifrado y se usa para tu diagnóstico.</p></div>
          <Checkbox checked={accepted} onChange={setAccepted}>Autorizo a LUFT a consultar mi información ante operadores de información financiera para mi diagnóstico.</Checkbox>
          {inquiry?.status === "FAILED" && <Alert type="warning">La consulta anterior no se pudo completar. Puedes intentarlo de nuevo.</Alert>}
          <Button onClick={request} disabled={!accepted || busy}>{busy ? "Solicitando…" : "Autorizar y consultar"}</Button>
          <Tip lufty title="Sin impacto en tu puntaje">Consultarlo tú mismo no lo baja.</Tip>
        </Card>}
        {failure && <Alert>{failure}</Alert>}
      </div>
      <div className="l-footer"><Button href={data.credit ? "/app" : "/app/credito"} arrow>{data.credit ? "Ir a mi inicio" : score ? "Empezar mi camino" : "Continuar con LUFT"}</Button></div>
    </Screen>
  );
}
