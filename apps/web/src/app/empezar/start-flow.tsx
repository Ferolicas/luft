"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BackButton, Button, Header, Icon, Lufty, OptionCard, Screen, Tip } from "@/components/luft/ui";
import { EXPERIENCE, GOALS } from "@/lib/classification";
import { pendingClassification, rememberClassification, type CreditExperience, type Goal } from "@/lib/journey";

const SLIDES = [
  { art: "/luft/onboarding-1.svg", title: "Vamos a fortalecer tu puntaje crediticio", text: "Descubre tu situación actual y entiende qué significa para ti.", cta: "Siguiente" },
  { art: "/luft/onboarding-2.svg", title: "Construye un mejor historial", text: "Paga a tiempo y mira cómo sube tu puntaje mes a mes.", cta: "Siguiente" },
  { art: "/luft/onboarding-3.svg", title: "Abre nuevas oportunidades", text: "Conoce opciones de crédito de libre destino con entidades aliadas.", cta: "Empieza ya" },
];

type Step = "intro" | "goal" | "experience" | 0 | 1 | 2;

export function StartFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [goal, setGoal] = useState<Goal | null>(null);
  const [experience, setExperience] = useState<CreditExperience | null>(null);
  useEffect(() => { const saved = pendingClassification(); setGoal(saved.goal ?? null); setExperience(saved.creditExperience ?? null); }, []);
  const later = (next: Step) => window.setTimeout(() => setStep(next), 220);

  if (step === "intro") return (
    <Screen>
      <div className="l-splash" aria-hidden="true"><Lufty mood="neutral" tone="white" width={96} /></div>
      <div className="l-onboard" style={{ paddingTop: 56 }}>
        <div className="l-halo"><Lufty width={144} /></div>
        <span className="l-chip" style={{ marginTop: -44, background: "#fff", color: "var(--l-n-900)", fontSize: 14, padding: "10px 14px", boxShadow: "var(--l-shadow-soft)" }}>¡Hola! Soy Lufty. Te haré 2 preguntas.</span>
        <h1 style={{ fontSize: 28, lineHeight: "36px" }}>Cuéntanos qué te trae a LUFT</h1>
        <p>Así adaptamos la app a lo que necesitas hoy. No es un formulario y no te pedimos datos personales aquí.</p>
        <div className="l-card" style={{ width: "100%", textAlign: "left", gap: 12 }}>
          <ul className="l-checks">
            <li><Icon name="schedule" />Toma menos de 1 minuto</li>
            <li><Icon name="sync" />Puedes cambiar tu respuesta cuando quieras</li>
            <li><Icon name="verified_user" />Solo usamos tus respuestas para personalizar LUFT</li>
          </ul>
        </div>
      </div>
      <div className="l-footer">
        <Button arrow onClick={() => setStep("goal")}>Empecemos</Button>
        <small>¿Ya tienes cuenta? <Link className="l-link" href="/login">Inicia sesión</Link></small>
      </div>
    </Screen>
  );

  if (step === "goal" || step === "experience") {
    const first = step === "goal";
    return (
      <Screen>
        <Header back onBack={() => setStep(first ? "intro" : "goal")} progress={first ? 50 : 100} step={`Pregunta ${first ? 1 : 2} de 2`} title={first ? "¿Qué te gustaría lograr con LUFT?" : "¿Tienes o has tenido créditos a tu nombre?"} subtitle={first ? "Elige lo que más te urge hoy." : "Tarjetas, préstamos, compras a cuotas o planes de celular cuentan."} />
        <div className="l-body">
          <div className="l-stack" role="radiogroup" aria-label={first ? "Tu objetivo" : "Tu experiencia con créditos"}>
            {first
              ? GOALS.map((item) => <OptionCard key={item.value} icon={item.icon} title={item.title} description={item.text} selected={goal === item.value} onSelect={() => { setGoal(item.value); rememberClassification({ goal: item.value }); later("experience"); }} />)
              : EXPERIENCE.map((item) => <OptionCard key={item.value} icon={item.icon} title={item.title} description={item.text} selected={experience === item.value} onSelect={() => { setExperience(item.value); rememberClassification({ creditExperience: item.value }); later(0); }} />)}
          </div>
          {first
            ? <Tip title="¿Te identificas con varias?">Elige la que más te urge hoy. Podrás ajustar tu ruta con el tiempo.</Tip>
            : <Tip title="¿No estás seguro?">Elige la más cercana. Lo confirmamos al consultar tu historial, sin afectar tu puntaje.</Tip>}
        </div>
        <div className="l-footer"><small>Toca una opción para continuar</small></div>
      </Screen>
    );
  }

  const slide = SLIDES[step];
  return (
    <Screen>
      <div className="l-plain-top">
        <BackButton light onClick={() => setStep(step === 0 ? "experience" : ((step - 1) as Step))} />
        <Link href="/registro" className="l-skip">Saltar</Link>
      </div>
      <div className="l-onboard">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={slide.art} alt="" />
        <div className="l-dots" aria-hidden="true">{SLIDES.map((_, index) => <i key={index} className={index === step ? "on" : ""} />)}</div>
        <h1>{slide.title}</h1>
        <p>{slide.text}</p>
        {step === 0 && <span className="l-chip blue" style={{ padding: "8px 14px" }}><Icon name="verified_user" size={14} />Con datos de Datacrédito y TransUnion, solo si lo autorizas</span>}
      </div>
      <div className="l-footer"><Button arrow onClick={() => (step === 2 ? router.push("/registro") : setStep((step + 1) as Step))}>{slide.cta}</Button></div>
    </Screen>
  );
}
