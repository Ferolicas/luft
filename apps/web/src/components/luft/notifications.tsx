"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/journey";
import type { NotificationItem, NotificationsData } from "@/lib/types";
import { useLuft } from "./shell";
import { Alert, Icon, Lufty, Sheet } from "./ui";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: NotificationItem[] };

/** Only in-app paths and https links are followed; anything else is shown as plain text. */
const linkKind = (href: string | null) => (!href ? null : href.startsWith("/") && !href.startsWith("//") ? "internal" : href.startsWith("https://") ? "external" : null);

/** Bell of the home header: unread indicator and the sheet with the person's real notifications. */
export function NotificationBell() {
  const { data, reload, notificationTick } = useLuft();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "loading" });
  // Builds of the API older than the notifications contract do not send the counter.
  const unread = data.notificationsUnread ?? 0;

  const load = useCallback(async () => {
    try {
      const result = await api<NotificationsData>("/luft/notifications");
      setState({ status: "ready", items: result.items });
      if (result.unread > 0) {
        // Abrir la lista las marca como leídas; si falla, el indicador simplemente se conserva.
        try { await api<{ unread: number }>("/luft/notifications/read", { method: "POST", body: JSON.stringify({}) }); await reload(); } catch { /* se reintenta al volver a abrir */ }
      }
    } catch (cause) { setState({ status: "error", message: errorMessage(cause) }); }
  }, [reload]);
  useEffect(() => { if (open) void load(); }, [open, notificationTick, load]);

  const close = () => setOpen(false);
  const retry = () => { setState({ status: "loading" }); void load(); };
  const content = (item: NotificationItem, linked: boolean) => <>
    <span className="dot" aria-hidden="true" />
    <span className="l-grow"><strong>{item.title}{!item.readAt && <span className="l-sr"> (sin leer)</span>}</strong><p>{item.body}</p><time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></span>
    {linked && <Icon name="chevron_right" />}
  </>;
  return (
    <>
      <button type="button" className="l-bell" aria-haspopup="dialog" aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"} onClick={() => { setState({ status: "loading" }); setOpen(true); }}>
        <Icon name="notifications" size={22} />{unread > 0 && <i aria-hidden="true" />}
      </button>
      {open && (
        <Sheet title="Notificaciones" onClose={close}>
          <div className="l-sheet-title"><h2>Notificaciones</h2><button type="button" className="l-round light" aria-label="Cerrar notificaciones" onClick={close}><Icon name="close" /></button></div>
          {state.status === "loading" && <p className="l-muted" role="status" style={{ padding: "24px 0", textAlign: "center" }}>Cargando tus notificaciones…</p>}
          {state.status === "error" && <><Alert>No pudimos cargar tus notificaciones. {state.message}</Alert><button type="button" className="l-link-button" onClick={retry}>Reintentar</button></>}
          {state.status === "ready" && state.items.length === 0 && <div className="l-empty"><Lufty mood="neutral" width={72} /><strong style={{ color: "var(--l-n-900)", fontWeight: 500 }}>Aún no tienes notificaciones</strong>Aquí verás las novedades de tu crédito, tus pagos y tus solicitudes.</div>}
          {state.status === "ready" && state.items.length > 0 && <ul className="l-notifs">{state.items.map((item) => {
            const kind = linkKind(item.href);
            return (
              <li key={item.id} className={item.readAt ? "read" : ""}>
                {kind === "internal" ? <Link href={item.href!} onClick={close}>{content(item, true)}</Link>
                  : kind === "external" ? <a href={item.href!} target="_blank" rel="noreferrer">{content(item, true)}</a>
                  : <div>{content(item, false)}</div>}
              </li>
            );
          })}</ul>}
        </Sheet>
      )}
    </>
  );
}
