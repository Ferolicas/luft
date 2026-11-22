"use client";

import { Check, Copy, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PortalLoaded } from "@/components/admin/portal";
import { Button, Loaded, PageHead, Panel, Stat, Toolbar, useLoad } from "@/components/admin/ui";
import { day, integer, percent, today } from "@/lib/admin/format";
import { get, query } from "@/lib/admin/http";

interface Me { ally: { id: string; name: string; referralCode: string } }
interface Funnel {
  ally: { id: string; name: string };
  period: { from: string | null; to: string | null };
  suppressed: boolean;
  minimumGroup: number;
  stages: Array<{ key: string; label: string; count: number | null }>;
  note: string;
}

export default function AllyHome() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);
  const me = useLoad(() => get<Me>("/ally/me"), []);
  const funnel = useLoad(() => get<Funnel>(`/ally/funnel${query({ from, to })}`), [from, to]);
  const rangeError = from && to && from > to ? "La fecha inicial no puede ser posterior a la final." : null;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PortalLoaded loader={me} linkCode="ally_link_required" partner="aliado">
      {(data) => (
        <>
          <PageHead
            eyebrow="Aliado LUFT"
            title={data.ally.name}
            description="Embudo agregado de las personas que llegaron a LUFT por tu organización. Nunca verás datos individuales: solo cuántas personas han alcanzado cada etapa."
          />
          <Panel title="Tu código de referido" description="Compártelo con las personas que acompañas. El equipo de LUFT lo usa para atribuirte sus registros.">
            <div className="cs-row">
              <strong className="cs-mono" style={{ fontSize: "1.25rem", letterSpacing: ".08em", padding: "8px 14px", borderRadius: 10, background: "var(--canvas)", border: "1px solid var(--cs-line)" }}>{data.ally.referralCode}</strong>
              <Button variant="ghost" onClick={() => void copy(data.ally.referralCode)}>{copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar código</>}</Button>
            </div>
          </Panel>
          <Panel>
            <Toolbar>
              <label>Referidos desde<input type="date" value={from} max={to || today()} onChange={(event) => setFrom(event.target.value)} /></label>
              <label>Referidos hasta<input type="date" value={to} min={from || undefined} max={today()} onChange={(event) => setTo(event.target.value)} /></label>
              {(from || to) && <Button variant="quiet" onClick={() => { setFrom(""); setTo(""); }}>Ver todo el periodo</Button>}
            </Toolbar>
            {rangeError && <p className="cs-field-error cs-small" style={{ marginTop: 8, color: "var(--danger)" }}>{rangeError}</p>}
          </Panel>
          <Loaded loader={funnel} label="Calculando tu embudo…">
            {(result) => {
              const referred = result.stages.find((stage) => stage.key === "referred")?.count ?? result.stages[0]?.count ?? 0;
              const top = Math.max(1, ...result.stages.map((stage) => stage.count ?? 0));
              return (
                <>
                  <div className="cs-stats">
                    <Stat label="Personas referidas" value={integer(referred)} hint={result.period.from || result.period.to ? `${result.period.from ? `Desde ${day(result.period.from)}` : "Desde el inicio"}${result.period.to ? ` hasta ${day(result.period.to)}` : ""}` : "Todo el periodo"} />
                    {!result.suppressed && result.stages.filter((stage) => ["creditActive", "matched", "approved"].includes(stage.key)).map((stage) => <Stat key={stage.key} label={stage.label} value={integer(stage.count)} hint={referred ? `${percent((stage.count ?? 0) / referred, 0)} de tus referidos` : undefined} />)}
                  </div>
                  {result.suppressed && (
                    <div className="cs-note cs-note-warn cs-row" role="status" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                      <ShieldCheck size={18} style={{ flex: "none", marginTop: 1 }} />
                      <span><strong>El detalle por etapas está oculto para proteger a las personas.</strong> Con menos de {result.minimumGroup} referidos en el periodo, el desglose podría identificar a alguien; por eso solo mostramos el total.</span>
                    </div>
                  )}
                  <Panel title="Embudo de tus referidos" description={result.suppressed ? undefined : result.note}>
                    <div className="cs-bars cs-bars-wide">
                      {result.stages.map((stage, index) => (
                        <div key={stage.key} className="cs-bar" title={stage.count === null ? "Oculto por protección de datos" : referred ? `${percent(stage.count / referred, 0)} de tus referidos` : undefined}>
                          <span>{index + 1}. {stage.label}</span>
                          <div className="cs-bar-track">{stage.count !== null && stage.count > 0 && <i style={{ width: `${(stage.count / top) * 100}%` }} />}</div>
                          <b>{stage.count === null ? "Oculto" : integer(stage.count)}</b>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </>
              );
            }}
          </Loaded>
        </>
      )}
    </PortalLoaded>
  );
}
