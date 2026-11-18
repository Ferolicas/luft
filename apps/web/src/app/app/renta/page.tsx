"use client";

import { useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Chip, Choice, Header, Icon, Lufty, Screen, Tip } from "@/components/luft/ui";
import { api, ApiError, errorMessage } from "@/lib/api";

const GROUPS = [
  { key: "incomes" as const, title: "¿Qué ingresos tuviste este año?", options: [["SALARIO", "Salario"], ["HONORARIOS", "Honorarios"], ["ARRIENDOS", "Arriendos"], ["INTERESES", "Intereses"]] },
  { key: "holdings" as const, title: "¿Qué tienes o debes?", options: [["VIVIENDA", "Vivienda"], ["VEHICULO", "Vehículo"], ["INVERSIONES", "Inversiones"], ["HIPOTECA", "Hipoteca"]] },
  { key: "deductions" as const, title: "¿Qué te ayuda a pagar menos?", options: [["PERSONAS_A_CARGO", "Personas a cargo"], ["PREPAGADA", "Prepagada"], ["PENSION_VOLUNTARIA", "Pensión voluntaria"], ["CUENTA_AFC", "Cuenta AFC"]] },
];
const STEPS = ["Tu año", "Documentos", "Revisión", "Presentar"];
type Answers = { incomes: string[]; holdings: string[]; deductions: string[] };

export default function TaxReturnPage() {
  const { data, reload } = useLuft();
  const saved = data.journey.taxReturn;
  const [step, setStep] = useState<"intro" | "confirm" | "status">(saved?.status === "CONFIGURATION_REQUIRED" ? "status" : "intro");
  const [answers, setAnswers] = useState<Answers>(saved?.answers ?? { incomes: [], holdings: [], deductions: [] });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const year = new Date().getFullYear();
  const toggle = (key: keyof Answers, value: string) => setAnswers((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));

  async function confirm() {
    setBusy(true); setFailure("");
    try {
      await api("/luft/tax-return", { method: "PUT", body: JSON.stringify(answers) });
      await api("/luft/tax-return/calculation", { method: "POST" });
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.body.code === "configuration_required")) { setFailure(errorMessage(cause)); setBusy(false); return; }
    }
    await reload(); setStep("status"); setBusy(false);
  }

  if (step === "intro") return (
    <Screen>
      <Header back="/app/perfil" topTitle={`Año gravable ${year}`} title="Tu declaración de renta, sin enredos" subtitle="Partimos de tu perfil financiero para ayudarte a prepararla."><div style={{ display: "grid", placeItems: "center", marginBottom: 12 }}><Lufty tone="white" width={120} /></div></Header>
      <div className="l-body">
        <Card>
          <span className="l-overline" style={{ color: "var(--l-n-600)" }}>Así funciona</span>
          <div className="l-list" style={{ margin: "0 -16px" }}>{[["Confirma tus datos", "Ya los tenemos de tu perfil"], ["Completa tus documentos", "Solo te pedimos los que faltan"], ["Revisa tu declaración", "Con acompañamiento del equipo"], ["Preséntala ante la DIAN", "Cuando el servicio esté habilitado"]].map(([title, text], index) => <div key={title}><span className="l-lesson-num">{index + 1}</span><span className="l-grow"><strong>{title}</strong><small>{text}</small></span></div>)}</div>
        </Card>
        <Tip tone="amber" icon="warning" title="Servicio en preparación">La conexión con la DIAN y el cálculo de la declaración todavía no están habilitados. Puedes dejar tus datos listos y registrar tu solicitud.</Tip>
      </div>
      <div className="l-footer"><Button arrow onClick={() => setStep("confirm")}>Empezar mi declaración</Button><Button variant="secondary" href="/app/pqr">Prefiero hablar con el equipo</Button></div>
    </Screen>
  );

  const stepper = (active: number) => <div className="l-stepper4">{STEPS.map((label, index) => <div key={label} className={index === active ? "on" : index < active ? "done" : ""}><span />{label}</div>)}</div>;

  if (step === "confirm") return (
    <Screen>
      <Header back onBack={() => setStep("intro")} topTitle={`Declaración de renta ${year}`} title="Confirma lo que sabemos" subtitle="Marca lo que aplica a tu año.">{stepper(0)}</Header>
      <div className="l-body">
        <Card>
          <Tip icon="task">La DIAN pide los valores de todo el año. Revisa que tus respuestas sigan siendo así.</Tip>
          {GROUPS.map((group) => <div className="l-stack" key={group.key}><strong style={{ fontSize: 14, fontWeight: 500 }}>{group.title}</strong><div className="l-choice-grid">{group.options.map(([value, label]) => <Choice key={value} multiple selected={answers[group.key].includes(value)} onSelect={() => toggle(group.key, value)}>{label}</Choice>)}</div></div>)}
        </Card>
        {failure && <Alert>{failure}</Alert>}
      </div>
      <div className="l-footer"><Button arrow onClick={confirm} disabled={busy}>{busy ? "Guardando…" : "Confirmar y continuar"}</Button></div>
    </Screen>
  );

  const documents = new Set(data.journey.documents.map((item) => item.kind)).size;
  return (
    <Screen>
      <Header back="/app/perfil" topTitle={`Declaración de renta ${year}`} title="Tu solicitud quedó registrada" subtitle="Te avisaremos cuando puedas continuar.">{stepper(1)}</Header>
      <div className="l-body">
        <Card>
          <div className="l-row between"><strong style={{ fontWeight: 500 }}>Estado</strong><Chip tone="amber" dot>Pendiente de habilitar</Chip></div>
          <p className="l-muted">Guardamos tus respuestas. La preparación y la presentación ante la DIAN todavía no están habilitadas, así que no mostramos valores de impuesto ni presentamos nada por ti.</p>
          <div className="l-kv"><div>Respuestas confirmadas<strong>{saved?.answers ? "Sí" : "Pendiente"}</strong></div><div>Documentos de respaldo<strong>{documents} de 4</strong></div><div>Solicitud registrada<strong>{saved?.requestedAt ? new Date(saved.requestedAt).toLocaleDateString("es-CO", { dateStyle: "medium" }) : "—"}</strong></div></div>
        </Card>
        <Tip lufty title="Mientras tanto">Completa tus documentos y tu perfil financiero: es lo que usaremos para preparar la declaración.</Tip>
      </div>
      <div className="l-footer"><Button arrow href="/app/perfil/financiero/documentos">Completar mis documentos</Button><Button variant="secondary" onClick={() => setStep("confirm")}><Icon name="sync" />Actualizar mis respuestas</Button></div>
    </Screen>
  );
}
