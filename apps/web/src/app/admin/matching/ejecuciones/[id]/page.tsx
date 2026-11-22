"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ExplanationView } from "@/components/admin/matching";
import { PersonCell, usePeople } from "@/components/admin/people";
import { Badge, Button, ErrorBox, Facts, Loaded, PageHead, Panel, StatusBadge, useAction, useLoad } from "@/components/admin/ui";
import { dateTime, day, points, shortId } from "@/lib/admin/format";
import { get, send } from "@/lib/admin/http";
import type { RunDetail, RunVerification } from "@/lib/admin/matching-types";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const people = usePeople();
  const run = useLoad(() => get<RunDetail>(`/admin/matching/runs/${id}`), [id]);
  const [verification, setVerification] = useState<RunVerification | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const action = useAction();
  const verify = () => action.run(async () => setVerification(await send<RunVerification>("POST", `/admin/matching/runs/${id}/verify`)));

  return (
    <Loaded loader={run} label="Cargando la ejecución…">
      {(data) => (
        <>
          <PageHead
            back={{ href: "/admin/matching/ejecuciones", label: "Ejecuciones" }}
            eyebrow="Ejecución de matching"
            title={`Ejecución ${shortId(data.id)}`}
            description={`${dateTime(data.createdAt)} · ${data.productsEvaluated} ${data.productsEvaluated === 1 ? "producto evaluado" : "productos evaluados"}`}
            actions={<Button onClick={() => void verify()} disabled={action.busy}><ShieldCheck size={16} /> {action.busy ? "Recalculando…" : "Verificar reproducibilidad"}</Button>}
          />
          <ErrorBox problem={action.problem} />
          {verification && (
            <Panel title="Verificación de reproducibilidad" description="Se volvió a calcular cada resultado con la instantánea de hechos guardada y la copia de reglas de la versión de política usada.">
              <div className="cs-stack" style={{ gap: 12 }}>
                <div className="cs-row">
                  <Badge tone={verification.reproducible ? "good" : "bad"}>{verification.reproducible ? "Reproducible: todos los resultados coinciden" : "No reproducible: hay diferencias"}</Badge>
                  <Badge tone={verification.factsHashValid ? "good" : "bad"}>{verification.factsHashValid ? "Huella de hechos íntegra" : "La huella de hechos no coincide"}</Badge>
                  <Badge tone={verification.sameEngineVersion ? "good" : "warn"}>{verification.sameEngineVersion ? `Mismo motor (${verification.engineVersion})` : `Motor distinto: se ejecutó con ${verification.engineVersion}, hoy es ${verification.currentEngineVersion}`}</Badge>
                </div>
                <div className="cs-table-wrap">
                  <table className="cs-table cs-table-compact">
                    <caption>Resultado guardado frente al recalculado</caption>
                    <thead><tr><th scope="col">Producto</th><th scope="col" className="is-center">Política</th><th scope="col">Guardado</th><th scope="col">Recalculado</th><th scope="col">Coincide</th></tr></thead>
                    <tbody>
                      {verification.results.map((result) => (
                        <tr key={result.resultId}>
                          <td><strong>{result.productName}</strong></td>
                          <td className="is-center">v{result.policyVersion}</td>
                          <td><StatusBadge value={result.stored.status} /> {points(result.stored.fitPercent, 0)}</td>
                          <td>{result.recomputed ? <><StatusBadge value={result.recomputed.status} /> {points(result.recomputed.fitPercent, 0)}</> : <span className="cs-muted">No se pudo recalcular</span>}</td>
                          <td><Badge tone={result.reproducible ? "good" : "bad"}>{result.reproducible ? "Sí" : "No"}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          )}
          <Panel title="Datos de la ejecución">
            <Facts
              columns={4}
              items={[
                { label: "Persona", value: <PersonCell id={data.userId} people={people} /> },
                { label: "Motor", value: <span className="cs-mono">{data.engineVersion}</span> },
                { label: "Origen", value: data.trigger === "USER" ? "La persona" : data.trigger },
                { label: "Huella de los hechos (SHA-256)", value: <span className="cs-mono" title={data.factsHash}>{data.factsHash.slice(0, 24)}…</span> },
              ]}
            />
          </Panel>
          <Panel flush title="Resultados" description="La explicación no incluye los valores de la persona: solo qué regla se cumplió, cuál no y por qué.">
            {data.results.length === 0 ? <p className="cs-empty"><strong>Sin resultados</strong><span>No había productos con política vigente al momento de la ejecución.</span></p> : (
              <div className="cs-table-wrap">
                <table className="cs-table">
                  <caption>Resultados por producto</caption>
                  <thead><tr><th scope="col">Producto</th><th scope="col">Política usada</th><th scope="col">Resultado</th><th scope="col" className="is-right">Encaje</th><th scope="col">Reglas</th><th scope="col" /></tr></thead>
                  <tbody>
                    {data.results.map((result) => (
                      <ResultRows key={result.id} open={open === result.id} onToggle={() => setOpen(open === result.id ? null : result.id)}>
                        {{
                          row: (
                            <>
                              <td><div className="cs-cell"><strong>{result.productName}</strong><small>{result.institutionName}</small></div></td>
                              <td><Link className="cs-link" href={`/admin/matching/productos/versiones/${result.policyVersionId}`} onClick={(event) => event.stopPropagation()}>Versión {result.policyVersion}</Link><div className="cs-muted cs-small">{result.policyEffectiveFrom ? `Vigente desde ${day(result.policyEffectiveFrom)}` : ""}</div></td>
                              <td><div className="cs-chips"><StatusBadge value={result.status} />{result.presentable && <Badge tone="info">Presentable</Badge>}</div></td>
                              <td className="is-right"><strong>{points(result.fitPercent, 0)}</strong></td>
                              <td><span className="cs-small">{result.totals.passed} de {result.totals.rules} cumplidas · {result.totals.gaps} brechas · {result.totals.exclusions} exclusiones</span></td>
                            </>
                          ),
                          detail: <ExplanationView explanation={result.explanation} totals={result.totals} />,
                        }}
                      </ResultRows>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </Loaded>
  );
}

function ResultRows({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: { row: React.ReactNode; detail: React.ReactNode } }) {
  return (
    <>
      <tr className="is-clickable" onClick={onToggle}>
        {children.row}
        <td className="is-right"><span className="cs-link">{open ? "Ocultar" : "Ver explicación"}</span></td>
      </tr>
      {open && <tr><td colSpan={6} style={{ background: "#fbfcff" }}>{children.detail}</td></tr>}
    </>
  );
}
