"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLuft } from "@/components/luft/shell";
import { Button, Card, Chip, Header, Icon, Screen, Segments, Tip } from "@/components/luft/ui";
import { LESSON_XP, lessonContent } from "@/lib/lessons";

export default function ModulePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data } = useLuft();
  const index = data.learning.findIndex((item) => item.slug === slug);
  const learningModule = data.learning[index];
  if (!learningModule) return <Screen><Header back="/app/aprender" title="Módulo no encontrado" /><div className="l-body"><Tip lufty>No encontramos este módulo.</Tip></div></Screen>;
  const locked = index > 0 && data.learning[index - 1].completedLessons < data.learning[index - 1].lessons.length;
  const total = learningModule.lessons.length; const done = learningModule.completedLessons;
  const next = learningModule.lessons[Math.min(done, total - 1)];
  return (
    <Screen>
      <Header back="/app/aprender" title={learningModule.title}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/luft/modulo-score.svg" alt="" style={{ width: 208, margin: "-20px auto 10px", display: "block" }} />
        <span className="l-chip" style={{ background: "var(--l-n-900)", color: "#fff", marginBottom: 12 }}>MÓDULO {index + 1}</span>
      </Header>
      <div className="l-body">
        <Card>
          <div className="l-row"><span className="l-avatar lg" style={{ background: "#fff", border: "4px solid var(--l-blue-50)" }}>{done}/{total}</span><div className="l-grow l-stack" style={{ gap: 6 }}><strong style={{ fontSize: 18, fontWeight: 500 }}>{done === 0 ? "Aún no empiezas" : done >= total ? "Módulo completado" : "Vas avanzando"}</strong><span className="l-small">{done} de {total} lecciones · {learningModule.durationMin} min en total</span><Segments total={total} done={done} /></div></div>
          <hr className="l-divider" />
          <div className="l-row"><span className="l-icon-box amber"><Icon name="workspace_premium" /></span><div className="l-grow"><span className="l-overline" style={{ color: "var(--l-amber-500)" }}>Recompensa</span><div style={{ fontWeight: 500 }}>Insignia Estudioso</div><span className="l-small">Al terminar las {total} lecciones</span></div><Chip tone="violet" large icon="diamond_fill">+{total * LESSON_XP + 30}</Chip></div>
        </Card>
        <section className="l-stack"><div className="l-section-title"><h2>Sobre este módulo</h2></div><p className="l-muted">{learningModule.description}</p></section>
        <Card className="flush"><div className="l-list">{learningModule.lessons.map((lesson, lessonIndex) => {
          const complete = lessonIndex < done; const open = !locked && lessonIndex <= done;
          const meta = `${lessonContent(lesson.key)?.quiz.length ?? 0} pregunta${lessonContent(lesson.key)?.quiz.length === 1 ? "" : "s"} · +${LESSON_XP} XP`;
          const inner = <><span className={`l-lesson-num ${complete ? "done" : ""}`}>{complete ? <Icon name="check" size={16} /> : lessonIndex + 1}</span><span className="l-grow"><strong>{lesson.title}</strong><small>{meta}</small></span><Icon name={open ? "chevron_right" : "lock"} /></>;
          return open ? <Link key={lesson.key} href={`/app/aprender/${learningModule.slug}/${lesson.key}`}>{inner}</Link> : <div key={lesson.key} style={{ opacity: .6 }}>{inner}</div>;
        })}</div></Card>
      </div>
      <div className="l-footer">{locked ? <Button variant="secondary" href="/app/aprender">Termina primero el módulo anterior</Button> : <Button arrow href={`/app/aprender/${learningModule.slug}/${next.key}`}>{done >= total ? "Repasar una lección" : done === 0 ? "Empezar lección 1" : `Continuar lección ${done + 1}`}</Button>}</div>
    </Screen>
  );
}
