import type { IconName } from "@/components/luft/icon-data";
import type { CreditExperience, Goal } from "./journey";

export const GOALS: Array<{ value: Goal; icon: IconName; title: string; text: string }> = [
  { value: "IMPROVE_SCORE", icon: "trending_up", title: "Mejorar mi puntaje", text: "Ya tengo créditos, pero me cuesta que me aprueben nuevos." },
  { value: "START", icon: "eco", title: "Empezar mi vida financiera", text: "Aún no tengo créditos y quiero aprender desde cero." },
  { value: "GUIDE_YOUTH", icon: "group", title: "Acompañar a un joven", text: "Quiero guiar a mi hijo, hija o familiar en sus finanzas." },
];
export const EXPERIENCE: Array<{ value: CreditExperience; icon: IconName; title: string; text: string }> = [
  { value: "UP_TO_DATE", icon: "check_circle", title: "Sí, y voy al día", text: "Pago a tiempo, pero mi puntaje sigue bajo." },
  { value: "LATE", icon: "warning", title: "Sí, pero me he atrasado", text: "He tenido moras o me han reportado." },
  { value: "NONE", icon: "eco", title: "No, nunca he tenido", text: "Aún no tengo historial crediticio." },
];
