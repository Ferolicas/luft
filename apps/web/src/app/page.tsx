import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ServiceWorker } from "@/components/service-worker";

export default function Home() {
  return (
    <div className="marketing-page">
      <ServiceWorker />
      <header className="public-header">
        <Brand />
        <nav aria-label="Navegación principal"><a href="#ruta">Cómo funciona</a><a href="#seguridad">Seguridad</a></nav>
        <div className="header-actions"><Link href="/login" className="text-link">Entrar</Link><Link href="/registro" className="button button-small">Comenzar</Link></div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><Sparkles size={15} /> Tu historia financiera empieza aquí</span>
            <h1>Tu futuro merece<br /><span>más posibilidades.</span></h1>
            <p>Conoce tu perfil, aprende a tu ritmo y construye un historial financiero que hable bien de ti.</p>
            <div className="hero-actions"><Link href="/registro" className="button button-large">Crear mi ruta <ArrowRight size={19} /></Link><Link href="/login" className="button button-ghost button-large">Ya tengo cuenta</Link></div>
            <div className="trust-line"><span><CheckCircle2 size={17} /> Sin costo para empezar</span><span><ShieldCheck size={17} /> Tus datos protegidos</span></div>
          </div>
          <div className="hero-visual">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <Image src="/images/luft-welcome.png" alt="Joven listo para construir su futuro financiero" width={1280} height={1280} priority sizes="(max-width: 760px) 100vw, 50vw" />
            <div className="floating-card score-float"><span>Puntaje en progreso</span><strong>+ hábitos que suman</strong></div>
            <div className="floating-card goal-float"><TrendingUp size={20} /><span>Una meta<br /><strong>a la vez</strong></span></div>
          </div>
        </section>
        <section id="ruta" className="path-section">
          <div className="section-heading"><span className="eyebrow">Una ruta hecha para ti</span><h2>Avanza con claridad, no con suposiciones.</h2><p>Cada paso tiene un propósito y puedes ver tu progreso en todo momento.</p></div>
          <div className="path-grid">
            {[['01','Conócete','Descubre tu punto de partida y tu arquetipo financiero.'],['02','Prepárate','Aprende lo que necesitas con experiencias cortas y prácticas.'],['03','Construye','Accede a una ruta StartIF y demuestra tus buenos hábitos.'],['04','Proyecta','Mide tu evolución y encuentra oportunidades acordes a ti.']].map(([number,title,text]) => <article className="path-card" key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>
        <section id="seguridad" className="security-band"><ShieldCheck size={38} /><div><h2>Tu información, bajo tu control.</h2><p>Autorizaciones separadas, datos sensibles cifrados, sesiones seguras y trazabilidad de cada acción importante.</p></div><Link href="/legal/privacidad" className="button button-light">Cómo cuidamos tus datos</Link></section>
      </main>
      <footer className="public-footer"><Brand inverse /><p>Educación y construcción de historial financiero para Colombia.</p><div><Link href="/legal/privacidad">Privacidad</Link><Link href="/legal/terminos">Términos</Link><Link href="/legal/habeas-data">Habeas data</Link></div><small>© 2026 LUFT · StartIF. Todos los derechos reservados.</small></footer>
    </div>
  );
}
