"use client";

import { Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { ArchetypeRuleBuilder } from "@/components/admin/archetype-rules";
import { Badge, Button, Cell, Check, ConfirmDialog, DataTable, Empty, ErrorBox, Field, FormActions, Loaded, Modal, PageHead, Pager, Panel, Toolbar, useAction, useLoad } from "@/components/admin/ui";
import { type AdminArchetype, type AdminCategory, type ArchetypeFact, type ArchetypeRules, countConditions, describeRules, type EditGroup, emptyGroup, fromEditable, toEditable } from "@/lib/admin/catalog-types";
import { date } from "@/lib/admin/format";
import { get, type Paged, query, send } from "@/lib/admin/http";
import { can } from "@/lib/admin/nav";

interface FactCatalog { facts: ArchetypeFact[]; operators: string[] }

export default function ArchetypesPage() {
  const { user, notify } = useConsole();
  const categories = useLoad(() => get<Paged<AdminCategory>>("/admin/categories"), []);
  const catalog = useLoad(() => get<FactCatalog>("/admin/archetypes/facts"), []);
  const [categoryCode, setCategoryCode] = useState("");
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminArchetype | "new" | null>(null);
  const [deactivating, setDeactivating] = useState<AdminArchetype | null>(null);
  const canEdit = can("editCatalog", user.role);

  // La categoría inicial puede venir enlazada desde la pantalla de categorías (?categoria=JOVEN).
  useEffect(() => {
    if (categoryCode || !categories.data) return;
    const wanted = new URLSearchParams(window.location.search).get("categoria");
    const sorted = [...categories.data.items].sort((a, b) => a.position - b.position);
    setCategoryCode(sorted.find((item) => item.code === wanted)?.code ?? sorted[0]?.code ?? "");
  }, [categories.data, categoryCode]);

  const archetypes = useLoad(
    () => (categoryCode ? get<Paged<AdminArchetype>>(`/admin/archetypes${query({ categoryCode, history: history ? "true" : undefined, page })}`) : Promise.resolve({ items: [], page: 1, pages: 1, total: 0 })),
    [categoryCode, history, page],
  );
  const facts = catalog.data?.facts ?? [];
  const category = categories.data?.items.find((item) => item.code === categoryCode) ?? null;

  return (
    <>
      <PageHead
        eyebrow="Catálogo LUFT"
        title="Arquetipos"
        description="El arquetipo es el perfil conductual de una persona dentro de su categoría. Sus reglas se evalúan por prioridad; editar un arquetipo publica una versión nueva y la anterior queda en el historial, de modo que cada asignación conserva la versión con la que se hizo."
        actions={canEdit && categoryCode && catalog.data && <Button onClick={() => setEditing("new")}><Plus size={16} /> Nuevo arquetipo</Button>}
      />
      <ErrorBox problem={categories.problem ?? catalog.problem} onRetry={() => { void categories.reload(); void catalog.reload(); }} />
      <Panel flush>
        <Toolbar>
          <label>
            Categoría
            <select value={categoryCode} onChange={(event) => { setCategoryCode(event.target.value); setPage(1); }}>
              {(categories.data?.items ?? []).map((item) => <option key={item.code} value={item.code}>{item.brand} · {item.label}{item.active ? "" : " (inactiva)"}</option>)}
            </select>
          </label>
          <div style={{ paddingBottom: 9 }}><Check label="Mostrar historial de versiones" checked={history} onChange={(value) => { setHistory(value); setPage(1); }} /></div>
        </Toolbar>
        <Loaded loader={archetypes} label="Cargando arquetipos…">
          {(data) => (
            <>
              <DataTable
                caption="Arquetipos"
                rows={data.items}
                rowKey={(row) => row.id}
                empty={<Empty title="Esta categoría no tiene arquetipos">{canEdit ? "Crea el primero y márcalo como predeterminado para que toda persona de la categoría tenga un perfil." : undefined}</Empty>}
                columns={[
                  { key: "name", header: "Arquetipo", cell: (row) => <Cell main={row.name} sub={<span className="cs-mono">{row.code}</span>} /> },
                  { key: "version", header: "Versión", align: "center", cell: (row) => `v${row.version}` },
                  { key: "priority", header: "Prioridad", align: "center", cell: (row) => row.priority },
                  { key: "state", header: "Estado", cell: (row) => <div className="cs-chips"><Badge tone={row.active ? "good" : "neutral"}>{row.active ? "Vigente" : "Versión anterior"}</Badge>{row.isDefault && <Badge tone="info">Predeterminado</Badge>}</div> },
                  { key: "rules", header: "Reglas", cell: (row) => <Cell main={`${countConditions(row.rules)} ${countConditions(row.rules) === 1 ? "condición" : "condiciones"}`} sub={describeRules(row.rules, facts)} /> },
                  { key: "created", header: "Publicado", cell: (row) => date(row.createdAt) },
                  {
                    key: "actions",
                    header: "",
                    align: "right",
                    cell: (row) => (
                      <div className="cs-actions">
                        <Button small variant="ghost" onClick={() => setEditing(row)}>{canEdit && row.active ? "Editar" : "Ver"}</Button>
                        {canEdit && row.active && !row.isDefault && <Button small variant="ghost" className="cs-btn-danger-text" onClick={() => setDeactivating(row)}>Desactivar</Button>}
                      </div>
                    ),
                  },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun={history ? "versiones" : "arquetipos"} />
            </>
          )}
        </Loaded>
      </Panel>
      {editing && catalog.data && category && (
        <ArchetypeForm
          archetype={editing === "new" ? null : editing}
          category={category}
          catalog={catalog.data}
          readOnly={!canEdit || (editing !== "new" && !editing.active)}
          onClose={() => setEditing(null)}
          onSaved={async (saved, created) => {
            setEditing(null);
            notify(created ? `Arquetipo ${saved.name} creado (versión 1).` : `${saved.name}: publicada la versión ${saved.version}.`);
            await archetypes.reload();
          }}
        />
      )}
      {deactivating && (
        <ConfirmDialog
          title="Desactivar el arquetipo"
          confirmLabel="Desactivar"
          danger
          onClose={() => setDeactivating(null)}
          onConfirm={async () => {
            await send("POST", `/admin/archetypes/${deactivating.id}/deactivate`);
            notify(`${deactivating.name} quedó desactivado.`);
            await archetypes.reload();
          }}
        >
          <p><strong>{deactivating.name}</strong> dejará de asignarse a personas nuevas. Quienes ya lo tienen conservan su historial; en la próxima evaluación recibirán el arquetipo que les corresponda.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function ArchetypeForm({ archetype, category, catalog, readOnly, onClose, onSaved }: { archetype: AdminArchetype | null; category: AdminCategory; catalog: FactCatalog; readOnly: boolean; onClose: () => void; onSaved: (saved: AdminArchetype, created: boolean) => Promise<void> }) {
  const [code, setCode] = useState(archetype?.code ?? "");
  const [name, setName] = useState(archetype?.name ?? "");
  const [description, setDescription] = useState(archetype?.description ?? "");
  const [priority, setPriority] = useState(String(archetype?.priority ?? 50));
  const [isDefault, setIsDefault] = useState(archetype?.isDefault ?? false);
  const [root, setRoot] = useState<EditGroup>(() => (archetype ? (toEditable(archetype.rules) as EditGroup) : emptyGroup("any")));
  const [issues, setIssues] = useState<string[]>([]);
  const action = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly) return;
    const found: string[] = [];
    const rules = fromEditable(root, catalog.facts, found) as ArchetypeRules;
    setIssues(found);
    if (found.length > 0) return;
    const body = { name: name.trim(), description: description.trim(), rules, priority: Number(priority) || 0, isDefault };
    await action.run(async () => {
      const saved = archetype
        ? await send<AdminArchetype>("PUT", `/admin/archetypes/${archetype.id}`, body)
        : await send<AdminArchetype>("POST", "/admin/archetypes", { ...body, categoryCode: category.code, code: code.trim().toUpperCase() });
      await onSaved(saved, !archetype);
    });
  };

  return (
    <Modal
      title={archetype ? `${archetype.name} · versión ${archetype.version}` : `Nuevo arquetipo de ${category.brand}`}
      description={archetype ? (readOnly ? "Versión de solo lectura." : `Al guardar se publica la versión ${archetype.version + 1}; la versión ${archetype.version} queda en el historial.`) : `Categoría ${category.label} (${category.code}).`}
      size="xl"
      onClose={onClose}
    >
      <form className="cs-form" onSubmit={submit}>
        <fieldset className="cs-fieldset" disabled={readOnly}>
          <legend>Perfil</legend>
          <div className="cs-fields cs-fields-3">
            <Field label="Código" required hint={archetype ? "No se puede cambiar." : "Mayúsculas, números y guion bajo."}><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} pattern="[A-Z][A-Z0-9_]{1,39}" maxLength={40} disabled={Boolean(archetype)} required /></Field>
            <Field label="Nombre" required><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required /></Field>
            <Field label="Prioridad" required hint="De 0 a 1.000. Gana la regla de mayor prioridad que se cumpla."><input type="number" min={0} max={1000} value={priority} onChange={(event) => setPriority(event.target.value)} required /></Field>
            <Field label="Descripción que verá la persona" required wide hint="Entre 10 y 1.000 caracteres."><textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={1000} rows={2} required /></Field>
          </div>
          <Check label="Arquetipo predeterminado de la categoría" hint="Se asigna cuando ninguna regla se cumple. Solo hay uno por categoría: marcarlo reemplaza al actual." checked={isDefault} onChange={setIsDefault} disabled={readOnly} />
        </fieldset>
        <fieldset className="cs-fieldset">
          <legend>Reglas</legend>
          <ArchetypeRuleBuilder root={root} onChange={setRoot} facts={catalog.facts} operators={catalog.operators} disabled={readOnly} />
        </fieldset>
        {issues.length > 0 && <div className="cs-error" role="alert"><span /><div><strong>Revisa las reglas antes de guardar</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></div>}
        <ErrorBox problem={action.problem} />
        {readOnly ? <div className="cs-form-actions"><Button variant="ghost" onClick={onClose}>Cerrar</Button></div> : <FormActions busy={action.busy} onCancel={onClose} submitLabel={archetype ? `Publicar versión ${archetype.version + 1}` : "Crear arquetipo"} />}
      </form>
    </Modal>
  );
}
