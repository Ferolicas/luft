"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { initials, useLuft } from "@/components/luft/shell";
import { Button, Card, Header, Icon, Screen, Segments, type IconName } from "@/components/luft/ui";
import { V2_LINKS } from "@/components/luft/v2";
import { api } from "@/lib/api";

const STAFF = ["COMMERCIAL", "LEGAL", "SUPPORT", "COLLECTIONS", "RISK", "FINANCE", "SUPERADMIN"];
function Row({ href, icon, title, text }: { href: string; icon: IconName; title: string; text: string }) {
  return <Link href={href}><span className="l-icon-box"><Icon name={icon} /></span><span className="l-grow"><strong>{title}</strong><small>{text}</small></span><Icon name="chevron_right" /></Link>;
}

export default function ProfilePage() {
  const { user, data } = useLuft();
  const router = useRouter();
  const { percent, completed } = data.journey;
  const since = (user as { createdAt?: string }).createdAt;
  async function logout() { await api("/auth/logout", { method: "POST" }).catch(() => undefined); router.push("/login"); }
  return (
    <Screen className="d-profile">
      <Header>
        <div className="l-greeting"><span className="l-avatar lg">{initials(user.fullName)}</span><span className="l-grow"><strong>{user.fullName}</strong><small>{since ? `Miembro desde ${new Date(since).toLocaleDateString("es-CO", { month: "long", year: "numeric" })}` : `@${user.username}`}</small></span></div>
      </Header>
      <div className="l-body tabbed">
        <Card>
          <div className="l-row between"><span className="l-muted" style={{ fontWeight: 500 }}>Tu perfil financiero</span><strong style={{ fontSize: 24, fontWeight: 700 }}>{percent}%</strong></div>
          <Segments total={4} done={completed} />
          <p className="l-muted">{percent === 100 ? "Tu perfil está completo. Actualízalo cuando cambie tu trabajo, tus ingresos o tus bienes." : "Suma información que hoy no aparece en tu historial: arriendo, seguridad social, ingresos y patrimonio."}</p>
          <Button href="/app/perfil/financiero" arrow>{percent === 0 ? "Completar mi perfil" : "Actualizar información"}</Button>
        </Card>
        <div className="l-section-title"><h2 style={{ fontSize: 16 }}>Trámites</h2></div>
        <Card className="flush"><div className="l-list">
          {V2_LINKS.map((link) => <Row key={link.href} href={link.href} icon={link.icon} title={link.label} text={link.text} />)}
          <Row href="/app/puntaje" icon="speed" title="Mi puntaje" text="Tu punto de partida y su evolución" />
          <Row href="/app/credito" icon="account_balance_wallet" title="Mi crédito" text="Solicitud, plan y estado" />
        </div></Card>
        <div className="l-section-title"><h2 style={{ fontSize: 16 }}>Mi cuenta</h2></div>
        <Card className="flush"><div className="l-list">
          <Row href="/app/perfil/cuenta" icon="person" title="Datos personales" text="Nombre, usuario y contacto" />
          <Row href="/app/perfil/cuenta#seguridad" icon="lock" title="Seguridad y acceso" text="Clave, biometría y avisos" />
          <Row href="/app/pqr" icon="help" title="Ayuda y PQR" text={data.openPqr ? `${data.openPqr} solicitud${data.openPqr === 1 ? "" : "es"} en curso` : "Peticiones, quejas y reclamos"} />
          {STAFF.includes(user.role) && <Row href="/admin" icon="bar_chart" title="Operación" text="Panel interno del equipo" />}
          <button onClick={logout}><span className="l-icon-box gray"><Icon name="logout" /></span><span className="l-grow"><strong>Cerrar sesión</strong></span></button>
        </div></Card>
      </div>
    </Screen>
  );
}
