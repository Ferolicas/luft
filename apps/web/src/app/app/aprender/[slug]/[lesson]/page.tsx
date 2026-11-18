"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { firstName, useLuft } from "@/components/luft/shell";
import { Alert, BackButton, Button, Card, Celebration, Chip, Header, Icon, Lufty, OptionCard, Screen, Segments, Tip } from "@/components/luft/ui";
import { api, errorMessage } from "@/lib/api";
import { LESSON_XP, lessonContent } from "@/lib/lessons";

type Phase = "story" | "ready" | "quiz" | "done";

export default function LessonPage() {
  const { lesson } = useParams<{ lesson: string }>();
  return <LessonFlow key={lesson} />;
}

function LessonFlow() {
  const { slug, lesson: lessonKey } = useParams<{ slug: string; lesson: string }>();
  const router = useRouter();
  const { user, data, reload } = useLuft();
  const learningModule = data.learning.find((item) => item.slug === slug);
  const lessonIndex = learningModule?.lessons.findIndex((item) => item.key === lessonKey) ?? -1;
  const lesson = learningModule?.lessons[lessonIndex];
  const content = lessonContent(lessonKey);
  const [phase, setPhase] = useState<Phase>("story");
  const [slide, setSlide] = useState(0);
  const [question, setQuestion] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [hearts, setHearts] = useState(3);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [streak, setStreak] = useState<number | null>(null);
  const back = `/app/aprender/${slug}`;

  if (!learningModule || !lesson) return <Screen><Header back="/app/aprender" title="Lección no encontrada" /><div className="l-body"><Tip lufty>No encontramos esta lección.</Tip></div></Screen>;
  const quiz = content?.quiz ?? [];

  async function finish(hits: number) {
    setBusy(true); setFailure("");
    try {
      const result = await api<{ streak: { currentDays: number } }>("/luft/learning/complete", { method: "POST", body: JSON.stringify({ moduleId: learningModule!.id, lessonKey, score: quiz.length ? Math.round((hits / quiz.length) * 100) : 100 }) });
      setStreak(result.streak.currentDays); await reload(); setPhase("done");
    } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); }
  }

  if (phase === "story") {
    const slides = content?.slides ?? [{ title: lesson.title, text: learningModule.description }];
    const current = slides[slide]; const last = slide === slides.length - 1;
    return (
      <Screen blue>
        <div className="l-story">
          <div className="l-row"><BackButton href={back} icon="close" label="Cerrar lección" /><div className="l-grow"><Segments total={slides.length} done={slide + 1} /></div></div>
          <div className="stage" key={slide}><Lufty mood={slide % 2 ? "wink" : "happy"} tone="white" width={150} /><h2>{current.title}</h2><p>{current.text}</p></div>
          <div className="meta"><span className="l-avatar" style={{ background: "#fff" }}><Lufty mood="neutral" width={30} /></span><span><strong>LUFT</strong>Lección {lessonIndex + 1} de {learningModule.lessons.length} · {lesson.title}</span></div>
          <div className="controls">{slide > 0 && <Button variant="secondary" onClick={() => setSlide(slide - 1)}>Atrás</Button>}<Button variant="white" arrow onClick={() => (last ? setPhase(quiz.length ? "ready" : "quiz") : setSlide(slide + 1))}>{last ? "Terminar" : "Siguiente"}</Button></div>
        </div>
      </Screen>
    );
  }

  if (phase === "ready") return (
    <Screen>
      <div className="l-body" style={{ paddingTop: 56 }}>
        <div className="l-row"><span className="l-icon-box green" style={{ width: 56, height: 56, borderRadius: 999 }}><Icon name="check_circle" size={28} /></span><div><h1 style={{ fontSize: 24, fontWeight: 700 }}>¡Lección vista!</h1><span className="l-muted">Ahora demuestra lo que aprendiste.</span></div></div>
        <Card className="tight" as="div"><span className="l-overline" style={{ color: "var(--l-n-600)" }}>Lo que aprendiste</span><ul className="l-checks">{content!.learned.map((item) => <li key={item}><Icon name="check_circle" />{item}</li>)}</ul></Card>
        <div className="l-row between"><span className="l-muted">{quiz.length} pregunta{quiz.length === 1 ? "" : "s"} para ganar</span><span className="l-row" style={{ gap: 8 }}><Chip tone="violet" large icon="diamond_fill">+{LESSON_XP}</Chip><Chip tone="amber" large icon="local_fire_department_fill">+1</Chip></span></div>
      </div>
      <div className="l-footer"><Button arrow onClick={() => setPhase("quiz")}>Empezar quiz</Button><button className="l-link-button" onClick={() => { setSlide(0); setPhase("story"); }}>Ver la lección de nuevo</button></div>
    </Screen>
  );

  if (phase === "quiz") {
    if (!quiz.length) return (
      <Screen><Header back={back} title={lesson.title} subtitle="Marca la lección como completada para sumar a tu racha." /><div className="l-body">{failure && <Alert>{failure}</Alert>}</div><div className="l-footer"><Button onClick={() => finish(0)} disabled={busy}>{busy ? "Guardando…" : "Completar lección"}</Button></div></Screen>
    );
    const item = quiz[question]; const right = selected === item.correct; const lastQuestion = question === quiz.length - 1;
    const advance = () => { if (lastQuestion) return void finish(correct); setQuestion(question + 1); setSelected(null); setChecked(false); };
    const check = () => { setChecked(true); if (right) setCorrect(correct + 1); else setHearts(Math.max(0, hearts - 1)); };
    return (
      <Screen>
        <div className="l-quiz-top"><BackButton href={back} light icon="close" label="Salir del quiz" /><Segments total={quiz.length} done={question + (checked ? 1 : 0)} /><span className="l-hearts"><Icon name="favorite_fill" />{hearts}</span></div>
        <div className="l-body l-quiz" style={{ paddingTop: 24 }}>
          <span className="l-overline">Pregunta {question + 1} de {quiz.length}</span>
          <h1>{item.prompt}</h1>
          <div className="l-stack" role="radiogroup" aria-label="Respuestas">{item.options.map((option, index) => (
            <OptionCard key={option.title} icon={option.icon} title={option.title} description={option.text} selected={selected === index} disabled={checked} onSelect={() => setSelected(index)}
              state={!checked ? undefined : index === item.correct ? "correct" : index === selected ? "wrong" : "dim"} />
          ))}</div>
          {!checked && <Tip lufty title="Pista de Lufty">{item.hint}</Tip>}
          {failure && <Alert>{failure}</Alert>}
          {checked && <div className={`l-feedback ${right ? "" : "bad"}`} role="status">
            <div className="l-row"><span className="mark"><Icon name={right ? "check" : "close"} size={24} /></span><div className="l-grow"><h2>{right ? "¡Correcto!" : "Casi…"}</h2><span className="l-small">{right ? `Así se hace, ${firstName(user.fullName)}` : `La respuesta correcta es la ${"ABC"[item.correct]}`}</span></div></div>
            <p style={{ fontSize: 14, lineHeight: "18px" }}>{item.explain}</p>
            <Button arrow={right} onClick={advance} disabled={busy}>{busy ? "Guardando…" : right ? "Continuar" : "Entendido"}</Button>
          </div>}
        </div>
        {!checked && <div className="l-footer"><Button onClick={check} disabled={selected == null}>Comprobar</Button></div>}
      </Screen>
    );
  }

  const fresh = data.learning.find((item) => item.slug === slug) ?? learningModule;
  const nextLesson = fresh.lessons[lessonIndex + 1];
  return (
    <Celebration badge={fresh.completedLessons >= fresh.lessons.length ? "Módulo completado" : "Lección completada"} title="¡Lección completada!" text={quiz.length ? `Respondiste ${correct} de ${quiz.length} bien${streak ? ` y tu racha va en ${streak} día${streak === 1 ? "" : "s"}` : ""}. ¡Vas con toda!` : "Sumaste un paso más a tu racha."}
      stats={[{ label: "Total XP", value: `+${LESSON_XP}`, icon: "diamond_fill" }, { label: "Nivel", value: data.progress.level, icon: "verified_user_fill" }, { label: "Aciertos", value: quiz.length ? `${correct}/${quiz.length}` : "—", icon: "check_circle" }]}
      barLabel={fresh.title} barText={`${fresh.completedLessons} / ${fresh.lessons.length} lecciones`} barValue={(fresh.completedLessons / fresh.lessons.length) * 100}
      mission={nextLesson ? { label: "Siguiente lección", text: nextLesson.title, icon: "trending_up" } : undefined}>
      {nextLesson ? <Button variant="white" arrow onClick={() => { router.push(`/app/aprender/${slug}/${nextLesson.key}`); }}>Siguiente lección</Button> : <Button variant="white" arrow href="/app/aprender">Volver a Aprender</Button>}
      <Button variant="secondary" href={back}>Volver al módulo</Button>
    </Celebration>
  );
}
