"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Children, useEffect, useRef, useState } from "react";
import type { PlanStep } from "@/lib/credit";
import { ICONS, type IconName } from "./icon-data";

export type { IconName };

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg className={`l-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}

/** Logotipo "luft" en minúsculas para escribir la marca dentro de un texto: hereda color y tamaño. */
export function Luft() {
  return (
    <span className="l-luft" role="img" aria-label="LUFT">
      <svg viewBox="0 0 194 100" fill="none" stroke="currentColor" strokeWidth="15" aria-hidden="true" focusable="false">
        <path d="M8 6V100" />
        <path d="M43 35V73.5a19 19 0 0 0 38 0V35M81 35V100" />
        <path d="M113 100V30.5a17 17 0 0 1 17-17h7" />
        <path d="M99 42.5H193.5" strokeWidth="14" />
        <path d="M152 15V75.5a17 17 0 0 0 34 0V60" />
      </svg>
    </span>
  );
}

type LuftyMotion = "hop" | "hop soft" | "cheer";
export function Lufty({ mood = "happy", tone = "blue", width = 88, motion }: { mood?: "happy" | "wink" | "neutral"; tone?: "blue" | "white"; width?: number; motion?: LuftyMotion }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`l-lufty ${motion ?? ""}`} src={`/luft/lufty-${mood}-${tone}.svg`} alt="" width={width} height={Math.round(width * 0.455)} />;
}

export function Screen({ children, blue = false, className = "" }: { children: React.ReactNode; blue?: boolean; className?: string }) {
  return <div className="l-app"><div className={`l-screen ${blue ? "blue" : ""} ${className}`}>{children}</div></div>;
}

export function BackButton({ href, light = false, icon = "chevron_left", label = "Volver", onClick }: { href?: string; light?: boolean; icon?: IconName; label?: string; onClick?: () => void }) {
  const router = useRouter();
  const className = `l-round ${light ? "light" : ""}`;
  if (href) return <Link href={href} className={className} aria-label={label}><Icon name={icon} /></Link>;
  return <button type="button" className={className} aria-label={label} onClick={onClick ?? (() => router.back())}><Icon name={icon} /></button>;
}

export function Header({ title, subtitle, back, onBack, step, progress, topTitle, flat = false, children, action, meta }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; back?: string | true; onBack?: () => void; step?: string; progress?: number; topTitle?: string; flat?: boolean; children?: React.ReactNode; action?: React.ReactNode; meta?: React.ReactNode;
}) {
  const hasTop = back || step || progress !== undefined || topTitle || action;
  return (
    <header className={`l-header ${flat ? "flat" : ""}`}>
      {hasTop && (
        <div className="l-header-top">
          {back && <BackButton href={typeof back === "string" ? back : undefined} onClick={onBack} />}
          {progress !== undefined && <div className="l-track" role="progressbar" aria-label={step ?? "Avance"} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>}
          {topTitle && <span className="l-top-title">{topTitle}</span>}
          {step && <span className="l-step">{step}</span>}
          {action}
        </div>
      )}
      {children}
      {title && <h1>{title}</h1>}
      {subtitle && <p>{subtitle}</p>}
      {meta}
    </header>
  );
}

type ButtonProps = { children: React.ReactNode; variant?: "primary" | "secondary" | "white"; arrow?: boolean; icon?: IconName; small?: boolean; href?: string; disabled?: boolean; type?: "button" | "submit"; onClick?: () => void; external?: boolean };
export function Button({ children, variant = "primary", arrow = false, icon, small = false, href, disabled, type = "button", onClick, external }: ButtonProps) {
  const className = `l-btn ${variant} ${small ? "small" : ""}`;
  const content = <>{icon && <Icon name={icon} />}{children}{arrow && <Icon name="arrow_forward" />}</>;
  if (href && !disabled) return external ? <a className={className} href={href} target="_blank" rel="noreferrer" onClick={onClick}>{content}</a> : <Link className={className} href={href} onClick={onClick}>{content}</Link>;
  return <button className={className} type={type} disabled={disabled} onClick={onClick}>{content}</button>;
}

export function Card({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "article" | "form" }) {
  return <Tag className={`l-card ${className}`}>{children}</Tag>;
}

/** Single choice inside a `role="radiogroup"`. */
export function OptionCard({ icon, title, description, selected, onSelect, trailing, state, disabled }: {
  icon?: IconName; title: React.ReactNode; description?: React.ReactNode; selected: boolean; onSelect: () => void; trailing?: React.ReactNode; state?: "correct" | "wrong" | "dim"; disabled?: boolean;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={disabled} className={`l-option ${state ?? ""}`} onClick={onSelect}>
      {icon && <span className="l-icon-box"><Icon name={icon} size={24} /></span>}
      <span className="l-grow"><strong>{title}</strong>{description && <span className="desc">{description}</span>}</span>
      {trailing}
      <span className="l-radio" />
    </button>
  );
}

export function Tip({ title, children, icon = "info", lufty = false, tone = "" }: { title?: React.ReactNode; children?: React.ReactNode; icon?: IconName; lufty?: boolean; tone?: "" | "amber" | "green" | "red" | "glass" }) {
  return (
    <div className={`l-tip ${tone}`}>
      {lufty ? <span className="avatar"><Lufty mood="neutral" width={30} /></span> : <Icon name={icon} />}
      <div>{title && <strong>{title}</strong>}{children}</div>
    </div>
  );
}

export function Chip({ children, tone = "", dot = false, icon, large = false }: { children: React.ReactNode; tone?: "" | "green" | "blue" | "amber" | "red" | "violet"; dot?: boolean; icon?: IconName; large?: boolean }) {
  return <span className={`l-chip ${tone} ${dot ? "dot" : ""} ${large ? "lg" : ""}`}>{icon && <Icon name={icon} size={large ? 18 : 14} />}{children}</span>;
}

export function Bar({ value, tone = "", label }: { value: number; tone?: "" | "violet" | "amber" | "green" | "on-blue"; label?: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return <div className={`l-bar ${tone}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div>;
}

export function Segments({ total, done }: { total: number; done: number }) {
  return <div className="l-segments" aria-hidden="true">{Array.from({ length: total }, (_, index) => <i key={index} className={index < done ? "on" : ""} />)}</div>;
}

export function Field({ label, hint, valid, trailing, children, className = "", optional = false, prefix }: {
  label: React.ReactNode; hint?: React.ReactNode; valid?: boolean; trailing?: React.ReactNode; children: React.ReactNode; className?: string; optional?: boolean; prefix?: React.ReactNode;
}) {
  const input = (
    <span className={`l-input ${valid ? "valid" : ""} ${trailing ? "has-trailing" : ""} ${className}`}>
      {children}
      {valid ? <span className="trailing"><Icon name="check_circle_fill" size={24} /></span> : trailing ? <span className="trailing">{trailing}</span> : null}
    </span>
  );
  return (
    <label className="l-field">
      <span>{label}{optional && <em className="l-optional">Opcional</em>}</span>
      {prefix ? <span className="l-phone"><span className="l-prefix" aria-hidden="true">{prefix}</span>{input}</span> : input}
      {hint && <span className="l-hint">{hint}</span>}
    </label>
  );
}

/** Bandera de Colombia para el prefijo fijo del celular (+57). */
export function ColombiaFlag() {
  return <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false"><path fill="#fcd116" d="M0 0h24v8H0z" /><path fill="#003893" d="M0 8h24v4H0z" /><path fill="#ce1126" d="M0 12h24v4H0z" /></svg>;
}

const digits = (value: string) => value.replace(/\D/g, "").slice(0, 12);
export const formatCOP = (value: number | string | null | undefined) => `$ ${new Intl.NumberFormat("es-CO").format(Number(value ?? 0))}`;

export function MoneyInput({ value, onChange, placeholder = "Ingresa el valor", label, compact = false }: { value: number | null; onChange: (value: number | null) => void; placeholder?: string; label: string; compact?: boolean }) {
  return (
    <span className={`l-input money ${compact ? "compact" : ""} ${value ? "valid" : ""}`}>
      <input inputMode="numeric" aria-label={label} placeholder={placeholder} value={value == null ? "" : formatCOP(value)} onChange={(event) => { const raw = digits(event.target.value); onChange(raw ? Number(raw) : null); }} />
      {!compact && value ? <span className="trailing"><Icon name="check_circle_fill" size={24} /></span> : null}
    </span>
  );
}

export function Checkbox({ checked, onChange, children, row = false, required }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode; row?: boolean; required?: boolean }) {
  return (
    <label className={`l-check ${row ? "row" : ""}`}>
      <input type="checkbox" checked={checked} required={required} onChange={(event) => onChange(event.target.checked)} />
      <span className="box">{checked && <Icon name="check" size={16} />}</span>
      <span className="l-grow">{children}</span>
    </label>
  );
}

/** Compact choice: a radio for single selection, a square checkbox when several can be picked. */
export function Choice({ selected, onSelect, children, multiple = false }: { selected: boolean; onSelect: () => void; children: React.ReactNode; multiple?: boolean }) {
  return (
    <button type="button" role={multiple ? "checkbox" : "radio"} aria-checked={selected} className="l-choice" onClick={onSelect}>
      {multiple ? <span className="l-tick"><Icon name="check" size={16} /></span> : <span className={`l-radio ${selected ? "on" : ""}`} />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T | null; onChange: (value: T) => void; label: string }) {
  return <div className="l-segmented" role="group" aria-label={label}>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Bottom sheet (centered dialog on desktop): traps focus, closes with Escape and restores focus. */
export function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const node = sheet.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return (
    <div className="l-sheet-backdrop" onClick={onClose}>
      <div ref={sheet} className="l-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Horizontal carousel with the position indicator of the design; scrolls with touch, wheel or arrow keys. */
export function Carousel({ children, label }: { children: React.ReactNode; label: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = Children.count(children);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const update = () => {
      const box = node.getBoundingClientRect();
      const center = box.left + box.width / 2;
      let best = 0; let distance = Infinity;
      Array.from(node.children).forEach((child, index) => {
        const rect = child.getBoundingClientRect();
        const gap = Math.abs(rect.left + rect.width / 2 - center);
        if (gap < distance) { distance = gap; best = index; }
      });
      if (node.scrollLeft <= 2) best = 0;
      else if (node.scrollLeft + node.clientWidth >= node.scrollWidth - 2) best = node.children.length - 1;
      setActive(best);
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { node.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [count]);
  return (
    <div className="l-carousel-wrap">
      <div ref={track} className="l-carousel" role="group" aria-roledescription="carrusel" aria-label={label} tabIndex={0}>{children}</div>
      <div className="l-dots sm" aria-hidden="true">{Array.from({ length: count }, (_, index) => <i key={index} className={index === active ? "on" : ""} />)}</div>
      <span className="l-sr" aria-live="polite">{`Tarjeta ${active + 1} de ${count}`}</span>
    </div>
  );
}

/** Staircase of installments: one step per installment, Lufty stands on the current one. */
export function Staircase({ steps, full = false, callout, goal, label }: { steps: PlanStep[]; full?: boolean; callout?: { overline: string; text: string }; goal?: string; label: string }) {
  const last = Math.max(1, steps.length - 1);
  // The compact version starts taller so the first step still fits its mark.
  const base = full ? 18 : 32;
  return (
    <div>
      <div className={`l-stairs-wrap ${full ? "full" : ""}`}>
        {callout && <div className="l-stairs-callout"><small>{callout.overline}</small>{callout.text}</div>}
        {goal && <span className="l-stairs-goal"><Chip tone="green" icon="flag">{goal}</Chip></span>}
        <div className="l-stairs" role="img" aria-label={label}>
          {steps.map((step, index) => (
            <div key={index} className={step.state ?? step.tone ?? ""} style={{ height: `${base + (index / last) * (100 - base)}%` }}>
              {step.state === "now" && <span className="mascot"><Lufty width={40} motion="hop soft" /></span>}
              {step.state === "paid" ? <Icon name="check" size={12} /> : step.state !== "now" && step.icon ? <Icon name={step.icon} size={steps.length > 8 ? 12 : 16} /> : null}
            </div>
          ))}
        </div>
      </div>
      {full && <div className="l-stairs-labels" aria-hidden="true">{steps.map((step, index) => <span key={index} className={step.state === "now" ? "now" : ""}>{index + 1}</span>)}</div>}
    </div>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <div className="l-loading" role="status"><Lufty mood="neutral" /><span>{label}</span></div>;
}

export function Alert({ children, type = "error" }: { children: React.ReactNode; type?: "error" | "info" | "success" | "warning" }) {
  return <div className={`l-alert ${type === "error" ? "" : type}`} role={type === "error" ? "alert" : "status"}>{children}</div>;
}

const CONFETTI: Array<[left: number, color: string, delay: number, shape: "" | "pill" | "dot", drift: number]> = [
  [4, "#f4bd45", 0, "dot", 18], [11, "#fff", .9, "pill", -14], [17, "#35c77a", .3, "", 22], [24, "#d4c9ff", 1.5, "pill", 10], [31, "#f4bd45", .6, "", -20], [38, "#f56b6b", 1.9, "pill", 14],
  [45, "#fff", .2, "dot", -10], [52, "#87a4ff", 1.2, "", 24], [59, "#35c77a", 2.1, "pill", -18], [66, "#f4bd45", .4, "pill", 12], [73, "#d4c9ff", 1.7, "dot", -22], [80, "#f56b6b", .8, "", 16],
  [87, "#fff", 1.4, "pill", -12], [94, "#87a4ff", .1, "dot", 20], [8, "#d4c9ff", 2.4, "", 14], [56, "#f4bd45", 2.7, "dot", -16], [70, "#fff", 2.2, "", 10], [28, "#35c77a", 2.9, "pill", -8],
];
export function Confetti() {
  return <div className="l-confetti" aria-hidden="true">{CONFETTI.map(([left, color, delay, shape, drift], index) => <i key={index} className={shape} style={{ left: `${left}%`, background: color, animationDelay: `${delay}s`, "--dx": `${drift}px`, "--rot": `${drift * 18}deg` } as React.CSSProperties} />)}</div>;
}

const SPARKLES: Array<[left: string, top: string, size: number, delay: number]> = [["12%", "24%", 22, 0], ["82%", "22%", 26, .5], ["86%", "50%", 16, 1.1], ["9%", "56%", 14, .8], ["72%", "6%", 12, 1.4]];
/** Four-point sparkle of the illustrations. */
export function Spark({ size, style, className = "" }: { size: number; style?: React.CSSProperties; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" width={size} height={size} style={style} aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 0c1 6.5 4.5 10 12 12-7.5 2-11 5.5-12 12-1-6.5-4.5-10-12-12 7.5-2 11-5.5 12-12Z" /></svg>;
}
function Sparkles() {
  return <div className="l-sparkles" aria-hidden="true">{SPARKLES.map(([left, top, size, delay]) => <Spark key={left} size={size} style={{ left, top, animationDelay: `${delay}s` }} />)}</div>;
}

/** Full-screen celebration: confetti, sparkles and an animated Lufty (all still under reduced motion). */
export function Celebration({ badge, title, text, stats, barLabel, barValue, barText, next, children, mood = "happy" }: {
  badge?: string; title: string; text: string; stats?: Array<{ label: string; value: React.ReactNode; icon: IconName }>; barLabel?: string; barValue?: number; barText?: string; next?: { label: string; text: string; icon: IconName }; children: React.ReactNode; mood?: "happy" | "wink";
}) {
  return (
    <Screen blue>
      <Confetti />
      <div className="l-celebrate">
        <div className="l-halo on-blue"><Sparkles /><Lufty mood={mood} tone="white" width={200} motion="cheer" /></div>
        {badge && <span className="l-badge-pill"><Icon name="workspace_premium" />{badge}</span>}
        <h1>{title}</h1>
        <p>{text}</p>
        {stats && <div className="l-trio">{stats.map((item) => <div key={item.label}>{item.label}<strong><Icon name={item.icon} />{item.value}</strong></div>)}</div>}
        {barValue !== undefined && <div className="l-stack" style={{ gap: 8 }}><div className="l-row between" style={{ fontSize: 12 }}><span>{barLabel}</span><span>{barText}</span></div><Bar value={barValue} tone="on-blue" label={barLabel} /></div>}
        {next && <div className="l-next"><span className="box"><Icon name={next.icon} /></span><div><small>{next.label}</small><strong>{next.text}</strong></div></div>}
      </div>
      <div className="l-footer">{children}</div>
    </Screen>
  );
}

/** Semicircular score gauge, 150–950, with the four bands of the design. */
export function ScoreGauge({ score, min = 150, max = 950, label = "Tu score crediticio" }: { score: number | null; min?: number; max?: number; label?: string }) {
  const bands = [["#ef4444", 180, 222], ["#f97316", 228, 268], ["#ffc83d", 274, 312], ["#22c55e", 318, 360]] as const;
  const point = (angle: number, radius = 100) => { const rad = (angle * Math.PI) / 180; return [128 + radius * Math.cos(rad), 128 + radius * Math.sin(rad)]; };
  const arc = (from: number, to: number) => { const [x1, y1] = point(from); const [x2, y2] = point(to); return `M${x1.toFixed(1)} ${y1.toFixed(1)}A100 100 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  const ratio = score == null ? null : Math.max(0, Math.min(1, (score - min) / (max - min)));
  const marker = ratio == null ? null : point(180 + ratio * 180);
  const markerColor = ratio == null ? "#98a4b8" : bands[Math.min(3, Math.floor(ratio * 4))][0];
  return (
    <div>
      <div className="l-gauge">
        <svg viewBox="0 0 256 144" role="img" aria-label={score == null ? "Puntaje aún no disponible" : `Puntaje ${score} de ${max}`}>
          {bands.map(([color, from, to]) => <path key={color} d={arc(from, to)} fill="none" stroke={color} strokeOpacity={score == null ? 0.3 : 1} strokeWidth="14" strokeLinecap="round" />)}
          {marker && <><circle cx={marker[0]} cy={marker[1]} r="13" fill="#fff" /><circle cx={marker[0]} cy={marker[1]} r="9" fill="none" stroke={markerColor} strokeWidth="6" /></>}
        </svg>
        <div className="value"><strong>{score ?? "—"}</strong><span>{label}</span></div>
      </div>
      <div className="l-gauge-ends"><span>{min}</span><span>{max}</span></div>
    </div>
  );
}

export function scoreBand(score: number) {
  if (score < 350) return { label: "Necesita mejorar", tone: "red" as const };
  if (score < 550) return { label: "En construcción", tone: "amber" as const };
  if (score < 750) return { label: "Bueno", tone: "blue" as const };
  return { label: "Excelente", tone: "green" as const };
}
