/** Formas reales de `/api/admin/{categories,archetypes,plans}` y utilidades del constructor de reglas de arquetipos. */

export interface CategoryConfig {
  onboarding: { headline: string; steps: string[] };
  modules: string[];
  requiredDocuments: string[];
  messages: { welcome: string; nextStep: string; matching: string };
  projectKinds: string[];
}

export interface AdminCategory {
  id: string;
  code: string;
  brand: string;
  label: string;
  description: string;
  config: CategoryConfig;
  active: boolean;
  position: number;
  archetypes: number;
  routes: number;
  updatedAt: string;
}

export interface RuleLeaf { fact: string; op: string; value?: string | number | boolean | string[]; label: string }
export type RuleNode = RuleLeaf | { all: RuleNode[] } | { any: RuleNode[] };
export type ArchetypeRules = { all: RuleNode[] } | { any: RuleNode[] };

export interface AdminArchetype {
  id: string;
  categoryCode: string;
  code: string;
  name: string;
  description: string;
  rules: ArchetypeRules;
  priority: number;
  version: number;
  isDefault: boolean;
  active: boolean;
  createdAt: string;
}

export interface ArchetypeFact { key: string; label: string; type: "text" | "number" | "boolean" | "list" }

export interface AdminPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  minSeats: number;
  maxSeats: number;
  basePriceCOP: number;
  discountPercent: number;
  pricePerSeatCOP: number;
  active: boolean;
  position: number;
  updatedAt: string;
}

export const DOCUMENT_OPTIONS = [
  { value: "TAX_RETURN", label: "Declaración de renta" },
  { value: "BANK_STATEMENTS", label: "Extractos bancarios" },
  { value: "SOCIAL_SECURITY", label: "Seguridad social" },
  { value: "EMPLOYMENT_CERTIFICATE", label: "Certificado laboral" },
];
export const PROJECT_OPTIONS = [
  { value: "EDUCACION", label: "Educación" },
  { value: "MOVILIDAD", label: "Movilidad" },
  { value: "VIVIENDA", label: "Vivienda" },
  { value: "EMPRENDIMIENTO", label: "Emprendimiento" },
  { value: "OTRO", label: "Otro" },
];

export const OPERATOR_LABEL: Record<string, string> = {
  eq: "es igual a",
  neq: "es distinto de",
  in: "es uno de",
  nin: "no es ninguno de",
  gt: "es mayor que",
  gte: "es mayor o igual a",
  lt: "es menor que",
  lte: "es menor o igual a",
  includes: "incluye",
  includesAny: "incluye alguno de",
  isTrue: "es verdadero",
  isFalse: "es falso",
  exists: "tiene dato",
};

const BY_TYPE: Record<ArchetypeFact["type"], string[]> = {
  text: ["eq", "neq", "in", "nin", "exists"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "exists"],
  boolean: ["isTrue", "isFalse", "exists"],
  list: ["includes", "includesAny", "exists"],
};

/** Operadores con sentido para el tipo del hecho, limitados a los que la API declara. */
export function operatorsFor(fact: ArchetypeFact | undefined, available: string[]) {
  const wanted = fact ? BY_TYPE[fact.type] : available;
  return wanted.filter((operator) => available.includes(operator));
}

export type ValueShape = "none" | "number" | "list" | "text";
export function valueShape(operator: string, fact: ArchetypeFact | undefined): ValueShape {
  if (["isTrue", "isFalse", "exists"].includes(operator)) return "none";
  if (["in", "nin", "includesAny"].includes(operator)) return "list";
  if (["gt", "gte", "lt", "lte"].includes(operator)) return "number";
  return fact?.type === "number" ? "number" : "text";
}

/* ----- Árbol editable ----- */

export interface EditLeaf { id: string; kind: "leaf"; fact: string; op: string; value: string; label: string }
export interface EditGroup { id: string; kind: "group"; mode: "all" | "any"; children: EditNode[] }
export type EditNode = EditLeaf | EditGroup;

let sequence = 0;
export const nextId = () => `n${++sequence}`;

export function toEditable(node: RuleNode): EditNode {
  if ("all" in node) return { id: nextId(), kind: "group", mode: "all", children: node.all.map(toEditable) };
  if ("any" in node) return { id: nextId(), kind: "group", mode: "any", children: node.any.map(toEditable) };
  return { id: nextId(), kind: "leaf", fact: node.fact, op: node.op, label: node.label, value: Array.isArray(node.value) ? node.value.join(", ") : node.value === undefined ? "" : String(node.value) };
}

export const emptyGroup = (mode: "all" | "any" = "any"): EditGroup => ({ id: nextId(), kind: "group", mode, children: [] });
export const emptyLeaf = (fact: ArchetypeFact | undefined, operators: string[]): EditLeaf => ({ id: nextId(), kind: "leaf", fact: fact?.key ?? "", op: operatorsFor(fact, operators)[0] ?? "eq", value: "", label: "" });

/** Convierte el árbol editable al formato de la API y reúne los problemas que impedirían guardarlo. */
export function fromEditable(node: EditNode, facts: ArchetypeFact[], issues: string[]): RuleNode {
  if (node.kind === "group") {
    const children = node.children.map((child) => fromEditable(child, facts, issues));
    if (node.mode === "any" && children.length === 0) issues.push("Un grupo «alguna» necesita al menos una condición.");
    if (children.length > 12) issues.push("Un grupo admite máximo 12 condiciones.");
    return node.mode === "all" ? { all: children } : { any: children };
  }
  const fact = facts.find((item) => item.key === node.fact);
  const name = fact?.label ?? "condición";
  if (!fact) issues.push("Hay una condición sin hecho seleccionado.");
  if (node.label.trim().length < 3) issues.push(`«${name}»: escribe la etiqueta que verá la persona (mínimo 3 caracteres).`);
  const shape = valueShape(node.op, fact);
  const leaf: RuleLeaf = { fact: node.fact, op: node.op, label: node.label.trim() };
  if (shape === "list") {
    const values = node.value.split(",").map((item) => item.trim()).filter(Boolean);
    if (values.length === 0) issues.push(`«${name}»: escribe al menos un valor (separados por coma).`);
    leaf.value = values;
  } else if (shape === "number") {
    const parsed = Number(node.value.replace(",", "."));
    if (node.value.trim() === "" || !Number.isFinite(parsed)) issues.push(`«${name}»: el valor debe ser un número.`);
    leaf.value = parsed;
  } else if (shape === "text") {
    if (!node.value.trim()) issues.push(`«${name}»: escribe el valor a comparar.`);
    leaf.value = node.value.trim();
  }
  return leaf;
}

export function countConditions(node: RuleNode): number {
  if ("all" in node) return node.all.reduce((sum, child) => sum + countConditions(child), 0);
  if ("any" in node) return node.any.reduce((sum, child) => sum + countConditions(child), 0);
  return 1;
}

/** Texto legible de una regla, para tablas e historial. */
export function describeRules(node: RuleNode, facts: ArchetypeFact[]): string {
  if ("all" in node) return node.all.length === 0 ? "Sin condiciones (aplica siempre)" : node.all.map((child) => wrap(child, facts)).join(" Y ");
  if ("any" in node) return node.any.map((child) => wrap(child, facts)).join(" O ");
  const fact = facts.find((item) => item.key === node.fact)?.label ?? node.fact;
  const value = node.value === undefined ? "" : ` ${Array.isArray(node.value) ? node.value.join(", ") : String(node.value)}`;
  return `${fact} ${OPERATOR_LABEL[node.op] ?? node.op}${value}`;
}
const wrap = (node: RuleNode, facts: ArchetypeFact[]) => ("fact" in node ? describeRules(node, facts) : `(${describeRules(node, facts)})`);
