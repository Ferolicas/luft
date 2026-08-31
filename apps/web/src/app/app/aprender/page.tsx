"use client";

import { BookOpen, Check, Clock3, LockKeyhole, Play } from "lucide-react";
import { useState } from "react";
import { Notice, Spinner } from "@/components/status";
import { useDashboard } from "@/hooks/use-dashboard";
import { api, errorMessage } from "@/lib/api";

export default function LearningPage() {
  const { data, error, reload } = useDashboard(); const [busy, setBusy] = useState(""); const [failure, setFailure] = useState("");
  async function complete(moduleId: string, lessonKey: string) { setBusy(`${moduleId}:${lessonKey}`); setFailure(""); try { await api("/luft/learning/complete", { method: "POST", body: JSON.stringify({ moduleId, lessonKey, score: 100 }) }); await reload(); } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(""); } }
  if (error) return <Notice type="error">{error}</Notice>; if (!data) return <Spinner label="Cargando tu ruta de aprendizaje…" />;
  return <div className="inner-page"><header className="inner-heading"><div><span className="eyebrow"><BookOpen size={14} /> Aprende a tu ritmo</span><h1>Lo importante cabe en pocos minutos.</h1><p>Lecciones claras, sin lenguaje complicado y conectadas con decisiones reales.</p></div><div className="learning-stat"><strong>{data.streak.currentDays}</strong><span>días de<br />constancia</span></div></header>{failure && <Notice type="error">{failure}</Notice>}<div className="module-list">{data.learning.map((module, moduleIndex) => { const total = module.lessons.length; const completed = module.completedLessons; return <article className="module-card" key={module.id}><div className="module-number">{String(moduleIndex + 1).padStart(2,"0")}</div><div className="module-body"><div className="module-meta"><span><Clock3 /> {module.durationMin} min</span><span>{completed}/{total} lecciones</span></div><h2>{module.title}</h2><p>{module.description}</p><div className="progress-track"><i style={{ width: `${(completed / total) * 100}%` }} /></div><div className="lesson-list">{module.lessons.map((lesson, index) => { const isComplete = index < completed; const locked = moduleIndex > 0 && data.learning[moduleIndex - 1].completedLessons < data.learning[moduleIndex - 1].lessons.length; return <div className={`lesson-row ${isComplete ? "complete" : ""}`} key={lesson.key}><span>{isComplete ? <Check /> : locked ? <LockKeyhole /> : <Play />}</span><strong>{lesson.title}</strong><button disabled={isComplete || locked || Boolean(busy)} onClick={() => complete(module.id, lesson.key)}>{isComplete ? "Completada" : locked ? "Bloqueada" : busy === `${module.id}:${lesson.key}` ? "Guardando…" : "Completar"}</button></div>; })}</div></div></article>; })}</div></div>;
}
