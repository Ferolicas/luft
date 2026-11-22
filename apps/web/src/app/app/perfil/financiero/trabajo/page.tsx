"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Checkbox, Chip, Field, formatCOP, Header, Icon, Loading, MoneyInput, Screen, Segmented } from "@/components/luft/ui";
import { useFinancialProfile } from "@/lib/profile";

const SITUATIONS = [["EMPLEADO", "Empleado/a"], ["INDEPENDIENTE", "Independiente"], ["ESTUDIANTE", "Estudiante"], ["PENSIONADO", "Pensionado/a"], ["HOGAR", "Labores del hogar"], ["SIN_EMPLEO", "Sin empleo actualmente"]];
const CONTRACTS = [["LABORAL", "Contrato laboral"], ["PRESTACION_SERVICIOS", "Prestación de servicios"], ["OBRA_LABOR", "Obra o labor"], ["APRENDIZAJE", "Aprendizaje o práctica"], ["NO_APLICA", "No aplica"]];
const SOURCES = [["SALARIO", "Salario"], ["VENTAS", "Ventas o negocio"], ["ARRIENDOS", "Arriendos"], ["PENSION", "Pensión"], ["HONORARIOS", "Honorarios"], ["INTERESES", "Intereses o rendimientos"], ["OTROS", "Otros ingresos"]];

export default function WorkPage() {
  const router = useRouter();
  const { reload } = useLuft();
  const { profile, failure, busy, save } = useFinancialProfile();
  const [step, setStep] = useState(1);
  const [job, setJob] = useState({ situation: "EMPLEADO", contractType: "LABORAL", occupation: "", company: "" });
  const [sources, setSources] = useState<Record<string, number | null>>({});
  const [withholding, setWithholding] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!profile) return;
    if (profile.context.employment) setJob(profile.context.employment);
    if (profile.context.income) { setSources(Object.fromEntries(profile.context.income.sources.map((row) => [row.kind, row.monthlyCOP]))); setWithholding(profile.context.income.withholding == null ? null : profile.context.income.withholding ? "yes" : "no"); }
  }, [profile]);
  if (!profile) return <Screen>{failure ? <div className="l-body" style={{ paddingTop: 48 }}><Alert>{failure}</Alert></div> : <Loading />}</Screen>;
  const chosen = Object.keys(sources);
  const total = Object.values(sources).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (step === 1) { if (await save("employment", job)) setStep(2); return; }
    if (!chosen.length || chosen.some((kind) => !sources[kind])) return setError("Marca al menos una fuente e ingresa su valor mensual.");
    if (await save("income", { sources: chosen.map((kind) => ({ kind, monthlyCOP: sources[kind] })), withholding: withholding == null ? null : withholding === "yes" })) { await reload(); router.push("/app/perfil/financiero"); }
  }
  return (
    <Screen>
      <Header back onBack={() => (step === 1 ? router.push("/app/perfil/financiero") : setStep(1))} progress={step * 50} step={`Trabajo e ingresos · ${step} de 2`} title={step === 1 ? "Cuéntanos de tu trabajo" : "Tus ingresos"} subtitle={step === 1 ? "Así entendemos de dónde vienen tus ingresos." : "Marca todas tus fuentes y su valor mensual."} />
      <form className="l-body" onSubmit={submit}>
        {step === 1 ? <Card>
          <Field label="Situación laboral" trailing={<Icon name="keyboard_arrow_down" />}><select value={job.situation} onChange={(event) => setJob({ ...job, situation: event.target.value })}>{SITUATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Tipo de contrato" trailing={<Icon name="keyboard_arrow_down" />}><select value={job.contractType} onChange={(event) => setJob({ ...job, contractType: event.target.value })}>{CONTRACTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Ocupación o cargo" valid={job.occupation.trim().length >= 2}><input value={job.occupation} onChange={(event) => setJob({ ...job, occupation: event.target.value })} minLength={2} maxLength={120} required /></Field>
          <Field label="Empresa donde trabajas" optional><input value={job.company} onChange={(event) => setJob({ ...job, company: event.target.value })} maxLength={160} /></Field>
        </Card> : <Card>
          <div className="l-row between"><strong style={{ fontWeight: 500 }}>Tus fuentes de ingreso</strong><Chip tone="blue">{chosen.length} elegida{chosen.length === 1 ? "" : "s"}</Chip></div>
          <div className="l-kv">{SOURCES.map(([kind, label]) => (
            <div key={kind} style={{ alignItems: "center", padding: "6px 0" }}>
              <Checkbox row checked={kind in sources} onChange={(checked) => setSources((current) => { const next = { ...current }; if (checked) next[kind] = null; else delete next[kind]; return next; })}>{label}</Checkbox>
              {kind in sources && <span style={{ width: 150 }}><MoneyInput compact label={`Valor mensual de ${label}`} value={sources[kind]} onChange={(value) => setSources((current) => ({ ...current, [kind]: value }))} /></span>}
            </div>
          ))}</div>
          <div className="l-total"><span>Total al mes</span><strong>{formatCOP(total)}</strong></div>
          <strong style={{ fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}>¿Te descuentan retención? <em className="l-optional">Opcional</em></strong>
          <Segmented label="Retención" value={withholding} onChange={setWithholding} options={[{ value: "yes", label: "Sí" }, { value: "no", label: "No" }]} />
        </Card>}
        {(error || failure) && <Alert>{error || failure}</Alert>}
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}><Button type="submit" arrow disabled={busy}>{busy ? "Guardando…" : step === 1 ? "Continuar" : "Guardar sección"}</Button></div>
      </form>
    </Screen>
  );
}
