"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Choice, Header, Loading, MoneyInput, Screen, Segmented } from "@/components/luft/ui";
import { useFinancialProfile } from "@/lib/profile";

const SECURITY = [["EMPLEADO", "Empleado/a"], ["INDEPENDIENTE", "Independiente"], ["NO_COTIZO", "No cotizo"]];
const OTHERS = [["CELULAR", "Celular"], ["SUSCRIPCIONES", "Suscripciones"], ["GIMNASIO", "Gimnasio / Actividades"], ["MANUTENCION", "Manutención"]];

export default function HabitsPage() {
  const router = useRouter();
  const { reload } = useLuft();
  const { profile, failure, busy, save } = useFinancialProfile();
  const [rent, setRent] = useState<"yes" | "no" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [security, setSecurity] = useState<string | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const saved = profile?.context.recurring; if (!saved) return;
    setRent(saved.paysRent ? "yes" : "no"); setAmount(saved.rentMonthlyCOP || null); setSecurity(saved.socialSecurity); setOthers(saved.otherPayments);
  }, [profile]);
  if (!profile) return <Screen>{failure ? <div className="l-body" style={{ paddingTop: 48 }}><Alert>{failure}</Alert></div> : <Loading />}</Screen>;
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!rent || !security) return setError("Responde si pagas arriendo y cómo cotizas a seguridad social.");
    if (rent === "yes" && !amount) return setError("Ingresa el valor mensual del arriendo.");
    if (await save("recurring", { paysRent: rent === "yes", rentMonthlyCOP: rent === "yes" ? amount : 0, socialSecurity: security, otherPayments: others })) { await reload(); router.push("/app/perfil/financiero"); }
  }
  return (
    <Screen>
      <Header back="/app/perfil/financiero" title="Tus pagos recurrentes" subtitle="Pagos puntuales que hoy no aparecen en tu historial." />
      <form className="l-body" onSubmit={submit}>
        <Card>
          <strong style={{ fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}>¿Pagas arriendo?</strong>
          <Segmented label="¿Pagas arriendo?" value={rent} onChange={setRent} options={[{ value: "yes", label: "Sí" }, { value: "no", label: "No" }]} />
          {rent === "yes" && <label className="l-field"><span>Valor mensual del arriendo</span><MoneyInput label="Valor mensual del arriendo" value={amount} onChange={setAmount} /></label>}
          <div className="l-stack" style={{ gap: 4 }}>
            <strong id="habits-security" style={{ fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}>¿Cómo cotizas a seguridad social?</strong>
            <div className="l-choice-grid" role="radiogroup" aria-labelledby="habits-security">{SECURITY.map(([value, label]) => <Choice key={value} selected={security === value} onSelect={() => setSecurity(value)}>{label}</Choice>)}</div>
          </div>
          <div className="l-stack" style={{ gap: 4 }}>
            <strong id="habits-others" style={{ fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}>Otros pagos que haces cada mes</strong>
            <div className="l-choice-grid" role="group" aria-labelledby="habits-others">{OTHERS.map(([value, label]) => <Choice key={value} multiple selected={others.includes(value)} onSelect={() => setOthers(others.includes(value) ? others.filter((item) => item !== value) : [...others, value])}>{label}</Choice>)}</div>
          </div>
        </Card>
        {(error || failure) && <Alert>{error || failure}</Alert>}
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}><Button type="submit" arrow disabled={busy}>{busy ? "Guardando…" : "Guardar sección"}</Button></div>
      </form>
    </Screen>
  );
}
