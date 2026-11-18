"use client";

import Link from "next/link";
import { useLuft } from "@/components/luft/shell";
import { Button, Card, Chip, Header, Icon, Screen } from "@/components/luft/ui";
import { DOCUMENTS } from "@/lib/profile";

export default function DocumentsPage() {
  const { data } = useLuft();
  const count = (kind: string) => data.journey.documents.filter((item) => item.kind === kind).length;
  const next = DOCUMENTS.find((item) => count(item.kind) === 0);
  return (
    <Screen>
      <Header back="/app/perfil/financiero" title="Tus documentos" subtitle="Respaldan la información de tu perfil financiero." />
      <div className="l-body">
        <Card className="flush"><div className="l-list">{DOCUMENTS.map((item) => (
          <Link key={item.kind} href={`/app/perfil/financiero/documentos/${item.slug}`}>
            <span className="l-icon-box"><Icon name={item.icon} /></span>
            <span className="l-grow"><strong>{item.title}</strong><small>{item.note}</small></span>
            <Chip tone={count(item.kind) ? "green" : ""} dot>{count(item.kind) ? `Cargado${count(item.kind) > 1 ? ` (${count(item.kind)})` : ""}` : "Pendiente"}</Chip>
          </Link>
        ))}</div></Card>
      </div>
      <div className="l-footer">{next ? <Button arrow href={`/app/perfil/financiero/documentos/${next.slug}`}>Subir {next.title.toLowerCase()}</Button> : <Button href="/app/perfil/financiero">Volver a tu perfil financiero</Button>}</div>
    </Screen>
  );
}
