"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Chip, Field, Header, Icon, Loading, Screen } from "@/components/luft/ui";
import { api, errorMessage } from "@/lib/api";
import { statusLabel } from "@/lib/credit";

interface Pqr { id: string; type: string; subject: string; status: string; dueAt: string; createdAt: string }
const STATUS: Record<string, string> = { OPEN: "Abierta", IN_REVIEW: "En revisión", WAITING_USER: "Esperando tu respuesta", RESOLVED: "Resuelta", CLOSED: "Cerrada" };

export default function PqrPage() {
  const [rows, setRows] = useState<Pqr[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");
  const load = () => api<Pqr[]>("/startif/pqr").then(setRows).catch((cause) => { setRows([]); setFailure(errorMessage(cause)); });
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFailure(""); setMessage("");
    const target = event.currentTarget; const form = new FormData(target);
    try { await api("/startif/pqr", { method: "POST", body: JSON.stringify({ type: form.get("type"), subject: form.get("subject"), message: form.get("message") }) }); target.reset(); setMessage("Recibimos tu solicitud. Puedes seguir su estado aquí."); await load(); }
    catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Header back="/app/perfil" title="Cuéntanos qué necesitas" subtitle="Cada petición, queja, reclamo o consulta tiene seguimiento y fecha de respuesta." />
      <div className="l-body">
        {message && <Alert type="success">{message}</Alert>}
        {failure && <Alert>{failure}</Alert>}
        <Card as="div"><form className="l-stack" style={{ gap: 16 }} onSubmit={submit}>
          <strong style={{ fontWeight: 500 }}>Nueva solicitud</strong>
          <Field label="Tipo" trailing={<Icon name="keyboard_arrow_down" />}><select name="type" required><option value="CONSULTA">Consulta</option><option value="PETICION">Petición</option><option value="QUEJA">Queja</option><option value="RECLAMO">Reclamo</option></select></Field>
          <Field label="Asunto"><input name="subject" minLength={5} maxLength={180} required /></Field>
          <Field label="Mensaje"><textarea name="message" minLength={20} maxLength={8000} required /></Field>
          <Button type="submit" arrow disabled={busy}>{busy ? "Enviando…" : "Enviar solicitud"}</Button>
        </form></Card>
        <div className="l-section-title"><h2>Mis solicitudes</h2></div>
        {rows === null ? <Loading /> : rows.length === 0 ? <div className="l-empty"><Icon name="help" size={28} />Aún no tienes solicitudes. Cuando envíes una, podrás seguirla aquí.</div>
          : <Card className="flush"><div className="l-list">{rows.map((row) => <div key={row.id}><span className="l-grow"><small>{row.type}</small><strong>{row.subject}</strong><small>Creada el {new Date(row.createdAt).toLocaleDateString("es-CO")} · Límite {new Date(row.dueAt).toLocaleDateString("es-CO")}</small></span><Chip tone={["RESOLVED", "CLOSED"].includes(row.status) ? "green" : "blue"} dot>{STATUS[row.status] ?? statusLabel(row.status)}</Chip></div>)}</div></Card>}
      </div>
    </Screen>
  );
}
