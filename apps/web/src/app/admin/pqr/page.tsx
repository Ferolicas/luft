"use client";

import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { PersonCell, usePeople } from "@/components/admin/people";
import { Badge, Button, Cell, DataTable, Empty, ErrorBox, Facts, Field, FormActions, Loaded, Modal, PageHead, Panel, StatusBadge, Toolbar, useAction, useLoad } from "@/components/admin/ui";
import type { Pqr } from "@/lib/admin/credit-types";
import { date, dateTime } from "@/lib/admin/format";
import { get, query, send } from "@/lib/admin/http";
import { label } from "@/lib/admin/labels";

const PAGE_SIZE = 25;
const STATUSES = ["OPEN", "IN_REVIEW", "WAITING_USER", "RESOLVED", "CLOSED"];
const NEXT_STATUSES = ["IN_REVIEW", "WAITING_USER", "RESOLVED", "CLOSED"];
const ASSIGNABLE = [{ value: "SUPPORT", label: "Soporte" }, { value: "LEGAL", label: "Legal" }, { value: "COLLECTIONS", label: "Cartera y cobranza" }];
const closed = (status: string) => status === "RESOLVED" || status === "CLOSED";

export default function PqrPage() {
  const { notify } = useConsole();
  const people = usePeople();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Pqr | null>(null);
  const list = useLoad(() => get<Pqr[]>(`/admin/pqr${query({ page, status })}`), [page, status]);

  return (
    <>
      <PageHead eyebrow="Operación" title="Peticiones, quejas y reclamos" description="Ordenadas por fecha de vencimiento. La respuesta que escribas es la que verá la persona en su app." />
      <Panel flush>
        <Toolbar>
          <label>
            Estado
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">Todos</option>
              {STATUSES.map((item) => <option key={item} value={item}>{label(item)}</option>)}
            </select>
          </label>
        </Toolbar>
        <Loaded loader={list} label="Cargando PQR…">
          {(rows) => (
            <>
              <DataTable
                caption="PQR"
                rows={rows}
                rowKey={(row) => row.id}
                onRowClick={setSelected}
                empty={<Empty title={page > 1 ? "No hay más PQR" : "No hay PQR en este estado"} />}
                columns={[
                  { key: "type", header: "Tipo", cell: (row) => <Badge>{label(row.type)}</Badge> },
                  { key: "subject", header: "Asunto", cell: (row) => <Cell main={row.subject} sub={row.message.length > 110 ? `${row.message.slice(0, 110)}…` : row.message} /> },
                  { key: "person", header: "Persona", cell: (row) => <PersonCell id={row.userId} people={people} /> },
                  { key: "assigned", header: "Área", cell: (row) => ASSIGNABLE.find((item) => item.value === row.assignedRole)?.label ?? "—" },
                  { key: "due", header: "Vence", cell: (row) => <Cell main={date(row.dueAt)} sub={!closed(row.status) && new Date(row.dueAt) < new Date() ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>Vencida</span> : `Creada ${date(row.createdAt)}`} /> },
                  { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} /> },
                  { key: "open", header: "", align: "right", cell: (row) => <span className="cs-link">{closed(row.status) ? "Ver" : "Gestionar"}</span> },
                ]}
              />
              <nav className="cs-pager" aria-label="Paginación">
                <span>Página {page}</span>
                <div>
                  <Button variant="ghost" small disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                  <Button variant="ghost" small disabled={rows.length < PAGE_SIZE} onClick={() => setPage(page + 1)}>Siguiente</Button>
                </div>
              </nav>
            </>
          )}
        </Loaded>
      </Panel>
      {selected && (
        <PqrDialog
          pqr={selected}
          person={<PersonCell id={selected.userId} people={people} />}
          onClose={() => setSelected(null)}
          onSaved={async (nextStatus) => {
            setSelected(null);
            notify(`PQR actualizada: ${label(nextStatus).toLowerCase()}.`);
            await list.reload();
          }}
        />
      )}
    </>
  );
}

function PqrDialog({ pqr, person, onClose, onSaved }: { pqr: Pqr; person: React.ReactNode; onClose: () => void; onSaved: (status: string) => Promise<void> }) {
  const [status, setStatus] = useState(pqr.status === "OPEN" ? "IN_REVIEW" : NEXT_STATUSES.includes(pqr.status) ? pqr.status : "IN_REVIEW");
  const [resolution, setResolution] = useState("");
  const [assignedRole, setAssignedRole] = useState(pqr.assignedRole ?? "SUPPORT");
  const action = useAction();
  const done = closed(pqr.status);
  const needsResolution = status === "RESOLVED";
  const resolutionError = resolution.trim().length > 0 && resolution.trim().length < 10 ? "Escribe al menos 10 caracteres." : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await action.run(async () => {
      await send("PATCH", `/admin/pqr/${pqr.id}`, { status, assignedRole, resolution: resolution.trim() || undefined });
      await onSaved(status);
    });
  };
  return (
    <Modal title={pqr.subject} description={`${label(pqr.type)} · ${label(pqr.status)}`} size="lg" onClose={onClose}>
      <Facts
        columns={3}
        items={[
          { label: "Persona", value: person },
          { label: "Creada", value: dateTime(pqr.createdAt) },
          { label: "Vence", value: date(pqr.dueAt) },
          { label: "Mensaje de la persona", value: <span style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>{pqr.message}</span>, wide: true },
          ...(pqr.resolution ? [{ label: `Respuesta${pqr.resolvedAt ? ` (${dateTime(pqr.resolvedAt)})` : ""}`, value: <span style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>{pqr.resolution}</span>, wide: true }] : []),
        ]}
      />
      {done ? <p className="cs-note">Esta PQR ya está {label(pqr.status).toLowerCase()}.</p> : (
        <form className="cs-form" onSubmit={submit}>
          <div className="cs-fields">
            <Field label="Nuevo estado" required>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>{NEXT_STATUSES.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
            </Field>
            <Field label="Área responsable" required>
              <select value={assignedRole} onChange={(event) => setAssignedRole(event.target.value)}>{ASSIGNABLE.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </Field>
            <Field label="Respuesta para la persona" wide required={needsResolution} error={resolutionError} hint={needsResolution ? "Obligatoria para resolver. Mínimo 10 caracteres." : "Opcional en este estado."}>
              <textarea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={4} maxLength={8000} required={needsResolution} />
            </Field>
          </div>
          <ErrorBox problem={action.problem} />
          <FormActions busy={action.busy} onCancel={onClose} submitLabel="Guardar gestión" disabled={Boolean(resolutionError) || (needsResolution && resolution.trim().length < 10)} />
        </form>
      )}
    </Modal>
  );
}
