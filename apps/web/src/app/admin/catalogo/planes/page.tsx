"use client";

import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { Badge, Button, Cell, Check, DataTable, Empty, ErrorBox, Field, FormActions, Loaded, Modal, PageHead, Panel, useAction, useLoad } from "@/components/admin/ui";
import type { AdminPlan } from "@/lib/admin/catalog-types";
import { cop, date, points } from "@/lib/admin/format";
import { get, type Paged, send } from "@/lib/admin/http";
import { can } from "@/lib/admin/nav";

const seatsText = (plan: Pick<AdminPlan, "minSeats" | "maxSeats">) => (plan.minSeats === plan.maxSeats ? `${plan.minSeats} ${plan.minSeats === 1 ? "identidad" : "identidades"}` : `${plan.minSeats} a ${plan.maxSeats} identidades`);
const perSeat = (base: number, discount: number) => Math.round((base * (100 - discount)) / 100);

export default function PlansPage() {
  const { user, notify } = useConsole();
  const plans = useLoad(() => get<Paged<AdminPlan>>("/admin/plans"), []);
  const [editing, setEditing] = useState<AdminPlan | null>(null);
  const canEdit = can("editPlans", user.role);
  return (
    <>
      <PageHead
        eyebrow="Catálogo LUFT"
        title="Planes"
        description="El plan es la modalidad de compra: cuántas identidades incluye y a qué precio. Un paquete no fusiona expedientes: cada integrante conserva su cuenta, sus consentimientos y su ruta."
      />
      <Panel flush>
        <Loaded loader={plans} label="Cargando planes…">
          {(data) => (
            <DataTable
              caption="Planes"
              rows={[...data.items].sort((a, b) => a.position - b.position)}
              rowKey={(row) => row.id}
              empty={<Empty title="No hay planes configurados" />}
              columns={[
                { key: "name", header: "Plan", cell: (row) => <Cell main={row.name} sub={<span className="cs-mono">{row.code}</span>} /> },
                { key: "description", header: "Descripción", cell: (row) => <span className="cs-small">{row.description}</span> },
                { key: "seats", header: "Cupos", cell: (row) => seatsText(row) },
                { key: "base", header: "Precio base", align: "right", cell: (row) => cop(row.basePriceCOP) },
                { key: "discount", header: "Descuento", align: "right", cell: (row) => points(row.discountPercent, 2) },
                { key: "price", header: "Precio por identidad", align: "right", cell: (row) => <strong>{cop(row.pricePerSeatCOP)}</strong> },
                { key: "active", header: "Estado", cell: (row) => <Cell main={<Badge tone={row.active ? "good" : "neutral"}>{row.active ? "Activo" : "Inactivo"}</Badge>} sub={`Actualizado ${date(row.updatedAt)}`} /> },
                { key: "actions", header: "", align: "right", cell: (row) => (canEdit ? <Button small variant="ghost" onClick={() => setEditing(row)}>Editar</Button> : null) },
              ]}
            />
          )}
        </Loaded>
      </Panel>
      {!canEdit && <p className="cs-note">Los planes los edita el área comercial, finanzas o la superadministración.</p>}
      {editing && (
        <PlanForm
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null);
            notify(`Plan ${saved.name} actualizado.`);
            await plans.reload();
          }}
        />
      )}
    </>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan: AdminPlan; onClose: () => void; onSaved: (saved: AdminPlan) => Promise<void> }) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [minSeats, setMinSeats] = useState(String(plan.minSeats));
  const [maxSeats, setMaxSeats] = useState(String(plan.maxSeats));
  const [basePrice, setBasePrice] = useState(String(plan.basePriceCOP));
  const [discount, setDiscount] = useState(String(plan.discountPercent));
  const [active, setActive] = useState(plan.active);
  const [position, setPosition] = useState(String(plan.position));
  const action = useAction();
  const seatsError = Number(minSeats) > Number(maxSeats) ? "El mínimo no puede superar el máximo." : null;
  const preview = perSeat(Number(basePrice) || 0, Number(discount) || 0);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (seatsError) return;
    await action.run(async () => {
      const saved = await send<AdminPlan>("PATCH", `/admin/plans/${plan.code}`, {
        name: name.trim(), description: description.trim(), minSeats: Number(minSeats), maxSeats: Number(maxSeats), basePriceCOP: Number(basePrice), discountPercent: Number(discount), active, position: Number(position),
      });
      await onSaved(saved);
    });
  };
  return (
    <Modal title={`Plan ${plan.name}`} description={`Código ${plan.code}. El cambio aplica a las compras nuevas.`} onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields">
          <Field label="Nombre" required><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></Field>
          <Field label="Posición"><input type="number" min={0} max={1000} value={position} onChange={(event) => setPosition(event.target.value)} /></Field>
          <Field label="Descripción" required wide hint="Entre 10 y 1.000 caracteres."><textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={1000} rows={2} required /></Field>
          <Field label="Cupos mínimos" required><input type="number" min={1} max={20} value={minSeats} onChange={(event) => setMinSeats(event.target.value)} required /></Field>
          <Field label="Cupos máximos" required error={seatsError}><input type="number" min={1} max={20} value={maxSeats} onChange={(event) => setMaxSeats(event.target.value)} required /></Field>
          <Field label="Precio base por identidad (COP)" required hint={cop(Number(basePrice) || 0)}><input type="number" min={0} max={100000000} step={1} value={basePrice} onChange={(event) => setBasePrice(event.target.value)} required /></Field>
          <Field label="Descuento del plan (%)" required hint="De 0 a 100, con máximo dos decimales."><input type="number" min={0} max={100} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} required /></Field>
        </div>
        <p className="cs-note">Precio por identidad con este descuento: <strong>{cop(preview)}</strong>{Number(maxSeats) > 1 ? <> · paquete completo de {maxSeats}: <strong>{cop(preview * Number(maxSeats))}</strong></> : null}</p>
        <Check label="Plan activo" hint="Un plan inactivo no se ofrece en la compra." checked={active} onChange={setActive} />
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Guardar plan" disabled={Boolean(seatsError)} />
      </form>
    </Modal>
  );
}
