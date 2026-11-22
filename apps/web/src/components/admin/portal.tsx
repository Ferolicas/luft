"use client";

import { Link2Off } from "lucide-react";
import type { ReactNode } from "react";
import { useConsole } from "@/components/app-shell";
import { ErrorBox, Loading, type Loader } from "@/components/admin/ui";

/** Estado de un portal cuya cuenta tiene el rol pero aún no está vinculada a una entidad o a un aliado. */
export function LinkRequired({ partner }: { partner: "entidad financiera" | "aliado" }) {
  const { user } = useConsole();
  return (
    <div className="cs-denied" role="status">
      <Link2Off aria-hidden="true" />
      <h1>Tu cuenta aún no está vinculada a {partner === "aliado" ? "un aliado" : "una entidad financiera"}</h1>
      <p>Iniciaste sesión como <strong>{user.email}</strong>, pero el equipo de LUFT todavía no ha asociado esta cuenta a tu {partner}. Escríbele a tu contacto en LUFT para que active el acceso; no necesitas crear otra cuenta.</p>
    </div>
  );
}

/** Envoltura de carga de un portal: distingue «cuenta sin vincular» de los demás errores. */
export function PortalLoaded<T>({ loader, linkCode, partner, children }: { loader: Loader<T>; linkCode: string; partner: "entidad financiera" | "aliado"; children: (data: T) => ReactNode }) {
  if (loader.problem?.code === linkCode) return <LinkRequired partner={partner} />;
  if (loader.data === null) return loader.problem ? <ErrorBox problem={loader.problem} onRetry={() => void loader.reload()} /> : <Loading />;
  return <>{loader.problem && <ErrorBox problem={loader.problem} onRetry={() => void loader.reload()} />}{children(loader.data)}</>;
}
