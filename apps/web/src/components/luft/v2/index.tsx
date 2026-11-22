"use client";

import "@/app/luft-v2.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { pendingInvitation } from "@/lib/v2/api";
import type { DashboardRoute, StageKey } from "@/lib/v2/types";
import { Card, Icon, Tip, type IconName } from "../ui";
import { Ring, Steps } from "./kit";

/**
 * Accesos a las secciones V2. Sirven para el hub de Perfil, la barra lateral de
 * escritorio y cualquier menú: `href`, etiqueta, descripción corta e ícono del set existente.
 */
export const V2_LINKS: Array<{ href: string; label: string; text: string; icon: IconName }> = [
  { href: "/app/ruta", label: "Mi ruta", text: "Categoría, arquetipo y etapas", icon: "flag" },
  { href: "/app/formalizacion", label: "Formalización", text: "Diagnóstico y declaración asistida", icon: "calculate" },
  { href: "/app/finanzas", label: "Mis finanzas", text: "Tarjetas, créditos y conexiones", icon: "credit_card" },
  { href: "/app/familia", label: "LUFT Familia", text: "Hogar, metas y aportes", icon: "group" },
  { href: "/app/proyectos", label: "Mis proyectos", text: "Planes para tus metas de vida", icon: "bookmark" },
  { href: "/app/oportunidades", label: "Oportunidades", text: "Productos que encajan con tu perfil", icon: "account_balance" },
  { href: "/app/perfil/privacidad", label: "Privacidad", text: "Autorizaciones y habeas data", icon: "verified_user" },
];

export const STAGE_ORDER: Array<{ key: StageKey; label: string }> = [
  { key: "CONOCETE", label: "Conócete" },
  { key: "FORMALIZATE", label: "Formalízate" },
  { key: "PREPARATE", label: "Prepárate" },
  { key: "DEMUESTRA", label: "Demuestra" },
  { key: "AVANZA", label: "Avanza" },
];

/**
 * Resumen de la ruta para el inicio: categoría y arquetipo por separado, etapa, avance y
 * siguiente paso. Recibe `dashboard.route` tal cual lo entrega `GET /luft/dashboard`.
 */
export function RouteSummaryCard({ route }: { route: DashboardRoute | null | undefined }) {
  if (!route) return null;
  const position = STAGE_ORDER.findIndex((stage) => stage.key === route.visibleStage.key);
  const steps = STAGE_ORDER.map((stage, index) => ({ ...stage, status: index < position ? ("DONE" as const) : index === position ? ("CURRENT" as const) : ("PENDING" as const) }));
  const next = route.nextStep;
  return (
    <Card className="v2-route-card">
      <div className="l-row between">
        <span className="l-row" style={{ gap: 8, fontSize: 14, fontWeight: 500, color: "var(--l-n-600)" }}><span className="l-icon-box sm"><Icon name="flag" size={16} /></span>Mi ruta</span>
        <Link href="/app/ruta" className="l-link" style={{ fontSize: 14 }}>Ver ruta</Link>
      </div>
      <div className="top">
        <Ring value={route.progressPercent} label="Avance de tu ruta" />
        <div className="who">
          <div><span className="l-overline">Categoría</span><strong>{route.categoryBrand}</strong></div>
          <div><span className="l-overline" style={{ color: "var(--l-violet-600)" }}>Arquetipo</span><strong>{route.archetype?.name ?? "Por definir"}</strong></div>
        </div>
      </div>
      <span className="l-small" style={{ fontWeight: 500 }}>Etapa {route.visibleStage.title} · {route.progressPercent}% de tu ruta{route.archetype ? "" : " · responde dos preguntas para conocer tu arquetipo"}</span>
      <Steps items={steps} label="Etapas de tu ruta" />
      {next && (
        <Link href={next.href} className="next">
          <span className="l-grow"><small>Tu siguiente paso</small><strong>{next.title}</strong></span>
          <Icon name="arrow_forward" />
        </Link>
      )}
    </Card>
  );
}

/**
 * Aviso para retomar una invitación a un hogar que quedó pendiente antes de registrarse o entrar.
 * No muestra nada si no hay invitación guardada en este dispositivo.
 */
export function PendingInvitation() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { const stored = pendingInvitation(); if (stored) setToken(stored); }, []);
  if (!token) return null;
  return (
    <Tip icon="group" title="Tienes una invitación a un hogar LUFT">
      Quedó pendiente antes de entrar a tu cuenta. <Link className="l-link" href={`/invitacion/${encodeURIComponent(token)}`}>Revisarla ahora</Link>
    </Tip>
  );
}
