"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PersonCell, usePeople } from "@/components/admin/people";
import { Cell, DataTable, Empty, Loaded, PageHead, Pager, Panel, Toolbar, useLoad } from "@/components/admin/ui";
import { dateTime, shortId } from "@/lib/admin/format";
import { get, type Paged, query } from "@/lib/admin/http";
import type { RunRow } from "@/lib/admin/matching-types";

export default function RunsPage() {
  const router = useRouter();
  const people = usePeople();
  const [userId, setUserId] = useState("");
  const [page, setPage] = useState(1);
  const runs = useLoad(() => get<Paged<RunRow>>(`/admin/matching/runs${query({ page, userId })}`), [page, userId]);
  const options = people ? [...people.values()].filter((person) => person.role === "USER").sort((a, b) => a.fullName.localeCompare(b.fullName)) : [];
  return (
    <>
      <PageHead
        eyebrow="Políticas y matching"
        title="Ejecuciones de matching"
        description="Cada ejecución guarda la instantánea cifrada de los hechos de la persona, su huella y la versión de política de cada resultado. Con eso se puede volver a calcular y comprobar que el resultado es reproducible."
      />
      <Panel flush>
        <Toolbar>
          <label>
            Persona
            <select value={userId} onChange={(event) => { setUserId(event.target.value); setPage(1); }}>
              <option value="">Todas</option>
              {options.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
            </select>
          </label>
        </Toolbar>
        <Loaded loader={runs} label="Cargando ejecuciones…">
          {(data) => (
            <>
              <DataTable
                caption="Ejecuciones de matching"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/matching/ejecuciones/${row.id}`)}
                empty={<Empty title="No hay ejecuciones">Se registran cuando una persona busca oportunidades desde su app.</Empty>}
                columns={[
                  { key: "run", header: "Ejecución", cell: (row) => <Cell main={<span className="cs-mono">{shortId(row.id)}</span>} sub={dateTime(row.createdAt)} /> },
                  { key: "person", header: "Persona", cell: (row) => <PersonCell id={row.userId} people={people} /> },
                  { key: "engine", header: "Motor", cell: (row) => <span className="cs-mono">{row.engineVersion}</span> },
                  { key: "trigger", header: "Origen", cell: (row) => (row.trigger === "USER" ? "La persona" : row.trigger) },
                  { key: "products", header: "Productos evaluados", align: "center", cell: (row) => row.productsEvaluated },
                  { key: "eligible", header: "Elegibles", align: "center", cell: (row) => row.eligibleCount },
                  { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Ver y verificar</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="ejecuciones" />
            </>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
