"use client";

import { type FormEvent, useState } from "react";
import { Check, ErrorBox, Field, FormActions, ListEditor, Modal, useAction } from "@/components/admin/ui";
import { cop, fractionFromPercent, numberOrNull, percentInput } from "@/lib/admin/format";
import { send } from "@/lib/admin/http";
import type { Ally, Institution, MatchingCatalog, Product } from "@/lib/admin/matching-types";

/** Texto vacío → `null` (la API lo interpreta como «sin valor»). */
const orNull = (value: string) => (value.trim() ? value.trim() : null);

function ContactFields({ values, set }: { values: { taxId: string; contactName: string; contactEmail: string; contactPhone: string }; set: (key: "taxId" | "contactName" | "contactEmail" | "contactPhone", value: string) => void }) {
  return (
    <>
      <Field label="NIT" hint="6 a 12 dígitos, con dígito de verificación opcional. Ej.: 900123456-7."><input value={values.taxId} onChange={(event) => set("taxId", event.target.value)} pattern="\d{6,12}(-\d)?" /></Field>
      <Field label="Persona de contacto"><input value={values.contactName} onChange={(event) => set("contactName", event.target.value)} maxLength={160} /></Field>
      <Field label="Correo de contacto"><input type="email" value={values.contactEmail} onChange={(event) => set("contactEmail", event.target.value)} maxLength={254} /></Field>
      <Field label="Teléfono de contacto" hint="7 a 20 dígitos."><input value={values.contactPhone} onChange={(event) => set("contactPhone", event.target.value)} pattern="\+?[0-9 ]{7,20}" /></Field>
    </>
  );
}

export function InstitutionForm({ institution, catalog, onClose, onSaved }: { institution: Institution | null; catalog: MatchingCatalog; onClose: () => void; onSaved: (saved: Institution) => Promise<void> }) {
  const [values, setValues] = useState({
    name: institution?.name ?? "", kind: institution?.kind ?? catalog.institutionKinds[0]?.key ?? "BANCO", taxId: institution?.taxId ?? "", contactName: institution?.contactName ?? "",
    contactEmail: institution?.contactEmail ?? "", contactPhone: institution?.contactPhone ?? "", website: institution?.website ?? "", notes: institution?.notes ?? "",
  });
  const [active, setActive] = useState(institution?.active ?? true);
  const action = useAction();
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { name: values.name.trim(), kind: values.kind, taxId: orNull(values.taxId), contactName: orNull(values.contactName), contactEmail: orNull(values.contactEmail), contactPhone: orNull(values.contactPhone), website: orNull(values.website), notes: orNull(values.notes), active };
    await action.run(async () => onSaved(institution ? await send<Institution>("PATCH", `/admin/matching/institutions/${institution.id}`, body) : await send<Institution>("POST", "/admin/matching/institutions", body)));
  };
  return (
    <Modal title={institution ? `Editar ${institution.name}` : "Nueva entidad financiera"} size="lg" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields">
          <Field label="Nombre" required><input value={values.name} onChange={(event) => set("name", event.target.value)} minLength={2} maxLength={160} required /></Field>
          <Field label="Tipo de entidad" required><select value={values.kind} onChange={(event) => set("kind", event.target.value)}>{catalog.institutionKinds.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
          <ContactFields values={values} set={set} />
          <Field label="Sitio web" wide><input type="url" placeholder="https://…" value={values.website} onChange={(event) => set("website", event.target.value)} maxLength={500} /></Field>
          <Field label="Notas internas" wide><textarea value={values.notes} onChange={(event) => set("notes", event.target.value)} maxLength={4000} rows={2} /></Field>
        </div>
        <Check label="Entidad activa" hint="Los productos de una entidad inactiva no entran al matching." checked={active} onChange={setActive} />
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel={institution ? "Guardar cambios" : "Crear entidad"} />
      </form>
    </Modal>
  );
}

export function AllyForm({ ally, onClose, onSaved }: { ally: Ally | null; onClose: () => void; onSaved: (saved: Ally) => Promise<void> }) {
  const [values, setValues] = useState({ name: ally?.name ?? "", taxId: ally?.taxId ?? "", contactName: ally?.contactName ?? "", contactEmail: ally?.contactEmail ?? "", contactPhone: ally?.contactPhone ?? "" });
  const [active, setActive] = useState(ally?.active ?? true);
  const action = useAction();
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { name: values.name.trim(), taxId: orNull(values.taxId), contactName: orNull(values.contactName), contactEmail: orNull(values.contactEmail), contactPhone: orNull(values.contactPhone), active };
    await action.run(async () => onSaved(ally ? await send<Ally>("PATCH", `/admin/matching/allies/${ally.id}`, body) : await send<Ally>("POST", "/admin/matching/allies", body)));
  };
  return (
    <Modal title={ally ? `Editar ${ally.name}` : "Nuevo aliado"} description={ally ? undefined : "Al crearlo se genera su código de referido."} onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields">
          <Field label="Nombre" required wide><input value={values.name} onChange={(event) => set("name", event.target.value)} minLength={2} maxLength={160} required /></Field>
          <ContactFields values={values} set={set} />
        </div>
        <Check label="Aliado activo" checked={active} onChange={setActive} />
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel={ally ? "Guardar cambios" : "Crear aliado"} />
      </form>
    </Modal>
  );
}

export function ProductForm({ product, institutions, defaultInstitutionId, catalog, onClose, onSaved }: { product: Product | null; institutions: Institution[]; defaultInstitutionId?: string; catalog: MatchingCatalog; onClose: () => void; onSaved: (saved: Product) => Promise<void> }) {
  const [values, setValues] = useState({
    institutionId: product?.institutionId ?? defaultInstitutionId ?? institutions[0]?.id ?? "",
    name: product?.name ?? "", kind: product?.kind ?? catalog.productKinds[0]?.key ?? "LIBRE_INVERSION", description: product?.description ?? "",
    minAmountCOP: product?.minAmountCOP?.toString() ?? "", maxAmountCOP: product?.maxAmountCOP?.toString() ?? "", minTermMonths: product?.minTermMonths?.toString() ?? "", maxTermMonths: product?.maxTermMonths?.toString() ?? "",
    referenceRateEA: percentInput(product?.referenceRateEA), channel: product?.channel ?? "", commissionPercent: percentInput(product?.commissionPercent), commissionNotes: product?.commissionNotes ?? "", agreementReference: product?.agreementReference ?? "",
  });
  const [guarantees, setGuarantees] = useState(product?.guarantees ?? []);
  const [documents, setDocuments] = useState(product?.requiredDocuments ?? []);
  const [active, setActive] = useState(product?.active ?? true);
  const action = useAction();
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const amountError = values.minAmountCOP && values.maxAmountCOP && Number(values.minAmountCOP) > Number(values.maxAmountCOP) ? "El máximo debe ser mayor o igual al mínimo." : null;
  const termError = values.minTermMonths && values.maxTermMonths && Number(values.minTermMonths) > Number(values.maxTermMonths) ? "El máximo debe ser mayor o igual al mínimo." : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (amountError || termError) return;
    const body = {
      name: values.name.trim(), kind: values.kind, description: orNull(values.description),
      minAmountCOP: numberOrNull(values.minAmountCOP), maxAmountCOP: numberOrNull(values.maxAmountCOP), minTermMonths: numberOrNull(values.minTermMonths), maxTermMonths: numberOrNull(values.maxTermMonths),
      referenceRateEA: fractionFromPercent(values.referenceRateEA), guarantees: guarantees.map((item) => item.trim()).filter(Boolean), requiredDocuments: documents.map((item) => item.trim()).filter(Boolean),
      channel: orNull(values.channel), commissionPercent: fractionFromPercent(values.commissionPercent), commissionNotes: orNull(values.commissionNotes), agreementReference: orNull(values.agreementReference), active,
    };
    await action.run(async () => onSaved(product ? await send<Product>("PATCH", `/admin/matching/products/${product.id}`, body) : await send<Product>("POST", "/admin/matching/products", { ...body, institutionId: values.institutionId })));
  };
  return (
    <Modal title={product ? `Editar ${product.name}` : "Nuevo producto financiero"} description="Datos comerciales del producto. Los criterios de elegibilidad van en sus versiones de política." size="lg" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields">
          <Field label="Entidad" required hint={product ? "No se puede cambiar." : undefined}>
            <select value={values.institutionId} onChange={set("institutionId")} disabled={Boolean(product)} required>
              {product && !institutions.some((item) => item.id === product.institutionId) && <option value={product.institutionId}>{product.institution.name}</option>}
              {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Tipo de producto" required><select value={values.kind} onChange={set("kind")}>{catalog.productKinds.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
          <Field label="Nombre del producto" required wide><input value={values.name} onChange={set("name")} minLength={2} maxLength={160} required /></Field>
          <Field label="Descripción" wide><textarea value={values.description} onChange={set("description")} maxLength={4000} rows={2} /></Field>
        </div>
        <div className="cs-fields cs-fields-4">
          <Field label="Monto mínimo (COP)" hint={values.minAmountCOP ? cop(values.minAmountCOP) : undefined}><input type="number" min={0} step={1} value={values.minAmountCOP} onChange={set("minAmountCOP")} /></Field>
          <Field label="Monto máximo (COP)" error={amountError} hint={values.maxAmountCOP ? cop(values.maxAmountCOP) : undefined}><input type="number" min={0} step={1} value={values.maxAmountCOP} onChange={set("maxAmountCOP")} /></Field>
          <Field label="Plazo mínimo (meses)"><input type="number" min={1} max={480} step={1} value={values.minTermMonths} onChange={set("minTermMonths")} /></Field>
          <Field label="Plazo máximo (meses)" error={termError}><input type="number" min={1} max={480} step={1} value={values.maxTermMonths} onChange={set("maxTermMonths")} /></Field>
          <Field label="Tasa de referencia (% E.A.)" hint="Informativa."><input type="number" min={0} max={500} step="0.0001" value={values.referenceRateEA} onChange={set("referenceRateEA")} /></Field>
          <Field label="Canal" hint="Ej.: oficina, digital."><input value={values.channel} onChange={set("channel")} maxLength={80} /></Field>
          <Field label="Comisión (%)" hint="Sobre el monto desembolsado."><input type="number" min={0} max={100} step="0.0001" value={values.commissionPercent} onChange={set("commissionPercent")} /></Field>
          <Field label="Convenio" hint="Referencia del convenio."><input value={values.agreementReference} onChange={set("agreementReference")} maxLength={160} /></Field>
          <Field label="Notas de la comisión" wide><input value={values.commissionNotes} onChange={set("commissionNotes")} maxLength={2000} /></Field>
        </div>
        <div className="cs-fields">
          <Field label="Garantías" group><ListEditor values={guarantees} onChange={setGuarantees} placeholder="Ej.: Pagaré, codeudor" addLabel="Agregar garantía" max={20} /></Field>
          <Field label="Documentos que pide la entidad" group><ListEditor values={documents} onChange={setDocuments} placeholder="Ej.: Certificado laboral" addLabel="Agregar documento" max={30} /></Field>
        </div>
        <Check label="Producto activo" hint="Un producto inactivo no entra al matching." checked={active} onChange={setActive} />
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel={product ? "Guardar cambios" : "Crear producto"} disabled={Boolean(amountError || termError)} />
      </form>
    </Modal>
  );
}
