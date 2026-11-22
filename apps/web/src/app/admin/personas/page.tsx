"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { type AdminUser, forgetPeople } from "@/components/admin/people";
import { Button, Cell, ConfirmDialog, DataTable, Empty, Loaded, PageHead, Pager, Panel, StatusBadge, Toolbar, useLoad } from "@/components/admin/ui";
import { date, dateTime } from "@/lib/admin/format";
import { get, type Paged, query, send } from "@/lib/admin/http";
import { USER_STATUS_LABEL } from "@/lib/admin/labels";
import { can, ROLE_LABEL } from "@/lib/admin/nav";

/** Roles que se asignan a mano. ALLY e INSTITUTION nacen al vincular la cuenta a un aliado o a una entidad. */
const ASSIGNABLE = ["USER", "COMMERCIAL", "LEGAL", "SUPPORT", "COLLECTIONS", "RISK", "FINANCE", "SUPERADMIN"];
const PARTNER_AREA: Record<string, { label: string; href: string }> = {
  INSTITUTION: { label: "Se gestiona en Entidades", href: "/admin/matching/entidades" },
  ALLY: { label: "Se gestiona en Aliados", href: "/admin/matching/aliados" },
};

export default function PeoplePage() {
  const { user, notify } = useConsole();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [change, setChange] = useState<{ person: AdminUser; role: string } | null>(null);
  const users = useLoad(() => get<Paged<AdminUser>>(`/admin/users${query({ page, search })}`), [page, search]);
  const canSetRoles = can("setRoles", user.role);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(draft.trim());
  };

  return (
    <>
      <PageHead
        eyebrow="Operación"
        title="Personas y roles"
        description="Cuentas registradas en LUFT. Los roles internos solo los cambia la superadministración y cada cambio queda en la auditoría."
      />
      <Panel flush>
        <Toolbar>
          <form onSubmit={submit} className="cs-row">
            <input aria-label="Buscar por nombre, usuario o correo" placeholder="Nombre, usuario o correo" value={draft} onChange={(event) => setDraft(event.target.value)} style={{ width: 280 }} />
            <Button type="submit" variant="ghost"><Search size={15} /> Buscar</Button>
            {search && <Button variant="quiet" onClick={() => { setDraft(""); setSearch(""); setPage(1); }}>Limpiar</Button>}
          </form>
        </Toolbar>
        <Loaded loader={users} label="Cargando cuentas…">
          {(data) => (
            <>
              <DataTable
                caption="Cuentas registradas"
                rows={data.items}
                rowKey={(row) => row.id}
                empty={<Empty title="No hay cuentas que coincidan">{search ? `Ninguna cuenta coincide con «${search}».` : "Todavía no hay cuentas registradas."}</Empty>}
                columns={[
                  { key: "person", header: "Persona", cell: (row) => <Cell main={row.fullName} sub={`@${row.username}`} /> },
                  { key: "contact", header: "Contacto", cell: (row) => <Cell main={row.email} sub={row.phone} /> },
                  { key: "stratum", header: "Estrato", align: "center", cell: (row) => row.stratum },
                  { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} labels={USER_STATUS_LABEL} /> },
                  { key: "created", header: "Registro", cell: (row) => <Cell main={date(row.createdAt)} sub={row.lastLoginAt ? `Último ingreso ${dateTime(row.lastLoginAt)}` : "Sin ingresos"} /> },
                  {
                    key: "role",
                    header: "Rol",
                    width: "230px",
                    cell: (row) => {
                      const partner = PARTNER_AREA[row.role];
                      if (partner) return <Cell main={ROLE_LABEL[row.role]} sub={canSetRoles ? <Link className="cs-link" href={partner.href}>{partner.label}</Link> : partner.label} />;
                      if (!canSetRoles) return ROLE_LABEL[row.role] ?? row.role;
                      return (
                        <select aria-label={`Rol de ${row.fullName}`} value={row.role} onChange={(event) => setChange({ person: row, role: event.target.value })}>
                          {ASSIGNABLE.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                        </select>
                      );
                    },
                  },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="cuentas" />
            </>
          )}
        </Loaded>
      </Panel>
      {change && (
        <ConfirmDialog
          title="Cambiar rol"
          confirmLabel="Cambiar rol"
          onClose={() => setChange(null)}
          onConfirm={async () => {
            await send("PATCH", `/admin/users/${change.person.id}/role`, { role: change.role });
            forgetPeople();
            notify(`Rol de ${change.person.fullName} actualizado.`);
            await users.reload();
          }}
        >
          <p><strong>{change.person.fullName}</strong> pasará de <strong>{ROLE_LABEL[change.person.role] ?? change.person.role}</strong> a <strong>{ROLE_LABEL[change.role]}</strong>.</p>
          <p>El rol define qué áreas del panel puede usar esta cuenta. El cambio aplica desde su próxima petición.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
