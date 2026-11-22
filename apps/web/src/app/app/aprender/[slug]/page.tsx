"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLuft } from "@/components/luft/shell";
import { Button, Card, Chip, Header, Icon, Screen, Segments, Tip } from "@/components/luft/ui";
import { MODULE_XP, lessonContent, lessonXp, moduleMeta } from "@/lib/lessons";

export default function ModulePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data } = useLuft();
  const index = data.learning.findIndex((item) => item.slug === slug);
  const learningModule = data.learning[index];
  if (!learningModule) return <Screen><Header back="/app/aprender" title="Módulo no encontrado" /><div className="l-body"><Tip lufty>No encontramos este módulo.</Tip></div></Screen>;
  const locked = index > 0 && data.learning[index - 1].completedLessons < data.learning[index - 1].lessons.length;
  const total = learningModule.lessons.length; const done = learningModule.completedLessons;
  const next = learningModule.lessons[Math.min(done, total - 1)];
  const meta = moduleMeta(learningModule.slug);
  const xp = lessonXp(data.progress);
  const minutes = Math.max(1, Math.round(learningModule.durationMin / Math.max(1, total)));
  const finished = done >= total;
  return (
    <Screen>
      <Header back="/app/aprender" title={learningModule.title} meta={(
        <div className="l-meta-row">
          <span><Icon name="play_arrow_fill" size={14} />{total} {total === 1 ? "lección" : "lecciones"}</span>
          <span><Icon name="schedule" size={14} />{learningModule.durationMin} min</span>
          {meta && <span><Icon name="eco" size={14} />{meta.level}</span>}
        </div>
      )}>
        <div className="l-module-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/luft/modulo-score.svg" alt="" width={218} height={124} />
          <span className="l-pill-dark">Módulo {index + 1}{meta ? ` · ${meta.topic}` : ""}</span>
        </div>
      </Header>
      <div className="l-body">
        <Card>
          <div className="l-row"><span className="l-ring">{done}/{total}</span><div className="l-grow l-stack" style={{ gap: 6 }}><strong style={{ fontSize: 18, fontWeight: 500 }}>{done === 0 ? "Aún no empiezas" : finished ? "Módulo completado" : "Vas avanzando"}</strong><span className="l-small">{done} de {total} lecciones · {learningModule.durationMin} min en total</span><Segments total={total} done={done} /></div></div>
          <hr className="l-divider" />
          <div className="l-reward">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/luft/medal-${finished ? "violet" : "locked"}.svg`} alt={finished ? "Insignia obtenida" : "Insignia por desbloquear"} width={52} height={42} />
            <div className="l-grow"><span className="l-overline" style={{ color: "var(--l-amber-500)" }}>Recompensa</span><div style={{ fontWeight: 500 }}>Insignia Estudioso</div><span className="l-small">Al terminar las {total} lecciones</span></div>
            <Chip tone="violet" large icon="diamond_fill">+{total * xp + MODULE_XP}</Chip>
          </div>
        </Card>
        <section className="l-stack">
          <div className="l-section-title"><h2>Sobre este módulo</h2></div>
          <p className="l-muted">{learningModule.description}</p>
          {locked ? <Button variant="secondary" href="/app/aprender">Termina primero el módulo anterior</Button> : <Button arrow href={`/app/aprender/${learningModule.slug}/${next.key}`}>{finished ? "Repasar una lección" : done === 0 ? "Empezar lección 1" : `Continuar lección ${done + 1}`}</Button>}
        </section>
        <Card className="flush"><div className="l-list">{learningModule.lessons.map((lesson, lessonIndex) => {
          const complete = lessonIndex < done; const open = !locked && lessonIndex <= done; const current = open && !complete;
          const questions = lessonContent(lesson.key)?.quiz.length ?? 0;
          const detail = current && questions ? `Quiz de ${questions} pregunta${questions === 1 ? "" : "s"}` : `+${xp} XP`;
          const inner = <>
            <span className={`l-lesson-num ${complete ? "done" : ""}`}>{complete ? <Icon name="check" size={16} /> : lessonIndex + 1}</span>
            <span className="l-grow"><strong>{lesson.title}</strong><small>Lectura de {minutes} min · {detail}</small></span>
            {current ? <span className="l-play"><Icon name="play_arrow_fill" size={22} /></span> : <Icon name={open ? "chevron_right" : "lock"} />}
          </>;
          return open ? <Link key={lesson.key} href={`/app/aprender/${learningModule.slug}/${lesson.key}`} className={current ? "now" : ""}>{inner}</Link> : <div key={lesson.key} className="locked">{inner}</div>;
        })}</div></Card>
      </div>
    </Screen>
  );
}
