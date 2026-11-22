"use client";

import { useEffect, useSyncExternalStore } from "react";
import { send } from "@/lib/admin/http";
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

interface PersonName { fullName: string; email: string }

/*
 * Nombres junto a los `userId` que devuelven los listados de crédito, PQR,
 * auditoría y matching. Cada celda pide su id; las peticiones de un mismo
 * render se agrupan en una sola consulta (`POST /admin/directory/lookup`) y el
 * resultado queda en memoria. Cualquier rol del equipo puede resolver los
 * nombres de los casos que ya está viendo; no se descarga un directorio.
 */
const names = new Map<string, PersonName | null>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let timer: number | undefined;
let version = 0;

async function flush() {
  timer = undefined;
  const ids = [...waiting].slice(0, 200);
  for (const id of ids) waiting.delete(id);
  try {
    const result = await send<{ items: Array<PersonName & { id: string }> }>("POST", "/admin/directory/lookup", { ids });
    for (const id of ids) names.set(id, null);
    for (const item of result.items) names.set(item.id, { fullName: item.fullName, email: item.email });
  } catch {
    for (const id of ids) names.set(id, null);
  }
  version += 1;
  for (const listener of listeners) listener();
  if (waiting.size > 0) timer = window.setTimeout(() => void flush(), 20);
}

function request(id: string) {
  if (names.has(id) || waiting.has(id)) return;
  waiting.add(id);
  timer ??= window.setTimeout(() => void flush(), 20);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Se conserva por compatibilidad con las pantallas: las celdas resuelven su propio nombre. */
export function usePeople() {
  return null as Map<string, AdminUser> | null;
}

/** Olvida los nombres en memoria (tras cambiar un rol o vincular una cuenta). */
export function forgetPeople() {
  names.clear();
  version += 1;
  for (const listener of listeners) listener();
}

export function PersonCell({ id }: { id: string | null | undefined; people?: Map<string, AdminUser> | null }) {
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => { if (id) request(id); }, [id]);
  if (!id) return <span className="cs-muted">—</span>;
  const person = names.get(id);
  if (!person) return <span className="cs-mono" title={id}>{shortId(id)}</span>;
  return <div className="cs-cell"><strong>{person.fullName}</strong><small>{person.email}</small></div>;
}
