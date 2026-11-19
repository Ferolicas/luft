"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, Lufty, type IconName } from "./ui";

/*
 * Piezas que solo existen en la variante de escritorio (≥1024px).
 * En móvil permanecen ocultas por CSS (ver luft-desktop.css) y no alteran el diseño.
 */

type NavItem = { href: string; label: string; icon: IconName; exact?: boolean };

const MAIN: NavItem[] = [
  { href: "/app", label: "Inicio", icon: "home", exact: true },
  { href: "/app/progreso", label: "Progreso", icon: "speed" },
  { href: "/app/aprender", label: "Aprender", icon: "school" },
  { href: "/app/perfil", label: "Perfil", icon: "person" },
];
const SHORTCUTS: NavItem[] = [
  { href: "/app/credito", label: "Mi crédito", icon: "account_balance_wallet" },
  { href: "/app/historial", label: "Historial de pagos", icon: "task" },
  { href: "/app/puntaje", label: "Mi puntaje", icon: "trending_up" },
  { href: "/app/renta", label: "Declaración de renta", icon: "receipt_long" },
  { href: "/app/pqr", label: "Ayuda y PQR", icon: "help" },
];

function Wordmark({ href }: { href: string }) {
  return <Link href={href} className="l-d-brand" aria-label="LUFT, ir al inicio"><Lufty mood="happy" tone="white" width={56} /><span>LUFT</span></Link>;
}

/** Barra lateral de la app autenticada: reemplaza a la barra inferior en escritorio. */
export function DesktopNav({ name, initials, username, openPqr, onLogout }: { name: string; initials: string; username: string; openPqr: number; onLogout: () => void }) {
  const pathname = usePathname();
  const item = (entry: NavItem) => {
    const active = entry.exact ? pathname === entry.href : pathname === entry.href || pathname.startsWith(`${entry.href}/`);
    return (
      <Link key={entry.href} href={entry.href} aria-current={active ? "page" : undefined}>
        <Icon name={entry.icon} size={22} /><span>{entry.label}</span>
        {entry.href === "/app/pqr" && openPqr > 0 && <i aria-label={`${openPqr} en curso`}>{openPqr}</i>}
      </Link>
    );
  };
  return (
    <aside className="l-sidenav" aria-label="Navegación de escritorio">
      <Wordmark href="/app" />
      <nav aria-label="Navegación principal">{MAIN.map(item)}</nav>
      <nav aria-label="Accesos rápidos"><span className="l-d-label">Accesos</span>{SHORTCUTS.map(item)}</nav>
      <div className="l-d-user">
        <Link href="/app/perfil" className="l-d-me"><span className="l-avatar">{initials}</span><span><strong>{name}</strong><small>@{username}</small></span></Link>
        <button type="button" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión"><Icon name="logout" size={20} /></button>
      </div>
    </aside>
  );
}

const PROMISES: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: "speed", title: "Conoce tu punto de partida", text: "Tu puntaje y tu perfil, explicados sin enredos." },
  { icon: "school", title: "Aprende a tu ritmo", text: "Lecciones cortas que suman a tu progreso." },
  { icon: "trending_up", title: "Construye tu historial", text: "Un primer crédito pensado para empezar bien." },
];

/** Marco de las pantallas públicas (entrar, registro, recuperar…): panel de marca + pantalla. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="l-auth">
      <aside className="l-auth-aside">
        <Wordmark href="/" />
        <div className="l-auth-hero">
          <div className="l-halo on-blue"><Lufty mood="happy" tone="white" width={200} /></div>
          <h2>Construye tu futuro financiero</h2>
          <p>Diagnóstico, educación y una ruta clara para construir tu historial en Colombia.</p>
        </div>
        <ul>
          {PROMISES.map((promise) => <li key={promise.title}><span><Icon name={promise.icon} size={22} /></span><div><strong>{promise.title}</strong>{promise.text}</div></li>)}
        </ul>
      </aside>
      <div className="l-auth-main">{children}</div>
    </div>
  );
}
