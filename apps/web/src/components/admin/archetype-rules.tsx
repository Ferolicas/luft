"use client";

import { FolderPlus, Plus, Trash2 } from "lucide-react";
import { type ArchetypeFact, type EditGroup, type EditLeaf, type EditNode, emptyGroup, emptyLeaf, OPERATOR_LABEL, operatorsFor, valueShape } from "@/lib/admin/catalog-types";

const MAX_DEPTH = 3;
const MAX_CHILDREN = 12;

function replace(node: EditNode, id: string, next: EditNode | null): EditNode | null {
  if (node.id === id) return next;
  if (node.kind === "leaf") return node;
  return { ...node, children: node.children.map((child) => replace(child, id, next)).filter((child): child is EditNode => child !== null) };
}

/** Constructor visual de las reglas de un arquetipo: grupos «todas / alguna» con condiciones hecho–operador–valor. */
export function ArchetypeRuleBuilder({ root, onChange, facts, operators, disabled = false }: { root: EditGroup; onChange: (root: EditGroup) => void; facts: ArchetypeFact[]; operators: string[]; disabled?: boolean }) {
  const update = (id: string, next: EditNode | null) => {
    const result = replace(root, id, next);
    if (result && result.kind === "group") onChange(result);
  };
  return <GroupEditor group={root} depth={1} isRoot update={update} facts={facts} operators={operators} disabled={disabled} />;
}

function GroupEditor({ group, depth, isRoot = false, update, facts, operators, disabled }: { group: EditGroup; depth: number; isRoot?: boolean; update: (id: string, next: EditNode | null) => void; facts: ArchetypeFact[]; operators: string[]; disabled: boolean }) {
  const full = group.children.length >= MAX_CHILDREN;
  return (
    <div className="cs-group">
      <div className="cs-group-head">
        <span>{isRoot ? "La persona encaja si cumple" : "Grupo: cumple"}</span>
        <select aria-label="Tipo de grupo" value={group.mode} disabled={disabled} onChange={(event) => update(group.id, { ...group, mode: event.target.value as "all" | "any" })}>
          <option value="all">todas las condiciones</option>
          <option value="any">alguna de las condiciones</option>
        </select>
        <span style={{ flex: 1 }} />
        {!isRoot && !disabled && <button type="button" className="cs-icon-btn" aria-label="Quitar grupo" onClick={() => update(group.id, null)}><Trash2 size={15} /></button>}
      </div>
      {group.children.length === 0 && <p className="cs-rule-hint">{group.mode === "all" ? "Sin condiciones: aplica a cualquier persona de la categoría (úsalo para el arquetipo predeterminado)." : "Agrega al menos una condición."}</p>}
      {group.children.map((child) => (child.kind === "group"
        ? <GroupEditor key={child.id} group={child} depth={depth + 1} update={update} facts={facts} operators={operators} disabled={disabled} />
        : <LeafEditor key={child.id} leaf={child} update={update} facts={facts} operators={operators} disabled={disabled} />))}
      {!disabled && (
        <div className="cs-row">
          <button type="button" className="cs-btn cs-btn-quiet cs-btn-sm" disabled={full} onClick={() => update(group.id, { ...group, children: [...group.children, emptyLeaf(facts[0], operators)] })}><Plus size={14} /> Condición</button>
          {depth < MAX_DEPTH && <button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" disabled={full} onClick={() => update(group.id, { ...group, children: [...group.children, emptyGroup(group.mode === "all" ? "any" : "all")] })}><FolderPlus size={14} /> Grupo anidado</button>}
        </div>
      )}
    </div>
  );
}

function LeafEditor({ leaf, update, facts, operators, disabled }: { leaf: EditLeaf; update: (id: string, next: EditNode | null) => void; facts: ArchetypeFact[]; operators: string[]; disabled: boolean }) {
  const fact = facts.find((item) => item.key === leaf.fact);
  const allowed = operatorsFor(fact, operators);
  const shape = valueShape(leaf.op, fact);
  const set = (changes: Partial<EditLeaf>) => update(leaf.id, { ...leaf, ...changes });
  return (
    <div className="cs-leaf">
      <select aria-label="Hecho" value={leaf.fact} disabled={disabled} onChange={(event) => {
        const next = facts.find((item) => item.key === event.target.value);
        const nextOperators = operatorsFor(next, operators);
        set({ fact: event.target.value, op: nextOperators.includes(leaf.op) ? leaf.op : (nextOperators[0] ?? leaf.op), value: "" });
      }}>
        {!fact && <option value={leaf.fact}>{leaf.fact || "Elige un hecho"}</option>}
        {facts.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <select aria-label="Operador" value={leaf.op} disabled={disabled} onChange={(event) => set({ op: event.target.value })}>
        {!allowed.includes(leaf.op) && <option value={leaf.op}>{OPERATOR_LABEL[leaf.op] ?? leaf.op}</option>}
        {allowed.map((operator) => <option key={operator} value={operator}>{OPERATOR_LABEL[operator] ?? operator}</option>)}
      </select>
      {shape === "none" ? <input aria-label="Valor" value="Sin valor" disabled readOnly />
        : shape === "number" ? <input aria-label="Valor" type="number" step="any" placeholder="Número" value={leaf.value} disabled={disabled} onChange={(event) => set({ value: event.target.value })} />
          : <input aria-label="Valor" placeholder={shape === "list" ? "Valores separados por coma" : "Valor"} value={leaf.value} disabled={disabled} onChange={(event) => set({ value: event.target.value })} />}
      <input aria-label="Etiqueta que verá la persona" placeholder="Etiqueta que verá la persona" value={leaf.label} maxLength={160} disabled={disabled} onChange={(event) => set({ label: event.target.value })} />
      {!disabled ? <button type="button" className="cs-icon-btn" aria-label="Quitar condición" onClick={() => update(leaf.id, null)}><Trash2 size={15} /></button> : <span />}
    </div>
  );
}
