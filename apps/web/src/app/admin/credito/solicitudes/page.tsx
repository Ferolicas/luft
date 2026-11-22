"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useConsole } from "@/components/app-shell";
import { PersonCell, usePeople } from "@/components/admin/people";
import { PlanTable } from "@/components/admin/plan-table";
import { Badge, Button, Cell, ConfirmDialog, DataTable, Empty, ErrorBox, Facts, Loaded, Loading, Modal, PageHead, Pager, Panel, StatusBadge, Toolbar, useLoad } from "@/components/admin/ui";
import { type Application, type Eligibility, PRODUCT_CODE_LABEL } from "@/lib/admin/credit-types";
import { cop, date, dateTime, percent, shortId, today } from "@/lib/admin/format";
import { get, type Paged, query, send } from "@/lib/admin/http";
import { APPLICATION_STATUSES, label } from "@/lib/admin/labels";
import { can } from "@/lib/admin/nav";

interface DecisionResult { applicationId?: string; id?: string; loanId?: string | null; disbursementId?: string | null; status: string }

const numberOf = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? null : Number(value));

export default function ApplicationsPage() {
  const { user, notify } = useConsole();
  const people = usePeople();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [selected, setSelected] = useState<Application | null>(null);
  const applications = useLoad(() => get<Paged<Application>>(`/admin/applications${query({ page, status })}`), [page, status]);
  const canDecide = can("decideApplication", user.role);

  return (
    <>
      <PageHead
        eyebrow="Crédito STARTIF"
        title="Solicitudes de crédito"
        description="Cada solicitud conserva el producto y la versión con la que se firmó el pagaré. La aprobación usa la tasa de ese producto: no se digita una tasa nueva."
      />
      <Panel flush>
        <Toolbar>
          <label>
            Estado
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">Todos</option>
              {APPLICATION_STATUSES.map((item) => <option key={item} value={item}>{label(item)}</option>)}
            </select>
          </label>
        </Toolbar>
        <Loaded loader={applications} label="Cargando solicitudes…">
          {(data) => (
            <>
              <DataTable
                caption="Solicitudes de crédito"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={setSelected}
                empty={<Empty title="No hay solicitudes en este estado">{status === "PENDING_REVIEW" ? "Cuando una persona complete identidad y firma, su solicitud aparecerá aquí para estudio." : "Cambia el filtro para ver otras solicitudes."}</Empty>}
                columns={[
                  { key: "id", header: "Solicitud", cell: (row) => <Cell main={<span className="cs-mono">{shortId(row.id)}</span>} sub={date(row.submittedAt ?? row.createdAt)} /> },
                  { key: "person", header: "Persona", cell: (row) => <PersonCell id={row.userId} people={people} /> },
                  { key: "product", header: "Producto", cell: (row) => <Cell main={row.productName ?? row.productCode} sub={`${PRODUCT_CODE_LABEL[row.productCode] ?? row.productCode}${row.productVersion ? ` · v${row.productVersion}` : ""}`} /> },
                  { key: "purpose", header: "Finalidad", cell: (row) => <Cell main={label(row.purpose)} sub={row.purposeDescription} /> },
                  { key: "amount", header: "Monto", align: "right", cell: (row) => <Cell main={cop(row.amountCOP)} sub={`${row.termMonths} cuotas`} /> },
                  { key: "checks", header: "Identidad y firma", cell: (row) => <div className="cs-chips"><StatusBadge value={row.kycProcesses[0]?.status ?? "PENDING"} text={`KYC: ${label(row.kycProcesses[0]?.status ?? "PENDING")}`} /><StatusBadge value={row.signatures[0]?.status ?? "PENDING"} text={`Pagaré: ${label(row.signatures[0]?.status ?? "PENDING")}`} /></div> },
                  { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} /> },
                  { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Ver detalle</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="solicitudes" />
            </>
          )}
        </Loaded>
      </Panel>
      {selected && (
        <ApplicationDetail
          application={selected}
          canDecide={canDecide}
          person={<PersonCell id={selected.userId} people={people} />}
          onClose={() => setSelected(null)}
          onDecided={async (result, decision) => {
            setSelected(null);
            notify(
              decision === "REJECT"
                ? "Solicitud rechazada."
                : result.status === "APPROVED"
                  ? "Solicitud aprobada. Quedó un desembolso pendiente de registrar."
                  : "Solicitud aprobada. El crédito quedó vigente.",
            );
            await applications.reload();
          }}
        />
      )}
    </>
  );
}

function ApplicationDetail({ application, canDecide, person, onClose, onDecided }: { application: Application; canDecide: boolean; person: React.ReactNode; onClose: () => void; onDecided: (result: DecisionResult, decision: "APPROVE" | "REJECT") => Promise<void> }) {
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const secondCredit = application.productCode === "BUILDER_2";
  const rate = numberOf(application.approvedRateMonthly ?? application.requestedRateMonthly);
  const decrease = numberOf(application.geometricDecrease);
  const signature = application.signatures[0];
  const pending = application.status === "PENDING_REVIEW";
  return (
    <Modal title={`Solicitud ${shortId(application.id)}`} description={`${application.productName ?? application.productCode} · ${label(application.status)}`} size="xl" onClose={onClose}>
      <div className="cs-grid cs-grid-2">
        <div className="cs-stack">
          <Facts
            columns={2}
            items={[
              { label: "Persona", value: person },
              { label: "Estado", value: <div className="cs-chips"><StatusBadge value={application.status} /><Badge>Etapa: {label(application.stage)}</Badge></div> },
              { label: "Producto", value: `${application.productName ?? application.productCode}${application.productVersion ? ` (versión ${application.productVersion})` : ""}` },
              { label: "Finalidad", value: application.purposeDescription ? `${label(application.purpose)} — ${application.purposeDescription}` : label(application.purpose) },
              { label: "Monto", value: cop(application.amountCOP) },
              { label: "Plazo", value: `${application.termMonths} cuotas mensuales` },
              { label: "Tasa del pagaré", value: rate === null ? "Sin tasa" : `${percent(rate)} mensual` },
              { label: "Tasa aprobada", value: application.approvedRateMonthly ? `${percent(Number(application.approvedRateMonthly))} mensual` : "—" },
              { label: "Radicada", value: dateTime(application.submittedAt ?? application.createdAt) },
              { label: "Decidida", value: application.decidedAt ? dateTime(application.decidedAt) : "—" },
              ...(application.decisionReason ? [{ label: "Motivo de la decisión", value: application.decisionReason, wide: true }] : []),
              ...(application.disbursement ? [{ label: "Desembolso", value: <span><StatusBadge value={application.disbursement.status} text={label(application.disbursement.status, { PENDING: "Pendiente de giro", COMPLETED: "Registrado", CANCELLED: "Cancelado" })} /> {application.disbursement.status === "PENDING" && <Link className="cs-link" href="/admin/credito/desembolsos">Ir a desembolsos</Link>}</span>, wide: true }] : []),
            ]}
          />
          {secondCredit && pending && <EligibilityPanel applicationId={application.id} allowed={canDecide} />}
          <PreviousTerms terms={application.previousTerms} />
        </div>
        <div className="cs-stack">
          <h3 style={{ fontSize: ".9rem", fontWeight: 800 }}>Plan de cuotas con las condiciones de la solicitud</h3>
          <PlanTable principalCOP={Number(application.amountCOP)} termMonths={application.termMonths} monthlyRate={rate} geometricDecrease={decrease} startDate={application.loan?.disbursedAt ? application.loan.disbursedAt.slice(0, 10) : today()} estimated={!application.loan?.disbursedAt} />
        </div>
      </div>
      {signature?.documentSnapshot && (
        <details>
          <summary className="cs-link" style={{ cursor: "pointer" }}>Ver el pagaré firmado (versión {signature.documentVersion ?? "—"})</summary>
          <pre className="cs-pre" style={{ marginTop: 10 }}>{signature.documentSnapshot}</pre>
        </details>
      )}
      {pending && (
        canDecide ? (
          <div className="cs-form-actions">
            <Button variant="ghost" className="cs-btn-danger-text" onClick={() => setDecision("REJECT")}><XCircle size={16} /> Rechazar</Button>
            <Button onClick={() => setDecision("APPROVE")}><CheckCircle2 size={16} /> Aprobar</Button>
          </div>
        ) : <p className="cs-note">La decisión de crédito corresponde al rol de riesgo o a la superadministración.</p>
      )}
      {decision && (
        <ConfirmDialog
          title={decision === "APPROVE" ? "Aprobar la solicitud" : "Rechazar la solicitud"}
          confirmLabel={decision === "APPROVE" ? "Aprobar crédito" : "Rechazar solicitud"}
          danger={decision === "REJECT"}
          reason={{ label: "Motivo de la decisión", min: 5, placeholder: decision === "APPROVE" ? "Ej.: identidad y pagaré completos; capacidad de pago verificada." : "Ej.: la información de ingresos no pudo verificarse." }}
          onClose={() => setDecision(null)}
          onConfirm={async (reason) => {
            const result = await send<DecisionResult>("POST", `/admin/applications/${application.id}/decision`, { decision, reason });
            await onDecided(result, decision);
          }}
        >
          {decision === "APPROVE" ? (
            <>
              <p>Se aprobará por <strong>{cop(application.amountCOP)}</strong> a <strong>{application.termMonths} cuotas</strong> con la tasa del pagaré firmado{rate !== null ? <> (<strong>{percent(rate)} mensual</strong>)</> : null}. La API valida esa tasa contra la tasa máxima legal vigente.</p>
              <p>{secondCredit ? "Este producto gira dinero: al aprobar se crea un desembolso pendiente y el crédito nace cuando finanzas registre el giro." : "Este producto financia el servicio LUFT: al aprobar, el crédito queda vigente de inmediato."} La decisión no se puede deshacer.</p>
            </>
          ) : <p>La persona verá su solicitud como rechazada. La decisión no se puede deshacer.</p>}
        </ConfirmDialog>
      )}
    </Modal>
  );
}

/** Condiciones cotizadas antes de la versión firmada (solo informativo; la API lo envía cuando existe). */
function PreviousTerms({ terms }: { terms: Application["previousTerms"] }) {
  if (!terms || typeof terms !== "object") return null;
  const value = (key: string) => (terms as Record<string, unknown>)[key];
  const numeric = (key: string) => (value(key) === null || value(key) === undefined || value(key) === "" || Number.isNaN(Number(value(key))) ? null : Number(value(key)));
  const items = [
    numeric("amountCOP") !== null ? { label: "Monto", value: cop(numeric("amountCOP")) } : null,
    numeric("termMonths") !== null ? { label: "Plazo", value: `${numeric("termMonths")} cuotas` } : null,
    numeric("monthlyRate") !== null ? { label: "Tasa mensual", value: percent(numeric("monthlyRate")) } : numeric("requestedRateMonthly") !== null ? { label: "Tasa mensual", value: percent(numeric("requestedRateMonthly")) } : null,
    numeric("geometricDecrease") !== null ? { label: "Gradiente", value: percent(numeric("geometricDecrease")) } : null,
    numeric("productVersion") !== null ? { label: "Versión del producto", value: `v${numeric("productVersion")}` } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  if (items.length === 0) return null;
  return (
    <div className="cs-fieldset">
      <strong>Condiciones cotizadas antes</strong>
      <Facts columns={2} items={items} />
      <small className="cs-muted cs-small">Solo informativo: las condiciones vigentes de la solicitud son las del pagaré firmado.</small>
    </div>
  );
}

function EligibilityPanel({ applicationId, allowed }: { applicationId: string; allowed: boolean }) {
  if (!allowed) return <p className="cs-note">La elegibilidad explicada del segundo crédito solo la consulta el rol de riesgo.</p>;
  return <EligibilityLoaded applicationId={applicationId} />;
}

function EligibilityLoaded({ applicationId }: { applicationId: string }) {
  const eligibility = useLoad(() => get<Eligibility>(`/admin/applications/${applicationId}/eligibility`), [applicationId]);
  if (eligibility.data === null) return eligibility.problem ? <ErrorBox problem={eligibility.problem} onRetry={() => void eligibility.reload()} /> : <Loading label="Evaluando requisitos…" />;
  const data = eligibility.data;
  return (
    <div className="cs-fieldset">
      <div className="cs-row" style={{ justifyContent: "space-between" }}>
        <strong>Elegibilidad del segundo crédito</strong>
        <Badge tone={data.eligible ? "good" : "bad"}>{data.eligible ? "Cumple todos los requisitos" : "No cumple todos los requisitos"}</Badge>
      </div>
      <div>
        {data.requirements.map((item) => (
          <div key={item.code} className="cs-outcome">
            <Badge tone={item.met ? "good" : "bad"}>{item.met ? "Cumple" : "No cumple"}</Badge>
            <strong>{item.label}</strong>
            {item.detail && <p>{item.detail}</p>}
          </div>
        ))}
      </div>
      <small className="cs-muted cs-small">Es un insumo para el análisis: la decisión sigue siendo de la persona analista. Esta consulta queda en la auditoría.</small>
    </div>
  );
}
