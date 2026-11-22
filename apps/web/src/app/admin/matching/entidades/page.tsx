"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { useMatchingCatalog } from "@/components/admin/matching";
import { InstitutionForm } from "@/components/admin/partner-forms";
import { Badge, Button, Cell, DataTable, Empty, ErrorBox, Loaded, PageHead, Pager, Panel, Toolbar, useLoad } from "@/components/admin/ui";
import { date } from "@/lib/admin/format";
import { get, type Paged, query } from "@/lib/admin/http";
import { type Institution, optionLabel } from "@/lib/admin/matching-types";
import { can } from "@/lib/admin/nav";

export default function InstitutionsPage() {
  const router = useRouter();
  const { user, notify } = useConsole();
  const { catalog, problem } = useMatchingCatalog();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState("");
  const [creating, setCreating] = useState(false);
  const institutions = useLoad(() => get<Paged<Institution>>(`/admin/matching/institutions${query({ page, search, active })}`), [page, search, active]);
  const canWrite = can("writePolicies", user.role);
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(draft.trim()); setPage(1); };

  return (
    <>
      <PageHead
        eyebrow="Políticas y matching"
        title="Entidades financieras"
        description="Entidades con las que LUFT tiene convenio o canal. Cada entidad agrupa sus productos, y cada producto tiene sus versiones de política."
        actions={canWrite && catalog && <Button onClick={() => setCreating(true)}><Plus size={16} /> Nueva entidad</Button>}
      />
      <ErrorBox problem={problem} />
      <Panel flush>
        <Toolbar>
          <form className="cs-row" onSubmit={submit}>
            <input aria-label="Buscar entidad" placeholder="Nombre o NIT" value={draft} onChange={(event) => setDraft(event.target.value)} style={{ width: 240 }} />
            <Button type="submit" variant="ghost"><Search size={15} /> Buscar</Button>
          </form>
          <label>
            Estado
            <select value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }}>
              <option value="">Todas</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </label>
        </Toolbar>
        <Loaded loader={institutions} label="Cargando entidades…">
          {(data) => (
            <>
              <DataTable
                caption="Entidades financieras"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/matching/entidades/${row.id}`)}
                empty={<Empty title={search || active ? "Ninguna entidad coincide" : "Aún no hay entidades"}>{search || active ? undefined : "Crea la primera entidad para registrar sus productos y políticas. Sin políticas vigentes, el matching no tiene contra qué evaluar."}</Empty>}
                columns={[
                  { key: "name", header: "Entidad", cell: (row) => <Cell main={row.name} sub={optionLabel(catalog?.institutionKinds, row.kind)} /> },
                  { key: "taxId", header: "NIT", cell: (row) => row.taxId ?? "—" },
                  { key: "contact", header: "Contacto", cell: (row) => (row.contactName || row.contactEmail ? <Cell main={row.contactName ?? row.contactEmail} sub={row.contactName ? row.contactEmail : row.contactPhone} /> : "—") },
                  { key: "products", header: "Productos", align: "center", cell: (row) => row.productsCount },
                  { key: "users", header: "Cuentas", align: "center", cell: (row) => row.usersCount },
                  { key: "active", header: "Estado", cell: (row) => <Badge tone={row.active ? "good" : "neutral"}>{row.active ? "Activa" : "Inactiva"}</Badge> },
                  { key: "updated", header: "Actualizada", cell: (row) => date(row.updatedAt) },
                  { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Abrir</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="entidades" />
            </>
          )}
        </Loaded>
      </Panel>
      {creating && catalog && (
        <InstitutionForm
          institution={null}
          catalog={catalog}
          onClose={() => setCreating(false)}
          onSaved={async (saved) => {
            notify(`Entidad ${saved.name} creada.`);
            router.push(`/admin/matching/entidades/${saved.id}`);
          }}
        />
      )}
    </>
  );
}
