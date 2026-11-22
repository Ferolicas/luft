import type { IconName } from "@/components/luft/icon-data";

export interface Slide { title: string; text: string }
export interface Question { prompt: string; options: Array<{ title: string; text: string; icon: IconName }>; correct: number; explain: string; hint: string }
export interface LessonContent { slides: Slide[]; learned: string[]; quiz: Question[] }

/** Contenido de cada lección, indexado por la clave que guarda la base de datos. */
export const LESSONS: Record<string, LessonContent> = {
  score: {
    slides: [
      { title: "Tu puntaje es tu reputación financiera", text: "Bancos y entidades lo miran para decidir si te prestan y en qué condiciones. En Colombia suele ir de 150 a 950 puntos." },
      { title: "Un número, no una etiqueta", text: "Resume cómo has manejado tus obligaciones hasta hoy. Cambia con el tiempo y con tus hábitos." },
      { title: "Lo que más pesa", text: "Pagar a tiempo es la señal más importante. Cada cuota puntual suma a tu favor." },
    ],
    learned: ["El puntaje resume tu comportamiento de pago", "Pagar a tiempo es lo que más pesa", "Tu puntaje puede mejorar con hábitos"],
    quiz: [
      { prompt: "Si pagas una cuota tarde, ¿qué le pasa a tu puntaje?", options: [{ title: "Sube, porque igual pagaste", text: "Lo importante es pagar completo", icon: "trending_up" }, { title: "Baja y queda en tu historial", text: "Los atrasos se reportan", icon: "warning" }, { title: "No le pasa nada", text: "Un par de días no hace diferencia", icon: "balance" }], correct: 1, explain: "Un pago tarde puede bajar tu puntaje y queda en tu historial. Pagar a tiempo, aunque sea el mínimo, es lo que más lo cuida.", hint: "Piensa en qué es lo que más pesa en tu puntaje." },
      { prompt: "¿Qué describe mejor tu puntaje crediticio?", options: [{ title: "Cuánto dinero tienes", text: "Tu saldo en el banco", icon: "paid" }, { title: "Cómo has pagado tus obligaciones", text: "Tu comportamiento de pago", icon: "task" }, { title: "Tu salario", text: "Lo que ganas al mes", icon: "work" }], correct: 1, explain: "El puntaje se construye con tu comportamiento de pago, no con tu saldo ni con tu salario.", hint: "No mide riqueza: mide hábitos." },
    ],
  },
  report: {
    slides: [
      { title: "Tu reporte cuenta tu historia", text: "Los operadores de información, como Datacrédito y TransUnion, registran tus créditos, cuotas y pagos." },
      { title: "Positivo y negativo", text: "El reporte muestra tanto los pagos al día como los atrasos. Lo positivo también construye." },
      { title: "Revisarlo es tu derecho", text: "Puedes consultar tu información. Hacerlo tú mismo no baja tu puntaje." },
    ],
    learned: ["Tu reporte registra pagos al día y atrasos", "Los pagos positivos también suman", "Consultarlo tú mismo no lo baja"],
    quiz: [
      { prompt: "Consultar tu propio historial…", options: [{ title: "Baja tu puntaje", text: "Cada consulta resta", icon: "trending_up" }, { title: "No afecta tu puntaje", text: "Es tu derecho conocerlo", icon: "verified_user" }, { title: "Borra tus atrasos", text: "Reinicia el reporte", icon: "sync" }], correct: 1, explain: "Consultar tu propia información es tu derecho y no baja tu puntaje.", hint: "Conocer tu información no es pedir un crédito." },
    ],
  },
  rights: {
    slides: [
      { title: "Tienes derechos sobre tus datos", text: "La ley de habeas data financiero te permite conocer, actualizar y rectificar la información que reportan sobre ti." },
      { title: "Si algo no cuadra, reclama", text: "Puedes presentar una petición o reclamo ante la entidad que reportó o ante el operador de información." },
      { title: "Los reportes negativos no son eternos", text: "La información negativa tiene un tiempo máximo de permanencia definido por la ley, contado desde que te pones al día." },
    ],
    learned: ["Puedes conocer y corregir tus datos", "Puedes reclamar ante la fuente o el operador", "Los reportes negativos tienen un límite de tiempo"],
    quiz: [
      { prompt: "Ves un dato equivocado en tu reporte. ¿Qué puedes hacer?", options: [{ title: "Nada, es definitivo", text: "El reporte no cambia", icon: "lock" }, { title: "Presentar un reclamo", text: "Ante la entidad o el operador", icon: "description" }, { title: "Abrir otro crédito", text: "Para taparlo", icon: "credit_card" }], correct: 1, explain: "Tienes derecho a pedir que corrijan la información que no sea veraz.", hint: "La ley protege tu derecho a rectificar." },
    ],
  },
  budget: {
    slides: [
      { title: "Un presupuesto es un plan", text: "Es decidir, antes de gastar, a dónde va tu dinero: lo necesario, lo que quieres y lo que guardas." },
      { title: "Empieza por lo fijo", text: "Anota arriendo, servicios, transporte y comida. Lo que queda es tu margen real." },
      { title: "Revisa cada mes", text: "Compara lo que planeaste con lo que pasó. Ajustar es parte del proceso." },
    ],
    learned: ["Presupuestar es decidir antes de gastar", "Primero van los gastos fijos", "Revisar y ajustar cada mes"],
    quiz: [
      { prompt: "¿Cuál es el primer paso de un presupuesto?", options: [{ title: "Anotar tus gastos fijos", text: "Saber cuánto ya está comprometido", icon: "receipt_long" }, { title: "Pedir un crédito", text: "Para tener más margen", icon: "credit_card" }, { title: "Gastar y ver qué queda", text: "Ajustar al final", icon: "payments" }], correct: 0, explain: "Conocer tus gastos fijos te muestra tu margen real para decidir lo demás.", hint: "Antes de decidir, hay que saber qué ya está comprometido." },
    ],
  },
  dates: {
    slides: [
      { title: "Las fechas importan", text: "Cada obligación tiene una fecha límite de pago. Pagar después de esa fecha es un atraso." },
      { title: "Ponte recordatorios", text: "Programa un aviso unos días antes. Así un olvido no te cuesta puntos." },
      { title: "Cuadra tus fechas con tus ingresos", text: "Si puedes, elige fechas de pago cercanas al día en que recibes tu dinero." },
    ],
    learned: ["Pagar después de la fecha límite es un atraso", "Un recordatorio evita olvidos", "Alinea tus pagos con tus ingresos"],
    quiz: [
      { prompt: "¿Qué ayuda más a no atrasarte?", options: [{ title: "Recordatorio antes de la fecha", text: "Con unos días de margen", icon: "schedule" }, { title: "Pagar cuando te acuerdes", text: "Sin fecha fija", icon: "help" }, { title: "Esperar el cobro", text: "Que te llamen", icon: "smartphone" }], correct: 0, explain: "Un recordatorio con margen te da tiempo de reaccionar si algo falla.", hint: "La anticipación es tu aliada." },
    ],
  },
  capacity: {
    slides: [
      { title: "Tu capacidad de pago", text: "Es lo que puedes destinar a cuotas sin descuadrar tus gastos básicos." },
      { title: "Una regla sencilla", text: "Procura que la suma de tus cuotas no pase de una parte moderada de lo que recibes al mes." },
      { title: "Menos es más", text: "Una cuota cómoda que pagas siempre vale más que una grande que te atrasa." },
    ],
    learned: ["Capacidad de pago = cuotas sin descuadrarte", "Mantén tus cuotas en una parte moderada del ingreso", "Mejor una cuota cómoda y constante"],
    quiz: [
      { prompt: "¿Qué cuota le conviene más a tu historial?", options: [{ title: "La más alta posible", text: "Para terminar rápido", icon: "trending_up" }, { title: "Una que pagues siempre a tiempo", text: "Cómoda y constante", icon: "check_circle" }, { title: "Cualquiera", text: "Da igual", icon: "balance" }], correct: 1, explain: "La constancia pesa más: una cuota que puedes pagar siempre a tiempo construye historial.", hint: "Piensa en constancia, no en velocidad." },
    ],
  },
  rates: {
    slides: [
      { title: "La tasa es el precio del crédito", text: "Indica cuánto pagas por usar dinero prestado. Puede expresarse mensual o efectiva anual." },
      { title: "Mira el costo total", text: "Suma intereses, seguros y cargos. Dos créditos con la misma cuota pueden costar distinto." },
      { title: "Hay un límite legal", text: "Ninguna entidad puede cobrar por encima de la tasa de usura vigente." },
    ],
    learned: ["La tasa es el precio de usar dinero prestado", "Compara el costo total, no solo la cuota", "Existe un tope legal: la tasa de usura"],
    quiz: [
      { prompt: "Para comparar dos créditos, ¿qué debes mirar?", options: [{ title: "Solo la cuota", text: "La más bajita gana", icon: "payments" }, { title: "El costo total", text: "Intereses, seguros y cargos", icon: "calculate" }, { title: "El nombre de la entidad", text: "La más conocida", icon: "account_balance" }], correct: 1, explain: "El costo total te dice cuánto pagarás realmente por el crédito.", hint: "La cuota no cuenta toda la historia." },
    ],
  },
  contract: {
    slides: [
      { title: "Antes de firmar, lee", text: "Revisa monto, plazo, tasa, valor de las cuotas y qué pasa si te atrasas." },
      { title: "Pregunta sin pena", text: "Si algo no es claro, pide que te lo expliquen. Firmar es aceptar todo lo escrito." },
      { title: "Guarda tu copia", text: "Conserva el contrato y el plan de pagos. Son tu referencia ante cualquier duda." },
    ],
    learned: ["Revisa monto, plazo, tasa y cuotas", "Pregunta todo lo que no entiendas", "Guarda copia del contrato y del plan"],
    quiz: [
      { prompt: "Hay una cláusula que no entiendes. ¿Qué haces?", options: [{ title: "Firmar igual", text: "Seguro no es importante", icon: "task" }, { title: "Pedir que te la expliquen", text: "Antes de firmar", icon: "help" }, { title: "Tacharla", text: "Y firmar", icon: "close" }], correct: 1, explain: "Firmar es aceptar todo el contenido: aclara tus dudas antes.", hint: "Tu firma te compromete con todo el texto." },
    ],
  },
  payment: {
    slides: [
      { title: "Un plan que sí cumples", text: "Tu plan de pagos te dice cuánto y cuándo pagar. Tenlo siempre a la mano." },
      { title: "Si ves venir un problema, avisa", text: "Contacta a la entidad antes de atrasarte. Suele haber más opciones antes que después." },
      { title: "Terminar bien también cuenta", text: "Cerrar un crédito al día deja una señal positiva en tu historial." },
    ],
    learned: ["Conoce tu plan: cuánto y cuándo", "Avisa antes de atrasarte", "Cerrar al día deja una señal positiva"],
    quiz: [
      { prompt: "Sabes que este mes no alcanzas a pagar. ¿Qué es mejor?", options: [{ title: "No contestar", text: "Esperar a ver qué pasa", icon: "wifi_off" }, { title: "Avisar antes de la fecha", text: "Y buscar una alternativa", icon: "smartphone" }, { title: "Pedir otro crédito", text: "Para pagar este", icon: "credit_card" }], correct: 1, explain: "Hablar antes de atrasarte abre más alternativas y cuida tu historial.", hint: "Anticiparse casi siempre da más opciones." },
    ],
  },
};

export const lessonContent = (key: string): LessonContent | null => LESSONS[key] ?? null;
export const LESSON_XP = 20;
/** Bonus for finishing every lesson of a module. */
export const MODULE_XP = 30;
/** XP of one lesson: the value the API reports for the learning mission, or the launch default. */
export const lessonXp = (progress: { missions: Array<{ key: string; xp: number }> }) => progress.missions.find((mission) => mission.key === "lesson")?.xp || LESSON_XP;

/** Tema y nivel de cada módulo publicado, por slug (acompaña al contenido de las lecciones). */
const MODULES: Record<string, { topic: string; level: string }> = {
  "conoce-tu-historial": { topic: "Historial", level: "Nivel básico" },
  "habitos-que-suman": { topic: "Hábitos", level: "Nivel básico" },
  "tu-primer-credito": { topic: "Crédito", level: "Nivel intermedio" },
};
export const moduleMeta = (slug: string) => MODULES[slug] ?? null;
