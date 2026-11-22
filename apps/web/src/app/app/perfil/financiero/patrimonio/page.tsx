"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Bar, Button, Card, Checkbox, Chip, Choice, formatCOP, Header, Icon, Loading, MoneyInput, Screen, Sheet, Tip } from "@/components/luft/ui";
import { DOCUMENTS, useFinancialProfile } from "@/lib/profile";
import type { TaxCheck } from "@/lib/types";

const ASSETS = [["AHORROS", "Cuentas de ahorro"], ["VIVIENDA", "Vivienda o terrenos"], ["VEHICULOS", "Vehículos"], ["INVERSIONES", "Inversiones"], ["EXTERIOR", "Bienes en el exterior"]];
const EXPENSES = [["VIVIENDA", "Vivienda"], ["SERVICIOS", "Servicios"], ["COMIDA", "Comida"], ["TRANSPORTE", "Transporte"], ["SALUD", "Salud"], ["EDUCACION", "Educación"]];
const TAX_RETURN_UPLOAD = `/app/perfil/financiero/documentos/${DOCUMENTS.find((item) => item.kind === "TAX_RETURN")!.slug}`;
const COUNT = ["ninguno", "uno", "dos", "tres", "cuatro", "cinco"];

/** One criterion of the tax-filing orientation: label and value on one line, full-width bar, limit and tag below. */
function TaxRow({ row }: { row: TaxCheck["criteria"][number] }) {
  return (
    <div>
      <div className="head"><span>{row.label}</span><strong>{formatCOP(row.valueCOP)}</strong></div>
      <Bar value={(row.valueCOP / row.limitCOP) * 100} tone={row.exceeds ? "amber" : ""} label={row.label} />
      {row.exceeds && <div className="foot"><span>Tope: {row.limitUvt.toLocaleString("es-CO")} UVT · {formatCOP(row.limitCOP)}</span><Chip tone="amber" dot>Supera el tope</Chip></div>}
    </div>
  );
}

export default function WealthPage() {
  const router = useRouter();
  const { reload } = useLuft();
  const { profile, failure, busy, save } = useFinancialProfile();
  const [step, setStep] = useState(1);
  const [assets, setAssets] = useState<Record<string, number | null>>({});
  const [debts, setDebts] = useState<{ cardSpendMonthlyCOP: number | null; totalDebtCOP: number | null; fixedExpensesMonthlyCOP: number | null; expenseKinds: string[] }>({ cardSpendMonthlyCOP: null, totalDebtCOP: null, fixedExpensesMonthlyCOP: null, expenseKinds: [] });
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!profile) return;
    if (profile.context.assets) setAssets(Object.fromEntries(profile.context.assets.items.map((row) => [row.kind, row.valueCOP])));
    if (profile.context.debts) setDebts(profile.context.debts);
  }, [profile]);
  if (!profile) return <Screen>{failure ? <div className="l-body" style={{ paddingTop: 48 }}><Alert>{failure}</Alert></div> : <Loading />}</Screen>;
  const chosen = Object.keys(assets);
  const total = Object.values(assets).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const check = profile.taxCheck;
  const exceeded = check.criteria.filter((row) => row.exceeds);

  /** The section is already saved step by step; leaving refreshes the profile summary first. */
  async function leave(href: string) { setLeaving(true); await reload(); router.push(href); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (step === 1) {
      if (chosen.some((kind) => assets[kind] == null)) return setError("Ingresa el valor de cada bien que marcaste.");
      if (await save("assets", { items: chosen.map((kind) => ({ kind, valueCOP: assets[kind] })) })) setStep(2);
    } else if (step === 2) {
      if (await save("debts", { ...debts, cardSpendMonthlyCOP: debts.cardSpendMonthlyCOP ?? 0, totalDebtCOP: debts.totalDebtCOP ?? 0, fixedExpensesMonthlyCOP: debts.fixedExpensesMonthlyCOP ?? 0 })) setStep(3);
    } else if (check.mayHaveToFile && exceeded.length > 0) setSheet(true);
    else await leave("/app/perfil/financiero");
  }
  const head = [["Lo que tienes", "Lo que tenías al 31 de diciembre."], ["Lo que debes y gastas", "Así mostramos tu capacidad de pago real."], ["¿Debes declarar renta?", "Es una orientación, no asesoría tributaria."]][step - 1];
  return (
    <Screen>
      <Header back onBack={() => (step === 1 ? router.push("/app/perfil/financiero") : setStep(step - 1))} progress={(step / 3) * 100} step={`Patrimonio y deudas · ${step} de 3`} title={head[0]} subtitle={head[1]} />
      <form className="l-body" onSubmit={submit}>
        {step === 1 && <>
          <Card>
            <strong style={{ fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}>¿Qué bienes tienes?</strong>
            <div className="l-kv">{ASSETS.map(([kind, label]) => (
              <div key={kind} style={{ alignItems: "center", padding: "6px 0" }}>
                <Checkbox row checked={kind in assets} onChange={(checked) => setAssets((current) => { const next = { ...current }; if (checked) next[kind] = null; else delete next[kind]; return next; })}>{label}</Checkbox>
                {kind in assets && <span style={{ width: 150 }}><MoneyInput compact label={`Valor de ${label}`} value={assets[kind]} onChange={(value) => setAssets((current) => ({ ...current, [kind]: value }))} /></span>}
              </div>
            ))}</div>
            <div className="l-total"><span>Total de tus bienes</span><strong>{formatCOP(total)}</strong></div>
          </Card>
          <Tip title="¿Qué valor pongo?">El de tus certificados bancarios o el predial. Si no lo tienes a mano, un aproximado sirve por ahora.</Tip>
        </>}
        {step === 2 && <Card>
          <label className="l-field"><span>Consumo con tarjetas de crédito al mes</span><MoneyInput label="Consumo con tarjetas de crédito al mes" placeholder="$ 0" value={debts.cardSpendMonthlyCOP} onChange={(value) => setDebts({ ...debts, cardSpendMonthlyCOP: value })} /></label>
          <label className="l-field"><span>¿Cuánto debes en total hoy?</span><MoneyInput label="Deuda total" placeholder="$ 0" value={debts.totalDebtCOP} onChange={(value) => setDebts({ ...debts, totalDebtCOP: value })} /></label>
          <label className="l-field"><span>Gastos fijos del hogar al mes</span><MoneyInput label="Gastos fijos del hogar al mes" placeholder="$ 0" value={debts.fixedExpensesMonthlyCOP} onChange={(value) => setDebts({ ...debts, fixedExpensesMonthlyCOP: value })} /></label>
          <div className="l-stack" style={{ gap: 4 }}>
            <strong id="wealth-expenses" style={{ fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}>¿Qué gastos incluiste?</strong>
            <div className="l-choice-grid" role="group" aria-labelledby="wealth-expenses">{EXPENSES.map(([kind, label]) => <Choice key={kind} multiple selected={debts.expenseKinds.includes(kind)} onSelect={() => setDebts({ ...debts, expenseKinds: debts.expenseKinds.includes(kind) ? debts.expenseKinds.filter((item) => item !== kind) : [...debts.expenseKinds, kind] })}>{label}</Choice>)}</div>
          </div>
        </Card>}
        {step === 3 && <>
          <Card>
            <p className="l-note"><Icon name="calculate" size={16} /><span>Datos tomados de tu perfil. Topes {check.taxYear} (UVT {formatCOP(check.uvtCOP)}): patrimonio 4.500 UVT; demás criterios 1.400 UVT. Las consignaciones e inversiones son un valor estimado.</span></p>
            <div className="l-tax">{check.criteria.map((row) => <TaxRow key={row.key} row={row} />)}</div>
          </Card>
          {!check.ready ? <Tip title="Nos faltan datos">Completa «Trabajo e ingresos» para que la orientación tenga en cuenta tus ingresos.</Tip>
            : check.mayHaveToFile ? <Tip tone="amber" icon="warning" title="Podrías estar obligado a declarar renta"><button type="button" className="l-link" style={{ minHeight: 24 }} onClick={() => setSheet(true)}>Ver qué significa</button></Tip>
            : <Tip tone="green" icon="check_circle" title="No superas los topes de referencia">Si tus ingresos o bienes cambian, actualiza estos datos.</Tip>}
        </>}
        {(error || failure) && <Alert>{error || failure}</Alert>}
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}><Button type="submit" arrow disabled={busy || leaving}>{busy || leaving ? "Guardando…" : step === 3 ? "Guardar sección" : "Continuar"}</Button></div>
      </form>
      {sheet && <Sheet onClose={() => setSheet(false)} title="Podrías tener que declarar renta">
        <span className="l-icon-box amber" style={{ width: 56, height: 56, borderRadius: 999 }}><Icon name="warning" size={28} /></span>
        <h2>Podrías tener que declarar renta</h2>
        <p className="l-muted">Según los datos que registraste, superas {COUNT[exceeded.length] ?? exceeded.length} de los topes de referencia del año gravable {check.taxYear}:</p>
        <div className="l-tax boxed">{exceeded.map((row) => <TaxRow key={row.key} row={row} />)}</div>
        <p className="l-note"><Icon name="info" size={16} /><span>Esto no es una determinación tributaria: depende de toda tu situación y de las normas de la DIAN. Los topes cambian cada año con la UVT.</span></p>
        <Button arrow disabled={leaving} onClick={() => void leave("/app/renta")}>Hacer mi declaración con LUFT</Button>
        <Button variant="secondary" disabled={leaving} onClick={() => void leave(TAX_RETURN_UPLOAD)}>Ya la tengo, continuar con mi perfil financiero</Button>
      </Sheet>}
    </Screen>
  );
}
