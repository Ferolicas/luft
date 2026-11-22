"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Cell, DataTable, Empty, Loaded, PageHead, Pager, Panel, StatusBadge, Toolbar, useLoad } from "@/components/admin/ui";
import { date, shortId } from "@/lib/admin/format";
import { CASE_STATUSES, type CaseRow, PATH_LABEL } from "@/lib/admin/formalization-types";
import { get, type Paged, query } from "@/lib/admin/http";

const NEXT_ACTION: Record<string, string> = { OBSERVE: "Revisar", APPROVE: "Revisar", MARK_FILED: "Registrar presentación", VERIFY: "Verificar evidencia" };

export default function CasesPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const cases = useLoad(() => get<Paged<CaseRow>>(`/admin/formalization/cases${query({ status, page })}`), [status, page]);
  return (
    <>
      <PageHead
        eyebrow="Formalización tributaria"
        title="Casos de formalización"
        description="Cola de revisión profesional. Cada caso nace de un diagnóstico automático (una alerta, no una determinación): aquí se revisa, se registra la presentación real ante la DIAN y se verifica la evidencia."
      />
      <Panel flush>
        <Toolbar>
          <label>
            Estado
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              {CASE_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </Toolbar>
        <Loaded loader={cases} label="Cargando casos…">
          {(data) => (
            <>
              <DataTable
                caption="Casos de formalización"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/formalizacion/casos/${row.id}`)}
                empty={<Empty title={status ? "No hay casos en este estado" : "No hay casos por revisar"}>{status ? undefined : "Cuando una persona envíe su caso a revisión aparecerá aquí."}</Empty>}
                columns={[
                  { key: "person", header: "Persona", cell: (row) => <Cell main={row.userName ?? shortId(row.userId)} sub={<span className="cs-mono">Caso {shortId(row.id)}</span>} /> },
                  { key: "year", header: "Año gravable", align: "center", cell: (row) => row.taxYear },
                  { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} text={row.statusLabel} /> },
                  { key: "diagnosis", header: "Diagnóstico", cell: (row) => (row.mayHaveToFile === null ? <span className="cs-muted">Sin evaluar</span> : <Badge tone={row.mayHaveToFile ? "warn" : "neutral"}>{row.mayHaveToFile ? "Posible obligación" : "Sin alerta"}</Badge>) },
                  { key: "path", header: "Vía", cell: (row) => (row.path ? PATH_LABEL[row.path] : "—") },
                  { key: "review", header: "Revisión", cell: (row) => (row.reviewApproved ? <Badge tone="good">Aprobada</Badge> : <span className="cs-muted">Pendiente</span>) },
                  { key: "submitted", header: "Enviado", cell: (row) => <Cell main={date(row.submittedAt)} sub={`Actualizado ${date(row.updatedAt)}`} /> },
                  { key: "open", header: "", align: "right", cell: (row) => <span className="cs-link">{row.actions.length > 0 ? (NEXT_ACTION[row.actions[row.actions.length - 1]] ?? "Abrir") : "Ver"}</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="casos" />
            </>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
