import {
  formalizationSettled,
  type FormalizationStatus,
} from '../formalization/formalization';

/**
 * Pure rules of the LUFT route. The machine is linear and never goes back:
 * registrado → diagnosticado → formalización → formación → crédito_1 →
 * seguimiento → crédito_2_opcional → perfil_final → matching →
 * relación_continua. It only advances with real facts.
 */

export const ROUTE_STAGES = [
  'REGISTRADO',
  'DIAGNOSTICADO',
  'FORMALIZACION',
  'FORMACION',
  'CREDITO_1',
  'SEGUIMIENTO',
  'CREDITO_2_OPCIONAL',
  'PERFIL_FINAL',
  'MATCHING',
  'RELACION_CONTINUA',
] as const;
export type RouteStage = (typeof ROUTE_STAGES)[number];

export const ROUTE_STAGE_LABELS: Record<RouteStage, string> = {
  REGISTRADO: 'Registrado',
  DIAGNOSTICADO: 'Diagnosticado',
  FORMALIZACION: 'Formalización',
  FORMACION: 'Formación',
  CREDITO_1: 'Crédito constructor 1',
  SEGUIMIENTO: 'Seguimiento',
  CREDITO_2_OPCIONAL: 'Crédito constructor 2 (opcional)',
  PERFIL_FINAL: 'Perfil final',
  MATCHING: 'Matching',
  RELACION_CONTINUA: 'Relación continua',
};

export function isRouteStage(value: unknown): value is RouteStage {
  return ROUTE_STAGES.includes(value as RouteStage);
}
export const stageIndex = (stage: RouteStage) => ROUTE_STAGES.indexOf(stage);

export type CreditState =
  'NONE' | 'IN_PROCESS' | 'REJECTED' | 'ACTIVE' | 'COMPLETED' | 'DEFAULTED';

export interface CreditFact {
  state: CreditState;
  installmentsPaid: number;
  installmentsTotal: number;
  overdue: number;
}
export const NO_CREDIT: CreditFact = {
  state: 'NONE',
  installmentsPaid: 0,
  installmentsTotal: 0,
  overdue: 0,
};

/** Non-sensitive facts; safe to keep in the transition history. */
export interface RouteFacts {
  classified: boolean;
  bureauRequested: boolean;
  bureauCompleted: boolean;
  archetypeAssigned: boolean;
  incomeDeclared: boolean;
  formalization: FormalizationStatus;
  requiredDocuments: number;
  requiredDocumentsUploaded: number;
  lessonsCompleted: number;
  modulesCompleted: number;
  credit1: CreditFact;
  credit2: CreditFact;
  finalScoreCompleted: boolean;
  matchingAvailable: boolean;
  lifeProjects: number;
}

const started = (credit: CreditFact) =>
  ['IN_PROCESS', 'ACTIVE', 'COMPLETED', 'DEFAULTED'].includes(credit.state);
const disbursed = (credit: CreditFact) =>
  ['ACTIVE', 'COMPLETED', 'DEFAULTED'].includes(credit.state);

/** Whether the facts by themselves justify being at each stage. */
export function stageReached(facts: RouteFacts): Record<RouteStage, boolean> {
  const diagnosed = facts.classified && facts.bureauCompleted;
  const formalizing =
    diagnosed &&
    (facts.incomeDeclared || facts.formalization !== 'SIN_EVALUAR');
  const learning =
    formalizing &&
    facts.incomeDeclared &&
    (formalizationSettled(facts.formalization) ||
      facts.formalization === 'PRESENTADO');
  const firstClosed = facts.credit1.state === 'COMPLETED';
  const finalProfile =
    firstClosed &&
    facts.finalScoreCompleted &&
    !['IN_PROCESS', 'ACTIVE'].includes(facts.credit2.state);
  const matching = finalProfile && facts.matchingAvailable;
  return {
    REGISTRADO: true,
    DIAGNOSTICADO: diagnosed,
    FORMALIZACION: formalizing,
    FORMACION: learning,
    CREDITO_1: started(facts.credit1),
    SEGUIMIENTO: disbursed(facts.credit1),
    CREDITO_2_OPCIONAL: firstClosed,
    PERFIL_FINAL: finalProfile,
    MATCHING: matching,
    RELACION_CONTINUA: matching && facts.lifeProjects > 0,
  };
}

/** The furthest stage backed by facts. Credit facts are hard evidence and pull the route forward. */
export function targetStage(facts: RouteFacts): RouteStage {
  const reached = stageReached(facts);
  let target: RouteStage = 'REGISTRADO';
  for (const stage of ROUTE_STAGES) if (reached[stage]) target = stage;
  return target;
}

export interface StageStep {
  from: RouteStage;
  to: RouteStage;
  reason: string;
}

const STAGE_REASONS: Record<RouteStage, string> = {
  REGISTRADO: 'account_created',
  DIAGNOSTICADO: 'classification_and_bureau_completed',
  FORMALIZACION: 'formalization_started',
  FORMACION: 'formalization_settled',
  CREDITO_1: 'credit_1_requested',
  SEGUIMIENTO: 'credit_1_active',
  CREDITO_2_OPCIONAL: 'credit_1_paid',
  PERFIL_FINAL: 'final_profile_ready',
  MATCHING: 'matching_available',
  RELACION_CONTINUA: 'life_project_started',
};

/**
 * Steps to record when the facts move the route. It never regresses; each
 * intermediate stage leaves its own transition so the history stays linear.
 */
export function advance(current: RouteStage, facts: RouteFacts): StageStep[] {
  const reached = stageReached(facts);
  const from = stageIndex(current);
  const to = stageIndex(targetStage(facts));
  const steps: StageStep[] = [];
  for (let index = from + 1; index <= to; index += 1) {
    const stage = ROUTE_STAGES[index];
    steps.push({
      from: ROUTE_STAGES[index - 1],
      to: stage,
      reason: reached[stage]
        ? STAGE_REASONS[stage]
        : 'passed_by_later_evidence',
    });
  }
  return steps;
}

export const ROUTE_HREFS = {
  route: '/app/ruta',
  score: '/app/puntaje',
  profile: '/app/perfil/financiero',
  documents: '/app/perfil/financiero/documentos',
  formalization: '/app/formalizacion',
  learn: '/app/aprender',
  credit: '/app/credito',
  pay: '/app/pagar',
  opportunities: '/app/oportunidades',
  projects: '/app/proyectos',
} as const;

export type VisibleStageKey =
  'CONOCETE' | 'FORMALIZATE' | 'PREPARATE' | 'DEMUESTRA' | 'AVANZA';

export interface RouteItem {
  key: string;
  label: string;
  done: boolean;
  optional: boolean;
  waiting: boolean;
  detail: string | null;
  href: string;
}

export interface VisibleStage {
  key: VisibleStageKey;
  title: string;
  description: string;
  status: 'DONE' | 'CURRENT' | 'PENDING';
  machineStages: RouteStage[];
  items: RouteItem[];
}

const item = (
  key: string,
  label: string,
  done: boolean,
  href: string,
  extra: Partial<Pick<RouteItem, 'optional' | 'waiting' | 'detail'>> = {},
): RouteItem => ({
  key,
  label,
  done,
  href,
  optional: extra.optional ?? false,
  waiting: !done && (extra.waiting ?? false),
  detail: extra.detail ?? null,
});

const FORMALIZATION_DETAIL: Partial<Record<FormalizationStatus, string>> = {
  POSIBLE_OBLIGACION:
    'Detectamos una posible obligación: cuéntanos si ya declaraste.',
  DOCUMENTO_CARGADO: 'Envía tu declaración a revisión.',
  PREPARACION_GUIADA: 'Termina la preparación guiada y envíala a revisión.',
  REVISION: 'Un profesional está revisando tu caso.',
  PRESENTADO: 'Estamos verificando la presentación.',
};

/** The five stages the user sees, each with its real checklist. */
export function visibleStages(facts: RouteFacts): VisibleStage[] {
  const { credit1, credit2 } = facts;
  const stages: Array<Omit<VisibleStage, 'status'>> = [
    {
      key: 'CONOCETE',
      title: 'Conócete',
      description: 'Centrales, contexto y perfil inicial',
      machineStages: ['REGISTRADO', 'DIAGNOSTICADO'],
      items: [
        item(
          'classification',
          'Responde las dos preguntas de clasificación',
          facts.classified,
          ROUTE_HREFS.route,
        ),
        item(
          'bureau',
          'Consulta tu historial en centrales de riesgo',
          facts.bureauCompleted,
          ROUTE_HREFS.score,
          {
            waiting: facts.bureauRequested,
            detail:
              facts.bureauRequested && !facts.bureauCompleted
                ? 'Tu consulta está en trámite con la central.'
                : null,
          },
        ),
        item(
          'archetype',
          'Conoce tu categoría y tu arquetipo',
          facts.archetypeAssigned,
          ROUTE_HREFS.route,
        ),
      ],
    },
    {
      key: 'FORMALIZATE',
      title: 'Formalízate',
      description: 'Ingresos, soportes y obligaciones',
      machineStages: ['FORMALIZACION'],
      items: [
        item(
          'income',
          'Cuéntanos de tu trabajo y tus ingresos',
          facts.incomeDeclared,
          ROUTE_HREFS.profile,
        ),
        item(
          'tax-diagnosis',
          'Haz tu diagnóstico tributario',
          facts.formalization !== 'SIN_EVALUAR',
          ROUTE_HREFS.formalization,
        ),
        item(
          'tax-settled',
          'Deja tu formalización al día',
          formalizationSettled(facts.formalization),
          ROUTE_HREFS.formalization,
          {
            waiting: ['REVISION', 'PRESENTADO'].includes(facts.formalization),
            detail: FORMALIZATION_DETAIL[facts.formalization] ?? null,
          },
        ),
        item(
          'documents',
          'Carga los soportes de tu categoría',
          facts.requiredDocumentsUploaded >= facts.requiredDocuments,
          ROUTE_HREFS.documents,
          {
            detail: facts.requiredDocuments
              ? `${Math.min(facts.requiredDocumentsUploaded, facts.requiredDocuments)} de ${facts.requiredDocuments}`
              : null,
          },
        ),
      ],
    },
    {
      key: 'PREPARATE',
      title: 'Prepárate',
      description: 'Academia y hábitos verificables',
      machineStages: ['FORMACION'],
      items: [
        item(
          'first-lesson',
          'Completa tu primera lección',
          facts.lessonsCompleted > 0,
          ROUTE_HREFS.learn,
        ),
        item(
          'first-module',
          'Termina un módulo completo',
          facts.modulesCompleted > 0,
          ROUTE_HREFS.learn,
          {
            detail: facts.lessonsCompleted
              ? `${facts.lessonsCompleted} ${facts.lessonsCompleted === 1 ? 'lección completada' : 'lecciones completadas'}`
              : null,
          },
        ),
      ],
    },
    {
      key: 'DEMUESTRA',
      title: 'Demuestra',
      description: 'Créditos constructores e historia',
      machineStages: ['CREDITO_1', 'SEGUIMIENTO', 'CREDITO_2_OPCIONAL'],
      items: [
        item(
          'credit-1-request',
          'Solicita tu crédito constructor 1',
          started(credit1),
          ROUTE_HREFS.credit,
          {
            detail:
              credit1.state === 'REJECTED'
                ? 'Tu solicitud anterior no fue aprobada.'
                : null,
          },
        ),
        item(
          'credit-1-active',
          'Activa tu crédito',
          disbursed(credit1),
          ROUTE_HREFS.credit,
          { waiting: credit1.state === 'IN_PROCESS' },
        ),
        item(
          'credit-1-paid',
          'Paga todas tus cuotas',
          credit1.state === 'COMPLETED',
          ROUTE_HREFS.pay,
          {
            detail: credit1.installmentsTotal
              ? `${credit1.installmentsPaid} de ${credit1.installmentsTotal} cuotas${credit1.overdue ? ` · ${credit1.overdue} en mora` : ''}`
              : null,
          },
        ),
        item(
          'credit-2',
          'Crédito constructor 2',
          credit2.state === 'COMPLETED',
          ROUTE_HREFS.credit,
          {
            optional: true,
            waiting: credit2.state === 'IN_PROCESS',
            detail:
              credit2.state === 'NONE'
                ? 'Opcional: solo si tienes una finalidad definida y capacidad disponible.'
                : credit2.installmentsTotal
                  ? `${credit2.installmentsPaid} de ${credit2.installmentsTotal} cuotas`
                  : null,
          },
        ),
      ],
    },
    {
      key: 'AVANZA',
      title: 'Avanza',
      description: 'Matching y nuevo proyecto',
      machineStages: ['PERFIL_FINAL', 'MATCHING', 'RELACION_CONTINUA'],
      items: [
        item(
          'final-profile',
          'Consulta final de tu perfil',
          facts.finalScoreCompleted,
          ROUTE_HREFS.score,
          { waiting: credit1.state === 'COMPLETED' },
        ),
        item(
          'matching',
          'Revisa tus oportunidades',
          facts.matchingAvailable,
          ROUTE_HREFS.opportunities,
        ),
        item(
          'life-project',
          'Crea tu siguiente proyecto de vida',
          facts.lifeProjects > 0,
          ROUTE_HREFS.projects,
        ),
      ],
    },
  ];
  let currentAssigned = false;
  return stages.map((stage) => {
    const done = stage.items
      .filter((row) => !row.optional)
      .every((row) => row.done);
    const status = done ? 'DONE' : currentAssigned ? 'PENDING' : 'CURRENT';
    if (status === 'CURRENT') currentAssigned = true;
    return { ...stage, status };
  });
}

export interface NextStep {
  key: string;
  stage: VisibleStageKey;
  title: string;
  description: string;
  href: string;
}

/** First required item the user can act on; items waiting on a third party are skipped. */
export function nextStep(stages: VisibleStage[]): NextStep | null {
  const pending = stages.flatMap((stage) =>
    stage.items
      .filter((row) => !row.done && !row.optional)
      .map((row) => ({ stage, row })),
  );
  const chosen = pending.find(({ row }) => !row.waiting) ?? pending[0];
  if (!chosen) return null;
  return {
    key: chosen.row.key,
    stage: chosen.stage.key,
    title: chosen.row.label,
    description:
      chosen.row.detail ??
      `${chosen.stage.title}: ${chosen.stage.description.toLowerCase()}.`,
    href: chosen.row.href,
  };
}

export function routeProgress(stages: VisibleStage[]) {
  const required = stages.flatMap((stage) =>
    stage.items.filter((row) => !row.optional),
  );
  const done = required.filter((row) => row.done).length;
  return required.length ? Math.round((done / required.length) * 100) : 0;
}

/** A new route (another life stage or a project) opens once the current one reached its final profile. */
export function canStartNewRoute(stage: RouteStage) {
  return stageIndex(stage) >= stageIndex('PERFIL_FINAL');
}
