"use client";

import { Bell, BookOpen, CircleHelp, CreditCard, Gauge, LayoutDashboard, LogOut, Menu, Shield, Target, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { api, ApiError } from "@/lib/api";
import { Brand } from "./brand";
import { Spinner } from "./status";

export interface SessionUser { id: string; email: string; username: string; fullName: string; stratum: number; role: string; status: string }
const UserContext = createContext<SessionUser | null>(null);
export const useSessionUser = () => useContext(UserContext);

const nav = [
  { href: "/app", label: "Inicio", icon: LayoutDashboard },
  { href: "/app/diagnostico", label: "Mi diagnóstico", icon: Gauge },
  { href: "/app/aprender", label: "Aprender", icon: BookOpen },
  { href: "/app/credito", label: "Mi crédito", icon: CreditCard },
  { href: "/app/pqr", label: "Ayuda y PQR", icon: CircleHelp },
];
const staffRoles = ["COMMERCIAL", "LEGAL", "SUPPORT", "COLLECTIONS", "RISK", "FINANCE", "SUPERADMIN"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const [user, setUser] = useState<SessionUser | null>(null); const [menu, setMenu] = useState(false); const [event, setEvent] = useState("");
  useEffect(() => { api<{ user: SessionUser }>("/auth/me").then((result) => setUser(result.user)).catch((error) => { if (error instanceof ApiError && error.status === 401) router.replace("/login"); }); }, [router]);
  useEffect(() => { if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js"); }, []);
  useEffect(() => { if (!user) return; const socket: Socket = io({ path: "/socket.io", transports: ["websocket"], withCredentials: true }); const show = (payload: { status?: string }) => { setEvent(payload.status ? `Actualización: ${payload.status.replaceAll("_", " ").toLowerCase()}` : "Tu información se actualizó."); window.setTimeout(() => setEvent(""), 4500); }; socket.on("score:status", show); socket.on("profile:updated", show); socket.on("credit:decision", show); socket.on("payment:status", show); socket.on("pqr:status", show); return () => { socket.disconnect(); }; }, [user]);
  async function logout() { await api("/auth/logout", { method: "POST" }); router.push("/login"); }
  if (!user) return <div className="app-loading"><Brand /><Spinner label="Abriendo tu ruta…" /></div>;
  return <UserContext.Provider value={user}><div className="app-shell">
    <aside className={`app-sidebar ${menu ? "open" : ""}`}><div className="sidebar-head"><Brand /><button className="mobile-close" onClick={() => setMenu(false)} aria-label="Cerrar menú"><X /></button></div><nav>{nav.map((item) => { const Icon = item.icon; const active = item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setMenu(false)}><Icon size={20} /><span>{item.label}</span></Link>; })}{staffRoles.includes(user.role) && <Link href="/admin" className={pathname.startsWith("/admin") ? "active" : ""}><Shield size={20} /><span>Operación</span></Link>}</nav><div className="sidebar-goal"><Target size={20} /><div><span>Tu ruta LUFT</span><strong>Un paso cada día</strong></div></div><button className="logout-button" onClick={logout}><LogOut size={19} /> Cerrar sesión</button></aside>
    {menu && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMenu(false)} />}
    <div className="app-main"><header className="app-header"><button className="menu-button" onClick={() => setMenu(true)} aria-label="Abrir menú"><Menu /></button><div className="mobile-brand"><Brand /></div><div className="app-header-actions"><button className="icon-button" aria-label="Notificaciones"><Bell size={20} /><i /></button><Link href="/app/perfil" className="profile-chip"><span>{user.fullName.split(" ").map((word) => word[0]).slice(0,2).join("")}</span><div><strong>{user.fullName.split(" ")[0]}</strong><small>Estrato {user.stratum}</small></div><UserRound size={16} /></Link></div></header><main className="app-content">{event && <div className="realtime-toast">{event}</div>}{children}</main></div>
    <nav className="bottom-nav">{nav.slice(0,4).map((item) => { const Icon = item.icon; const active = item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={active ? "active" : ""}><Icon /><span>{item.label.replace("Mi ", "")}</span></Link>; })}</nav>
  </div></UserContext.Provider>;
}
