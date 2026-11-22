"use client";

import { FlaskConical } from "lucide-react";
import { useMemo, useState } from "react";
import { ExplanationView } from "@/components/admin/matching";
import { Badge, Button, ErrorBox, Field, OptionChecks, Panel, StatusBadge, useAction } from "@/components/admin/ui";
import { points } from "@/lib/admin/format";
import { send } from "@/lib/admin/http";
import { type FactField, type MatchingCatalog, optionLabel, type Rule, type Simulation } from "@/lib/admin/matching-types";

type FactValue = number | string | boolean | string[] | null;

function FactInput({ field, value, onChange }: { field: FactField; value: string | string[]; onChange: (value: string | string[]) => void }) {
  if (field.type === "list") return <OptionChecks options={field.options} values={Array.isArray(value) ? value : []} onChange={onChange} />;
  const text = Array.isArray(value) ? "" : value;
  if (field.type === "boolean") return <select value={text} onChange={(event) => onChange(event.target.value)}><option value="">Sin dato</option><option value="true">Sí</option><option value="false">No</option></select>;
  if (field.type === "number" || field.type === "money") return <input type="number" step="any" placeholder="Sin dato" value={text} onChange={(event) => onChange(event.target.value)} />;
  if (field.options.length > 0) return <select value={text} onChange={(event) => onChange(event.target.value)}><option value="">Sin dato</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  return <input placeholder="Sin dato" value={text} onChange={(event) => onChange(event.target.value)} />;
}

function toFact(field: FactField, value: string | string[] | undefined): FactValue | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  if (value.trim() === "") return undefined;
  if (field.type === "boolean") return value === "true";
  if (field.type === "number" || field.type === "money") { const parsed = Number(value.replace(",", ".")); return Number.isFinite(parsed) ? parsed : undefined; }
  return value.trim();
}

/** Simulador: evalúa la versión contra hechos de prueba. No guarda nada. */
export function PolicySimulator({ versionId, rules, catalog }: { versionId: string; rules: Rule[]; catalog: MatchingCatalog }) {
  const ruleFields = useMemo(() => [...new Set(rules.map((rule) => rule.field))], [rules]);
  const [extra, setExtra] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [result, setResult] = useState<Simulation | null>(null);
  const action = useAction();
  const keys = [...ruleFields, ...extra.filter((key) => !ruleFields.includes(key))];
  const fields = keys.map((key) => catalog.fields.find((item) => item.key === key)).filter((field): field is FactField => Boolean(field));
  const remaining = catalog.fields.filter((field) => !keys.includes(field.key));

  const run = () => action.run(async () => {
    const facts: Record<string, FactValue> = {};
    for (const field of fields) { const fact = toFact(field, values[field.key]); if (fact !== undefined) facts[field.key] = fact; }
    setResult(await send<Simulation>("POST", `/admin/matching/versions/${versionId}/simulate`, { facts }));
  });

  return (
    <Panel title={<span className="cs-row"><FlaskConical size={17} /> Simulador</span>} description="Prueba la versión con hechos de ejemplo antes de enviarla a revisión. Un campo vacío se evalúa como «dato faltante». La simulación no guarda nada.">
      {rules.length === 0 ? <p className="cs-muted">Agrega reglas para poder simular.</p> : (
        <div className="cs-stack" style={{ gap: 14 }}>
          <div className="cs-fields cs-fields-3">
            {fields.map((field) => (
              <Field key={field.key} label={`${field.label}${field.unit && field.unit !== "COP" && field.unit !== "razón" ? ` (${field.unit})` : ""}`} wide={field.type === "list"} group={field.type === "list"}>
                <FactInput field={field} value={values[field.key] ?? (field.type === "list" ? [] : "")} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />
              </Field>
            ))}
          </div>
          <div className="cs-row">
            <Button onClick={() => void run()} disabled={action.busy}>{action.busy ? "Evaluando…" : "Simular"}</Button>
            {remaining.length > 0 && (
              <select aria-label="Agregar otro campo a la simulación" value="" onChange={(event) => { if (event.target.value) setExtra((current) => [...current, event.target.value]); }} style={{ width: "auto" }}>
                <option value="">Agregar otro campo…</option>
                {remaining.map((field) => <option key={field.key} value={field.key}>{field.group} · {field.label}</option>)}
              </select>
            )}
          </div>
          <ErrorBox problem={action.problem} />
          {result && (
            <div className="cs-fieldset">
              <div className="cs-row">
                <StatusBadge value={result.status} />
                <strong style={{ fontSize: "1.05rem" }}>{points(result.fitPercent, 0)} de encaje</strong>
                <Badge tone={result.presentable ? "good" : "neutral"}>{result.presentable ? "Presentable a la entidad" : "No presentable"}</Badge>
                {result.requiresException && <Badge tone="warn">Requiere excepción: {result.exceptionApprovalLevels.map((level) => optionLabel(catalog.exceptionLevels, level)).join(", ")}</Badge>}
              </div>
              <ExplanationView explanation={result.explanation} totals={result.totals} />
              <small className="cs-muted cs-small">Motor {result.engineVersion} · versión {result.version} de la política.</small>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
