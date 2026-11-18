"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId } from "react";
import { ICONS, type IconName } from "./icon-data";

export type { IconName };

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg className={`l-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}

export function Lufty({ mood = "happy", tone = "blue", width = 88 }: { mood?: "happy" | "wink" | "neutral"; tone?: "blue" | "white"; width?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="l-lufty" src={`/luft/lufty-${mood}-${tone}.svg`} alt="" width={width} height={Math.round(width * 0.455)} />;
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

export function Header({ title, subtitle, back, onBack, step, progress, topTitle, flat = false, children, action }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; back?: string | true; onBack?: () => void; step?: string; progress?: number; topTitle?: string; flat?: boolean; children?: React.ReactNode; action?: React.ReactNode;
}) {
  const hasTop = back || step || progress !== undefined || topTitle || action;
  return (
    <header className={`l-header ${flat ? "flat" : ""}`}>
      {hasTop && (
        <div className="l-header-top">
          {back && <BackButton href={typeof back === "string" ? back : undefined} onClick={onBack} />}
          {progress !== undefined && <div className="l-track" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>}
          {topTitle && <span className="l-top-title">{topTitle}</span>}
          {step && <span className="l-step">{step}</span>}
          {action}
        </div>
      )}
      {children}
      {title && <h1>{title}</h1>}
      {subtitle && <p>{subtitle}</p>}
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

export function Field({ label, hint, valid, trailing, children, className = "" }: { label: React.ReactNode; hint?: React.ReactNode; valid?: boolean; trailing?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className="l-field">
      <span>{label}</span>
      <span className={`l-input ${valid ? "valid" : ""} ${trailing ? "has-trailing" : ""} ${className}`}>
        {children}
        {valid ? <span className="trailing"><Icon name="check_circle_fill" size={24} /></span> : trailing ? <span className="trailing">{trailing}</span> : null}
      </span>
      {hint && <span className="l-hint">{hint}</span>}
    </label>
  );
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

export function Choice({ selected, onSelect, children, multiple = false }: { selected: boolean; onSelect: () => void; children: React.ReactNode; multiple?: boolean }) {
  return <button type="button" role={multiple ? "checkbox" : "radio"} aria-checked={selected} className="l-choice" onClick={onSelect}><span className={`l-radio ${selected ? "on" : ""}`} />{children}</button>;
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T | null; onChange: (value: T) => void; label: string }) {
  return <div className="l-segmented" role="group" aria-label={label}>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

export function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const id = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="l-sheet-backdrop" onClick={onClose}>
      <div className="l-sheet" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(event) => event.stopPropagation()}>
        <h2 id={id} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <div className="l-loading" role="status"><Lufty mood="neutral" /><span>{label}</span></div>;
}

export function Alert({ children, type = "error" }: { children: React.ReactNode; type?: "error" | "info" | "success" | "warning" }) {
  return <div className={`l-alert ${type === "error" ? "" : type}`} role={type === "error" ? "alert" : "status"}>{children}</div>;
}

const CONFETTI = [["8%", "#f4bd45", 0], ["18%", "#fff", 0.6], ["30%", "#35c77a", 1.4], ["44%", "#b6a4ff", 0.3], ["58%", "#f4bd45", 1.9], ["70%", "#f56b6b", 0.9], ["82%", "#fff", 1.6], ["92%", "#87a4ff", 0.2]] as const;
export function Confetti() {
  return <div className="l-confetti" aria-hidden="true">{CONFETTI.map(([left, color, delay]) => <i key={left} style={{ left, background: color, animationDelay: `${delay}s` }} />)}</div>;
}

export function Celebration({ badge, title, text, stats, barLabel, barValue, barText, mission, children, mood = "happy" }: {
  badge?: string; title: string; text: string; stats?: Array<{ label: string; value: React.ReactNode; icon: IconName }>; barLabel?: string; barValue?: number; barText?: string; mission?: { label: string; text: string; icon: IconName }; children: React.ReactNode; mood?: "happy" | "wink";
}) {
  return (
    <Screen blue>
      <Confetti />
      <div className="l-celebrate">
        <div className="l-halo on-blue"><Lufty mood={mood} tone="white" width={200} /></div>
        {badge && <span className="l-badge-pill"><Icon name="workspace_premium" />{badge}</span>}
        <h1>{title}</h1>
        <p>{text}</p>
        {stats && <div className="l-trio">{stats.map((item) => <div key={item.label}>{item.label}<strong><Icon name={item.icon} />{item.value}</strong></div>)}</div>}
        {barValue !== undefined && <div className="l-stack" style={{ gap: 8 }}><div className="l-row between" style={{ fontSize: 12 }}><span>{barLabel}</span><span>{barText}</span></div><Bar value={barValue} tone="on-blue" /></div>}
        {mission && <Tip tone="glass" icon={mission.icon} title={mission.label}><span style={{ fontSize: 14 }}>{mission.text}</span></Tip>}
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
