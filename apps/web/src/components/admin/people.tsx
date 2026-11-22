"use client";

import { useEffect, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { get, type Paged } from "@/lib/admin/http";
import { shortId } from "@/lib/admin/format";

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  phone: string;
  fullName: string;
  stratum: number;
  role: string;
  status: string;
  phoneVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Roles que la API deja consultar `GET /admin/users`. */
const DIRECTORY_ROLES = ["SUPPORT", "RISK", "SUPERADMIN"];
/** Tope de páginas del directorio en memoria (25 cuentas por página). */
const MAX_PAGES = 12;

let cache: Promise<Map<string, AdminUser>> | null = null;

async function loadDirectory() {
  const people = new Map<string, AdminUser>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await get<Paged<AdminUser>>(`/admin/users?page=${page}`);
    for (const user of result.items) people.set(user.id, user);
    if (page >= result.pages) break;
  }
  return people;
}

/**
 * Directorio de cuentas para mostrar nombres junto a los `userId` que devuelven
 * los listados de crédito, PQR y auditoría (esos listados solo traen el id).
 * Solo se carga para los roles que pueden leer cuentas; el resto ve el id corto.
 */
export function usePeople() {
  const { user } = useConsole();
  const [people, setPeople] = useState<Map<string, AdminUser> | null>(null);
  const enabled = DIRECTORY_ROLES.includes(user.role);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    cache ??= loadDirectory().catch((cause) => { cache = null; throw cause; });
    cache.then((result) => { if (alive) setPeople(result); }).catch(() => undefined);
    return () => { alive = false; };
  }, [enabled]);
  return people;
}

/** Olvida el directorio en memoria (tras cambiar un rol o vincular una cuenta). */
export function forgetPeople() {
  cache = null;
}

export function PersonCell({ id, people }: { id: string | null | undefined; people: Map<string, AdminUser> | null }) {
  if (!id) return <span className="cs-muted">—</span>;
  const person = people?.get(id);
  if (!person) return <span className="cs-mono" title={id}>{shortId(id)}</span>;
  return <div className="cs-cell"><strong>{person.fullName}</strong><small>{person.email}</small></div>;
}
