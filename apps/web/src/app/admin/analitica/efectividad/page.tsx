"use client";

import { useState } from "react";
import { BarList, ColumnChart } from "@/components/admin/charts";
import { Button, DataTable, Empty, Loaded, PageHead, Panel, Stat, Toolbar, useLoad } from "@/components/admin/ui";
import type { Effectiveness, ScoreCohort } from "@/lib/admin/analytics-types";
import { dateTime, day, decimal, integer, month, percent } from "@/lib/admin/format";
import { get, query } from "@/lib/admin/http";

const cohortLabel = (value: string) => (value === "SIN_CREDITO" ? "Sin crédito" : value === "TODOS" ? "Todos" : month(value));
const signed = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${decimal(value, 1)}`);
const rate = (value: number | null) => (value === null ? "—" : percent(value, 1));

export default function EffectivenessPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const effectiveness = useLoad(() => get<Effectiveness>(`/admin/analytics/effectiveness${query({ from, to })}`), [from, to]);
  return (
    <>
      <PageHead
        eyebrow="Analítica"
        title="Efectividad de la intervención"
        description="Qué pasa con el puntaje, el pago de las cuotas y el arquetipo de las personas a lo largo de su ruta. Es un análisis descriptivo: no prueba causalidad ni anticipa resultados."
      />
      <Panel>
        <Toolbar>
          <label>Cosecha desde<input type="month" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Cosecha hasta<input type="month" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          {(from || to) && <Button variant="quiet" onClick={() => { setFrom(""); setTo(""); }}>Limpiar</Button>}
        </Toolbar>
      </Panel>
      <Loaded loader={effectiveness} label="Calculando efectividad…">
        {(data) => {
          const overall = data.score.overall;
          const withBoth = data.score.cohorts.filter((cohort) => cohort.averageInitial !== null || cohort.averageFinal !== null);
          const stability = data.archetypeStability;
          const lessonsWithData = data.lessons.buckets.some((bucket) => bucket.installmentsDue > 0);
          return (
            <>
              <p className="cs-note cs-note-warn">{data.note}</p>
              <div className="cs-stats">
                <Stat label="Personas analizadas" value={integer(data.users)} hint={`${integer(overall.withBoth)} con puntaje inicial y final`} />
                <Stat label="Puntaje inicial promedio" value={overall.averageInitial === null ? "—" : decimal(overall.averageInitial, 0)} hint={`${integer(overall.withInitial)} personas con consulta inicial`} />
                <Stat label="Puntaje final promedio" value={overall.averageFinal === null ? "—" : decimal(overall.averageFinal, 0)} hint={`${integer(overall.withFinal)} personas con consulta final`} />
                <Stat label="Cambio promedio" value={signed(overall.averageDelta)} hint={`Mediana ${signed(overall.medianDelta)} puntos`} />
                <Stat label="Estabilidad del arquetipo" value={rate(stability.stabilityRate)} hint={`${integer(stability.stable)} sin cambios de ${integer(stability.usersWithHistory)}`} />
              </div>
              <Panel title="Puntaje inicial frente a puntaje final" description="Promedio por cosecha (mes de originación del crédito). Solo cuentan las consultas completadas a las centrales.">
                {withBoth.length === 0 ? <Empty title="Aún no hay puntajes para comparar">Se necesitan personas con una consulta inicial y una final completadas. Sin proveedor de centrales configurado no hay consultas.</Empty> : (
                  <div className="cs-grid cs-grid-chart">
                    <ColumnChart
                      label="Puntaje promedio inicial y final por cosecha"
                      seriesNames={["Puntaje inicial", "Puntaje final"]}
                      formatY={(value) => decimal(value, 0)}
                      groups={withBoth.map((cohort) => ({ label: cohortLabel(cohort.cohortMonth), values: [cohort.averageInitial, cohort.averageFinal] }))}
                    />
                    <ScoreTable cohorts={[...data.score.cohorts, overall]} />
                  </div>
                )}
              </Panel>
              <div className="cs-grid cs-grid-2">
                <Panel title="Lecciones completadas frente a comportamiento de pago" description="Cuotas pagadas a tiempo según cuántas lecciones completó la persona.">
                  {!lessonsWithData ? <Empty title="Aún no hay cuotas vencidas para comparar">La comparación aparece cuando existan créditos con cuotas ya exigibles.</Empty> : (
                    <div className="cs-stack" style={{ gap: 14 }}>
                      <BarList max={1} format={(value) => percent(value, 1)} items={data.lessons.buckets.map((bucket) => ({ label: bucket.label, value: bucket.onTimeRate, hint: `${bucket.installmentsOnTime} de ${bucket.installmentsDue} cuotas a tiempo` }))} />
                      <div className="cs-table-wrap">
                        <table className="cs-table cs-table-compact">
                          <caption>Lecciones y comportamiento</caption>
                          <thead><tr><th scope="col">Lecciones</th><th scope="col" className="is-right">Personas</th><th scope="col" className="is-right">Créditos</th><th scope="col" className="is-right">Cuotas a tiempo</th><th scope="col" className="is-right">Mora 30+</th></tr></thead>
                          <tbody>{data.lessons.buckets.map((bucket) => <tr key={bucket.key}><td>{bucket.label}</td><td className="is-right">{integer(bucket.users)}</td><td className="is-right">{integer(bucket.loans)}</td><td className="is-right">{rate(bucket.onTimeRate)} <span className="cs-muted">({bucket.installmentsOnTime}/{bucket.installmentsDue})</span></td><td className="is-right">{rate(bucket.ever30Rate)} <span className="cs-muted">({bucket.ever30})</span></td></tr>)}</tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Panel>
                <Panel title="Estabilidad del arquetipo" description="Cuántas personas conservaron su arquetipo y hacia cuál cambiaron las demás.">
                  {stability.usersWithHistory === 0 ? <Empty title="Aún no hay historia de arquetipos">Aparece cuando las personas tienen más de una evaluación de arquetipo.</Empty> : (
                    <div className="cs-stack" style={{ gap: 12 }}>
                      <div className="cs-row cs-small"><strong>{integer(stability.stable)}</strong> estables · <strong>{integer(stability.changed)}</strong> con cambios · {stability.averageChanges === null ? "—" : decimal(stability.averageChanges, 2)} cambios en promedio</div>
                      <DataTable
                        caption="Transiciones de arquetipo"
                        rows={stability.transitions}
                        rowKey={(row) => `${row.from}→${row.to}`}
                        empty={<p className="cs-muted cs-small">Nadie ha cambiado de arquetipo.</p>}
                        columns={[
                          { key: "from", header: "De", cell: (row) => row.from },
                          { key: "to", header: "A", cell: (row) => row.to },
                          { key: "count", header: "Personas", align: "right", cell: (row) => integer(row.count) },
                        ]}
                      />
                    </div>
                  )}
                </Panel>
              </div>
              <p className="cs-muted cs-small">Observación al {day(data.asOf)} · calculado el {dateTime(data.generatedAt)} · {data.analyticsVersion}.</p>
            </>
          );
        }}
      </Loaded>
    </>
  );
}

function ScoreTable({ cohorts }: { cohorts: ScoreCohort[] }) {
  return (
    <div className="cs-table-wrap">
      <table className="cs-table cs-table-compact">
        <caption>Puntaje por cosecha</caption>
        <thead><tr><th scope="col">Cosecha</th><th scope="col" className="is-right">Personas</th><th scope="col" className="is-right">Inicial</th><th scope="col" className="is-right">Final</th><th scope="col" className="is-right">Cambio</th><th scope="col" className="is-right">Subió / igual / bajó</th></tr></thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.cohortMonth} style={cohort.cohortMonth === "TODOS" ? { fontWeight: 700, background: "#f8faff" } : undefined}>
              <td>{cohortLabel(cohort.cohortMonth)}</td>
              <td className="is-right">{integer(cohort.users)}</td>
              <td className="is-right">{cohort.averageInitial === null ? "—" : decimal(cohort.averageInitial, 0)}</td>
              <td className="is-right">{cohort.averageFinal === null ? "—" : decimal(cohort.averageFinal, 0)}</td>
              <td className="is-right">{signed(cohort.averageDelta)}</td>
              <td className="is-right">{cohort.improved} / {cohort.unchanged} / {cohort.declined}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
