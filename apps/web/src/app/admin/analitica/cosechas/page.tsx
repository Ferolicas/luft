"use client";

import { Camera } from "lucide-react";
import { useMemo, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { heatStyle, LineChart } from "@/components/admin/charts";
import { Button, Cell, ConfirmDialog, DataTable, Empty, Loaded, PageHead, Pager, Panel, Stat, Tabs, Toolbar, useLoad } from "@/components/admin/ui";
import { type Cohort, type CohortGroup, type CohortSnapshot, type CohortsResponse, dimensionLabel, GROUP_LABEL } from "@/lib/admin/analytics-types";
import { cop, dateTime, day, integer, month, percent, today } from "@/lib/admin/format";
import { get, type Paged, query, send } from "@/lib/admin/http";

type View = "cohorts" | "snapshots";
type Bucket = "rate30" | "rate60" | "rate90";
const BUCKET_LABEL: Record<Bucket, string> = { rate30: "Mora de 30 días o más", rate60: "Mora de 60 días o más", rate90: "Mora de 90 días o más" };
const cohortKey = (cohort: Cohort) => `${cohort.originationMonth}|${cohort.dimensionValue}`;
const cohortName = (cohort: Cohort, groupBy: CohortGroup) => (groupBy === "month" ? month(cohort.originationMonth) : `${month(cohort.originationMonth)} · ${dimensionLabel(cohort.dimensionValue)}`);
const DEFINITION_TITLE: Record<string, string> = { originationMonth: "Mes de originación", monthsOnBooks: "Meses en libros", daysPastDue: "Días de mora", prepayment: "Prepago", capitalPrepayment: "Abono a capital", default: "Incumplimiento", writeOff: "Castigo", balance: "Saldo" };
const rate = (value: number | null) => (value === null ? "—" : percent(value, 1));

export default function CohortsPage() {
  const { notify } = useConsole();
  const [view, setView] = useState<View>("cohorts");
  const [groupBy, setGroupBy] = useState<CohortGroup>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [asOf, setAsOf] = useState("");
  const [bucket, setBucket] = useState<Bucket>("rate30");
  const [selected, setSelected] = useState<string | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [definitions, setDefinitions] = useState(false);
  const cohorts = useLoad(() => get<CohortsResponse>(`/admin/analytics/cohorts${query({ groupBy, from, to, asOf })}`), [groupBy, from, to, asOf]);

  return (
    <>
      <PageHead
        eyebrow="Analítica"
        title="Cosechas de cartera"
        description="Cada cosecha agrupa los créditos originados en un mes y sigue su comportamiento en el tiempo: cuotas a tiempo, mora 30/60/90, incumplimiento y castigo."
        actions={<Button onClick={() => setFreezing(true)}><Camera size={16} /> Congelar corte</Button>}
      />
      <Tabs<View> value={view} onChange={setView} items={[{ key: "cohorts", label: "Cosechas en vivo" }, { key: "snapshots", label: "Cortes congelados" }]} />
      {view === "cohorts" ? (
        <>
          <Panel>
            <Toolbar>
              <label>Agrupar por<select value={groupBy} onChange={(event) => { setGroupBy(event.target.value as CohortGroup); setSelected(null); }}>{(Object.keys(GROUP_LABEL) as CohortGroup[]).map((key) => <option key={key} value={key}>{GROUP_LABEL[key]}</option>)}</select></label>
              <label>Originación desde<input type="month" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
              <label>Originación hasta<input type="month" value={to} onChange={(event) => setTo(event.target.value)} /></label>
              <label>Fecha de observación<input type="date" value={asOf} max={today()} onChange={(event) => setAsOf(event.target.value)} /></label>
              {(from || to || asOf) && <Button variant="quiet" onClick={() => { setFrom(""); setTo(""); setAsOf(""); }}>Limpiar</Button>}
              <span className="cs-spacer" />
              <Button variant="ghost" onClick={() => setDefinitions(!definitions)}>{definitions ? "Ocultar definiciones" : "Ver definiciones"}</Button>
            </Toolbar>
          </Panel>
          <Loaded loader={cohorts} label="Calculando cosechas…">
            {(data) => <CohortsView data={data} bucket={bucket} setBucket={setBucket} selected={selected} setSelected={setSelected} showDefinitions={definitions} />}
          </Loaded>
        </>
      ) : <Snapshots />}
      {freezing && (
        <ConfirmDialog
          title="Congelar el corte de cosechas"
          confirmLabel="Congelar corte"
          onClose={() => setFreezing(false)}
          onConfirm={async () => {
            const result = await send<{ asOf: string; groupBy: CohortGroup; saved: number }>("POST", "/admin/analytics/cohorts/snapshots", { groupBy, asOf: asOf || undefined });
            notify(result.saved > 0 ? `Corte al ${day(result.asOf)} congelado: ${result.saved} ${result.saved === 1 ? "cosecha guardada" : "cosechas guardadas"}.` : `No hay cosechas para congelar al ${day(result.asOf)}.`);
            setView("snapshots");
          }}
        >
          <p>Se guardará una copia inmutable de las cosechas agrupadas por <strong>{GROUP_LABEL[groupBy].toLowerCase()}</strong> con fecha de observación <strong>{asOf ? day(asOf) : "de hoy"}</strong>. Sirve para comparar después contra una foto que ya no cambia.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function CohortsView({ data, bucket, setBucket, selected, setSelected, showDefinitions }: { data: CohortsResponse; bucket: Bucket; setBucket: (bucket: Bucket) => void; selected: string | null; setSelected: (key: string | null) => void; showDefinitions: boolean }) {
  const totals = data.totals;
  const maxMob = useMemo(() => Math.max(0, ...data.cohorts.flatMap((cohort) => cohort.monthsOnBooks.map((point) => point.mob))), [data.cohorts]);
  const maxRate = useMemo(() => Math.max(0, ...data.cohorts.flatMap((cohort) => cohort.monthsOnBooks.map((point) => point[bucket] ?? 0))), [data.cohorts, bucket]);
  const mobs = Array.from({ length: maxMob + 1 }, (_, index) => index).filter((mob) => data.cohorts.some((cohort) => cohort.monthsOnBooks.some((point) => point.mob === mob)));
  const active = data.cohorts.find((cohort) => cohortKey(cohort) === selected) ?? data.cohorts.find((cohort) => cohort.monthsOnBooks.length > 0) ?? data.cohorts[0] ?? null;
  const unavailable = data.groupBy !== "month" && !data.availability[data.groupBy];

  return (
    <>
      {showDefinitions && (
        <Panel title="Definiciones" description={`Versión del cálculo: ${data.analyticsVersion}.`}>
          <dl className="cs-facts cs-facts-2">{Object.entries(data.definitions).map(([key, text]) => <div key={key}><dt>{DEFINITION_TITLE[key] ?? key}</dt><dd style={{ fontWeight: 500 }}>{text}</dd></div>)}</dl>
        </Panel>
      )}
      <div className="cs-stats">
        <Stat label="Créditos originados" value={integer(totals.loans)} hint={`${integer(totals.borrowers)} personas · ${cop(totals.originatedCOP)}`} />
        <Stat label="Saldo de capital" value={cop(totals.outstandingCOP)} hint={`${integer(totals.activeLoans)} vigentes · ${integer(totals.closedLoans)} cerrados`} />
        <Stat label="Cuotas pagadas a tiempo" value={rate(totals.installments.onTimeRate)} hint={`${integer(totals.installments.paidOnTime)} de ${integer(totals.installments.due)} vencidas`} tone={totals.installments.onTimeRate !== null && totals.installments.onTimeRate >= 0.9 ? "good" : undefined} />
        <Stat label="Alguna vez en mora 30+" value={rate(totals.delinquency.everRate30)} hint={`${integer(totals.delinquency.ever30)} créditos · hoy ${integer(totals.delinquency.current30)}`} tone={totals.delinquency.ever30 > 0 ? "warn" : undefined} />
        <Stat label="Incumplidos y castigados" value={integer(totals.defaultedLoans + totals.writtenOffLoans)} hint={`${integer(totals.defaultedLoans)} en mora · ${integer(totals.writtenOffLoans)} castigados (${cop(totals.writtenOffCOP)})`} tone={totals.defaultedLoans + totals.writtenOffLoans > 0 ? "bad" : undefined} />
      </div>
      {unavailable && <p className="cs-note cs-note-warn">Todavía no hay datos de «{GROUP_LABEL[data.groupBy].toLowerCase()}» para los créditos originados: las cosechas aparecen bajo «Sin dato».</p>}
      {data.cohorts.length === 0 ? (
        <Panel><Empty title="Aún no hay cosechas">Las cosechas aparecen cuando existen créditos desembolsados{data.from || data.to ? " en el rango elegido" : ""}. Observación al {day(data.asOf)}.</Empty></Panel>
      ) : (
        <>
          <Panel flush title="Cosechas" description={`Observación al ${day(data.asOf)}. Haz clic en una cosecha para ver su curva.`}>
            <DataTable
              caption="Cosechas"
              rows={data.cohorts}
              rowKey={cohortKey}
              selectedKey={active ? cohortKey(active) : null}
              onRowClick={(row) => setSelected(cohortKey(row))}
              columns={[
                { key: "cohort", header: "Cosecha", cell: (row) => <Cell main={month(row.originationMonth)} sub={data.groupBy === "month" ? undefined : dimensionLabel(row.dimensionValue)} /> },
                { key: "loans", header: "Créditos", align: "right", cell: (row) => integer(row.loans) },
                { key: "originated", header: "Originado", align: "right", cell: (row) => cop(row.originatedCOP) },
                { key: "balance", header: "Saldo", align: "right", cell: (row) => cop(row.outstandingCOP) },
                { key: "ontime", header: "Cuotas a tiempo", align: "right", cell: (row) => <Cell main={rate(row.installments.onTimeRate)} sub={`${row.installments.paidOnTime}/${row.installments.due}`} /> },
                { key: "m30", header: "Mora 30+", align: "right", cell: (row) => <Cell main={rate(row.delinquency.everRate30)} sub={`hoy ${row.delinquency.current30}`} /> },
                { key: "m60", header: "Mora 60+", align: "right", cell: (row) => <Cell main={rate(row.delinquency.everRate60)} sub={`hoy ${row.delinquency.current60}`} /> },
                { key: "m90", header: "Mora 90+", align: "right", cell: (row) => <Cell main={rate(row.delinquency.everRate90)} sub={`hoy ${row.delinquency.current90}`} /> },
                { key: "prepaid", header: "Prepagados", align: "right", cell: (row) => <Cell main={integer(row.prepaidLoans)} sub={row.capitalPrepayments > 0 ? `${row.capitalPrepayments} abonos` : undefined} /> },
                { key: "defaulted", header: "Incumplidos", align: "right", cell: (row) => integer(row.defaultedLoans) },
                { key: "writeoff", header: "Castigados", align: "right", cell: (row) => <Cell main={integer(row.writtenOffLoans)} sub={row.writtenOffCOP > 0 ? cop(row.writtenOffCOP) : undefined} /> },
              ]}
            />
          </Panel>
          <Panel
            flush
            title="Matriz de cosechas por meses en libros"
            description={`${BUCKET_LABEL[bucket]} sobre los créditos de la cosecha, al cierre de cada mes en libros. Un tono más oscuro es una tasa más alta.`}
            actions={<Tabs<Bucket> value={bucket} onChange={setBucket} items={[{ key: "rate30", label: "30+" }, { key: "rate60", label: "60+" }, { key: "rate90", label: "90+" }]} />}
          >
            {mobs.length === 0 ? <Empty title="Aún no hay meses en libros">La matriz se llena al cierre del primer mes posterior a la originación.</Empty> : (
              <div className="cs-table-wrap">
                <table className="cs-table cs-table-compact">
                  <caption>Matriz de cosechas</caption>
                  <thead><tr><th scope="col">Cosecha</th><th scope="col" className="is-right">Créditos</th>{mobs.map((mob) => <th key={mob} scope="col" className="is-center">Mes {mob}</th>)}</tr></thead>
                  <tbody>
                    {data.cohorts.map((cohort) => (
                      <tr key={cohortKey(cohort)}>
                        <td><strong>{cohortName(cohort, data.groupBy)}</strong></td>
                        <td className="is-right">{integer(cohort.loans)}</td>
                        {mobs.map((mob) => {
                          const point = cohort.monthsOnBooks.find((item) => item.mob === mob);
                          const value = point ? point[bucket] : null;
                          return <td key={mob} className="is-center" style={heatStyle(point ? (value ?? 0) : null, maxRate)} title={point ? `Observado el ${day(point.observedOn)}: ${point.loans} créditos, saldo ${cop(point.balanceCOP)}` : "Mes aún no transcurrido"}>{point ? rate(value) : "·"}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {active && (
            <Panel title={`Curva de mora · cosecha ${cohortName(active, data.groupBy)}`} description="Porcentaje de créditos de la cosecha con mora de 30, 60 y 90 días o más, por mes en libros.">
              {active.monthsOnBooks.length === 0 ? <Empty title="Esta cosecha aún no cumple su primer mes en libros" /> : (
                <div className="cs-grid cs-grid-side">
                  <LineChart
                    label={`Curva de mora de la cosecha ${cohortName(active, data.groupBy)}`}
                    xLabel="Mes en libros"
                    formatX={(x) => String(x)}
                    formatY={(y) => percent(y, 1)}
                    series={[
                      { name: "Mora 30+", points: active.monthsOnBooks.map((point) => ({ x: point.mob, y: point.rate30 })) },
                      { name: "Mora 60+", points: active.monthsOnBooks.map((point) => ({ x: point.mob, y: point.rate60 })) },
                      { name: "Mora 90+", points: active.monthsOnBooks.map((point) => ({ x: point.mob, y: point.rate90 })) },
                    ]}
                  />
                  <div className="cs-table-wrap">
                    <table className="cs-table cs-table-compact">
                      <caption>Meses en libros de la cosecha</caption>
                      <thead><tr><th scope="col">Mes</th><th scope="col">Observado</th><th scope="col" className="is-right">30+</th><th scope="col" className="is-right">60+</th><th scope="col" className="is-right">90+</th><th scope="col" className="is-right">Saldo en riesgo</th></tr></thead>
                      <tbody>
                        {active.monthsOnBooks.map((point) => (
                          <tr key={point.mob}><td>{point.mob}</td><td>{day(point.observedOn)}</td><td className="is-right">{rate(point.rate30)}</td><td className="is-right">{rate(point.rate60)}</td><td className="is-right">{rate(point.rate90)}</td><td className="is-right">{rate(point.portfolioAtRisk30)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
      <p className="cs-muted cs-small">Calculado el {dateTime(data.generatedAt)} · {data.analyticsVersion}.</p>
    </>
  );
}

function Snapshots() {
  const [page, setPage] = useState(1);
  const [groupBy, setGroupBy] = useState("");
  const [originationMonth, setOriginationMonth] = useState("");
  const snapshots = useLoad(() => get<Paged<CohortSnapshot>>(`/admin/analytics/cohorts/snapshots${query({ page, groupBy, originationMonth })}`), [page, groupBy, originationMonth]);
  return (
    <Panel flush title="Cortes congelados" description="Fotos inmutables de las cosechas en una fecha de observación.">
      <Toolbar>
        <label>Agrupación<select value={groupBy} onChange={(event) => { setGroupBy(event.target.value); setPage(1); }}><option value="">Todas</option>{(Object.keys(GROUP_LABEL) as CohortGroup[]).map((key) => <option key={key} value={key}>{GROUP_LABEL[key]}</option>)}</select></label>
        <label>Mes de originación<input type="month" value={originationMonth} onChange={(event) => { setOriginationMonth(event.target.value); setPage(1); }} /></label>
      </Toolbar>
      <Loaded loader={snapshots} label="Cargando cortes…">
        {(data) => (
          <>
            <DataTable
              caption="Cortes congelados"
              rows={data.items}
              rowKey={(row) => row.id}
              empty={<Empty title="Aún no hay cortes congelados">Usa «Congelar corte» para guardar la foto de las cosechas de hoy o de una fecha de observación.</Empty>}
              columns={[
                { key: "asOf", header: "Fecha de observación", cell: (row) => <Cell main={day(row.asOf)} sub={`Congelado ${dateTime(row.createdAt)}`} /> },
                { key: "group", header: "Agrupación", cell: (row) => <Cell main={GROUP_LABEL[row.groupBy]} sub={row.groupBy === "month" ? undefined : dimensionLabel(row.dimensionValue)} /> },
                { key: "cohort", header: "Cosecha", cell: (row) => month(row.originationMonth) },
                { key: "loans", header: "Créditos", align: "right", cell: (row) => integer(row.metrics.loans) },
                { key: "originated", header: "Originado", align: "right", cell: (row) => cop(row.metrics.originatedCOP) },
                { key: "balance", header: "Saldo", align: "right", cell: (row) => cop(row.metrics.outstandingCOP) },
                { key: "ontime", header: "Cuotas a tiempo", align: "right", cell: (row) => rate(row.metrics.installments?.onTimeRate ?? null) },
                { key: "m30", header: "Mora 30+", align: "right", cell: (row) => rate(row.metrics.delinquency?.everRate30 ?? null) },
                { key: "m60", header: "Mora 60+", align: "right", cell: (row) => rate(row.metrics.delinquency?.everRate60 ?? null) },
                { key: "m90", header: "Mora 90+", align: "right", cell: (row) => rate(row.metrics.delinquency?.everRate90 ?? null) },
                { key: "version", header: "Cálculo", cell: (row) => <span className="cs-mono">{row.analyticsVersion}</span> },
              ]}
            />
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="cortes" />
          </>
        )}
      </Loaded>
    </Panel>
  );
}
