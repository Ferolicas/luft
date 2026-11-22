import { ratio, type LoanPerformance } from './cohorts';

/**
 * Pure effectiveness analytics: score before/after per cohort, lessons versus
 * payment behaviour and archetype stability. Descriptive only — it never
 * attributes a change to LUFT nor predicts a score.
 */

export const NO_CREDIT_COHORT = 'SIN_CREDITO';

export const EFFECTIVENESS_NOTE =
  'Análisis descriptivo. Una diferencia entre el puntaje inicial y el final no demuestra que LUFT la haya causado ni anticipa resultados futuros: el puntaje de las centrales depende de múltiples factores.';

export interface UserJourney {
  userId: string;
  /** Origination month of the first loan, or `null` without a loan. */
  cohortMonth: string | null;
  initialScore: number | null;
  finalScore: number | null;
  lessonsCompleted: number;
  /** Behaviour of each loan of the person. */
  loans: LoanPerformance[];
  /** Archetypes in chronological order (oldest first). */
  archetypes: string[];
}

const average = (values: number[]): number | null =>
  values.length
    ? Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
      ) / 100
    : null;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface ScoreCohort {
  cohortMonth: string;
  users: number;
  withInitial: number;
  withFinal: number;
  withBoth: number;
  averageInitial: number | null;
  averageFinal: number | null;
  averageDelta: number | null;
  medianDelta: number | null;
  improved: number;
  unchanged: number;
  declined: number;
}

function scoreCohort(cohortMonth: string, users: UserJourney[]): ScoreCohort {
  const both = users.filter(
    (user) => user.initialScore !== null && user.finalScore !== null,
  );
  const deltas = both.map(
    (user) => (user.finalScore as number) - (user.initialScore as number),
  );
  return {
    cohortMonth,
    users: users.length,
    withInitial: users.filter((user) => user.initialScore !== null).length,
    withFinal: users.filter((user) => user.finalScore !== null).length,
    withBoth: both.length,
    // Averages compare the SAME people (those with both inquiries).
    averageInitial: average(both.map((user) => user.initialScore as number)),
    averageFinal: average(both.map((user) => user.finalScore as number)),
    averageDelta: average(deltas),
    medianDelta: median(deltas),
    improved: deltas.filter((delta) => delta > 0).length,
    unchanged: deltas.filter((delta) => delta === 0).length,
    declined: deltas.filter((delta) => delta < 0).length,
  };
}

export const LESSON_BUCKETS = [
  { key: '0', label: 'Sin lecciones', min: 0, max: 0 },
  { key: '1-3', label: '1 a 3 lecciones', min: 1, max: 3 },
  { key: '4-7', label: '4 a 7 lecciones', min: 4, max: 7 },
  { key: '8+', label: '8 o más lecciones', min: 8, max: Infinity },
] as const;

export interface LessonBucket {
  key: string;
  label: string;
  users: number;
  loans: number;
  installmentsDue: number;
  installmentsOnTime: number;
  onTimeRate: number | null;
  ever30: number;
  ever30Rate: number | null;
}

function lessonBuckets(users: UserJourney[]): LessonBucket[] {
  const borrowers = users.filter((user) => user.loans.length > 0);
  return LESSON_BUCKETS.map((bucket) => {
    const members = borrowers.filter(
      (user) =>
        user.lessonsCompleted >= bucket.min &&
        user.lessonsCompleted <= bucket.max,
    );
    const loans = members.flatMap((user) => user.loans);
    const due = loans.reduce((sum, loan) => sum + loan.installmentsDue, 0);
    const onTime = loans.reduce(
      (sum, loan) => sum + loan.installmentsOnTime,
      0,
    );
    const ever30 = loans.filter((loan) => loan.everDpd30).length;
    return {
      key: bucket.key,
      label: bucket.label,
      users: members.length,
      loans: loans.length,
      installmentsDue: due,
      installmentsOnTime: onTime,
      onTimeRate: ratio(onTime, due),
      ever30,
      ever30Rate: ratio(ever30, loans.length),
    };
  });
}

export interface ArchetypeStability {
  usersWithHistory: number;
  stable: number;
  changed: number;
  stabilityRate: number | null;
  averageChanges: number | null;
  transitions: Array<{ from: string; to: string; count: number }>;
}

/** Stability needs at least two archetype records for the same person. */
function archetypeStability(users: UserJourney[]): ArchetypeStability {
  const histories = users
    .map((user) => user.archetypes)
    .filter((list) => list.length >= 2);
  const transitions = new Map<string, number>();
  const changes = histories.map((list) => {
    let count = 0;
    for (let index = 1; index < list.length; index += 1) {
      if (list[index] === list[index - 1]) continue;
      count += 1;
      const key = `${list[index - 1]}→${list[index]}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
    return count;
  });
  const stable = changes.filter((count) => count === 0).length;
  return {
    usersWithHistory: histories.length,
    stable,
    changed: histories.length - stable,
    stabilityRate: ratio(stable, histories.length),
    averageChanges: average(changes),
    transitions: [...transitions.entries()]
      .map(([key, count]) => {
        const [from, to] = key.split('→');
        return { from, to, count };
      })
      .sort(
        (a, b) => b.count - a.count || (a.from + a.to < b.from + b.to ? -1 : 1),
      )
      .slice(0, 20),
  };
}

export interface EffectivenessReport {
  users: number;
  score: { overall: ScoreCohort; cohorts: ScoreCohort[] };
  lessons: { buckets: LessonBucket[] };
  archetypeStability: ArchetypeStability;
  note: string;
}

export function computeEffectiveness(
  users: readonly UserJourney[],
): EffectivenessReport {
  const list = [...users];
  const groups = new Map<string, UserJourney[]>();
  for (const user of list) {
    const key = user.cohortMonth ?? NO_CREDIT_COHORT;
    groups.set(key, [...(groups.get(key) ?? []), user]);
  }
  return {
    users: list.length,
    score: {
      overall: scoreCohort('TODOS', list),
      cohorts: [...groups.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([month, members]) => scoreCohort(month, members)),
    },
    lessons: { buckets: lessonBuckets(list) },
    archetypeStability: archetypeStability(list),
    note: EFFECTIVENESS_NOTE,
  };
}
