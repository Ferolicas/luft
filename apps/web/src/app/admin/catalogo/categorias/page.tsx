"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { Badge, Button, Cell, Check, ConfirmDialog, DataTable, Empty, ErrorBox, Field, FormActions, ListEditor, Loaded, Modal, OptionChecks, PageHead, Panel, useAction, useLoad } from "@/components/admin/ui";
import { type AdminCategory, type CategoryConfig, DOCUMENT_OPTIONS, PROJECT_OPTIONS } from "@/lib/admin/catalog-types";
import { date } from "@/lib/admin/format";
import { get, type Paged, send } from "@/lib/admin/http";
import { can } from "@/lib/admin/nav";

interface ModuleOption { value: string; label: string }

const EMPTY_CONFIG: CategoryConfig = {
  onboarding: { headline: "", steps: [""] },
  modules: [],
  requiredDocuments: [],
  messages: { welcome: "", nextStep: "", matching: "" },
  projectKinds: [],
};

/** Módulos de aprendizaje publicados (el catálogo de la academia), para elegirlos por nombre. */
async function loadModules(): Promise<ModuleOption[]> {
  const dashboard = await get<{ learning?: Array<{ slug: string; title: string }> }>("/luft/dashboard");
  return (dashboard.learning ?? []).map((module) => ({ value: module.slug, label: module.title }));
}

export default function CategoriesPage() {
  const { user, notify } = useConsole();
  const categories = useLoad(() => get<Paged<AdminCategory>>("/admin/categories"), []);
  const modules = useLoad(loadModules, []);
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const canEdit = can("editCatalog", user.role);
  const canDelete = can("deleteCategory", user.role);

  return (
    <>
      <PageHead
        eyebrow="Catálogo LUFT"
        title="Categorías"
        description="La categoría es el segmento y la propuesta comercial (marca, lenguaje, ruta, módulos y documentos). Se crea y se ajusta aquí, sin desplegar código. No es lo mismo que el arquetipo, que es el perfil conductual dentro de la categoría."
        actions={canEdit && <Button onClick={() => setEditing("new")}><Plus size={16} /> Nueva categoría</Button>}
      />
      <Panel flush>
        <Loaded loader={categories} label="Cargando categorías…">
          {(data) => (
            <DataTable
              caption="Categorías"
              rows={[...data.items].sort((a, b) => a.position - b.position)}
              rowKey={(row) => row.id}
              empty={<Empty title="No hay categorías">Crea la primera categoría para que las personas puedan iniciar una ruta.</Empty>}
              columns={[
                { key: "brand", header: "Categoría", cell: (row) => <Cell main={`${row.brand} · ${row.label}`} sub={<span className="cs-mono">{row.code}</span>} /> },
                { key: "description", header: "Propuesta", cell: (row) => <span className="cs-small">{row.description}</span> },
                { key: "config", header: "Configuración", cell: (row) => <span className="cs-small cs-muted">{row.config.onboarding.steps.length} pasos · {row.config.modules.length} módulos · {row.config.requiredDocuments.length} documentos</span> },
                { key: "archetypes", header: "Arquetipos", align: "center", cell: (row) => <Link className="cs-link" href={`/admin/catalogo/arquetipos?categoria=${row.code}`}>{row.archetypes}</Link> },
                { key: "routes", header: "Rutas", align: "center", cell: (row) => row.routes },
                { key: "active", header: "Estado", cell: (row) => <Cell main={<Badge tone={row.active ? "good" : "neutral"}>{row.active ? "Activa" : "Inactiva"}</Badge>} sub={`Posición ${row.position} · ${date(row.updatedAt)}`} /> },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: (row) => (
                    <div className="cs-actions">
                      <Button small variant="ghost" onClick={() => setEditing(row)}>{canEdit ? "Editar" : "Ver"}</Button>
                      {canDelete && <Button small variant="ghost" className="cs-btn-danger-text" onClick={() => setDeleting(row)}>Eliminar</Button>}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Loaded>
      </Panel>
      {editing && (
        <CategoryForm
          category={editing === "new" ? null : editing}
          modules={modules.data ?? []}
          readOnly={!canEdit}
          nextPosition={(categories.data?.items.reduce((max, item) => Math.max(max, item.position), 0) ?? 0) + 1}
          onClose={() => setEditing(null)}
          onSaved={async (saved, created) => {
            setEditing(null);
            notify(created ? `Categoría ${saved.brand} creada.` : `Categoría ${saved.brand} actualizada.`);
            await categories.reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Eliminar la categoría"
          confirmLabel="Eliminar categoría"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await send("DELETE", `/admin/categories/${deleting.id}`);
            notify(`Categoría ${deleting.brand} eliminada.`);
            await categories.reload();
          }}
        >
          <p>Vas a eliminar <strong>{deleting.brand} ({deleting.label})</strong>. Solo se puede eliminar una categoría sin rutas ni asignaciones; si ya se usó, desactívala.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function CategoryForm({ category, modules, readOnly, nextPosition, onClose, onSaved }: { category: AdminCategory | null; modules: ModuleOption[]; readOnly: boolean; nextPosition: number; onClose: () => void; onSaved: (saved: AdminCategory, created: boolean) => Promise<void> }) {
  const [code, setCode] = useState(category?.code ?? "");
  const [brand, setBrand] = useState(category?.brand ?? "");
  const [label, setLabel] = useState(category?.label ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [position, setPosition] = useState(String(category?.position ?? nextPosition));
  const [active, setActive] = useState(category?.active ?? true);
  const [config, setConfig] = useState<CategoryConfig>(category?.config ?? EMPTY_CONFIG);
  const action = useAction();
  // Un módulo configurado que ya no está publicado se conserva visible para poder quitarlo.
  const moduleOptions = [...modules, ...config.modules.filter((slug) => !modules.some((item) => item.value === slug)).map((slug) => ({ value: slug, label: `${slug} (no publicado)` }))];
  const patch = (changes: Partial<CategoryConfig>) => setConfig((current) => ({ ...current, ...changes }));
  const steps = config.onboarding.steps.map((step) => step.trim()).filter(Boolean);
  const stepsError = steps.length === 0 ? "Agrega al menos un paso." : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || stepsError) return;
    const body = {
      brand: brand.trim(),
      label: label.trim(),
      description: description.trim(),
      position: Number(position) || 0,
      active,
      config: {
        onboarding: { headline: config.onboarding.headline.trim(), steps },
        modules: config.modules,
        requiredDocuments: config.requiredDocuments,
        messages: { welcome: config.messages.welcome.trim(), nextStep: config.messages.nextStep.trim(), matching: config.messages.matching.trim() },
        projectKinds: config.projectKinds,
      },
    };
    await action.run(async () => {
      const saved = category ? await send<AdminCategory>("PATCH", `/admin/categories/${category.id}`, body) : await send<AdminCategory>("POST", "/admin/categories", { ...body, code: code.trim().toUpperCase() });
      await onSaved(saved, !category);
    });
  };

  return (
    <Modal title={category ? `${category.brand} · ${category.label}` : "Nueva categoría"} description={category ? `Código ${category.code}. Los cambios aplican de inmediato a las rutas de esta categoría.` : "Queda disponible para las personas en cuanto la guardes activa."} size="lg" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <fieldset className="cs-fieldset" disabled={readOnly}>
          <legend>Identidad comercial</legend>
          <div className="cs-fields cs-fields-3">
            <Field label="Código" required hint={category ? "No se puede cambiar." : "Mayúsculas, números y guion bajo. Ej.: EMPRENDEDOR."}>
              <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} pattern="[A-Z][A-Z0-9_]{1,39}" maxLength={40} disabled={Boolean(category)} required />
            </Field>
            <Field label="Marca" required hint="Ej.: LUFT Impulso."><input value={brand} onChange={(event) => setBrand(event.target.value)} minLength={2} maxLength={80} required /></Field>
            <Field label="Etiqueta del segmento" required hint="Ej.: Joven."><input value={label} onChange={(event) => setLabel(event.target.value)} minLength={2} maxLength={80} required /></Field>
            <Field label="Descripción de la propuesta" required wide hint="Entre 10 y 1.000 caracteres."><textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={1000} rows={2} required /></Field>
            <Field label="Posición" hint="Orden en que se muestra."><input type="number" min={0} max={1000} value={position} onChange={(event) => setPosition(event.target.value)} /></Field>
            <div style={{ alignSelf: "end", paddingBottom: 9 }}><Check label="Categoría activa" hint="Las inactivas no se ofrecen a personas nuevas." checked={active} onChange={setActive} disabled={readOnly} /></div>
          </div>
        </fieldset>
        <fieldset className="cs-fieldset" disabled={readOnly}>
          <legend>Onboarding</legend>
          <Field label="Titular de bienvenida" required><input value={config.onboarding.headline} onChange={(event) => patch({ onboarding: { ...config.onboarding, headline: event.target.value } })} minLength={3} maxLength={160} required /></Field>
          <Field label="Pasos de la ruta (1 a 8)" required error={stepsError} group>
            <ListEditor values={config.onboarding.steps} onChange={(values) => patch({ onboarding: { ...config.onboarding, steps: values } })} placeholder="Ej.: Conoce tu punto de partida en las centrales de riesgo" addLabel="Agregar paso" max={8} disabled={readOnly} />
          </Field>
        </fieldset>
        <fieldset className="cs-fieldset" disabled={readOnly}>
          <legend>Módulos, documentos y proyectos</legend>
          <Field label="Módulos de aprendizaje de la categoría" hint="Módulos publicados en la academia." group>
            {moduleOptions.length > 0 ? <OptionChecks options={moduleOptions} values={config.modules} onChange={(values) => patch({ modules: values })} disabled={readOnly} /> : <ListEditor values={config.modules} onChange={(values) => patch({ modules: values })} placeholder="slug-del-modulo" addLabel="Agregar módulo" max={30} disabled={readOnly} />}
          </Field>
          <Field label="Documentos que se piden" group><OptionChecks options={DOCUMENT_OPTIONS} values={config.requiredDocuments} onChange={(values) => patch({ requiredDocuments: values })} disabled={readOnly} /></Field>
          <Field label="Tipos de proyecto de vida sugeridos" group><OptionChecks options={PROJECT_OPTIONS} values={config.projectKinds} onChange={(values) => patch({ projectKinds: values })} disabled={readOnly} /></Field>
        </fieldset>
        <fieldset className="cs-fieldset" disabled={readOnly}>
          <legend>Mensajes</legend>
          <Field label="Bienvenida" required><textarea value={config.messages.welcome} onChange={(event) => patch({ messages: { ...config.messages, welcome: event.target.value } })} minLength={3} maxLength={400} rows={2} required /></Field>
          <Field label="Siguiente paso" required><textarea value={config.messages.nextStep} onChange={(event) => patch({ messages: { ...config.messages, nextStep: event.target.value } })} minLength={3} maxLength={400} rows={2} required /></Field>
          <Field label="Matching" required hint="No prometas aprobaciones ni aumentos de puntaje."><textarea value={config.messages.matching} onChange={(event) => patch({ messages: { ...config.messages, matching: event.target.value } })} minLength={3} maxLength={400} rows={2} required /></Field>
        </fieldset>
        <details>
          <summary className="cs-link" style={{ cursor: "pointer" }}>Ver la configuración como JSON</summary>
          <pre className="cs-pre" style={{ marginTop: 8 }}>{JSON.stringify({ ...config, onboarding: { ...config.onboarding, steps } }, null, 2)}</pre>
        </details>
        <ErrorBox problem={action.problem} />
        {readOnly ? <div className="cs-form-actions"><Button variant="ghost" onClick={onClose}>Cerrar</Button></div> : <FormActions busy={action.busy} onCancel={onClose} submitLabel={category ? "Guardar cambios" : "Crear categoría"} disabled={Boolean(stepsError)} />}
      </form>
    </Modal>
  );
}
