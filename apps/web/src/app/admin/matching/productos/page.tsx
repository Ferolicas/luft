"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { useMatchingCatalog } from "@/components/admin/matching";
import { ProductForm } from "@/components/admin/partner-forms";
import { Badge, Button, Cell, DataTable, Empty, ErrorBox, Loaded, PageHead, Pager, Panel, Toolbar, useLoad } from "@/components/admin/ui";
import { cop, day, percent } from "@/lib/admin/format";
import { get, type Paged, query } from "@/lib/admin/http";
import { type Institution, optionLabel, type Product } from "@/lib/admin/matching-types";
import { can } from "@/lib/admin/nav";

/** Entidades para el filtro y el formulario (hasta 100: las primeras 4 páginas del listado). */
async function loadInstitutions() {
  const all: Institution[] = [];
  for (let page = 1; page <= 4; page += 1) {
    const result = await get<Paged<Institution>>(`/admin/matching/institutions?page=${page}`);
    all.push(...result.items);
    if (page >= result.pages) break;
  }
  return all;
}

export default function ProductsPage() {
  const router = useRouter();
  const { user, notify } = useConsole();
  const { catalog, problem } = useMatchingCatalog();
  const institutions = useLoad(loadInstitutions, []);
  const [page, setPage] = useState(1);
  const [institutionId, setInstitutionId] = useState("");
  const [kind, setKind] = useState("");
  const [active, setActive] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const products = useLoad(() => get<Paged<Product>>(`/admin/matching/products${query({ page, institutionId, kind, active, search })}`), [page, institutionId, kind, active, search]);
  const canWrite = can("writePolicies", user.role);
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(draft.trim()); setPage(1); };
  const hasInstitutions = (institutions.data?.length ?? 0) > 0;

  return (
    <>
      <PageHead
        eyebrow="Políticas y matching"
        title="Productos y políticas"
        description="Cada producto financiero tiene versiones de política con vigencia, fuente documental y aprobador. El matching guarda la versión que usó, así que una versión nueva nunca altera resultados históricos."
        actions={canWrite && catalog && <Button onClick={() => setCreating(true)} disabled={!hasInstitutions} title={hasInstitutions ? undefined : "Crea primero una entidad"}><Plus size={16} /> Nuevo producto</Button>}
      />
      <ErrorBox problem={problem ?? institutions.problem} />
      <Panel flush>
        <Toolbar>
          <form className="cs-row" onSubmit={submit}>
            <input aria-label="Buscar producto" placeholder="Nombre del producto" value={draft} onChange={(event) => setDraft(event.target.value)} style={{ width: 220 }} />
            <Button type="submit" variant="ghost"><Search size={15} /> Buscar</Button>
          </form>
          <label>
            Entidad
            <select value={institutionId} onChange={(event) => { setInstitutionId(event.target.value); setPage(1); }}>
              <option value="">Todas</option>
              {(institutions.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Tipo
            <select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}>
              <option value="">Todos</option>
              {(catalog?.productKinds ?? []).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Estado
            <select value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }}>
              <option value="">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </label>
        </Toolbar>
        <Loaded loader={products} label="Cargando productos…">
          {(data) => (
            <>
              <DataTable
                caption="Productos financieros"
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/matching/productos/${row.id}`)}
                empty={<Empty title={hasInstitutions ? "No hay productos que coincidan" : "Aún no hay entidades ni productos"}>{hasInstitutions ? undefined : "Empieza por crear una entidad financiera; después registra aquí sus productos y sus políticas."}</Empty>}
                columns={[
                  { key: "name", header: "Producto", cell: (row) => <Cell main={row.name} sub={`${row.institution.name} · ${optionLabel(catalog?.productKinds, row.kind)}`} /> },
                  { key: "amount", header: "Monto", cell: (row) => (row.minAmountCOP !== null || row.maxAmountCOP !== null ? `${cop(row.minAmountCOP)} a ${cop(row.maxAmountCOP)}` : "—") },
                  { key: "term", header: "Plazo", cell: (row) => (row.minTermMonths !== null || row.maxTermMonths !== null ? `${row.minTermMonths ?? "—"} a ${row.maxTermMonths ?? "—"} meses` : "—") },
                  { key: "rate", header: "Tasa ref.", align: "right", cell: (row) => (row.referenceRateEA === null ? "—" : `${percent(row.referenceRateEA)} E.A.`) },
                  { key: "policy", header: "Política vigente", cell: (row) => (row.currentVersion ? <Cell main={<Badge tone="good">Versión {row.currentVersion.version}</Badge>} sub={`Desde ${day(row.currentVersion.effectiveFrom)}`} /> : <Badge tone="warn">Sin política vigente</Badge>) },
                  { key: "versions", header: "Versiones", align: "center", cell: (row) => row.versionsCount },
                  { key: "active", header: "Estado", cell: (row) => <Badge tone={row.active && row.institution.active ? "good" : "neutral"}>{!row.institution.active ? "Entidad inactiva" : row.active ? "Activo" : "Inactivo"}</Badge> },
                  { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Abrir</span> },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="productos" />
            </>
          )}
        </Loaded>
      </Panel>
      {creating && catalog && institutions.data && (
        <ProductForm
          product={null}
          institutions={institutions.data.filter((item) => item.active)}
          defaultInstitutionId={institutionId || undefined}
          catalog={catalog}
          onClose={() => setCreating(false)}
          onSaved={async (saved) => { notify(`Producto ${saved.name} creado. Define ahora su política.`); router.push(`/admin/matching/productos/${saved.id}`); }}
        />
      )}
    </>
  );
}
