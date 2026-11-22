"use client";

import {
  Activity, BadgePercent, Banknote, BarChart3, Building2, ClipboardList, FileClock, FileSearch, FlaskConical, GitBranch, Handshake, Landmark, Layers, LineChart,
  LogOut, Menu, Package, Scale, Send, Shield, ShieldAlert, Shapes, Smartphone, Tags, UsersRound, WalletCards, X, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ApiError, api, problemOf, type Problem } from "@/lib/admin/http";
import { canOpen, homeFor, isStaff, navFor, navItemFor, ROLE_LABEL, type NavIcon } from "@/lib/admin/nav";
import { Brand } from "./brand";
import { Spinner } from "./status";

export interface SessionUser { id: string; email: string; username: string; fullName: string; stratum: number; role: string; status: string }

interface ConsoleValue { user: SessionUser; notify: (message: string) => void }
const ConsoleContext = createContext<ConsoleValue | null>(null);

/** Sesión de la consola actual, o `null` fuera de una consola. */
export const useSessionUser = () => useContext(ConsoleContext)?.user ?? null;

/** Sesión y avisos de la consola. Solo dentro de `ConsoleShell`. */
export function useConsole() {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error("useConsole debe usarse dentro de una consola");
  return value;
}

export type ConsoleArea = "admin" | "entidad" | "aliado";

const AREA_ROLE: Record<Exclude<ConsoleArea, "admin">, string> = { entidad: "INSTITUTION", aliado: "ALLY" };
const AREA_TITLE: Record<ConsoleArea, string> = { admin: "Operación", entidad: "Portal de entidad financiera", aliado: "Portal de aliado" };

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: Activity, people: UsersRound, pqr: FileClock, audit: Shield, applications: ClipboardList, products: Package, disbursements: Banknote,
  portfolio: WalletCards, legalRate: Scale, categories: Tags, archetypes: Shapes, plans: BadgePercent, cases: FileSearch, taxRules: Landmark,
  institutions: Building2, policies: GitBranch, presentations: Send, runs: Layers, allies: Handshake, cohorts: BarChart3, effectiveness: LineChart, backtests: FlaskConical,
};

/** Avisos en vivo que le interesan a cada consola (el servidor decide a quién le llegan). */
const EVENT_TEXT: Record<ConsoleArea, Record<string, string>> = {
  admin: {
    "formalization:new": "Llegó un caso tributario a revisión.",
    "disbursement:pending": "Hay un desembolso pendiente de registrar.",
    "matching:presentation": "Hay novedades en una presentación a entidad.",
  },
  entidad: { "institution:presentation": "Tienes una presentación nueva o actualizada." },
  aliado: {},
};

const initials = (name: string) => name.split(" ").filter(Boolean).map((word) => word[0]).slice(0, 2).join("").toUpperCase();

function allowed(area: ConsoleArea, role: string) {
  return area === "admin" ? isStaff(role) : role === AREA_ROLE[area];
}

/**
 * Marco común del panel de operación y de los portales de entidad y aliado.
 * Resuelve la sesión con `GET /api/auth/me` y no pinta contenido hasta saber
 * que el rol corresponde a la consola: si no, redirige a donde pertenece.
 */
export function ConsoleShell({ area, children }: { area: ConsoleArea; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");

  const loadSession = useCallback(() => {
    setProblem(null);
    api<{ user: SessionUser }>("/auth/me")
      .then((result) => {
        if (allowed(area, result.user.role)) setUser(result.user);
        else router.replace(homeFor(result.user.role));
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
        else setProblem(problemOf(cause));
      });
  }, [area, router]);
  useEffect(() => { loadSession(); }, [loadSession]);
  useEffect(() => { setMenu(false); }, [pathname]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? "" : current)), 5000);
  }, []);

  useEffect(() => {
    if (!user) return;
    const events = EVENT_TEXT[area];
    if (Object.keys(events).length === 0) return;
    const socket: Socket = io({ path: "/socket.io", transports: ["websocket"], withCredentials: true, reconnectionAttempts: 5 });
    for (const [event, text] of Object.entries(events)) socket.on(event, () => notify(text));
    return () => { socket.disconnect(); };
  }, [user, area, notify]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }, [router]);

  const value = useMemo(() => (user ? { user, notify } : null), [user, notify]);

  if (!user || !value)
    return (
      <div className="cs-boot">
        <Brand />
        {problem ? (
          <div className="cs-boot-error" role="alert">
            <strong>No pudimos abrir tu sesión</strong>
            <p>{problem.message}</p>
            <button type="button" className="cs-btn cs-btn-primary" onClick={loadSession}>Reintentar</button>
          </div>
        ) : <Spinner label="Verificando tu sesión…" />}
      </div>
    );

  const identity = (
    <div className="cs-identity">
      <span className="cs-avatar" aria-hidden="true">{initials(user.fullName)}</span>
      <div>
        <strong>{user.fullName}</strong>
        <small>{user.email}</small>
      </div>
      <span className="cs-role" title={`Rol ${user.role}`}><Shield size={13} /> {ROLE_LABEL[user.role] ?? user.role}</span>
      <button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" onClick={logout}><LogOut size={15} /> Cerrar sesión</button>
    </div>
  );

  if (area !== "admin")
    return (
      <ConsoleContext.Provider value={value}>
        <div className="cs-shell cs-portal">
          <header className="cs-topbar">
            <div className="cs-topbar-brand"><Brand /><span>{AREA_TITLE[area]}</span></div>
            {identity}
          </header>
          <main className="cs-content cs-content-portal">{children}</main>
          {toast && <div className="cs-toast" role="status">{toast}</div>}
        </div>
      </ConsoleContext.Provider>
    );

  const current = navItemFor(pathname);
  const permitted = canOpen(pathname, user.role);
  return (
    <ConsoleContext.Provider value={value}>
      <div className="cs-shell cs-admin">
        <aside className={`cs-sidebar ${menu ? "open" : ""}`}>
          <div className="cs-sidebar-head">
            <Brand />
            <span>Operación</span>
            <button type="button" className="cs-icon-btn cs-sidebar-close" onClick={() => setMenu(false)} aria-label="Cerrar menú"><X size={18} /></button>
          </div>
          <nav aria-label="Áreas del panel">
            {navFor(user.role).map((group) => (
              <div key={group.key} className="cs-nav-group">
                <span>{group.label}</span>
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = current?.href === item.href;
                  return <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={17} /> {item.label}</Link>;
                })}
              </div>
            ))}
          </nav>
          <Link href="/app" className="cs-sidebar-foot"><Smartphone size={16} /> Ver la app de usuario</Link>
        </aside>
        {menu && <button type="button" className="cs-backdrop" aria-label="Cerrar menú" onClick={() => setMenu(false)} />}
        <div className="cs-main">
          <header className="cs-topbar">
            <div className="cs-topbar-brand">
              <button type="button" className="cs-icon-btn cs-menu-button" onClick={() => setMenu(true)} aria-label="Abrir menú"><Menu size={20} /></button>
              <span className="cs-crumb">{current ? <><em>{current.area}</em> / {current.label}</> : "Panel de operación"}</span>
            </div>
            {identity}
          </header>
          <main className="cs-content">
            {permitted ? children : (
              <div className="cs-denied" role="alert">
                <ShieldAlert aria-hidden="true" />
                <h1>Esta sección no está disponible para tu rol</h1>
                <p>Tu rol actual es <strong>{ROLE_LABEL[user.role] ?? user.role}</strong>. Si necesitas este acceso, pídelo a la superadministración.</p>
                <Link href="/admin" className="cs-btn cs-btn-primary">Volver al resumen</Link>
              </div>
            )}
          </main>
        </div>
        {toast && <div className="cs-toast" role="status">{toast}</div>}
      </div>
    </ConsoleContext.Provider>
  );
}

/** Panel de operación (nombre histórico del componente). */
export function AppShell({ children }: { children: React.ReactNode }) {
  return <ConsoleShell area="admin">{children}</ConsoleShell>;
}
