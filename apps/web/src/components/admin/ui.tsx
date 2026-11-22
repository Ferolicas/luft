"use client";

import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Inbox, Plus, X } from "lucide-react";
import Link from "next/link";
import { type DependencyList, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Spinner } from "@/components/status";
import { integer } from "@/lib/admin/format";
import { type Problem, problemOf } from "@/lib/admin/http";
import { label as labelOf, type Tone, toneOf } from "@/lib/admin/labels";

/* ---------- Datos ---------- */

export interface Loader<T> {
  data: T | null;
  problem: Problem | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T | null) => void;
}

/** Carga datos al montar y cuando cambian las dependencias; descarta respuestas viejas. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): Loader<T> {
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const latest = useRef(load);
  useEffect(() => { latest.current = load; });
  // Las dependencias son valores simples (página, filtros, ids): su texto las identifica.
  const key = JSON.stringify(deps);
  const reload = useCallback(async () => {
    const current = ++ticket.current;
    setLoading(true);
    try {
      const result = await latest.current();
      if (current !== ticket.current) return;
      setData(result);
      setProblem(null);
    } catch (cause) {
      if (current !== ticket.current) return;
      setProblem(problemOf(cause));
    } finally {
      if (current === ticket.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => { ticket.current += 1; };
  }, [reload, key]);
  return { data, problem, loading, reload, setData };
}

/** Ejecuta una mutación mostrando su estado y su error. Devuelve `true` si terminó bien. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setProblem(problemOf(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, problem, run, clear: () => setProblem(null) };
}

/* ---------- Estructura ---------- */

export function PageHead({ eyebrow, title, description, actions, back }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="cs-head">
      <div>
        {back && <Link href={back.href} className="cs-back"><ArrowLeft size={15} /> {back.label}</Link>}
        {eyebrow && <span className="cs-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="cs-head-actions">{actions}</div>}
    </header>
  );
}

export function Panel({ title, description, actions, children, flush = false, className = "" }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`cs-panel ${flush ? "cs-panel-flush" : ""} ${className}`}>
      {(title || actions) && (
        <div className="cs-panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="cs-panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="cs-toolbar">{children}</div>;
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <div className="cs-loading"><Spinner label={label} /></div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="cs-empty">
      <Inbox aria-hidden="true" />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Error de la API: mensaje legible, código y lista de detalles. */
export function ErrorBox({ problem, onRetry }: { problem: Problem | null; onRetry?: () => void }) {
  if (!problem) return null;
  return (
    <div className="cs-error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>{problem.message}</strong>
        {problem.issues.length > 0 && <ul>{problem.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        {(problem.code || problem.status > 0) && <small>{problem.code ? <>Código <code>{problem.code}</code></> : null}{problem.code && problem.status > 0 ? " · " : ""}{problem.status > 0 ? `HTTP ${problem.status}` : ""}</small>}
      </div>
      {onRetry && <button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

/** Envoltura estándar de una vista que carga datos: cargando, error con reintento o contenido. */
export function Loaded<T>({ loader, children, label }: { loader: Loader<T>; children: (data: T) => ReactNode; label?: string }) {
  if (loader.data === null) return loader.problem ? <ErrorBox problem={loader.problem} onRetry={() => void loader.reload()} /> : <Loading label={label} />;
  return <>{loader.problem && <ErrorBox problem={loader.problem} onRetry={() => void loader.reload()} />}{children(loader.data)}</>;
}

/* ---------- Indicadores ---------- */

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`cs-badge cs-badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ value, labels, text }: { value: string | null | undefined; labels?: Record<string, string>; text?: string | null }) {
  return <Badge tone={toneOf(value)}>{text ?? labelOf(value, labels)}</Badge>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <article className={`cs-stat ${tone ? `cs-stat-${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {hint && <p>{hint}</p>}
    </article>
  );
}

export function Facts({ items, columns = 2 }: { items: Array<{ label: string; value: ReactNode; wide?: boolean }>; columns?: 1 | 2 | 3 | 4 }) {
  return (
    <dl className={`cs-facts cs-facts-${columns}`}>
      {items.map((item) => (
        <div key={item.label} className={item.wide ? "wide" : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value === null || item.value === undefined || item.value === "" ? "—" : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Tablas ---------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "right" | "center";
  width?: string;
}

export function DataTable<T>({ columns, rows, rowKey, empty, onRowClick, selectedKey, caption }: { columns: Array<Column<T>>; rows: T[]; rowKey: (row: T) => string; empty?: ReactNode; onRowClick?: (row: T) => void; selectedKey?: string | null; caption?: string }) {
  if (rows.length === 0) return <>{empty ?? <Empty title="Sin registros" />}</>;
  return (
    <div className="cs-table-wrap">
      <table className="cs-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>{columns.map((column) => <th key={column.key} className={column.align ? `is-${column.align}` : undefined} style={column.width ? { width: column.width } : undefined} scope="col">{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr key={key} className={`${onRowClick ? "is-clickable" : ""} ${selectedKey === key ? "is-selected" : ""}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((column) => <td key={column.key} className={column.align ? `is-${column.align}` : undefined}>{column.cell(row)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Dos líneas en una celda: dato principal y dato secundario. */
export function Cell({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return <div className="cs-cell"><strong>{main}</strong>{sub !== undefined && sub !== null && sub !== "" && <small>{sub}</small>}</div>;
}

export function Pager({ page, pages, total, onPage, noun = "registros" }: { page: number; pages: number; total?: number; onPage: (page: number) => void; noun?: string }) {
  const last = Math.max(1, pages);
  return (
    <nav className="cs-pager" aria-label="Paginación">
      <span>{total !== undefined ? `${integer(total)} ${noun} · ` : ""}Página {page} de {last}</span>
      <div>
        <button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /> Anterior</button>
        <button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" disabled={page >= last} onClick={() => onPage(page + 1)}>Siguiente <ChevronRight size={15} /></button>
      </div>
    </nav>
  );
}

/* ---------- Controles ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "quiet"; small?: boolean };
export function Button({ variant = "primary", small = false, className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`cs-btn cs-btn-${variant} ${small ? "cs-btn-sm" : ""} ${className}`} {...rest} />;
}

export function Field({ label, hint, error, children, wide = false, required = false }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; wide?: boolean; required?: boolean }) {
  return (
    <label className={`cs-field ${wide ? "wide" : ""} ${error ? "has-error" : ""}`}>
      <span>{label}{required && <i aria-hidden="true"> *</i>}</span>
      {children}
      {error ? <small className="cs-field-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Check({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className="cs-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Tabs<K extends string>({ items, value, onChange }: { items: Array<{ key: K; label: ReactNode; count?: number | null }>; value: K; onChange: (key: K) => void }) {
  return (
    <div className="cs-tabs" role="tablist">
      {items.map((item) => (
        <button key={item.key} type="button" role="tab" aria-selected={value === item.key} className={value === item.key ? "active" : ""} onClick={() => onChange(item.key)}>
          {item.label}{item.count !== undefined && item.count !== null && <i>{item.count}</i>}
        </button>
      ))}
    </div>
  );
}

/** Editor de una lista de textos (pasos, módulos, garantías…): agregar, editar y quitar. */
export function ListEditor({ values, onChange, placeholder, addLabel = "Agregar", max, disabled }: { values: string[]; onChange: (values: string[]) => void; placeholder?: string; addLabel?: string; max?: number; disabled?: boolean }) {
  return (
    <div className="cs-list-editor">
      {values.map((value, index) => (
        <div key={index}>
          <input value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(values.map((item, position) => (position === index ? event.target.value : item)))} />
          <button type="button" className="cs-icon-btn" aria-label="Quitar" disabled={disabled} onClick={() => onChange(values.filter((_, position) => position !== index))}><X size={15} /></button>
        </div>
      ))}
      {(!max || values.length < max) && <button type="button" className="cs-btn cs-btn-quiet cs-btn-sm" disabled={disabled} onClick={() => onChange([...values, ""])}><Plus size={14} /> {addLabel}</button>}
    </div>
  );
}

/** Selección múltiple con casillas a partir de opciones conocidas. */
export function OptionChecks({ options, values, onChange, disabled }: { options: Array<{ value: string; label: string }>; values: string[]; onChange: (values: string[]) => void; disabled?: boolean }) {
  return (
    <div className="cs-option-checks">
      {options.map((option) => (
        <label key={option.value} className={values.includes(option.value) ? "on" : ""}>
          <input type="checkbox" disabled={disabled} checked={values.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...values, option.value] : values.filter((item) => item !== option.value))} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/* ---------- Diálogos ---------- */

const openModals: string[] = [];

export function Modal({ title, description, onClose, children, footer, size = "md" }: { title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    openModals.push(titleId);
    // Con diálogos anidados, Escape solo cierra el que está encima.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && openModals.at(-1) === titleId) close.current(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const focusable = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button.cs-btn-primary");
    (focusable ?? ref.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(titleId), 1);
      if (openModals.length === 0) document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [titleId]);
  return (
    <div className="cs-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} className={`cs-modal cs-modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="cs-icon-btn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>
        <div className="cs-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * Confirmación de una acción sensible. Si `reason` está definido exige un texto
 * (motivo) con la longitud mínima que valida la API.
 */
export function ConfirmDialog({ title, children, confirmLabel, danger = false, reason, onConfirm, onClose }: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reason?: { label: string; min: number; placeholder?: string; optional?: boolean };
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const action = useAction();
  const trimmed = text.trim();
  const valid = !reason || (reason.optional && trimmed.length === 0) || trimmed.length >= reason.min;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    if (await action.run(() => onConfirm(trimmed))) onClose();
  };
  return (
    <Modal title={title} onClose={onClose} size="sm">
      <form className="cs-form" onSubmit={submit}>
        {children && <div className="cs-confirm-text">{children}</div>}
        {reason && (
          <Field label={reason.label} required={!reason.optional} hint={reason.optional ? "Opcional." : `Mínimo ${reason.min} caracteres. Queda en la auditoría.`} wide>
            <textarea value={text} placeholder={reason.placeholder} onChange={(event) => setText(event.target.value)} rows={3} />
          </Field>
        )}
        <ErrorBox problem={action.problem} />
        <div className="cs-form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.busy}>Cancelar</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={action.busy || !valid}>{action.busy ? "Procesando…" : confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Pie estándar de un formulario dentro de un modal. */
export function FormActions({ busy, onCancel, submitLabel, disabled }: { busy: boolean; onCancel: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <div className="cs-form-actions">
      <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
      <Button type="submit" disabled={busy || disabled}>{busy ? "Guardando…" : submitLabel}</Button>
    </div>
  );
}
