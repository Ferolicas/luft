"use client";

import Link from "next/link";
import { firstName, useLuft } from "@/components/luft/shell";
import { Bar, Button, Card, Chip, Header, Icon, Lufty, Screen, type IconName } from "@/components/luft/ui";
import { LESSON_XP } from "@/lib/lessons";

const ICONS: IconName[] = ["trending_up", "verified_user", "paid", "balance", "calculate"];

export default function LearnPage() {
  const { user, data } = useLuft();
  const modules = data.learning;
  const done = (index: number) => modules[index].completedLessons >= modules[index].lessons.length;
  const unlocked = (index: number) => index === 0 || done(index - 1);
  const currentIndex = modules.findIndex((_, index) => !done(index));
  const current = currentIndex >= 0 ? modules[currentIndex] : null;
  const lesson = current?.lessons[current.completedLessons];
  const completed = modules.filter((_, index) => done(index)).length;
  return (
    <Screen className="d-learn">
      <Header title={<span style={{ fontSize: 24 }}>Aprender</span>} subtitle="Escuela LUFT · aprende a tu ritmo" />
      <div className="l-body tabbed">
        <Card className="tight"><div className="l-row"><span className="l-avatar lg"><Lufty mood="neutral" width={40} /></span><div className="l-grow l-stack" style={{ gap: 6 }}><strong style={{ fontWeight: 500 }}>{data.streak.currentDays > 0 ? `¡Vas muy bien, ${firstName(user.fullName)}!` : `Empecemos, ${firstName(user.fullName)}`}</strong><span className="l-small">{data.streak.currentDays} día{data.streak.currentDays === 1 ? "" : "s"} de racha · {data.progress.xp} XP</span><Bar value={Math.min(100, data.streak.currentDays * 20)} tone="amber" label="Racha" /></div></div></Card>

        {current && lesson && <Card>
          <div className="l-row between"><span className="l-small">{current.title} · Lección {current.completedLessons + 1}</span><span className="l-small" style={{ color: "var(--l-blue-500)", fontWeight: 500 }}>{current.completedLessons} de {current.lessons.length}</span></div>
          <Bar value={(current.completedLessons / current.lessons.length) * 100} label="Avance del módulo" />
          <div className="l-tip" style={{ alignItems: "center" }}><span className="l-icon-box" style={{ background: "var(--l-gradient)", color: "#fff", width: 60, height: 60 }}><Icon name="play_arrow_fill" size={28} /></span><div><span className="l-overline">Lección {current.completedLessons + 1} · +{LESSON_XP} XP</span><div style={{ fontSize: 16, fontWeight: 500, color: "var(--l-n-900)" }}>{lesson.title}</div></div></div>
          <Button href={`/app/aprender/${current.slug}/${lesson.key}`} arrow>{current.completedLessons ? "Continuar lección" : "Empezar lección"}</Button>
        </Card>}

        <div className="l-section-title" style={{ marginTop: 8 }}><h2>Tus módulos</h2><Chip tone="green">{completed} de {modules.length} completados</Chip></div>
        {modules.length === 0 && <div className="l-empty">Los módulos se cargarán pronto.</div>}
        {modules.map((module, index) => unlocked(index) ? (
          <Link key={module.id} href={`/app/aprender/${module.slug}`} className={`l-module ${index === currentIndex ? "current" : ""}`}>
            <span className={`thumb`} style={done(index) ? { background: "var(--l-green-50)", color: "var(--l-green-400)" } : undefined}><Icon name={done(index) ? "check_circle" : ICONS[index % ICONS.length]} size={28} /></span>
            <span className="l-grow l-stack" style={{ gap: 6 }}><h3>{module.title}</h3><span className="l-small">{module.lessons.length} lecciones · {module.durationMin} min</span><Bar value={(module.completedLessons / Math.max(1, module.lessons.length)) * 100} label="Avance" /></span>
            <Chip tone="violet" large icon="diamond_fill">+{module.lessons.length * LESSON_XP}</Chip>
          </Link>
        ) : (
          <div key={module.id} className="l-module locked"><span className="thumb" style={{ background: "var(--l-n-100)", color: "var(--l-n-500)" }}><Icon name="lock" size={28} /></span><span className="l-grow"><h3>{module.title}</h3><span className="l-small">Se desbloquea al terminar «{modules[index - 1].title}»</span></span></div>
        ))}
      </div>
    </Screen>
  );
}
