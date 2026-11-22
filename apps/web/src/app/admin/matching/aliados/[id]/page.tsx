"use client";

import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { PartnerUsers } from "@/components/admin/matching";
import { AllyForm } from "@/components/admin/partner-forms";
import { Badge, Button, Cell, ConfirmDialog, DataTable, Empty, ErrorBox, Facts, Loaded, PageHead, Pager, Panel, useAction, useLoad } from "@/components/admin/ui";
import { date } from "@/lib/admin/format";
import { get, type Paged, send } from "@/lib/admin/http";
import type { Ally, Referral } from "@/lib/admin/matching-types";

const SOURCE_LABEL: Record<string, string> = { STAFF: "Registrado por LUFT", CODE: "Código de referido", MANUAL: "Registrado por LUFT" };

export default function AllyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { notify } = useConsole();
  const ally = useLoad(() => get<Ally>(`/admin/matching/allies/${id}`), [id]);
  const [page, setPage] = useState(1);
  const referrals = useLoad(() => get<Paged<Referral>>(`/admin/matching/allies/${id}/referrals?page=${page}`), [id, page]);
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState<Referral | null>(null);
  const adding = useAction();

  const addReferral = async (event: FormEvent) => {
    event.preventDefault();
    await adding.run(async () => {
      await send("POST", `/admin/matching/allies/${id}/referrals`, { email: email.trim().toLowerCase() });
      setEmail("");
      notify("Referido registrado.");
      await Promise.all([referrals.reload(), ally.reload()]);
    });
  };

  return (
    <Loaded loader={ally} label="Cargando el aliado…">
      {(data) => (
        <>
          <PageHead
            back={{ href: "/admin/matching/aliados", label: "Aliados" }}
            eyebrow="Aliado"
            title={data.name}
            description={<span className="cs-row"><Badge tone={data.active ? "good" : "neutral"}>{data.active ? "Activo" : "Inactivo"}</Badge><span>Código de referido <strong className="cs-mono">{data.referralCode}</strong></span></span>}
            actions={
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>Editar</Button>
                <Button variant="ghost" className="cs-btn-danger-text" onClick={() => setDeleting(true)}>Eliminar</Button>
              </>
            }
          />
          <Panel title="Datos del aliado">
            <Facts
              columns={4}
              items={[
                { label: "NIT", value: data.taxId },
                { label: "Contacto", value: data.contactName },
                { label: "Correo", value: data.contactEmail },
                { label: "Teléfono", value: data.contactPhone },
                { label: "Referidos", value: String(data.referralsCount) },
                { label: "Cuentas con acceso", value: String(data.usersCount) },
                { label: "Creado", value: date(data.createdAt) },
              ]}
            />
          </Panel>
          <PartnerUsers listPath={`/admin/matching/allies/${id}/users`} unlinkPath="/admin/matching/ally-users" partnerLabel="aliado" roleLabel="Aliado" onChanged={() => void ally.reload()} />
          <Panel flush title="Referidos" description="Personas usuarias atribuidas a este aliado. El aliado no ve esta lista: su portal solo muestra el embudo agregado, y con menos de 5 referidos solo el total.">
            <form className="cs-toolbar" onSubmit={addReferral}>
              <label>
                Correo de la persona referida
                <input type="email" placeholder="persona@correo.com" value={email} onChange={(event) => setEmail(event.target.value)} style={{ width: 280 }} required />
              </label>
              <Button type="submit" disabled={adding.busy}>{adding.busy ? "Registrando…" : "Registrar referido"}</Button>
            </form>
            <ErrorBox problem={adding.problem} />
            <Loaded loader={referrals} label="Cargando referidos…">
              {(list) => (
                <>
                  <DataTable
                    caption="Referidos del aliado"
                    rows={list.items}
                    rowKey={(row) => row.id}
                    empty={<Empty title="Sin referidos">Registra aquí a las personas que llegaron por este aliado.</Empty>}
                    columns={[
                      { key: "person", header: "Persona", cell: (row) => <Cell main={row.fullName} sub={row.email} /> },
                      { key: "source", header: "Origen", cell: (row) => SOURCE_LABEL[row.source] ?? row.source },
                      { key: "created", header: "Registrado", cell: (row) => date(row.createdAt) },
                      { key: "actions", header: "", align: "right", cell: (row) => <Button small variant="ghost" className="cs-btn-danger-text" onClick={() => setRemoving(row)}>Quitar</Button> },
                    ]}
                  />
                  <Pager page={list.page} pages={list.pages} total={list.total} onPage={setPage} noun="referidos" />
                </>
              )}
            </Loaded>
          </Panel>
          {editing && <AllyForm ally={data} onClose={() => setEditing(false)} onSaved={async (saved) => { setEditing(false); ally.setData(saved); notify("Aliado actualizado."); }} />}
          {removing && (
            <ConfirmDialog title="Quitar el referido" confirmLabel="Quitar referido" danger onClose={() => setRemoving(null)} onConfirm={async () => { await send("DELETE", `/admin/matching/ally-referrals/${removing.id}`); notify("Referido retirado."); await Promise.all([referrals.reload(), ally.reload()]); }}>
              <p><strong>{removing.fullName}</strong> dejará de contarse en el embudo de {data.name}.</p>
            </ConfirmDialog>
          )}
          {deleting && (
            <ConfirmDialog title="Eliminar el aliado" confirmLabel="Eliminar aliado" danger onClose={() => setDeleting(false)} onConfirm={async () => { await send("DELETE", `/admin/matching/allies/${id}`); notify(`Aliado ${data.name} eliminado.`); router.push("/admin/matching/aliados"); }}>
              <p>Solo se puede eliminar un aliado sin cuentas vinculadas ni referidos. Si ya se usó, desactívalo desde «Editar».</p>
            </ConfirmDialog>
          )}
        </>
      )}
    </Loaded>
  );
}
