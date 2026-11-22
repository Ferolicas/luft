"use client";

import { useState } from "react";
import { useConsole } from "@/components/app-shell";
import { PersonCell, usePeople } from "@/components/admin/people";
import { Badge, Button, Cell, ConfirmDialog, DataTable, Empty, Loaded, PageHead, Pager, Panel, StatusBadge, Tabs, useLoad } from "@/components/admin/ui";
import { type Loan, PRODUCT_CODE_LABEL } from "@/lib/admin/credit-types";
import { cop, date, percent, shortId } from "@/lib/admin/format";
import { get, type Paged, query, send } from "@/lib/admin/http";
import { label } from "@/lib/admin/labels";
import { can } from "@/lib/admin/nav";

type Filter = "" | "ACTIVE" | "DEFAULTED" | "COMPLETED" | "WRITTEN_OFF";
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Vigente", DEFAULTED: "En mora", COMPLETED: "Pagado", WRITTEN_OFF: "Castigado" };

export default function PortfolioPage() {
  const { user, notify } = useConsole();
  const people = usePeople();
  const [status, setStatus] = useState<Filter>("");
  const [page, setPage] = useState(1);
  const [writeOff, setWriteOff] = useState<Loan | null>(null);
  const loans = useLoad(() => get<Paged<Loan>>(`/admin/loans${query({ page, status })}`), [page, status]);
  const canWriteOff = can("writeOff", user.role);

  return (
    <>
      <PageHead
        eyebrow="Crédito STARTIF"
        title="Cartera"
        description="Préstamos por estado con su comportamiento de pago. Un crédito pasa a mora automáticamente según los días de atraso de su producto; el castigo es una decisión manual de finanzas sobre un crédito en mora."
      />
      <Tabs<Filter>
        value={status}
        onChange={(key) => { setStatus(key); setPage(1); }}
        items={[{ key: "", label: "Todos" }, { key: "ACTIVE", label: "Vigentes" }, { key: "DEFAULTED", label: "En mora" }, { key: "COMPLETED", label: "Pagados" }, { key: "WRITTEN_OFF", label: "Castigados" }]}
      />
      <Panel flush>
        <Loaded loader={loans} label="Cargando cartera…">
          {(data) => (
            <>
              <DataTable
                caption="Préstamos"
                rows={data.items}
                rowKey={(row) => row.id}
                empty={<Empty title="No hay préstamos en este estado" />}
                columns={[
                  { key: "loan", header: "Crédito", cell: (row) => <Cell main={<span className="cs-mono">{shortId(row.id)}</span>} sub={`${PRODUCT_CODE_LABEL[row.productCode] ?? row.productCode} · ${label(row.purpose)}`} /> },
                  { key: "person", header: "Persona", cell: (row) => <PersonCell id={row.userId} people={people} /> },
                  { key: "principal", header: "Capital", align: "right", cell: (row) => <Cell main={cop(row.principalCOP)} sub={`${percent(Number(row.monthlyRate))} mensual`} /> },
                  { key: "balance", header: "Saldo de capital", align: "right", cell: (row) => <strong>{cop(row.outstandingBalanceCOP)}</strong> },
                  { key: "installments", header: "Cuotas", align: "center", cell: (row) => `${row.installmentsPaid} de ${row.installmentsTotal}` },
                  {
                    key: "arrears",
                    header: "Mora",
                    cell: (row) => row.overdueInstallments > 0
                      ? <Cell main={<Badge tone="bad">{row.daysOverdue} días de atraso</Badge>} sub={`${row.overdueInstallments} ${row.overdueInstallments === 1 ? "cuota vencida" : "cuotas vencidas"} · ${cop(row.overdueCOP)}`} />
                      : <span className="cs-muted">Sin atrasos</span>,
                  },
                  { key: "status", header: "Estado", cell: (row) => <Cell main={<StatusBadge value={row.status} labels={STATUS_LABEL} />} sub={row.status === "WRITTEN_OFF" ? `Castigado el ${date(row.writtenOffAt)}` : row.status === "DEFAULTED" && row.defaultedAt ? `En mora desde ${date(row.defaultedAt)}` : undefined} /> },
                  { key: "disbursed", header: "Desembolso", cell: (row) => date(row.disbursedAt) },
                  { key: "actions", header: "", align: "right", cell: (row) => (row.status === "DEFAULTED" && canWriteOff ? <Button small variant="ghost" className="cs-btn-danger-text" onClick={() => setWriteOff(row)}>Castigar</Button> : row.status === "WRITTEN_OFF" && row.writtenOffReason ? <span className="cs-small cs-muted" title={row.writtenOffReason}>{row.writtenOffReason.slice(0, 40)}{row.writtenOffReason.length > 40 ? "…" : ""}</span> : null) },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="préstamos" />
            </>
          )}
        </Loaded>
      </Panel>
      {writeOff && (
        <ConfirmDialog
          title="Castigar el crédito"
          confirmLabel="Castigar cartera"
          danger
          reason={{ label: "Motivo del castigo", min: 10, placeholder: "Ej.: 120 días de mora, gestión de cobro agotada, acta del comité de cartera n.º 14." }}
          onClose={() => setWriteOff(null)}
          onConfirm={async (reason) => {
            await send("POST", `/admin/loans/${writeOff.id}/write-off`, { reason });
            notify("Crédito castigado. Quedó registrado en la auditoría.");
            await loans.reload();
          }}
        >
          <p>Vas a castigar el crédito <span className="cs-mono">{shortId(writeOff.id)}</span> con saldo de capital de <strong>{cop(writeOff.outstandingBalanceCOP)}</strong> y <strong>{writeOff.daysOverdue} días</strong> de atraso.</p>
          <p>El castigo es <strong>irreversible</strong>: el crédito sale de la cartera activa y la solicitud queda como castigada.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
