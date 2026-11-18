"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { DashboardData } from "@/lib/types";
import type { SessionUser } from "../app-shell";
import { Alert, Icon, Loading, Screen, type IconName } from "./ui";

interface LuftContext { user: SessionUser; data: DashboardData; reload: () => Promise<void>; notify: (message: string) => void }
const Context = createContext<LuftContext | null>(null);

/** Session, dashboard data and live updates for every authenticated screen. */
export function useLuft() {
  const value = useContext(Context);
  if (!value) throw new Error("useLuft debe usarse dentro de LuftShell");
  return value;
}

const TABS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/app", label: "Inicio", icon: "home" },
  { href: "/app/progreso", label: "Progreso", icon: "speed" },
  { href: "/app/aprender", label: "Aprender", icon: "school" },
  { href: "/app/perfil", label: "Perfil", icon: "person" },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="l-tabbar" aria-label="Navegación principal">
      {TABS.map((tab) => <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href ? "page" : undefined}><Icon name={tab.icon} />{tab.label}</Link>)}
    </nav>
  );
}

const EVENT_TEXT: Record<string, string> = {
  "score:status": "Tu consulta de historial se actualizó.",
  "profile:updated": "Tu perfil se actualizó.",
  "credit:decision": "Hay novedades en tu solicitud de crédito.",
  "payment:status": "Tu pago cambió de estado.",
  "pqr:status": "Tu solicitud de ayuda tiene una actualización.",
};

export function LuftShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [failure, setFailure] = useState("");
  const [toast, setToast] = useState("");
  const reload = useCallback(async () => {
    try { setData(await api<DashboardData>("/luft/dashboard")); setFailure(""); } catch (cause) { setFailure(errorMessage(cause)); }
  }, []);
  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(""), 4500); }, []);
  useEffect(() => {
    api<{ user: SessionUser }>("/auth/me")
      .then((result) => { setUser(result.user); return reload(); })
      .catch((cause) => { if (cause instanceof ApiError && cause.status === 401) router.replace("/login"); else setFailure(errorMessage(cause)); });
  }, [router, reload]);
  useEffect(() => { if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js"); }, []);
  useEffect(() => {
    if (!user) return;
    const socket: Socket = io({ path: "/socket.io", transports: ["websocket"], withCredentials: true });
    for (const [event, text] of Object.entries(EVENT_TEXT)) socket.on(event, () => { if (event !== "profile:updated") notify(text); void reload(); });
    return () => { socket.disconnect(); };
  }, [user, reload, notify]);
  if (!user || !data) return <Screen>{failure ? <div className="l-body" style={{ paddingTop: 48 }}><Alert>{failure}</Alert><button className="l-link-button" onClick={() => window.location.reload()}>Reintentar</button></div> : <Loading label="Abriendo tu camino…" />}</Screen>;
  return (
    <Context.Provider value={{ user, data, reload, notify }}>
      {toast && <div className="l-toast" role="status">{toast}</div>}
      {children}
      {TABS.some((tab) => tab.href === pathname) && <div className="l-app" style={{ minHeight: 0 }}><TabBar /></div>}
    </Context.Provider>
  );
}

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? "";
export const initials = (fullName: string) => fullName.trim().split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase();
