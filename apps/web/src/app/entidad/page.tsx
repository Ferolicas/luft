"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PortalLoaded } from "@/components/admin/portal";
import { Badge, Cell, DataTable, Empty, Loaded, PageHead, Pager, Panel, Stat, StatusBadge, Tabs, useLoad } from "@/components/admin/ui";
import { cop, date, percent, points } from "@/lib/admin/format";
import { get, type Paged, query } from "@/lib/admin/http";
import type { InstPresentation } from "@/lib/admin/matching-types";

interface Me { institution: { id: string; name: string; kind: string }; totals: Array<{ status: string; label: string; count: number }> }
const KIND_LABEL: Record<string, string> = { BANCO: "Banco", COMPANIA_FINANCIAMIENTO: "Compañía de financiamiento", COOPERATIVA: "Cooperativa", FINTECH: "Fintech", MICROFINANCIERA: "Microfinanciera", FONDO_EMPLEADOS: "Fondo de empleados", CAJA_COMPENSACION: "Caja de compensación", OTRA: "Entidad financiera" };

export default function InstitutionHome() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const me = useLoad(() => get<Me>("/institution/me"), []);
  const presentations = useLoad(() => get<Paged<InstPresentation>>(`/institution/presentations${query({ page, status })}`), [page, status]);

  return (
    <PortalLoaded loader={me} linkCode="institution_link_required" partner="entidad financiera">
      {(data) => {
        const total = data.totals.reduce((sum, item) => sum + item.count, 0);
        return (
          <>
            <PageHead
              eyebrow={KIND_LABEL[data.institution.kind] ?? "Entidad financiera"}
              title={data.institution.name}
              description="Personas que autorizaron a LUFT a presentarte su perfil para uno de tus productos. Solo ves los datos que cada persona autorizó compartir, y solo mientras el caso está en estudio o aprobado."
            />
            <div className="cs-stats">
              <Stat label="Presentaciones recibidas" value={total} />
              {data.totals.map((item) => <Stat key={item.status} label={item.label} value={item.count} tone={item.status === "PRESENTADA" && item.count > 0 ? "warn" : undefined} hint={item.status === "PRESENTADA" ? "Esperan tu decisión" : undefined} />)}
            </div>
            <Tabs
              value={status}
              onChange={(key) => { setStatus(key); setPage(1); }}
              items={[{ key: "", label: "Todas", count: total }, ...data.totals.map((item) => ({ key: item.status, label: item.label, count: item.count }))]}
            />
            <Panel flush>
              <Loaded loader={presentations} label="Cargando presentaciones…">
                {(list) => (
                  <>
                    <DataTable
                      caption="Presentaciones de tu entidad"
                      rows={list.items}
                      rowKey={(row) => row.id}
                      onRowClick={(row) => router.push(`/entidad/presentaciones/${row.id}`)}
                      empty={<Empty title={status ? "No hay presentaciones en este estado" : "Aún no has recibido presentaciones"}>{status ? undefined : "Cuando LUFT te presente el perfil de una persona que lo autorizó, aparecerá aquí."}</Empty>}
                      columns={[
                        { key: "applicant", header: "Persona", cell: (row) => <Cell main={row.applicantName ?? "Datos no disponibles"} sub={row.presentedAt ? `Presentada el ${date(row.presentedAt)}${row.presentationChannel ? ` · ${row.presentationChannel}` : ""}` : undefined} /> },
                        { key: "product", header: "Producto", cell: (row) => <Cell main={row.product.name} sub={`Política versión ${row.policy.version}`} /> },
                        { key: "fit", header: "Encaje con tu política", cell: (row) => <Cell main={points(row.match.fitPercent, 0)} sub={<StatusBadge value={row.match.status} />} /> },
                        { key: "status", header: "Estado", cell: (row) => <div className="cs-chips"><StatusBadge value={row.status} text={row.statusLabel} />{row.requiresException && <Badge tone="warn">Con excepción</Badge>}</div> },
                        { key: "outcome", header: "Decisión", cell: (row) => (row.status === "APROBADA" ? <Cell main={cop(row.approvedAmountCOP)} sub={`${percent(row.approvedRateEA)} E.A. · ${row.approvedTermMonths} meses`} /> : row.decisionReason ? <span className="cs-small">{row.decisionReason}</span> : <span className="cs-muted">Pendiente</span>) },
                        { key: "open", header: "", align: "right", cell: (row) => <span className="cs-link">{row.canDecide ? "Revisar y decidir" : "Ver"}</span> },
                      ]}
                    />
                    <Pager page={list.page} pages={list.pages} total={list.total} onPage={setPage} noun="presentaciones" />
                  </>
                )}
              </Loaded>
            </Panel>
          </>
        );
      }}
    </PortalLoaded>
  );
}
