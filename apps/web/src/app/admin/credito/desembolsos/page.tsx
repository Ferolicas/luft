"use client";

import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { PersonCell, usePeople } from "@/components/admin/people";
import { Button, Cell, ConfirmDialog, DataTable, Empty, ErrorBox, Field, FormActions, Loaded, Modal, PageHead, Pager, Panel, StatusBadge, Tabs, useAction, useLoad } from "@/components/admin/ui";
import { type Disbursement, PRODUCT_CODE_LABEL } from "@/lib/admin/credit-types";
import { cop, date, dateTime, shortId, today } from "@/lib/admin/format";
import { get, type Paged, query, send } from "@/lib/admin/http";
import { DISBURSEMENT_STATUS_LABEL, label } from "@/lib/admin/labels";
import { can } from "@/lib/admin/nav";

type Filter = "PENDING" | "COMPLETED" | "CANCELLED" | "";

export default function DisbursementsPage() {
  const { user, notify } = useConsole();
  const people = usePeople();
  const [status, setStatus] = useState<Filter>("PENDING");
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState<Disbursement | null>(null);
  const [cancelling, setCancelling] = useState<Disbursement | null>(null);
  const list = useLoad(() => get<Paged<Disbursement>>(`/admin/disbursements${query({ page, status })}`), [page, status]);
  const canRegister = can("registerDisbursement", user.role);

  return (
    <>
      <PageHead
        eyebrow="Crédito STARTIF"
        title="Desembolsos"
        description="La plataforma nunca ordena ni simula un giro. Finanzas gira por fuera y registra aquí la referencia y la fecha reales: solo entonces nace el crédito y empiezan a contar sus cuotas."
      />
      <Tabs<Filter>
        value={status}
        onChange={(key) => { setStatus(key); setPage(1); }}
        items={[{ key: "PENDING", label: "Pendientes de giro" }, { key: "COMPLETED", label: "Registrados" }, { key: "CANCELLED", label: "Cancelados" }, { key: "", label: "Todos" }]}
      />
      <Panel flush>
        <Loaded loader={list} label="Cargando desembolsos…">
          {(data) => (
            <>
              <DataTable
                caption="Desembolsos"
                rows={data.items}
                rowKey={(row) => row.id}
                empty={<Empty title={status === "PENDING" ? "No hay giros pendientes" : "No hay desembolsos en este estado"}>{status === "PENDING" ? "Cuando riesgo apruebe un crédito con giro de dinero, aparecerá aquí para que finanzas lo registre." : undefined}</Empty>}
                columns={[
                  { key: "created", header: "Creado", cell: (row) => <Cell main={date(row.createdAt)} sub={<span className="cs-mono">Solicitud {shortId(row.applicationId)}</span>} /> },
                  { key: "person", header: "Persona", cell: (row) => <PersonCell id={row.userId} people={people} /> },
                  { key: "product", header: "Producto", cell: (row) => <Cell main={PRODUCT_CODE_LABEL[row.productCode] ?? row.productCode} sub={label(row.kind)} /> },
                  { key: "purpose", header: "Finalidad", cell: (row) => label(row.purpose) },
                  { key: "amount", header: "Monto", align: "right", cell: (row) => <strong>{cop(row.amountCOP)}</strong> },
                  { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} labels={DISBURSEMENT_STATUS_LABEL} /> },
                  { key: "reference", header: "Giro", cell: (row) => (row.status === "COMPLETED" ? <Cell main={row.reference ?? "Sin giro de dinero"} sub={`${dateTime(row.disbursedAt)}${row.channel ? ` · ${row.channel}` : ""}`} /> : row.note ? <span className="cs-small">{row.note}</span> : <span className="cs-muted">—</span>) },
                  {
                    key: "actions",
                    header: "",
                    align: "right",
                    cell: (row) => row.status === "PENDING" && row.kind === "TRANSFER" && canRegister ? (
                      <div className="cs-actions">
                        <Button small onClick={() => setRegistering(row)}>Registrar giro</Button>
                        <Button small variant="ghost" className="cs-btn-danger-text" onClick={() => setCancelling(row)}>Cancelar</Button>
                      </div>
                    ) : null,
                  },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="desembolsos" />
            </>
          )}
        </Loaded>
      </Panel>
      {!canRegister && <p className="cs-note">Registrar o cancelar un giro corresponde al rol de finanzas o a la superadministración.</p>}
      {registering && (
        <RegisterForm
          disbursement={registering}
          onClose={() => setRegistering(null)}
          onDone={async () => {
            setRegistering(null);
            notify("Giro registrado. El crédito quedó vigente con su plan de cuotas.");
            await list.reload();
          }}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancelar el desembolso"
          confirmLabel="Cancelar desembolso"
          danger
          reason={{ label: "Motivo de la cancelación", min: 10, placeholder: "Ej.: la persona desistió del crédito antes del giro." }}
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await send("POST", `/admin/disbursements/${cancelling.id}/cancel`, { reason });
            notify("Desembolso cancelado. La solicitud quedó cerrada sin crédito.");
            await list.reload();
          }}
        >
          <p>El giro de <strong>{cop(cancelling.amountCOP)}</strong> no se hará y la solicitud aprobada se cerrará sin crédito. Esta acción no se puede deshacer.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function RegisterForm({ disbursement, onClose, onDone }: { disbursement: Disbursement; onClose: () => void; onDone: () => Promise<void> }) {
  const [reference, setReference] = useState("");
  const [disbursedAt, setDisbursedAt] = useState(today());
  const [channel, setChannel] = useState("");
  const [note, setNote] = useState("");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await action.run(async () => {
      await send("POST", `/admin/disbursements/${disbursement.id}/register`, { reference: reference.trim(), disbursedAt, channel: channel.trim() || undefined, note: note.trim() || undefined });
      await onDone();
    });
  };
  return (
    <Modal title="Registrar giro realizado" description={`${cop(disbursement.amountCOP)} · ${label(disbursement.purpose)}`} onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <p className="cs-note">Registra un giro que <strong>ya se hizo</strong>. Con la referencia y la fecha se crea el crédito y su plan de cuotas cuenta desde ese día. No se puede deshacer.</p>
        <div className="cs-fields">
          <Field label="Referencia bancaria" required hint="Número de transacción o comprobante (mínimo 4 caracteres). No puede repetirse."><input value={reference} onChange={(event) => setReference(event.target.value)} minLength={4} maxLength={160} required /></Field>
          <Field label="Fecha del giro" required hint="No puede ser futura ni anterior a la aprobación."><input type="date" value={disbursedAt} max={today()} onChange={(event) => setDisbursedAt(event.target.value)} required /></Field>
          <Field label="Canal" hint="Opcional. Ej.: transferencia ACH, Bancolombia."><input value={channel} onChange={(event) => setChannel(event.target.value)} maxLength={80} /></Field>
          <Field label="Nota" hint="Opcional."><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></Field>
        </div>
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Registrar giro y abrir el crédito" />
      </form>
    </Modal>
  );
}
