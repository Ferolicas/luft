"use client";

import { Landmark } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { Button, DataTable, Empty, ErrorBox, Field, Loaded, PageHead, Panel, useAction, useLoad } from "@/components/admin/ui";
import type { AuditEvent } from "@/lib/admin/credit-types";
import { dateTime, day, fractionFromPercent, percent } from "@/lib/admin/format";
import { get, send } from "@/lib/admin/http";

interface UsuryRate { id: string; category: string; annualEffectiveRate: string | number; effectiveFrom: string; effectiveTo: string; sourceUrl: string; verifiedAt: string }

/** Páginas de la bitácora (50 eventos c/u) que se revisan para listar los registros recientes de tasa. */
const AUDIT_PAGES = 4;

async function recentRates() {
  const events: AuditEvent[] = [];
  for (let page = 1; page <= AUDIT_PAGES; page += 1) {
    const batch = await get<AuditEvent[]>(`/admin/audit?page=${page}`);
    events.push(...batch.filter((event) => event.action === "legal.usury_rate.updated"));
    if (batch.length < 50) break;
  }
  return events;
}

export default function LegalRatePage() {
  const { notify } = useConsole();
  const action = useAction();
  const history = useLoad(recentRates, []);
  const [saved, setSaved] = useState<UsuryRate | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    await action.run(async () => {
      const rate = await send<UsuryRate>("POST", "/admin/legal/usury-rate", {
        category: String(form.get("category") ?? "").trim(),
        annualEffectiveRate: fractionFromPercent(String(form.get("rate") ?? "")),
        effectiveFrom: form.get("from"),
        effectiveTo: form.get("to"),
        sourceUrl: String(form.get("sourceUrl") ?? "").trim(),
      });
      setSaved(rate);
      element.reset();
      notify("Tasa máxima legal registrada con trazabilidad.");
      await history.reload();
    });
  };

  return (
    <>
      <PageHead
        eyebrow="Crédito STARTIF"
        title="Tasa máxima legal"
        description="Toda aprobación de crédito y toda activación de producto se compara contra la tasa de usura vigente. Sin una tasa vigente registrada, ninguna solicitud puede aprobarse. La de consumo y ordinario se actualiza sola con la certificación que la Superintendencia Financiera publica en datos abiertos; este formulario queda para corregirla o cargarla a mano."
      />
      <div className="cs-grid cs-grid-side">
        <Panel title={<span className="cs-row"><Landmark size={17} /> Registrar tasa certificada</span>} description="Registra exclusivamente el valor certificado por la Superintendencia Financiera, con el enlace a la fuente oficial.">
          <form className="cs-form" onSubmit={submit}>
            <div className="cs-fields">
              <Field label="Modalidad" required wide><input name="category" defaultValue="Crédito de consumo y ordinario" minLength={3} maxLength={100} required /></Field>
              <Field label="Tasa efectiva anual (%)" required hint="Ej.: 25,5. Máximo 200."><input name="rate" type="number" min="0.01" max="200" step="0.00001" required /></Field>
              <span />
              <Field label="Vigente desde" required><input name="from" type="date" required /></Field>
              <Field label="Vigente hasta" required><input name="to" type="date" required /></Field>
              <Field label="URL oficial de la certificación" required wide><input name="sourceUrl" type="url" placeholder="https://www.superfinanciera.gov.co/…" required /></Field>
            </div>
            <ErrorBox problem={action.problem} />
            {saved && <p className="cs-ok">Registrada: {saved.category}, {percent(Number(saved.annualEffectiveRate))} E.A., vigente del {day(String(saved.effectiveFrom))} al {day(String(saved.effectiveTo))}.</p>}
            <div className="cs-form-actions"><Button type="submit" disabled={action.busy}>{action.busy ? "Guardando…" : "Guardar tasa verificada"}</Button></div>
          </form>
        </Panel>
        <Panel flush title="Registros recientes" description="Tomados de la bitácora de auditoría (últimos 200 eventos).">
          <Loaded loader={history} label="Leyendo la bitácora…">
            {(events) => (
              <DataTable
                caption="Registros recientes de tasa legal"
                rows={events}
                rowKey={(row) => row.id}
                empty={<Empty title="Sin registros recientes">No hay registros de tasa legal entre los eventos recientes de la bitácora.</Empty>}
                columns={[
                  { key: "when", header: "Registrada", cell: (row) => dateTime(row.createdAt) },
                  { key: "rate", header: "Tasa E.A.", align: "right", cell: (row) => <strong>{percent(Number(row.payload?.annualEffectiveRate))}</strong> },
                  { key: "from", header: "Desde", cell: (row) => day(String(row.payload?.effectiveFrom ?? "")) },
                  { key: "source", header: "Fuente", cell: (row) => (typeof row.payload?.sourceUrl === "string" ? <a className="cs-link" href={row.payload.sourceUrl} target="_blank" rel="noreferrer noopener">Ver fuente</a> : "—") },
                ]}
              />
            )}
          </Loaded>
        </Panel>
      </div>
    </>
  );
}
