"use client";

import { useState } from "react";
import { PersonCell, usePeople } from "@/components/admin/people";
import { Button, Cell, DataTable, Empty, Facts, Loaded, Modal, PageHead, Panel, useLoad } from "@/components/admin/ui";
import type { AuditEvent } from "@/lib/admin/credit-types";
import { dateTime } from "@/lib/admin/format";
import { get } from "@/lib/admin/http";
import { ROLE_LABEL } from "@/lib/admin/nav";

const PAGE_SIZE = 50;

export default function AuditPage() {
  const people = usePeople();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const events = useLoad(() => get<AuditEvent[]>(`/admin/audit?page=${page}`), [page]);
  return (
    <>
      <PageHead eyebrow="Operación" title="Auditoría" description="Bitácora inmutable de accesos, decisiones y cambios. Cada evento encadena el hash del anterior, de modo que una alteración se detecta." />
      <Panel flush>
        <Loaded loader={events} label="Cargando la bitácora…">
          {(rows) => (
            <>
              <DataTable
                caption="Eventos de auditoría"
                rows={rows}
                rowKey={(row) => row.id}
                onRowClick={setSelected}
                empty={<Empty title={page > 1 ? "No hay más eventos" : "La bitácora está vacía"} />}
                columns={[
                  { key: "when", header: "Fecha", cell: (row) => dateTime(row.createdAt) },
                  { key: "actor", header: "Actor", cell: (row) => (row.actorUserId ? <Cell main={<PersonCell id={row.actorUserId} people={people} />} /> : <span className="cs-muted">Sistema</span>) },
                  { key: "role", header: "Rol", cell: (row) => (row.actorRole ? (ROLE_LABEL[row.actorRole] ?? row.actorRole) : "—") },
                  { key: "action", header: "Acción", cell: (row) => <code>{row.action}</code> },
                  { key: "resource", header: "Recurso", cell: (row) => <Cell main={row.resource} sub={row.resourceId ? <span className="cs-mono">{row.resourceId.slice(0, 13)}</span> : undefined} /> },
                  { key: "hash", header: "Integridad", cell: (row) => <span className="cs-mono" title={row.eventHash}>{row.eventHash.slice(0, 12)}…</span> },
                ]}
              />
              <nav className="cs-pager" aria-label="Paginación">
                <span>Página {page} · {PAGE_SIZE} eventos por página</span>
                <div>
                  <Button variant="ghost" small disabled={page <= 1} onClick={() => setPage(page - 1)}>Más recientes</Button>
                  <Button variant="ghost" small disabled={rows.length < PAGE_SIZE} onClick={() => setPage(page + 1)}>Anteriores</Button>
                </div>
              </nav>
            </>
          )}
        </Loaded>
      </Panel>
      {selected && (
        <Modal title={selected.action} description={dateTime(selected.createdAt)} size="lg" onClose={() => setSelected(null)}>
          <Facts
            columns={2}
            items={[
              { label: "Actor", value: selected.actorUserId ? <PersonCell id={selected.actorUserId} people={people} /> : "Sistema" },
              { label: "Rol", value: selected.actorRole ? (ROLE_LABEL[selected.actorRole] ?? selected.actorRole) : "—" },
              { label: "Recurso", value: selected.resource },
              { label: "Identificador", value: selected.resourceId ? <span className="cs-mono">{selected.resourceId}</span> : "—" },
              { label: "Hash del evento", value: <span className="cs-mono">{selected.eventHash}</span>, wide: true },
              { label: "Hash anterior", value: selected.previousHash ? <span className="cs-mono">{selected.previousHash}</span> : "Primer evento de la cadena", wide: true },
            ]}
          />
          <div>
            <strong className="cs-small">Datos registrados</strong>
            <pre className="cs-pre" style={{ marginTop: 6 }}>{selected.payload ? JSON.stringify(selected.payload, null, 2) : "Sin datos adicionales."}</pre>
          </div>
        </Modal>
      )}
    </>
  );
}
