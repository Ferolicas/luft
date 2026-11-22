"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackButton, Button, Header, Icon, Luft, Lufty, OptionCard, Screen, Tip } from "@/components/luft/ui";
import { EXPERIENCE, GOALS } from "@/lib/classification";
import { pendingClassification, rememberClassification, type CreditExperience, type Goal } from "@/lib/journey";

const SLIDES = [
  { art: "/luft/onboarding-1.svg", title: "Vamos a fortalecer tu puntaje crediticio", text: "Descubre tu situación actual y entiende qué significa para ti.", cta: "Siguiente" },
  { art: "/luft/onboarding-2.svg", title: "Construye un mejor historial", text: "Paga a tiempo y construye, mes a mes, un historial que hable bien de ti.", cta: "Siguiente" },
  { art: "/luft/onboarding-3.svg", title: "Abre nuevas oportunidades", text: "Conoce opciones de crédito de libre destino con entidades aliadas.", cta: "Empieza ya" },
];
const SWIPE_DISTANCE = 48;

type Step = "intro" | "goal" | "experience" | 0 | 1 | 2;

export function StartFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [back, setBack] = useState(false);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [experience, setExperience] = useState<CreditExperience | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { const saved = pendingClassification(); setGoal(saved.goal ?? null); setExperience(saved.creditExperience ?? null); }, []);
  const later = (next: Step) => window.setTimeout(() => setStep(next), 220);
  const slideIndex = typeof step === "number" ? step : null;

  /** Moves between the onboarding slides; it never leaves them (the buttons do that). */
  const move = useCallback((delta: 1 | -1) => {
    if (slideIndex == null) return;
    const next = slideIndex + delta;
    if (next < 0 || next >= SLIDES.length) return;
    setBack(delta < 0);
    setStep(next as Step);
  }, [slideIndex]);

  useEffect(() => {
    if (slideIndex == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight") move(1);
      else if (event.key === "ArrowLeft") move(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [slideIndex, move]);

  if (step === "intro") return (
    <Screen>
      <div className="l-splash" aria-hidden="true"><Lufty mood="neutral" tone="white" width={96} /></div>
      <div className="l-onboard" style={{ paddingTop: 56 }}>
        <div className="l-halo"><Lufty width={144} motion="hop" /></div>
        <span className="l-chip" style={{ marginTop: -44, background: "#fff", color: "var(--l-n-900)", fontSize: 14, padding: "10px 14px", boxShadow: "var(--l-shadow-soft)" }}>¡Hola! Soy Lufty. Te haré 2 preguntas.</span>
        <h1 style={{ fontSize: 28, lineHeight: "36px", textWrap: "wrap" }}>Cuéntanos qué te trae a <Luft /></h1>
        <p>Así adaptamos la app a lo que necesitas hoy. No es un formulario y no te pedimos datos personales aquí.</p>
        <div className="l-card soft" style={{ width: "100%", textAlign: "left", gap: 12 }}>
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
        <Header back onBack={() => setStep(first ? "intro" : "goal")} progress={first ? 50 : 100} step={`Pregunta ${first ? 1 : 2} de 2`} title={first ? <>¿Qué te gustaría lograr con <Luft />?</> : "¿Tienes o has tenido créditos a tu nombre?"} subtitle={first ? "Elige lo que más te urge hoy." : "Tarjetas, préstamos, compras a cuotas o planes de celular cuentan."} />
        <div className="l-body">
          <div className="l-stack" role="radiogroup" aria-label={first ? "Tu objetivo" : "Tu experiencia con créditos"}>
            {first
              ? GOALS.map((item) => <OptionCard key={item.value} icon={item.icon} title={item.title} description={item.text} selected={goal === item.value} onSelect={() => { setGoal(item.value); rememberClassification({ goal: item.value }); later("experience"); }} />)
              : EXPERIENCE.map((item) => <OptionCard key={item.value} icon={item.icon} title={item.title} description={item.text} selected={experience === item.value} onSelect={() => { setExperience(item.value); rememberClassification({ creditExperience: item.value }); setBack(false); later(0); }} />)}
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
        <BackButton light onClick={() => (step === 0 ? setStep("experience") : move(-1))} />
        <Link href="/registro" className="l-skip">Saltar</Link>
      </div>
      <section
        className="l-onboard" aria-roledescription="carrusel" aria-label="Así funciona LUFT"
        onPointerDown={(event) => { if (event.pointerType !== "mouse" || event.button === 0) drag.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={(event) => {
          const start = drag.current; drag.current = null;
          if (!start) return;
          const dx = event.clientX - start.x; const dy = event.clientY - start.y;
          if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <div className={`slide ${back ? "back" : ""}`} key={step}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="art"><img src={slide.art} alt="" draggable={false} /></div>
          <div className="l-dots" aria-hidden="true">{SLIDES.map((_, index) => <i key={index} className={index === step ? "on" : ""} />)}</div>
          <h1>{slide.title}</h1>
          <p>{slide.text}</p>
          {step === 0 && <span className="l-chip blue"><Icon name="verified_user" size={14} />Con datos de Datacrédito y TransUnion</span>}
        </div>
        <p className="l-sr" aria-live="polite">{`Lámina ${step + 1} de ${SLIDES.length}`}</p>
      </section>
      <div className="l-footer"><Button arrow onClick={() => (step === SLIDES.length - 1 ? router.push("/registro") : move(1))}>{slide.cta}</Button></div>
    </Screen>
  );
}
