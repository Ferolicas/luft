"use client";

import "@/app/luft-v2.css";
import Link from "next/link";
import { useRef, useState } from "react";
import { FILE_ACCEPT, fileProblem } from "@/lib/v2/api";
import { Alert, Bar, Button, Card, Chip, Header, Icon, Loading, Lufty, Screen, Sheet, type IconName } from "../ui";

type Tone = "" | "green" | "blue" | "amber" | "red" | "violet";

/** Pantalla completa de carga o de error con reintento, con el mismo encabezado de la pantalla final. */
export function PageState({ title, back, failure, onRetry, label }: { title: string; back?: string; failure?: string; onRetry?: () => void; label?: string }) {
  return (
    <Screen>
      <Header back={back} title={title} flat />
      <div className="l-body">
        {failure ? (
          <Card className="tight">
            <Alert>{failure}</Alert>
            {onRetry && <Button variant="secondary" small icon="sync" onClick={onRetry}>Reintentar</Button>}
          </Card>
        ) : <Loading label={label} />}
      </div>
    </Screen>
  );
}

export function SectionTitle({ children, action, id }: { children: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return <div className="l-section-title v2-section" id={id}><h2>{children}</h2>{action}</div>;
}

/** Estado vacío honesto: explica qué falta y ofrece la acción para empezar. */
export function Empty({ title, children, action, lufty = true, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; lufty?: boolean; icon?: IconName }) {
  return (
    <div className="v2-empty">
      {icon ? <span className="l-icon-box"><Icon name={icon} size={24} /></span> : lufty ? <Lufty mood="neutral" width={84} /> : null}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Título visible de una hoja (el `h2` de `Sheet` es solo para lectores de pantalla). */
export function SheetHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="v2-sheet-head"><strong aria-hidden="true">{title}</strong>{children && <p>{children}</p>}</div>;
}

export function ConfirmSheet({ title, children, confirm, danger = false, busy = false, failure, onConfirm, onClose }: { title: string; children: React.ReactNode; confirm: string; danger?: boolean; busy?: boolean; failure?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <SheetHead title={title} />
      <div className="v2-sheet-text">{children}</div>
      {failure && <Alert>{failure}</Alert>}
      <div className={danger ? "v2-danger" : undefined}><Button onClick={onConfirm} disabled={busy}>{busy ? "Un momento…" : confirm}</Button></div>
      <button type="button" className="l-link-button" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}

/** Par etiqueta–valor compacto para fichas de datos. `rows` apila las fichas en móvil (cifras largas). */
export function Facts({ items, columns = 2, rows = false }: { items: Array<{ label: string; value: React.ReactNode; hint?: React.ReactNode }>; columns?: 2 | 3; rows?: boolean }) {
  return <dl className={`v2-facts c${columns} ${rows ? "rows" : ""}`}>{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd>{item.hint && <small>{item.hint}</small>}</div>)}</dl>;
}

/** Fila de una lista con ícono, texto y remate; enlace si recibe `href`. */
export function ListRow({ icon, tone = "", title, text, trailing, href, onClick }: { icon?: IconName; tone?: "" | "green" | "amber" | "violet" | "gray"; title: React.ReactNode; text?: React.ReactNode; trailing?: React.ReactNode; href?: string; onClick?: () => void }) {
  const content = <>{icon && <span className={`l-icon-box ${tone}`}><Icon name={icon} /></span>}<span className="l-grow"><strong>{title}</strong>{text && <small>{text}</small>}</span>{trailing}{(href || onClick) && !trailing && <Icon name="chevron_right" />}</>;
  if (href) return <Link href={href}>{content}</Link>;
  if (onClick) return <button type="button" onClick={onClick}>{content}</button>;
  return <div>{content}</div>;
}

/** Medidor de uso (0–100) con la banda que calcula la API. */
const BAND_TONE: Record<string, "green" | "amber" | "" | "red"> = { HEALTHY: "green", MODERATE: "amber", HIGH: "amber", CRITICAL: "red" };
export const BAND_LABEL: Record<string, string> = { HEALTHY: "Uso saludable", MODERATE: "Uso moderado", HIGH: "Uso alto", CRITICAL: "Uso crítico" };
export const bandTone = (band: string): Tone => (band === "HEALTHY" ? "green" : band === "CRITICAL" ? "red" : "amber");
export function Meter({ value, band, label }: { value: number; band: string; label: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div className={`v2-meter ${BAND_TONE[band] ?? ""}`} role="img" aria-label={`${label}: ${value}%`}>
      <div className="track"><i style={{ width: `${percent}%` }} /><span className="mark" style={{ left: "30%" }} /></div>
      <div className="scale"><span>0%</span><span style={{ left: "30%" }}>30%</span><span>100%</span></div>
    </div>
  );
}

/** Anillo de porcentaje (encaje, avance). */
export function Ring({ value, tone = "", label, size = 64 }: { value: number; tone?: Tone; label: string; size?: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return <span className={`v2-ring ${tone}`} style={{ ["--p" as string]: percent, width: size, height: size }} role="img" aria-label={`${label}: ${percent}%`}><b>{percent}<small>%</small></b></span>;
}

/** Pasos horizontales con estado (etapas de la ruta, ciclo del proyecto, fases del caso). */
export function Steps({ items, label }: { items: Array<{ key: string; label: string; status: "DONE" | "CURRENT" | "PENDING" }>; label: string }) {
  return (
    <ol className="v2-steps" aria-label={label}>
      {items.map((item, index) => (
        <li key={item.key} className={item.status.toLowerCase()} aria-current={item.status === "CURRENT" ? "step" : undefined}>
          <span>{item.status === "DONE" ? <Icon name="check" size={14} /> : index + 1}</span>
          <small>{item.label}</small>
        </li>
      ))}
    </ol>
  );
}

/** Selección de archivo validada (PDF/JPG/PNG, 10 MB). La subida la hace quien lo usa. */
export function FilePicker({ label, hint, busy = false, progress, onFile }: { label: string; hint?: string; busy?: boolean; progress?: number | null; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState("");
  function choose(list: FileList | null) {
    const file = list?.[0];
    if (input.current) input.current.value = "";
    if (!file) return;
    const reason = fileProblem(file);
    setProblem(reason);
    if (!reason) onFile(file);
  }
  return (
    <div className="l-stack" style={{ gap: 8 }}>
      <input ref={input} type="file" accept={FILE_ACCEPT} hidden onChange={(event) => choose(event.target.files)} />
      <button type="button" className="l-drop v2-drop" onClick={() => input.current?.click()} disabled={busy}>
        <span><Icon name={busy ? "progress_activity" : "upload"} /></span>
        {busy ? `Subiendo…${progress != null ? ` ${progress}%` : ""}` : label}
        <small>{hint ?? "PDF, JPG o PNG · máx. 10 MB"}</small>
      </button>
      {busy && progress != null && <Bar value={progress} label="Carga del archivo" />}
      {problem && <Alert>{problem}</Alert>}
    </div>
  );
}

export function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Chip tone={tone} dot>{children}</Chip>;
}

/** Texto legal de una autorización: se muestra completo antes de aceptar. */
export function ConsentBox({ text, title = "Texto de la autorización" }: { text: string; title?: string }) {
  return <div className="v2-consent"><span className="l-overline">{title}</span><p>{text}</p></div>;
}

/** Bloque plegable accesible (`details`) con el estilo de las tarjetas. */
export function Fold({ summary, children, open = false }: { summary: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  return <details className="v2-fold" open={open || undefined}><summary><span className="l-grow">{summary}</span><Icon name="keyboard_arrow_down" /></summary><div className="v2-fold-body">{children}</div></details>;
}
