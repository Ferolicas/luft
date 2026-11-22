"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BarList, SegmentBar } from "@/components/admin/charts";
import { Badge, Empty, Facts, Loaded, PageHead, Panel, Stat, useLoad } from "@/components/admin/ui";
import type { Backtest } from "@/lib/admin/analytics-types";
import { dateTime, day, integer, percent, points } from "@/lib/admin/format";
import { get } from "@/lib/admin/http";
import { label } from "@/lib/admin/labels";

/** Paleta de estado (bueno / advertencia / crítico): siempre con etiqueta y valor al lado. */
const STATUS_COLOR = { ELEGIBLE: "#0ca30c", CON_BRECHAS: "#fab219", EXCLUIDO: "#d03b3b" };
const rate = (value: number | null) => (value === null ? "—" : percent(value, 1));
const PARAM_LABEL: Record<string, (value: unknown) => string> = {
  snapshots: (value) => `Instantáneas por persona: ${value === "ALL" ? "todas" : "solo la más reciente"}`,
  delinquencyDays: (value) => `Umbral de mora: ${String(value)} días`,
  loanWindow: (value) => `Créditos: ${value === "AFTER_SNAPSHOT" ? "posteriores a la instantánea" : "cualquiera de la persona"}`,
  from: (value) => `Desde ${day(String(value))}`,
  to: (value) => `Hasta ${day(String(value))}`,
};

export default function BacktestPage() {
  const { id } = useParams<{ id: string }>();
  const backtest = useLoad(() => get<Backtest>(`/admin/analytics/backtests/${id}`), [id]);
  return (
    <Loaded loader={backtest} label="Cargando el backtest…">
      {(data) => {
        const result = data.result;
        const params = Object.entries(data.params ?? {}).filter(([key, value]) => PARAM_LABEL[key] && value !== null && value !== undefined && value !== "").map(([key, value]) => PARAM_LABEL[key](value));
        return (
          <>
            <PageHead
              back={{ href: "/admin/analitica/backtesting", label: "Backtesting" }}
              eyebrow={label(data.kind)}
              title={data.label ?? "Backtest sin nombre"}
              description={<span className="cs-row"><span>{dateTime(data.createdAt)}{data.createdByName ? ` · ${data.createdByName}` : ""}</span>{data.policyVersionId && <Link className="cs-link" href={`/admin/matching/productos/versiones/${data.policyVersionId}`}>Ver la versión de política</Link>}<span className="cs-mono">{data.engineVersion}</span></span>}
            />
            {params.length > 0 && <div className="cs-chips">{params.map((text) => <span key={text} className="cs-chip">{text}</span>)}</div>}
            {result.evaluated === 0 ? (
              <Panel><Empty title="No había instantáneas para evaluar">El backtest quedó registrado, pero en la ventana elegida no hay instantáneas de matching ({integer(result.coverage.snapshotsInWindow)} en la ventana). Solo existen instantáneas de quienes ya buscaron oportunidades.</Empty></Panel>
            ) : (
              <>
                <div className="cs-stats">
                  <Stat label="Instantáneas evaluadas" value={integer(result.evaluated)} hint={`${integer(result.users)} ${result.users === 1 ? "persona" : "personas"}`} />
                  <Stat label="Serían elegibles" value={rate(result.eligibleRate)} hint={`${integer(result.predicted.ELEGIBLE)} de ${integer(result.evaluated)}`} />
                  <Stat label="Encaje promedio" value={result.averageFitPercent === null ? "—" : points(result.averageFitPercent, 1)} />
                  <Stat label="Coincidencia con decisiones reales" value={rate(result.approval.agreementRate)} hint={`${integer(result.approval.withDecision)} con decisión de la entidad`} />
                </div>
                <Panel title="Qué habría predicho la política">
                  <SegmentBar
                    label="Distribución de la predicción"
                    format={(value, share) => `${integer(value)} (${percent(share, 0)})`}
                    segments={[
                      { label: "Elegible", value: result.predicted.ELEGIBLE, color: STATUS_COLOR.ELEGIBLE },
                      { label: "Con brechas", value: result.predicted.CON_BRECHAS, color: STATUS_COLOR.CON_BRECHAS },
                      { label: "Excluido", value: result.predicted.EXCLUIDO, color: STATUS_COLOR.EXCLUIDO },
                    ]}
                  />
                </Panel>
                <div className="cs-grid cs-grid-2">
                  <Panel title="Frente a las decisiones de las entidades" description="Solo cuentan las instantáneas cuya persona tuvo una decisión registrada.">
                    {result.approval.withDecision === 0 ? <Empty title="Aún no hay decisiones registradas para comparar" /> : (
                      <div className="cs-table-wrap">
                        <table className="cs-table cs-table-compact">
                          <caption>Predicción frente a decisión real</caption>
                          <thead><tr><th scope="col">Predicción</th><th scope="col" className="is-right">Aprobadas</th><th scope="col" className="is-right">Rechazadas</th><th scope="col" className="is-right">Tasa de aprobación</th></tr></thead>
                          <tbody>
                            <tr><td>Elegible</td><td className="is-right">{integer(result.approval.eligibleApproved)}</td><td className="is-right">{integer(result.approval.eligibleRejected)}</td><td className="is-right">{rate(result.approval.approvalRateEligible)}</td></tr>
                            <tr><td>No elegible</td><td className="is-right">{integer(result.approval.notEligibleApproved)}</td><td className="is-right">{integer(result.approval.notEligibleRejected)}</td><td className="is-right">{rate(result.approval.approvalRateNotEligible)}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                  <Panel title={`Frente a la mora real (${result.delinquency.thresholdDays} días o más)`} description={`Créditos STARTIF de las personas evaluadas. Resultados observados al ${day(result.outcomesObservedAt)}.`}>
                    {result.delinquency.withLoan === 0 ? <Empty title="Las personas evaluadas aún no tienen créditos para comparar" /> : (
                      <BarList
                        max={1}
                        format={(value) => percent(value, 1)}
                        items={[
                          { label: `Elegibles (${result.delinquency.eligible.loans} ${result.delinquency.eligible.loans === 1 ? "crédito" : "créditos"})`, value: result.delinquency.eligible.rate, hint: `${result.delinquency.eligible.delinquent} en mora` },
                          { label: `No elegibles (${result.delinquency.notEligible.loans} ${result.delinquency.notEligible.loans === 1 ? "crédito" : "créditos"})`, value: result.delinquency.notEligible.rate, hint: `${result.delinquency.notEligible.delinquent} en mora` },
                        ]}
                      />
                    )}
                  </Panel>
                  <Panel title="Brechas más frecuentes" description="Reglas que más personas no cumplen o no pueden evaluarse por falta de dato.">
                    <BarList
                      format={(value) => integer(value)}
                      empty={<Empty title="Ninguna regla generó brechas" />}
                      items={result.topGaps.map((gap) => ({ label: gap.label, value: gap.notMet + gap.missingData, hint: `${gap.notMet} no cumplen · ${gap.missingData} sin dato${gap.fieldLabel ? ` · ${gap.fieldLabel}` : ""}` }))}
                    />
                  </Panel>
                  <Panel title="Exclusiones más frecuentes" description="Causales de rechazo que más personas activan.">
                    <BarList format={(value) => integer(value)} empty={<Empty title="Ninguna exclusión se activó" />} items={result.topExclusions.map((item) => ({ label: item.label, value: item.excluded, hint: item.fieldLabel ?? undefined }))} />
                  </Panel>
                </div>
                <Panel title="Frente al resultado que quedó guardado" description="Comparación con el resultado original de cada instantánea, cuando la política evaluada pertenece al mismo producto.">
                  <Facts
                    columns={4}
                    items={[
                      { label: "Comparadas", value: integer(result.versusRecorded.compared) },
                      { label: "Sin cambio", value: integer(result.versusRecorded.unchanged) },
                      { label: "Ahora serían elegibles", value: integer(result.versusRecorded.nowEligible) },
                      { label: "Dejarían de ser elegibles", value: integer(result.versusRecorded.noLongerEligible) },
                    ]}
                  />
                </Panel>
              </>
            )}
            <Panel flush title="Reglas evaluadas" description={`Cobertura: ${integer(result.coverage.snapshotsSelected)} instantáneas seleccionadas de ${integer(result.coverage.snapshotsInWindow)} en la ventana${result.coverage.unreadableSnapshots > 0 ? ` · ${integer(result.coverage.unreadableSnapshots)} ilegibles` : ""}${result.coverage.truncated ? " · resultado truncado al tope de instantáneas" : ""}.`}>
              <div className="cs-table-wrap">
                <table className="cs-table cs-table-compact">
                  <caption>Reglas evaluadas</caption>
                  <thead><tr><th scope="col">Tipo</th><th scope="col">Regla</th><th scope="col" className="is-center">Peso</th></tr></thead>
                  <tbody>{data.rules.map((rule, index) => <tr key={`${rule.field}-${index}`}><td><Badge tone={rule.kind === "EXCLUSION" ? "bad" : rule.kind === "PREFERENCIA" ? "info" : "neutral"}>{label(rule.kind)}</Badge></td><td>{rule.label}</td><td className="is-center">{rule.weight}</td></tr>)}</tbody>
                </table>
              </div>
            </Panel>
            <p className="cs-muted cs-small">Huella de los parámetros: <span className="cs-mono">{data.paramsHash?.slice(0, 16)}…</span></p>
          </>
        );
      }}
    </Loaded>
  );
}
