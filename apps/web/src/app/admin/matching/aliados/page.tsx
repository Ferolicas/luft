"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { AllyForm } from "@/components/admin/partner-forms";
import { Badge, Button, Cell, DataTable, Empty, Loaded, PageHead, Pager, Panel, Toolbar, useLoad } from "@/components/admin/ui";
import { date } from "@/lib/admin/format";
import { get, type Paged, query } from "@/lib/admin/http";
import type { Ally } from "@/lib/admin/matching-types";

export default function AlliesPage() {
  const router = useRouter();
  const { notify } = useConsole();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const allies = useLoad(() => get<Paged<Ally>>(`/admin/matching/allies${query({ page, search })}`), [page, search]);
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(draft.trim()); setPage(1); };
  return (
    <>
      <PageHead
        eyebrow="Políticas y matching"
        title="Aliados"
        description="Organizaciones que refieren personas a LUFT. Un aliado solo ve, en su portal, el embudo agregado de sus referidos: nunca datos individuales."
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Nuevo aliado</Button>}
      />
      <Panel flush>
        <Toolbar>
          <form className="cs-row" onSubmit={submit}>
            <input aria-label="Buscar aliado" placeholder="Nombre, NIT o código" value={draft} onChange={(event) => setDraft(event.target.value)} style={{ width: 240 }} />
            <Button type="submit" variant="ghost"><Search size={15} /> Buscar</Button>
          </form>
        </Toolbar>
        <Loaded loader={allies} label="Cargando aliados…">
          {(data) => (
            <>
              <DataTable
                caption="Aliados"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/matching/aliados/${row.id}`)}
                empty={<Empty title={search ? "Ningún aliado coincide" : "Aún no hay aliados"} />}
                columns={[
                  { key: "name", header: "Aliado", cell: (row) => <Cell main={row.name} sub={row.taxId ? `NIT ${row.taxId}` : undefined} /> },
                  { key: "code", header: "Código de referido", cell: (row) => <span className="cs-mono">{row.referralCode}</span> },
                  { key: "contact", header: "Contacto", cell: (row) => (row.contactName || row.contactEmail ? <Cell main={row.contactName ?? row.contactEmail} sub={row.contactName ? row.contactEmail : row.contactPhone} /> : "—") },
                  { key: "referrals", header: "Referidos", align: "center", cell: (row) => row.referralsCount },
                  { key: "users", header: "Cuentas", align: "center", cell: (row) => row.usersCount },
                  { key: "active", header: "Estado", cell: (row) => <Badge tone={row.active ? "good" : "neutral"}>{row.active ? "Activo" : "Inactivo"}</Badge> },
                  { key: "created", header: "Creado", cell: (row) => date(row.createdAt) },
                  { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Abrir</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="aliados" />
            </>
          )}
        </Loaded>
      </Panel>
      {creating && <AllyForm ally={null} onClose={() => setCreating(false)} onSaved={async (saved) => { notify(`Aliado ${saved.name} creado. Código de referido: ${saved.referralCode}.`); router.push(`/admin/matching/aliados/${saved.id}`); }} />}
    </>
  );
}
