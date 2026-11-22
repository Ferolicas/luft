"use client";

import Link from "next/link";
import { firstName, useLuft } from "@/components/luft/shell";
import { Button, Card, Celebration, Chip, Header, Icon, Screen, Segments } from "@/components/luft/ui";
import { BLOCKS } from "@/lib/profile";
import { useEffect, useState } from "react";

const DONE_KEY = "luft_profile_complete_seen";
const NEXT_LABEL: Record<string, string> = { work: "Iniciar", wealth: "Continuar con Patrimonio", habits: "Continuar con hábitos de pago", documents: "Continuar con documentos" };

export default function FinancialProfilePage() {
  const { user, data } = useLuft();
  const { blocks, completed, percent, documents } = data.journey;
  const next = BLOCKS.find((block) => !blocks[block.key]);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => { try { if (percent === 100 && !localStorage.getItem(DONE_KEY)) setCelebrate(true); } catch { /* sin almacenamiento */ } }, [percent]);
  const dismiss = () => { try { localStorage.setItem(DONE_KEY, "1"); } catch { /* sin almacenamiento */ } setCelebrate(false); };
  if (celebrate) return (
    <Celebration mood="wink" badge="Insignia desbloqueada: Perfil completo" title={`¡Perfil listo, ${firstName(user.fullName)}!`} text="Ya conocemos mejor tu realidad financiera. Mantén tus datos al día para que sigan hablando bien de ti."
      stats={[{ label: "Perfil", value: `${completed}/4`, icon: "task" }, { label: "Documentos", value: `${new Set(documents.map((item) => item.kind)).size}/4`, icon: "description" }, { label: "Insignias", value: data.progress.badgesEarned, icon: "workspace_premium_fill" }]}
      barLabel="Tu perfil financiero" barText={`${percent}% completo`} barValue={percent}>
      <Button variant="white" arrow href="/app/perfil" onClick={dismiss}>Volver a mi perfil</Button>
    </Celebration>
  );
  const kinds = new Set(documents.map((item) => item.kind)).size;
  return (
    <Screen>
      <Header back="/app/perfil" title="Mi perfil financiero" subtitle="Suma contexto a tu historial, a tu ritmo." />
      <div className="l-body">
        <Card className="tight">
          <div className="l-row between"><span className="l-muted" style={{ fontWeight: 500 }}>Tu avance</span><strong style={{ fontSize: 20, fontWeight: 500 }}>{percent}%</strong></div>
          <Segments total={4} done={completed} />
          <span className="l-small">{percent === 100 ? "100% completo" : `${completed} de 4 secciones completas`}</span>
        </Card>
        <Card className="flush"><div className="l-list">{BLOCKS.map((block) => (
          <Link key={block.key} href={block.href}>
            <span className="l-icon-box"><Icon name={block.icon} /></span>
            <span className="l-grow"><strong>{block.title}</strong>{block.key === "documents" && <small>{kinds} de 4 documentos</small>}</span>
            <Chip tone={blocks[block.key] ? "green" : ""} dot>{blocks[block.key] ? "Completo" : "Pendiente"}</Chip>
          </Link>
        ))}</div></Card>
      </div>
      <div className="l-footer">{next ? <Button href={next.href} arrow>{NEXT_LABEL[next.key]}</Button> : <Button variant="secondary" href="/app/perfil">Volver a mi perfil</Button>}</div>
    </Screen>
  );
}
