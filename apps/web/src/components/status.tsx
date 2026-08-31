"use client";

export function Notice({ type = "info", children }: { type?: "info" | "success" | "warning" | "error"; children: React.ReactNode }) {
  return <div className={`notice notice-${type}`} role={type === "error" ? "alert" : "status"}>{children}</div>;
}

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return <div className="loading"><span className="spinner" aria-hidden="true" /><span>{label}</span></div>;
}
