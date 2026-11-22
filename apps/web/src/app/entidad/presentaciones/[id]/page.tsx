"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useConsole } from "@/components/app-shell";
import { DecisionForm } from "@/components/admin/matching";
import { PortalLoaded } from "@/components/admin/portal";
import { Badge, Button, Facts, PageHead, Panel, StatusBadge, useLoad } from "@/components/admin/ui";
import { cop, dateTime, day, percent, points } from "@/lib/admin/format";
import { get, send } from "@/lib/admin/http";
import type { DecisionBody, InstPresentationDetail } from "@/lib/admin/matching-types";

export default function InstitutionPresentationPage() {
  const { id } = useParams<{ id: string }>();
  const { notify } = useConsole();
  const presentation = useLoad(() => get<InstPresentationDetail>(`/institution/presentations/${id}`), [id]);
  const [deciding, setDeciding] = useState(false);

  return (
    <PortalLoaded loader={presentation} linkCode="institution_link_required" partner="entidad financiera">
      {(data) => (
        <>
          <PageHead
            back={{ href: "/entidad", label: "Presentaciones" }}
            eyebrow={data.product.name}
            title={data.applicant?.fullName ?? data.applicantName ?? "Presentación"}
            description={<span className="cs-row"><StatusBadge value={data.status} text={data.statusLabel} /><span>Encaje {points(data.match.fitPercent, 0)} con la versión {data.policy.version} de tu política</span>{data.requiresException && <Badge tone="warn">Presentada con excepción</Badge>}</span>}
            actions={data.canDecide && <Button onClick={() => setDeciding(true)}>Registrar decisión</Button>}
          />
          <div className="cs-grid cs-grid-side">
            <div className="cs-stack">
              <Panel title="Datos que la persona autorizó compartir" description="Es exactamente lo que autorizó, tal como estaba al momento de autorizar. No hay más datos disponibles para tu entidad.">
                {data.dataAvailable && data.applicant ? (
                  <div className="cs-stack" style={{ gap: 14 }}>
                    <Facts
                      columns={4}
                      items={[
                        { label: "Nombre", value: data.applicant.fullName },
                        { label: "Documento", value: data.applicant.document },
                        { label: "Celular", value: data.applicant.phone },
                        { label: "Correo", value: data.applicant.email },
                      ]}
                    />
                    {data.facts.length > 0 && (
                      <div className="cs-table-wrap">
                        <table className="cs-table cs-table-compact">
                          <caption>Datos del perfil compartidos</caption>
                          <thead><tr><th scope="col">Dato</th><th scope="col">Valor</th></tr></thead>
                          <tbody>{data.facts.map((fact) => <tr key={fact.key}><td>{fact.label}</td><td><strong>{fact.display}</strong></td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : <p className="cs-note">Los datos personales ya no están disponibles: solo se muestran mientras la presentación está en estudio o aprobada.</p>}
              </Panel>
              <Panel title="Autorización de la persona" description={`Versión ${data.authorization.version} · aceptada el ${dateTime(data.authorization.authorizedAt)}`}>
                <pre className="cs-pre">{data.authorization.text}</pre>
              </Panel>
            </div>
            <Panel title="Seguimiento">
              <Facts
                columns={1}
                items={[
                  { label: "Producto", value: data.product.name },
                  { label: "Política evaluada", value: `Versión ${data.policy.version}${data.policy.effectiveFrom ? ` · vigente desde ${day(data.policy.effectiveFrom)}` : ""}` },
                  { label: "Resultado del matching", value: <span className="cs-row"><StatusBadge value={data.match.status} /> {points(data.match.fitPercent, 0)} · {dateTime(data.match.evaluatedAt)}</span> },
                  { label: "Presentada", value: data.presentedAt ? `${dateTime(data.presentedAt)}${data.presentationChannel ? ` · ${data.presentationChannel}` : ""}` : null },
                  { label: "Decisión", value: data.decidedAt ? `${dateTime(data.decidedAt)}${data.decidedByRole ? ` · registrada por ${data.decidedByRole === "INSTITUTION" ? "tu entidad" : "LUFT"}` : ""}` : "Pendiente" },
                  ...(data.status === "APROBADA" ? [
                    { label: "Monto aprobado", value: cop(data.approvedAmountCOP) },
                    { label: "Tasa", value: `${percent(data.approvedRateEA)} E.A.` },
                    { label: "Plazo", value: `${data.approvedTermMonths} meses` },
                    { label: "Producto final", value: data.finalProductName },
                  ] : []),
                  ...(data.decisionReason ? [{ label: data.status === "APROBADA" ? "Observación" : "Motivo", value: data.decisionReason }] : []),
                ]}
              />
            </Panel>
          </div>
          {deciding && (
            <DecisionForm
              productName={data.product.name}
              onClose={() => setDeciding(false)}
              onSubmit={async (body: DecisionBody) => { presentation.setData(await send<InstPresentationDetail>("POST", `/institution/presentations/${id}/decision`, body)); notify("Decisión registrada. LUFT y la persona ya la pueden ver."); }}
            />
          )}
        </>
      )}
    </PortalLoaded>
  );
}
