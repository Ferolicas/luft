import { FileClock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Brand } from "./brand";

export function LegalPending({ title }: { title: string }) {
  return (
    <main className="legal-pending">
      <header>
        <Brand />
      </header>
      <section>
        <span className="legal-icon">
          <FileClock />
        </span>
        <span className="eyebrow">
          <ShieldCheck size={14} /> Documento controlado
        </span>
        <h1>{title}</h1>
        <p>
          LUFT pertenece a RESTAURAR, operada por Tureporte S.A.S. La política
          vigente de privacidad y tratamiento de datos se encuentra publicada en
          RESTAURAR.
        </p>
        <p>
          El equipo jurídico está consolidando aquí las condiciones específicas
          de LUFT y StartIF. El acceso piloto permanece habilitado y cualquier
          autorización para consultar centrales o solicitar crédito se pide de
          forma separada.
        </p>
        <Link className="button" href="https://restaurar.co/privacy">
          Ver política de RESTAURAR
        </Link>
      </section>
    </main>
  );
}
