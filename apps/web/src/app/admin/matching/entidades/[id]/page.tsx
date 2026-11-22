"use client";

import { Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useConsole } from "@/components/app-shell";
import { PartnerUsers, useMatchingCatalog } from "@/components/admin/matching";
import { InstitutionForm, ProductForm } from "@/components/admin/partner-forms";
import { Badge, Button, Cell, ConfirmDialog, DataTable, Empty, ErrorBox, Facts, Loaded, PageHead, Panel, useLoad } from "@/components/admin/ui";
import { cop, day } from "@/lib/admin/format";
import { get, type Paged, send } from "@/lib/admin/http";
import { type Institution, optionLabel, type Product } from "@/lib/admin/matching-types";
import { can } from "@/lib/admin/nav";

export default function InstitutionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, notify } = useConsole();
  const { catalog, problem } = useMatchingCatalog();
  const institution = useLoad(() => get<Institution>(`/admin/matching/institutions/${id}`), [id]);
  const products = useLoad(() => get<Paged<Product>>(`/admin/matching/products?institutionId=${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const canWrite = can("writePolicies", user.role);
  const canLink = can("managePartners", user.role);

  return (
    <Loaded loader={institution} label="Cargando la entidad…">
      {(data) => (
        <>
          <PageHead
            back={{ href: "/admin/matching/entidades", label: "Entidades financieras" }}
            eyebrow={optionLabel(catalog?.institutionKinds, data.kind)}
            title={data.name}
            description={<span className="cs-row"><Badge tone={data.active ? "good" : "neutral"}>{data.active ? "Activa" : "Inactiva"}</Badge>{data.taxId && <span>NIT {data.taxId}</span>}</span>}
            actions={canWrite && catalog && (
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>Editar</Button>
                <Button variant="ghost" className="cs-btn-danger-text" onClick={() => setDeleting(true)}>Eliminar</Button>
              </>
            )}
          />
          <ErrorBox problem={problem} />
          <Panel title="Datos de la entidad">
            <Facts
              columns={4}
              items={[
                { label: "Contacto", value: data.contactName },
                { label: "Correo", value: data.contactEmail },
                { label: "Teléfono", value: data.contactPhone },
                { label: "Sitio web", value: data.website ? <a className="cs-link" href={data.website} target="_blank" rel="noreferrer noopener">{data.website}</a> : null },
                { label: "Notas internas", value: data.notes, wide: true },
              ]}
            />
          </Panel>
          <Panel flush title="Productos financieros" description="Abre un producto para gestionar sus versiones de política." actions={canWrite && catalog && <Button small onClick={() => setAddingProduct(true)}><Plus size={15} /> Nuevo producto</Button>}>
            <Loaded loader={products} label="Cargando productos…">
              {(list) => (
                <DataTable
                  caption="Productos de la entidad"
                  rows={list.items}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => router.push(`/admin/matching/productos/${row.id}`)}
                  empty={<Empty title="Esta entidad no tiene productos">{canWrite ? "Crea el primer producto y luego define su política." : undefined}</Empty>}
                  columns={[
                    { key: "name", header: "Producto", cell: (row) => <Cell main={row.name} sub={optionLabel(catalog?.productKinds, row.kind)} /> },
                    { key: "amount", header: "Monto", cell: (row) => (row.minAmountCOP !== null || row.maxAmountCOP !== null ? `${cop(row.minAmountCOP)} a ${cop(row.maxAmountCOP)}` : "—") },
                    { key: "term", header: "Plazo", cell: (row) => (row.minTermMonths !== null || row.maxTermMonths !== null ? `${row.minTermMonths ?? "—"} a ${row.maxTermMonths ?? "—"} meses` : "—") },
                    { key: "policy", header: "Política vigente", cell: (row) => (row.currentVersion ? <Cell main={<Badge tone="good">Versión {row.currentVersion.version}</Badge>} sub={`Desde ${day(row.currentVersion.effectiveFrom)}`} /> : <Badge tone="warn">Sin política vigente</Badge>) },
                    { key: "versions", header: "Versiones", align: "center", cell: (row) => row.versionsCount },
                    { key: "active", header: "Estado", cell: (row) => <Badge tone={row.active ? "good" : "neutral"}>{row.active ? "Activo" : "Inactivo"}</Badge> },
                    { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Abrir</span> },
                  ]}
                />
              )}
            </Loaded>
          </Panel>
          {canLink
            ? <PartnerUsers listPath={`/admin/matching/institutions/${id}/users`} unlinkPath="/admin/matching/institution-users" partnerLabel="entidad financiera" roleLabel="Entidad financiera" onChanged={() => void institution.reload()} />
            : <p className="cs-note">Las cuentas con acceso al portal de la entidad ({data.usersCount}) las administra la superadministración.</p>}
          {editing && catalog && (
            <InstitutionForm institution={data} catalog={catalog} onClose={() => setEditing(false)} onSaved={async (saved) => { setEditing(false); institution.setData(saved); notify("Entidad actualizada."); }} />
          )}
          {addingProduct && catalog && (
            <ProductForm
              product={null}
              institutions={[data]}
              defaultInstitutionId={data.id}
              catalog={catalog}
              onClose={() => setAddingProduct(false)}
              onSaved={async (saved) => { notify(`Producto ${saved.name} creado. Define ahora su política.`); router.push(`/admin/matching/productos/${saved.id}`); }}
            />
          )}
          {deleting && (
            <ConfirmDialog
              title="Eliminar la entidad"
              confirmLabel="Eliminar entidad"
              danger
              onClose={() => setDeleting(false)}
              onConfirm={async () => {
                await send("DELETE", `/admin/matching/institutions/${id}`);
                notify(`Entidad ${data.name} eliminada.`);
                router.push("/admin/matching/entidades");
              }}
            >
              <p>Solo se puede eliminar una entidad sin productos ni presentaciones. Si ya se usó, desactívala desde «Editar».</p>
            </ConfirmDialog>
          )}
        </>
      )}
    </Loaded>
  );
}
