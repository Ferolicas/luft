"use client";

import { Eraser } from "lucide-react";
import { PointerEvent, useEffect, useRef, useState } from "react";

interface Point { x: number; y: number; t: number; p: number }
export function SignaturePad({ onChange }: { onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const active = useRef(false); const current = useRef<Point[]>([]); const [strokes, setStrokes] = useState<Point[][]>([]);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const ratio = window.devicePixelRatio || 1; const rect = canvas.getBoundingClientRect(); canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; const context = canvas.getContext("2d"); if (context) context.scale(ratio, ratio); }, []);
  function point(event: PointerEvent<HTMLCanvasElement>): Point { const rect = event.currentTarget.getBoundingClientRect(); return { x: Number((event.clientX - rect.left).toFixed(2)), y: Number((event.clientY - rect.top).toFixed(2)), t: Date.now(), p: Number(event.pressure.toFixed(3)) }; }
  function start(event: PointerEvent<HTMLCanvasElement>) { event.currentTarget.setPointerCapture(event.pointerId); active.current = true; current.current = [point(event)]; }
  function move(event: PointerEvent<HTMLCanvasElement>) { if (!active.current) return; const next = point(event); const previous = current.current.at(-1); current.current.push(next); const context = event.currentTarget.getContext("2d"); if (!context || !previous) return; context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(next.x, next.y); context.strokeStyle = "#10214b"; context.lineWidth = Math.max(1.8, 3.2 * (next.p || .5)); context.lineCap = "round"; context.lineJoin = "round"; context.stroke(); }
  function end() { if (!active.current) return; active.current = false; const next = [...strokes, current.current]; setStrokes(next); onChange(JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, strokes: next })); current.current = []; }
  function clear() { const canvas = canvasRef.current; canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); setStrokes([]); onChange(""); }
  return <div className="signature-pad"><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-label="Área para dibujar tu firma" /><span>Firma dentro del recuadro</span><button type="button" onClick={clear}><Eraser size={15} /> Limpiar</button></div>;
}
