"use client";

import Link from "next/link";
import { useConsole } from "@/components/app-shell";
import { Loaded, PageHead, Panel, Stat, useLoad, Button } from "@/components/admin/ui";
import { cop, integer } from "@/lib/admin/format";
import { get } from "@/lib/admin/http";
import { navFor, ROLE_LABEL } from "@/lib/admin/nav";

interface Overview {
  users: number;
  activeUsers: number;
  applications: number;
  activeLoans: number;
  defaultedLoans: number;
  writtenOffLoans: number;
  pendingDisbursements: number;
  overdueInstallments: number;
  openPqr: number;
  approvedPayments: { count: number; amountCOP: string };
  pendingIntegrations: number;
  integrations: Record<string, boolean>;
}

const INTEGRATION_LABEL: Record<string, string> = {
  mercadoPago: "Mercado Pago (recaudo)",
  truora: "Truora (identidad)",
  dataCredito: "DataCrédito",
  transUnion: "TransUnion",
  sms: "SMS",
  email: "Correo",
  whatsapp: "WhatsApp",
  n8n: "Automatizaciones (n8n)",
  openFinance: "Open Finance",
};

export default function OverviewPage() {
  const { user } = useConsole();
  const overview = useLoad(() => get<Overview>("/admin/overview"), []);
  const areas = navFor(user.role).map((area) => ({ ...area, items: area.items.filter((item) => item.href !== "/admin") })).filter((area) => area.items.length > 0);
  return (
    <>
      <PageHead
        eyebrow="Operación LUFT + STARTIF"
        title="Resumen de la operación"
        description={<>Indicadores en vivo de la plataforma. Tu sesión opera con el rol <strong>{ROLE_LABEL[user.role] ?? user.role}</strong>: solo ves las áreas que ese rol puede usar.</>}
        actions={<Button variant="ghost" onClick={() => void overview.reload()} disabled={overview.loading}>Actualizar</Button>}
      />
      <Loaded loader={overview} label="Cargando indicadores…">
        {(data) => (
          <>
            <div className="cs-stats">
              <Stat label="Personas registradas" value={integer(data.users)} hint={`${integer(data.activeUsers)} con cuenta activa`} />
              <Stat label="Solicitudes de crédito" value={integer(data.applications)} hint="Todas las etapas" />
              <Stat label="Créditos vigentes" value={integer(data.activeLoans)} hint="Préstamos activos" tone="good" />
              <Stat label="Recaudo confirmado" value={cop(data.approvedPayments.amountCOP)} hint={`${integer(data.approvedPayments.count)} pagos aprobados`} />
            </div>
            <div className="cs-stats">
              <Stat label="Desembolsos pendientes" value={integer(data.pendingDisbursements)} hint="Giros por registrar" tone={data.pendingDisbursements > 0 ? "warn" : undefined} />
              <Stat label="Créditos en mora" value={integer(data.defaultedLoans)} hint={`${integer(data.overdueInstallments)} cuotas vencidas`} tone={data.defaultedLoans > 0 ? "bad" : undefined} />
              <Stat label="Créditos castigados" value={integer(data.writtenOffLoans)} hint="Cartera castigada" tone={data.writtenOffLoans > 0 ? "bad" : undefined} />
              <Stat label="PQR abiertas" value={integer(data.openPqr)} hint="Abiertas, en revisión o esperando" tone={data.openPqr > 0 ? "warn" : undefined} />
              <Stat label="Integraciones con fallas" value={integer(data.pendingIntegrations)} hint="Eventos fallidos o sin configurar" tone={data.pendingIntegrations > 0 ? "warn" : undefined} />
            </div>
            <Panel title="Estado de integraciones" description="Un proveedor sin credenciales no simula éxito: sus flujos quedan pendientes hasta que se configure.">
              <div className="cs-integrations">
                {Object.entries(data.integrations).map(([name, active]) => (
                  <span key={name} className={active ? "on" : ""}>
                    <i aria-hidden="true" />
                    {INTEGRATION_LABEL[name] ?? name}
                    <small>{active ? "Activa" : "Por configurar"}</small>
                  </span>
                ))}
              </div>
            </Panel>
          </>
        )}
      </Loaded>
      {areas.map((area) => (
        <Panel key={area.key} title={area.label}>
          <div className="cs-shortcuts">
            {area.items.map((item) => (
              <Link key={item.href} href={item.href}>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </Link>
            ))}
          </div>
        </Panel>
      ))}
    </>
  );
}
