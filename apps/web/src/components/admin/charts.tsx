"use client";

import { type ReactNode, useId, useRef, useState } from "react";

/**
 * Gráficos SVG propios de la consola (sin dependencias).
 * Paleta categórica validada para daltonismo en fondo claro (azul, naranja,
 * aguamarina, en ese orden fijo); el aguamarina no alcanza 3:1 sobre blanco,
 * por eso todo gráfico va acompañado de su tabla y de etiquetas directas.
 * El texto nunca usa el color de la serie.
 */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"] as const;
const INK = "#101d42";
const MUTED = "#66718d";
const GRID = "#e6ebf3";
const SURFACE = "#ffffff";
/** Rampa secuencial de un solo tono (claro → oscuro) para magnitudes. */
const SEQUENTIAL = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];

/** Color de celda para una magnitud entre 0 y `max` (mapa de calor de un solo tono). */
export function heatStyle(value: number | null, max: number): React.CSSProperties {
  if (value === null || !Number.isFinite(value)) return { color: MUTED };
  if (value <= 0 || max <= 0) return { background: "#f6f9fd" };
  const index = Math.min(SEQUENTIAL.length - 1, Math.floor((value / max) * (SEQUENTIAL.length - 1) + 0.5));
  return { background: SEQUENTIAL[index], color: index >= 6 ? "#ffffff" : INK, fontWeight: 700 };
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return <div className="cs-legend">{items.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}</div>;
}

export interface LineSeries { name: string; points: Array<{ x: number; y: number | null }> }

/** Líneas sobre un eje X numérico compartido (p. ej. meses en libros), con cursor y tooltip. */
export function LineChart({ series, xLabel, formatX, formatY, height = 260, label }: { series: LineSeries[]; xLabel: string; formatX: (x: number) => string; formatY: (y: number) => string; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const width = 720;
  const pad = { top: 16, right: 86, bottom: 40, left: 52 };
  const xs = [...new Set(series.flatMap((item) => item.points.map((point) => point.x)))].sort((a, b) => a - b);
  const values = series.flatMap((item) => item.points.map((point) => point.y)).filter((value): value is number => value !== null);
  if (xs.length === 0 || values.length === 0) return null;
  const yMax = niceMax(Math.max(...values));
  const xMin = xs[0]; const xMax = xs[xs.length - 1];
  const px = (x: number) => pad.left + (xMax === xMin ? (width - pad.left - pad.right) / 2 : ((x - xMin) / (xMax - xMin)) * (width - pad.left - pad.right));
  const py = (y: number) => pad.top + (1 - y / yMax) * (height - pad.top - pad.bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * yMax);
  const xTicks = xs.length <= 12 ? xs : xs.filter((_, index) => index % Math.ceil(xs.length / 12) === 0);

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    let nearest = xs[0];
    for (const candidate of xs) if (Math.abs(px(candidate) - x) < Math.abs(px(nearest) - x)) nearest = candidate;
    setHover(nearest);
  };
  // Las etiquetas del extremo se separan si dos líneas terminan a la misma altura.
  const ends = series.map((item, index) => { const last = [...item.points].reverse().find((point) => point.y !== null); return last ? { index, name: item.name, x: px(last.x), y: py(last.y as number), value: last.y as number } : null; }).filter((end): end is NonNullable<typeof end> => end !== null).sort((a, b) => a.y - b.y);
  for (let index = 1; index < ends.length; index += 1) if (ends[index].y - ends[index - 1].y < 14) ends[index].y = ends[index - 1].y + 14;

  return (
    <div className="cs-chart" ref={wrap}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <title id={id}>{label}</title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={py(tick)} y2={py(tick)} stroke={GRID} strokeWidth={1} />
            <text x={pad.left - 8} y={py(tick) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{formatY(tick)}</text>
          </g>
        ))}
        {xTicks.map((x) => <text key={x} x={px(x)} y={height - pad.bottom + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{formatX(x)}</text>)}
        <text x={(pad.left + width - pad.right) / 2} y={height - 6} textAnchor="middle" fontSize={11} fill={MUTED}>{xLabel}</text>
        {hover !== null && <line x1={px(hover)} x2={px(hover)} y1={pad.top} y2={height - pad.bottom} stroke="#b8c4d9" strokeWidth={1} />}
        {series.map((item, index) => {
          const color = SERIES_COLORS[index % SERIES_COLORS.length];
          const points = item.points.filter((point): point is { x: number; y: number } => point.y !== null);
          return (
            <g key={item.name}>
              {points.length > 1 && <polyline points={points.map((point) => `${px(point.x)},${py(point.y)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {points.map((point) => (points.length === 1 || point.x === hover || point === points[points.length - 1]) && <circle key={point.x} cx={px(point.x)} cy={py(point.y)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />)}
            </g>
          );
        })}
        {ends.map((end) => <text key={end.name} x={end.x + 10} y={end.y + 4} fontSize={11} fontWeight={700} fill={INK}>{formatY(end.value)}</text>)}
      </svg>
      {hover !== null && (
        <div className="cs-chart-tip" style={{ left: `${(px(hover) / width) * 100}%`, top: 8, transform: `translate(${px(hover) > width * 0.7 ? "-105%" : "5%"}, 0)` }}>
          <strong>{xLabel}: {formatX(hover)}</strong>
          {series.map((item, index) => { const point = item.points.find((candidate) => candidate.x === hover); return <span key={item.name}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />{item.name}: {point && point.y !== null ? formatY(point.y) : "sin dato"}</span>; })}
        </div>
      )}
      {series.length > 1 && <Legend items={series.map((item, index) => ({ label: item.name, color: SERIES_COLORS[index % SERIES_COLORS.length] }))} />}
    </div>
  );
}

export interface ColumnGroup { label: string; values: Array<number | null> }

/** Columnas agrupadas (una o varias series por categoría), con tooltip por grupo. */
export function ColumnChart({ groups, seriesNames, formatY, height = 250, label, yMaxHint }: { groups: ColumnGroup[]; seriesNames: string[]; formatY: (y: number) => string; height?: number; label: string; yMaxHint?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const width = 720;
  const pad = { top: 22, right: 16, bottom: 34, left: 52 };
  const values = groups.flatMap((group) => group.values).filter((value): value is number => value !== null);
  if (groups.length === 0 || values.length === 0) return null;
  const yMax = niceMax(Math.max(yMaxHint ?? 0, ...values));
  const band = (width - pad.left - pad.right) / groups.length;
  const barWidth = Math.min(24, (band - 16) / seriesNames.length - 2);
  const py = (y: number) => pad.top + (1 - y / yMax) * (height - pad.top - pad.bottom);
  const base = height - pad.bottom;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * yMax);
  const showValues = groups.length * seriesNames.length <= 16;
  return (
    <div className="cs-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id} onMouseLeave={() => setHover(null)}>
        <title id={id}>{label}</title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={py(tick)} y2={py(tick)} stroke={GRID} strokeWidth={1} />
            <text x={pad.left - 8} y={py(tick) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{formatY(tick)}</text>
          </g>
        ))}
        {groups.map((group, groupIndex) => {
          const center = pad.left + band * groupIndex + band / 2;
          const total = seriesNames.length * barWidth + (seriesNames.length - 1) * 2;
          return (
            <g key={group.label} onMouseEnter={() => setHover(groupIndex)}>
              <rect x={pad.left + band * groupIndex} y={pad.top} width={band} height={base - pad.top} fill={hover === groupIndex ? "#f3f7fd" : "transparent"} />
              {group.values.map((value, seriesIndex) => {
                if (value === null) return null;
                const x = center - total / 2 + seriesIndex * (barWidth + 2);
                const top = py(value);
                const barHeight = Math.max(0, base - top);
                const radius = Math.min(4, barHeight, barWidth / 2);
                return (
                  <g key={seriesNames[seriesIndex]}>
                    <path d={`M${x},${base} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + barWidth - radius} Q${x + barWidth},${top} ${x + barWidth},${top + radius} V${base} Z`} fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]} />
                    {showValues && <text x={x + barWidth / 2} y={top - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill={INK}>{formatY(value)}</text>}
                  </g>
                );
              })}
              <text x={center} y={base + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{group.label}</text>
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={base} y2={base} stroke="#cfd8e6" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div className="cs-chart-tip" style={{ left: `${((pad.left + band * hover + band / 2) / width) * 100}%`, top: 4, transform: "translate(-50%, 0)" }}>
          <strong>{groups[hover].label}</strong>
          {seriesNames.map((name, index) => <span key={name}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />{name}: {groups[hover].values[index] === null ? "sin dato" : formatY(groups[hover].values[index] as number)}</span>)}
        </div>
      )}
      {seriesNames.length > 1 && <Legend items={seriesNames.map((name, index) => ({ label: name, color: SERIES_COLORS[index % SERIES_COLORS.length] }))} />}
    </div>
  );
}

/** Barras horizontales de una sola serie con el valor al final de cada barra. */
export function BarList({ items, format, max, empty }: { items: Array<{ label: string; value: number | null; hint?: string }>; format: (value: number) => string; max?: number; empty?: ReactNode }) {
  const top = max ?? Math.max(0, ...items.map((item) => item.value ?? 0));
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <div className="cs-bars">
      {items.map((item) => (
        <div key={item.label} className="cs-bar" title={item.hint}>
          <span>{item.label}</span>
          <div className="cs-bar-track">{item.value !== null && item.value > 0 && top > 0 && <i style={{ width: `${Math.min(100, (item.value / top) * 100)}%` }} />}</div>
          <b>{item.value === null ? "—" : format(item.value)}</b>
        </div>
      ))}
    </div>
  );
}

/** Una barra segmentada (partes de un total) con separación de 2 px y leyenda con valores. */
export function SegmentBar({ segments, format, label }: { segments: Array<{ label: string; value: number; color: string }>; format: (value: number, share: number) => string; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;
  return (
    <div role="img" aria-label={label}>
      <div style={{ display: "flex", gap: 2, height: 22 }}>
        {segments.filter((segment) => segment.value > 0).map((segment) => <div key={segment.label} title={`${segment.label}: ${format(segment.value, segment.value / total)}`} style={{ flex: `${segment.value} 0 0`, minWidth: 3, background: segment.color, borderRadius: 4 }} />)}
      </div>
      <div className="cs-legend">{segments.map((segment) => <span key={segment.label}><i style={{ background: segment.color }} />{segment.label}: <strong style={{ color: INK }}>{format(segment.value, segment.value / total)}</strong></span>)}</div>
    </div>
  );
}
