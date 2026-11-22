"use client";

import { Play, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { useMatchingCatalog } from "@/components/admin/matching";
import { PolicyRuleForm } from "@/components/admin/policy-rule-form";
import { Badge, Button, Cell, DataTable, Empty, ErrorBox, Field, FormActions, Loaded, Modal, PageHead, Pager, Panel, useAction, useLoad } from "@/components/admin/ui";
import type { Backtest, BacktestRow } from "@/lib/admin/analytics-types";
import { dateTime, integer, percent, today } from "@/lib/admin/format";
import { get, type Paged, send } from "@/lib/admin/http";
import { label } from "@/lib/admin/labels";
import type { MatchingCatalog, Product, RuleInput, Version } from "@/lib/admin/matching-types";

export default function BacktestsPage() {
  const router = useRouter();
  const { notify } = useConsole();
  const { catalog, problem } = useMatchingCatalog();
  const [page, setPage] = useState(1);
  const [launching, setLaunching] = useState(false);
  const backtests = useLoad(() => get<Paged<BacktestRow>>(`/admin/analytics/backtests?page=${page}`), [page]);
  // El catálogo de políticas lo leen riesgo, comercial y superadministración; finanzas solo consulta resultados.
  const cannotLaunch = problem !== null && (problem.status === 401 || problem.status === 403);

  return (
    <>
      <PageHead
        eyebrow="Analítica"
        title="Backtesting de políticas"
        description="Vuelve a evaluar una política (o un conjunto de reglas) contra las instantáneas históricas de matching y la compara con lo que realmente pasó: decisiones de las entidades y mora de los créditos."
        actions={catalog && <Button onClick={() => setLaunching(true)}><Play size={16} /> Lanzar backtest</Button>}
      />
      {cannotLaunch ? <p className="cs-note">Para lanzar un backtest se necesita leer las políticas, que corresponde al rol de riesgo. Con tu rol puedes consultar los resultados.</p> : <ErrorBox problem={problem} />}
      <Panel flush>
        <Loaded loader={backtests} label="Cargando backtests…">
          {(data) => (
            <>
              <DataTable
                caption="Backtests"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/analitica/backtesting/${row.id}`)}
                empty={<Empty title="Aún no hay backtests">Lanza el primero sobre una versión de política. Solo hay instantáneas de quienes ya ejecutaron matching.</Empty>}
                columns={[
                  { key: "label", header: "Backtest", cell: (row) => <Cell main={row.label ?? "Sin nombre"} sub={dateTime(row.createdAt)} /> },
                  { key: "kind", header: "Base", cell: (row) => <Badge tone={row.kind === "POLICY_VERSION" ? "info" : "neutral"}>{label(row.kind)}</Badge> },
                  { key: "snapshots", header: "Instantáneas", align: "right", cell: (row) => integer(row.snapshotsEvaluated) },
                  { key: "eligible", header: "Elegibles", align: "right", cell: (row) => (row.eligibleRate === null ? "—" : percent(row.eligibleRate, 1)) },
                  { key: "predicted", header: "Predicción", cell: (row) => <span className="cs-small">{row.predicted.ELEGIBLE} elegibles · {row.predicted.CON_BRECHAS} con brechas · {row.predicted.EXCLUIDO} excluidos</span> },
                  { key: "engine", header: "Motor", cell: (row) => <span className="cs-mono">{row.engineVersion}</span> },
                  { key: "by", header: "Lanzado por", cell: (row) => row.createdByName ?? "—" },
                  { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Ver resultado</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="backtests" />
            </>
          )}
        </Loaded>
      </Panel>
      {launching && catalog && <LaunchForm catalog={catalog} onClose={() => setLaunching(false)} onDone={(backtest) => { notify(`Backtest listo: ${backtest.snapshotsEvaluated} instantáneas evaluadas.`); router.push(`/admin/analitica/backtesting/${backtest.id}`); }} />}
    </>
  );
}

const describe = (rule: RuleInput, catalog: MatchingCatalog) => {
  const field = catalog.fields.find((item) => item.key === rule.field);
  const operator = catalog.operators.find((item) => item.key === rule.operator)?.label ?? rule.operator;
  const show = (value: unknown) => field?.options.find((option) => option.value === String(value))?.label ?? (typeof value === "boolean" ? (value ? "Sí" : "No") : String(value));
  const value = Array.isArray(rule.value) ? rule.value.map(show).join(rule.operator === "between" ? " y " : ", ") : show(rule.value);
  return `${field?.label ?? rule.field} ${operator} ${value}`;
};

function LaunchForm({ catalog, onClose, onDone }: { catalog: MatchingCatalog; onClose: () => void; onDone: (backtest: Backtest) => void }) {
  const [mode, setMode] = useState<"version" | "rules">("version");
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [rules, setRules] = useState<RuleInput[]>([]);
  const [addingRule, setAddingRule] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [snapshots, setSnapshots] = useState<"LATEST_PER_USER" | "ALL">("LATEST_PER_USER");
  const [delinquencyDays, setDelinquencyDays] = useState(30);
  const [loanWindow, setLoanWindow] = useState<"ANY" | "AFTER_SNAPSHOT">("ANY");
  const products = useLoad(() => get<Paged<Product>>("/admin/matching/products"), []);
  const versions = useLoad(() => (productId ? get<{ items: Version[] }>(`/admin/matching/products/${productId}/versions`) : Promise.resolve({ items: [] })), [productId]);
  const action = useAction();
  const ready = mode === "version" ? Boolean(versionId) : rules.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const body: Record<string, unknown> = { snapshots, delinquencyDays, loanWindow };
    if (name.trim()) body.label = name.trim();
    if (from) body.from = from;
    if (to) body.to = to;
    if (mode === "version") body.policyVersionId = versionId;
    else { body.rules = rules; if (productId) body.productId = productId; }
    await action.run(async () => onDone(await send<Backtest>("POST", "/admin/analytics/backtests", body)));
  };

  return (
    <Modal title="Lanzar backtest" description="Se ejecuta de inmediato sobre las instantáneas guardadas y queda registrado. No cambia ninguna política ni ningún resultado." size="lg" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <Field label="Nombre del backtest" hint="Opcional, mínimo 3 caracteres. Ej.: Ingreso mínimo de 1,5 millones."><input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={160} /></Field>
        <div className="cs-option-checks" role="radiogroup" aria-label="Qué se evalúa">
          <label className={mode === "version" ? "on" : ""}><input type="radio" name="mode" checked={mode === "version"} onChange={() => setMode("version")} /> Una versión de política</label>
          <label className={mode === "rules" ? "on" : ""}><input type="radio" name="mode" checked={mode === "rules"} onChange={() => setMode("rules")} /> Un conjunto de reglas de prueba</label>
        </div>
        <ErrorBox problem={products.problem} />
        <div className="cs-fields">
          <Field label={mode === "version" ? "Producto" : "Comparar contra las decisiones del producto"} required={mode === "version"} hint={mode === "rules" ? "Opcional." : undefined}>
            <select value={productId} onChange={(event) => { setProductId(event.target.value); setVersionId(""); }} required={mode === "version"}>
              <option value="">{mode === "version" ? "Elige un producto…" : "Ninguno"}</option>
              {(products.data?.items ?? []).map((product) => <option key={product.id} value={product.id}>{product.institution.name} · {product.name}</option>)}
            </select>
          </Field>
          {mode === "version" && (
            <Field label="Versión de política" required>
              <select value={versionId} onChange={(event) => setVersionId(event.target.value)} disabled={!productId} required>
                <option value="">{productId ? (versions.loading ? "Cargando…" : "Elige una versión…") : "Elige primero un producto"}</option>
                {(versions.data?.items ?? []).map((version) => <option key={version.id} value={version.id}>Versión {version.version} · {version.statusLabel} · {version.rulesCount} reglas</option>)}
              </select>
            </Field>
          )}
        </div>
        {mode === "rules" && (
          <fieldset className="cs-fieldset">
            <legend>Reglas de prueba</legend>
            {rules.length === 0 ? <p className="cs-rule-hint">Agrega al menos una regla. Se usan los mismos campos y operadores del motor.</p> : rules.map((rule, index) => (
              <div key={`${rule.field}-${index}`} className="cs-row" style={{ justifyContent: "space-between" }}>
                <span><Badge tone={rule.kind === "EXCLUSION" ? "bad" : rule.kind === "PREFERENCIA" ? "info" : "neutral"}>{label(rule.kind)}</Badge> <strong>{rule.label ?? describe(rule, catalog)}</strong> <span className="cs-muted cs-small">· {describe(rule, catalog)} · peso {rule.weight}</span></span>
                <button type="button" className="cs-icon-btn" aria-label={`Quitar regla ${index + 1}`} onClick={() => setRules(rules.filter((_, position) => position !== index))}><Trash2 size={15} /></button>
              </div>
            ))}
            <Button variant="quiet" small onClick={() => setAddingRule(true)} style={{ width: "fit-content" }}><Plus size={14} /> Agregar regla</Button>
          </fieldset>
        )}
        <fieldset className="cs-fieldset">
          <legend>Ventana y criterios</legend>
          <div className="cs-fields cs-fields-3">
            <Field label="Instantáneas desde" hint="Opcional."><input type="date" value={from} max={today()} onChange={(event) => setFrom(event.target.value)} /></Field>
            <Field label="Instantáneas hasta" hint="Opcional."><input type="date" value={to} max={today()} onChange={(event) => setTo(event.target.value)} /></Field>
            <Field label="Instantáneas por persona"><select value={snapshots} onChange={(event) => setSnapshots(event.target.value as "LATEST_PER_USER" | "ALL")}><option value="LATEST_PER_USER">Solo la más reciente</option><option value="ALL">Todas</option></select></Field>
            <Field label="Umbral de mora"><select value={delinquencyDays} onChange={(event) => setDelinquencyDays(Number(event.target.value))}><option value={30}>30 días o más</option><option value={60}>60 días o más</option><option value={90}>90 días o más</option></select></Field>
            <Field label="Créditos que cuentan"><select value={loanWindow} onChange={(event) => setLoanWindow(event.target.value as "ANY" | "AFTER_SNAPSHOT")}><option value="ANY">Cualquier crédito de la persona</option><option value="AFTER_SNAPSHOT">Solo los posteriores a la instantánea</option></select></Field>
          </div>
        </fieldset>
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Lanzar backtest" disabled={!ready} />
      </form>
      {addingRule && <PolicyRuleForm catalog={catalog} rule={null} onClose={() => setAddingRule(false)} onSubmit={async (input) => { setRules([...rules, input]); setAddingRule(false); }} />}
    </Modal>
  );
}
