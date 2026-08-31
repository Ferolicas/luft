import { FileClock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Brand } from "./brand";

export function LegalPending({ title }: { title: string }) {
  return <main className="legal-pending"><header><Link href="/" aria-label="Volver a LUFT"><Brand /></Link></header><section><span className="legal-icon"><FileClock /></span><span className="eyebrow"><ShieldCheck size={14} /> Publicación controlada</span><h1>{title}</h1><p>Este documento aún no está publicado porque falta confirmar la identidad jurídica del responsable de LUFT y StartIF, su NIT, domicilio y canal oficial de protección de datos y PQR.</p><p>El registro público permanecerá cerrado hasta contar con esa información y aprobar el texto aplicable. No usaremos datos inventados ni una política genérica para solicitar autorizaciones sensibles.</p><Link className="button" href="/">Volver al inicio</Link></section></main>;
}
