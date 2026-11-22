"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Check, ErrorBox, Field, FormActions, Modal, OptionChecks, useAction } from "@/components/admin/ui";
import { cop } from "@/lib/admin/format";
import type { FactField, MatchingCatalog, Rule, RuleInput, RuleValue, ValueShape } from "@/lib/admin/matching-types";

const numeric = (field: FactField | undefined) => field?.type === "number" || field?.type === "money";
const AVAILABILITY_NOTE: Record<string, string> = {
  DECLARADO: "Este dato lo declara la persona. Si no lo ha declarado, la regla queda como «dato faltante».",
  EXTENSION: "Este dato aún no tiene fuente en la plataforma: la regla quedará como «dato faltante» hasta que exista.",
};

/** Texto de los campos de valor según la forma que exige el operador. */
interface ValueDraft { scalar: string; min: string; max: string; list: string[]; listText: string }

function draftFrom(value: RuleValue | undefined, shape: ValueShape, field: FactField | undefined): ValueDraft {
  const draft: ValueDraft = { scalar: "", min: "", max: "", list: [], listText: "" };
  if (value === undefined || value === null) return draft;
  if (shape === "range" && Array.isArray(value)) return { ...draft, min: String(value[0] ?? ""), max: String(value[1] ?? "") };
  if (shape === "list" && Array.isArray(value)) return field && field.options.length > 0 ? { ...draft, list: value.map(String) } : { ...draft, listText: value.join(", ") };
  if (!Array.isArray(value)) return { ...draft, scalar: String(value) };
  return draft;
}

function parseValue(draft: ValueDraft, shape: ValueShape, field: FactField | undefined): { value: RuleValue; error: string | null } {
  const toNumber = (text: string) => { const parsed = Number(text.trim().replace(",", ".")); return text.trim() !== "" && Number.isFinite(parsed) ? parsed : null; };
  if (shape === "range") {
    const min = toNumber(draft.min); const max = toNumber(draft.max);
    if (min === null || max === null) return { value: null, error: "Escribe el mínimo y el máximo." };
    if (min > max) return { value: null, error: "El mínimo no puede superar el máximo." };
    return { value: [min, max], error: null };
  }
  if (shape === "list") {
    if (field && field.options.length > 0) return draft.list.length > 0 ? { value: draft.list, error: null } : { value: null, error: "Elige al menos una opción." };
    const items = draft.listText.split(",").map((item) => item.trim()).filter(Boolean);
    if (items.length === 0) return { value: null, error: "Escribe al menos un valor (separados por coma)." };
    if (items.length > 50) return { value: null, error: "Máximo 50 valores." };
    if (numeric(field)) {
      const numbers = items.map(toNumber);
      return numbers.some((item) => item === null) ? { value: null, error: "Todos los valores deben ser números." } : { value: numbers as number[], error: null };
    }
    return { value: items, error: null };
  }
  if (field?.type === "boolean") return draft.scalar === "true" || draft.scalar === "false" ? { value: draft.scalar === "true", error: null } : { value: null, error: "Elige Sí o No." };
  if (numeric(field)) { const parsed = toNumber(draft.scalar); return parsed === null ? { value: null, error: "Escribe un número." } : { value: parsed, error: null }; }
  return draft.scalar.trim() ? { value: draft.scalar.trim(), error: null } : { value: null, error: "Escribe o elige un valor." };
}

/**
 * Formulario de una regla de política, parametrizado por `GET /admin/matching/catalog`:
 * el campo define qué operadores aplican y el operador define la forma del valor.
 */
export function PolicyRuleForm({ catalog, rule, onSubmit, onClose }: { catalog: MatchingCatalog; rule: Rule | null; onSubmit: (input: RuleInput) => Promise<void>; onClose: () => void }) {
  const firstField = catalog.fields[0];
  const [fieldKey, setFieldKey] = useState(rule?.field ?? firstField?.key ?? "");
  const field = catalog.fields.find((item) => item.key === fieldKey);
  const [operator, setOperator] = useState(rule?.operator ?? field?.operators[0] ?? "eq");
  const shapeOf = (key: string): ValueShape => catalog.operators.find((item) => item.key === key)?.valueShape ?? "scalar";
  const shape = shapeOf(operator);
  const [draft, setDraft] = useState<ValueDraft>(() => draftFrom(rule?.value, shapeOf(rule?.operator ?? field?.operators[0] ?? "eq"), field));
  const [kind, setKind] = useState<RuleInput["kind"]>(rule?.kind ?? "REQUISITO");
  const [weight, setWeight] = useState(String(rule?.weight ?? 10));
  const [text, setText] = useState(rule?.label ?? "");
  const [internal, setInternal] = useState(rule?.internal ?? false);
  const [exceptionAllowed, setExceptionAllowed] = useState(rule?.exceptionAllowed ?? false);
  const [exceptionLevel, setExceptionLevel] = useState(rule?.exceptionApprovalLevel ?? catalog.exceptionLevels[0]?.key ?? "RISK");
  const [touched, setTouched] = useState(false);
  const action = useAction();

  const groups = useMemo(() => {
    const map = new Map<string, FactField[]>();
    for (const item of catalog.fields) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return [...map.entries()];
  }, [catalog.fields]);
  const parsed = parseValue(draft, shape, field);
  const unit = field?.unit && field.unit !== "COP" ? field.unit : null;

  const changeField = (key: string) => {
    const next = catalog.fields.find((item) => item.key === key);
    setFieldKey(key);
    const nextOperator = next?.operators.includes(operator) ? operator : (next?.operators[0] ?? "eq");
    setOperator(nextOperator);
    setDraft(draftFrom(undefined, shapeOf(nextOperator), next));
    setTouched(false);
  };
  const changeOperator = (key: string) => {
    if (shapeOf(key) !== shape) setDraft(draftFrom(undefined, shapeOf(key), field));
    setOperator(key);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (parsed.error) return;
    const input: RuleInput = { field: fieldKey, operator, value: parsed.value, kind, weight: Number(weight) || 1, internal, exceptionAllowed: kind === "REQUISITO" && exceptionAllowed };
    if (text.trim()) input.label = text.trim();
    if (input.exceptionAllowed) input.exceptionApprovalLevel = exceptionLevel;
    await action.run(() => onSubmit(input));
  };

  const numberInput = (value: string, onChange: (value: string) => void, placeholder: string, aria: string) => (
    <div className={unit ? "cs-input-unit" : undefined}>
      <input type="number" step="any" aria-label={aria} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      {unit && <span>{unit}</span>}
    </div>
  );
  const moneyHint = (value: string) => (field?.type === "money" && Number(value) > 0 ? cop(Number(value)) : null);

  return (
    <Modal title={rule ? "Editar regla" : "Nueva regla"} description="Campo, operador y valor salen del catálogo del motor: nada queda fijo en la interfaz." size="lg" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields cs-fields-3">
          <Field label="Campo" required hint={field?.description}>
            <select value={fieldKey} onChange={(event) => changeField(event.target.value)}>
              {groups.map(([group, fields]) => <optgroup key={group} label={group}>{fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>)}
            </select>
          </Field>
          <Field label="Operador" required hint="Solo los operadores válidos para el campo.">
            <select value={operator} onChange={(event) => changeOperator(event.target.value)}>
              {(field?.operators ?? []).map((key) => <option key={key} value={key}>{catalog.operators.find((item) => item.key === key)?.label ?? key}</option>)}
            </select>
          </Field>
          <Field label="Valor" required group error={touched ? parsed.error : null} hint={shape === "range" ? (moneyHint(draft.min) && moneyHint(draft.max) ? `${moneyHint(draft.min)} a ${moneyHint(draft.max)}` : "Mínimo y máximo, incluidos.") : shape === "list" ? (field && field.options.length > 0 ? "Elige una o varias opciones." : "Valores separados por coma.") : (moneyHint(draft.scalar) ?? (field?.type === "text" ? "Se compara sin tildes ni mayúsculas." : undefined))}>
            {shape === "range" ? (
              <div className="cs-range">{numberInput(draft.min, (value) => setDraft({ ...draft, min: value }), "Mínimo", "Valor mínimo")}<span>a</span>{numberInput(draft.max, (value) => setDraft({ ...draft, max: value }), "Máximo", "Valor máximo")}</div>
            ) : shape === "list" ? (
              field && field.options.length > 0
                ? <OptionChecks options={field.options} values={draft.list} onChange={(values) => setDraft({ ...draft, list: values })} />
                : <input aria-label="Valores" placeholder={numeric(field) ? "Ej.: 1, 2, 3" : "Ej.: Cali, Palmira"} value={draft.listText} onChange={(event) => setDraft({ ...draft, listText: event.target.value })} />
            ) : field?.type === "boolean" ? (
              <select aria-label="Valor" value={draft.scalar} onChange={(event) => setDraft({ ...draft, scalar: event.target.value })}><option value="">Elige…</option><option value="true">Sí</option><option value="false">No</option></select>
            ) : numeric(field) ? numberInput(draft.scalar, (value) => setDraft({ ...draft, scalar: value }), "Número", "Valor") : field && field.options.length > 0 ? (
              <select aria-label="Valor" value={draft.scalar} onChange={(event) => setDraft({ ...draft, scalar: event.target.value })}><option value="">Elige…</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            ) : <input aria-label="Valor" placeholder="Valor" value={draft.scalar} onChange={(event) => setDraft({ ...draft, scalar: event.target.value })} />}
          </Field>
        </div>
        {field && AVAILABILITY_NOTE[field.availability] && <p className="cs-note cs-note-warn">{AVAILABILITY_NOTE[field.availability]}</p>}
        <div className="cs-fields cs-fields-3">
          <Field label="Tipo de regla" required hint={kind === "REQUISITO" ? "Si no se cumple, es una brecha que bloquea." : kind === "EXCLUSION" ? "Describe la causal de rechazo: si se cumple, excluye." : "Suma su peso al encaje; nunca bloquea."}>
            <select value={kind} onChange={(event) => setKind(event.target.value as RuleInput["kind"])}>{catalog.ruleKinds.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
          </Field>
          <Field label="Peso" required hint="De 1 a 100. Pondera el porcentaje de encaje."><input type="number" min={1} max={100} step={1} value={weight} onChange={(event) => setWeight(event.target.value)} required /></Field>
          <Field label="Etiqueta" hint="Lo que verá la persona. Vacía: se genera a partir de la condición."><input value={text} onChange={(event) => setText(event.target.value)} minLength={3} maxLength={200} /></Field>
        </div>
        <div className="cs-rule-flags">
          <Check label="Regla interna" hint="La persona solo verá «Criterio interno de la entidad»." checked={internal} onChange={setInternal} />
          {kind === "REQUISITO" && <Check label="Admite excepción" hint="Un incumplimiento puede presentarse con aprobación." checked={exceptionAllowed} onChange={setExceptionAllowed} />}
          {kind === "REQUISITO" && exceptionAllowed && (
            <label className="cs-row cs-small" style={{ fontWeight: 700 }}>
              Aprueba la excepción
              <select value={exceptionLevel} onChange={(event) => setExceptionLevel(event.target.value)}>{catalog.exceptionLevels.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
            </label>
          )}
        </div>
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel={rule ? "Guardar regla" : "Agregar regla"} />
      </form>
    </Modal>
  );
}
