"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { useMatchingCatalog } from "@/components/admin/matching";
import { ProductForm } from "@/components/admin/partner-forms";
import { Badge, Button, Cell, ConfirmDialog, DataTable, Empty, ErrorBox, Facts, Field, FormActions, Loaded, Modal, PageHead, Panel, StatusBadge, useAction, useLoad } from "@/components/admin/ui";
import { cop, date, day, percent } from "@/lib/admin/format";
import { get, send } from "@/lib/admin/http";
import { optionLabel, type Product, type Version, type VersionDetail } from "@/lib/admin/matching-types";
import { can } from "@/lib/admin/nav";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, notify } = useConsole();
  const { catalog, problem } = useMatchingCatalog();
  const product = useLoad(() => get<Product & { versions: Version[] }>(`/admin/matching/products/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const canWrite = can("writePolicies", user.role);

  return (
    <Loaded loader={product} label="Cargando el producto…">
      {(data) => {
        const versions = [...(data.versions ?? [])].sort((a, b) => b.version - a.version);
        return (
          <>
            <PageHead
              back={{ href: "/admin/matching/productos", label: "Productos y políticas" }}
              eyebrow={optionLabel(catalog?.productKinds, data.kind)}
              title={data.name}
              description={<span className="cs-row"><Link className="cs-link" href={`/admin/matching/entidades/${data.institutionId}`}>{data.institution.name}</Link><Badge tone={data.active ? "good" : "neutral"}>{data.active ? "Activo" : "Inactivo"}</Badge>{data.currentVersion ? <Badge tone="good">Política vigente: versión {data.currentVersion.version}</Badge> : <Badge tone="warn">Sin política vigente: no entra al matching</Badge>}</span>}
              actions={canWrite && catalog && (
                <>
                  <Button variant="ghost" onClick={() => setEditing(true)}>Editar producto</Button>
                  <Button variant="ghost" className="cs-btn-danger-text" onClick={() => setDeleting(true)}>Eliminar</Button>
                </>
              )}
            />
            <ErrorBox problem={problem} />
            <Panel title="Condiciones comerciales">
              <Facts
                columns={4}
                items={[
                  { label: "Monto", value: data.minAmountCOP !== null || data.maxAmountCOP !== null ? `${cop(data.minAmountCOP)} a ${cop(data.maxAmountCOP)}` : null },
                  { label: "Plazo", value: data.minTermMonths !== null || data.maxTermMonths !== null ? `${data.minTermMonths ?? "—"} a ${data.maxTermMonths ?? "—"} meses` : null },
                  { label: "Tasa de referencia", value: data.referenceRateEA === null ? null : `${percent(data.referenceRateEA)} E.A.` },
                  { label: "Canal", value: data.channel },
                  { label: "Comisión", value: data.commissionPercent === null ? null : `${percent(data.commissionPercent)}${data.commissionNotes ? ` · ${data.commissionNotes}` : ""}` },
                  { label: "Convenio", value: data.agreementReference },
                  { label: "Garantías", value: data.guarantees.length > 0 ? <span className="cs-chips">{data.guarantees.map((item) => <span key={item} className="cs-chip">{item}</span>)}</span> : null },
                  { label: "Documentos", value: data.requiredDocuments.length > 0 ? <span className="cs-chips">{data.requiredDocuments.map((item) => <span key={item} className="cs-chip">{item}</span>)}</span> : null },
                  { label: "Descripción", value: data.description, wide: true },
                ]}
              />
            </Panel>
            <Panel
              flush
              title="Versiones de política"
              description="Borrador → revisión → aprobada → vigente. Solo una versión está vigente; al activar otra, la anterior queda sustituida."
              actions={canWrite && <Button small onClick={() => setCreating(true)}><Plus size={15} /> Nueva versión</Button>}
            >
              <DataTable
                caption="Versiones de política"
                rows={versions}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/admin/matching/productos/versiones/${row.id}`)}
                empty={<Empty title="Este producto no tiene política">{canWrite ? "Crea la primera versión, agrega sus reglas y llévala hasta «vigente» para que el producto entre al matching." : undefined}</Empty>}
                columns={[
                  { key: "version", header: "Versión", cell: (row) => <Cell main={`v${row.version}`} sub={`Creada ${date(row.createdAt)}`} /> },
                  { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} text={row.statusLabel} /> },
                  { key: "rules", header: "Reglas", align: "center", cell: (row) => row.rulesCount },
                  { key: "effective", header: "Vigencia", cell: (row) => (row.effectiveFrom ? `${day(row.effectiveFrom)}${row.effectiveTo ? ` → ${day(row.effectiveTo)}` : ""}` : "—") },
                  { key: "source", header: "Fuente documental", cell: (row) => <span className="cs-small" title={row.sourceDocument}>{row.sourceDocument.length > 70 ? `${row.sourceDocument.slice(0, 70)}…` : row.sourceDocument}</span> },
                  { key: "responsible", header: "Responsable", cell: (row) => row.responsibleName ?? row.createdByName ?? "—" },
                  { key: "approver", header: "Aprobó", cell: (row) => (row.approvedByName ? <Cell main={row.approvedByName} sub={date(row.approvedAt)} /> : "—") },
                  { key: "open", header: "", align: "right", cell: () => <span className="cs-link">Abrir</span> },
                ]}
              />
            </Panel>
            {editing && catalog && (
              <ProductForm product={data} institutions={[]} catalog={catalog} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); notify("Producto actualizado."); await product.reload(); }} />
            )}
            {creating && (
              <NewVersionForm
                productId={id}
                onClose={() => setCreating(false)}
                onSaved={async (version) => { notify(`Versión ${version.version} creada en borrador.`); router.push(`/admin/matching/productos/versiones/${version.id}`); }}
              />
            )}
            {deleting && (
              <ConfirmDialog
                title="Eliminar el producto"
                confirmLabel="Eliminar producto"
                danger
                onClose={() => setDeleting(false)}
                onConfirm={async () => {
                  await send("DELETE", `/admin/matching/products/${id}`);
                  notify(`Producto ${data.name} eliminado.`);
                  router.push("/admin/matching/productos");
                }}
              >
                <p>Solo se puede eliminar un producto que no se haya usado en matching ni en presentaciones. Si ya se usó, desactívalo desde «Editar producto».</p>
              </ConfirmDialog>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

function NewVersionForm({ productId, onClose, onSaved }: { productId: string; onClose: () => void; onSaved: (version: VersionDetail) => Promise<void> }) {
  const [sourceDocument, setSourceDocument] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await action.run(async () => onSaved(await send<VersionDetail>("POST", `/admin/matching/products/${productId}/versions`, { sourceDocument: sourceDocument.trim(), sourceUrl: sourceUrl.trim() || null, notes: notes.trim() || null })));
  };
  return (
    <Modal title="Nueva versión de política" description="Nace en borrador y sin reglas. Para partir de una versión existente, ábrela y usa «Clonar»." onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <Field label="Fuente documental" required hint="Documento de la entidad que respalda la política: manual, circular, correo del convenio…"><textarea value={sourceDocument} onChange={(event) => setSourceDocument(event.target.value)} minLength={3} maxLength={2000} rows={2} required /></Field>
        <Field label="Enlace a la fuente" hint="Opcional."><input type="url" placeholder="https://…" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} maxLength={1000} /></Field>
        <Field label="Notas" hint="Opcional."><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} rows={2} /></Field>
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Crear borrador" />
      </form>
    </Modal>
  );
}
