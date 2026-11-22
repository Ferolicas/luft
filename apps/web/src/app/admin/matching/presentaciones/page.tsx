"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Cell, DataTable, Empty, Loaded, PageHead, Pager, Panel, StatusBadge, Toolbar, useLoad } from "@/components/admin/ui";
import { cop, date, percent, points } from "@/lib/admin/format";
import { get, type Paged, query } from "@/lib/admin/http";
import { type Institution, PRESENTATION_STATUSES, type StaffPresentation } from "@/lib/admin/matching-types";

export default function PresentationsPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [page, setPage] = useState(1);
  const institutions = useLoad(() => get<Paged<Institution>>("/admin/matching/institutions"), []);
  const presentations = useLoad(() => get<Paged<StaffPresentation>>(`/admin/matching/presentations${query({ page, status, institutionId })}`), [page, status, institutionId]);
  return (
    <>
      <PageHead
        eyebrow="Políticas y matching"
        title="Presentaciones a entidades"
        description="Una presentación existe solo cuando la persona autorizó expresamente compartir sus datos con esa entidad para ese producto. Aquí se registra el envío y, después, la decisión de la entidad."
      />
      <Panel flush>
        <Toolbar>
          <label>
            Estado
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">Todos</option>
              {PRESENTATION_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Entidad
            <select value={institutionId} onChange={(event) => { setInstitutionId(event.target.value); setPage(1); }}>
              <option value="">Todas</option>
              {(institutions.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </Toolbar>
        <Loaded loader={presentations} label="Cargando presentaciones…">
          {(data) => (
            <>
              <DataTable
                caption="Presentaciones"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/matching/presentaciones/${row.id}`)}
                empty={<Empty title="No hay presentaciones">Aparecen cuando una persona autoriza presentar su perfil a una entidad desde sus oportunidades.</Empty>}
                columns={[
                  { key: "person", header: "Persona", cell: (row) => <Cell main={row.user.fullName} sub={`Autorizó el ${date(row.authorizedAt)}`} /> },
                  { key: "product", header: "Producto", cell: (row) => <Cell main={row.product.name} sub={row.institution.name} /> },
                  { key: "match", header: "Encaje", cell: (row) => <Cell main={points(row.match.fitPercent, 0)} sub={<StatusBadge value={row.match.status} />} /> },
                  { key: "policy", header: "Política", align: "center", cell: (row) => `v${row.policy.version}` },
                  { key: "status", header: "Estado", cell: (row) => <div className="cs-chips"><StatusBadge value={row.status} text={row.statusLabel} />{row.requiresException && <Badge tone="warn">Con excepción</Badge>}</div> },
                  { key: "outcome", header: "Resultado", cell: (row) => (row.status === "APROBADA" ? <Cell main={cop(row.approvedAmountCOP)} sub={`${percent(row.approvedRateEA)} E.A. · ${row.approvedTermMonths} meses`} /> : row.decisionReason ? <span className="cs-small">{row.decisionReason}</span> : row.presentedAt ? <span className="cs-small cs-muted">Enviada el {date(row.presentedAt)}{row.presentationChannel ? ` · ${row.presentationChannel}` : ""}</span> : <span className="cs-muted">—</span>) },
                  { key: "open", header: "", align: "right", cell: (row) => <span className="cs-link">{row.allowedActions.includes("present") ? "Presentar" : row.allowedActions.includes("decide") ? "Registrar decisión" : "Ver"}</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="presentaciones" />
            </>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
