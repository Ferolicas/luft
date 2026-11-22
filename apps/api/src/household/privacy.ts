import { z } from 'zod';

/**
 * Pure privacy rules of LUFT Juntos / LUFT Familia. A package never merges
 * files or profiles: each member decides, metric by metric, what the household
 * may see. A support member only sees what was explicitly opened to support.
 */

export const HOUSEHOLD_ROLES = ['OWNER', 'BENEFICIARY', 'SUPPORT'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const SHAREABLE_METRICS = [
  'routeProgress',
  'archetype',
  'learning',
  'credit',
  'score',
] as const;
export type ShareableMetric = (typeof SHAREABLE_METRICS)[number];

/** NONE: private. BENEFICIARIES: owner and members with a route. ALL: also support members. */
export const SHARE_LEVELS = ['NONE', 'BENEFICIARIES', 'ALL'] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];
export type MemberPermissions = Record<ShareableMetric, ShareLevel>;

export const METRIC_LABELS: Record<ShareableMetric, string> = {
  routeProgress: 'Avance de mi ruta',
  archetype: 'Mi categoría y arquetipo',
  learning: 'Mis lecciones y módulos',
  credit: 'El estado de mi crédito constructor',
  score: 'Mi puntaje',
};

/** Privacy by default: nothing is shared until the member says so. */
export const PRIVATE_PERMISSIONS: MemberPermissions = {
  routeProgress: 'NONE',
  archetype: 'NONE',
  learning: 'NONE',
  credit: 'NONE',
  score: 'NONE',
};

export const permissionsSchema = z
  .object({
    routeProgress: z.enum(SHARE_LEVELS),
    archetype: z.enum(SHARE_LEVELS),
    learning: z.enum(SHARE_LEVELS),
    credit: z.enum(SHARE_LEVELS),
    score: z.enum(SHARE_LEVELS),
  })
  .partial()
  .strict();

export function normalizePermissions(value: unknown): MemberPermissions {
  const parsed = permissionsSchema.safeParse(value ?? {});
  return { ...PRIVATE_PERMISSIONS, ...(parsed.success ? parsed.data : {}) };
}

export interface MemberMetrics {
  routeProgress: {
    percent: number;
    stage: string;
    stageLabel: string;
  } | null;
  archetype: {
    categoryCode: string;
    categoryBrand: string;
    archetypeName: string | null;
  } | null;
  learning: { lessonsCompleted: number; modulesCompleted: number } | null;
  credit: {
    state: string;
    installmentsPaid: number;
    installmentsTotal: number;
    upToDate: boolean;
  } | null;
  score: { value: number } | null;
}

export interface MemberRecord {
  memberId: string;
  userId: string;
  firstName: string;
  role: HouseholdRole;
  seatAssigned: boolean;
  joinedAt: Date | string;
  permissions: MemberPermissions;
  metrics: MemberMetrics;
}

export interface Viewer {
  userId: string;
  role: HouseholdRole;
}

/** The single rule that decides whether a viewer may see one metric of a member. */
export function canSee(
  viewer: Viewer,
  subject: Pick<MemberRecord, 'userId' | 'permissions'>,
  metric: ShareableMetric,
): boolean {
  if (viewer.userId === subject.userId) return true;
  const level = subject.permissions[metric] ?? 'NONE';
  if (level === 'ALL') return true;
  if (level === 'BENEFICIARIES') return viewer.role !== 'SUPPORT';
  return false;
}

/** What a viewer receives about a member: unshared metrics are never included. */
export function memberView(viewer: Viewer, subject: MemberRecord) {
  const visible = SHAREABLE_METRICS.filter((metric) =>
    canSee(viewer, subject, metric),
  );
  const shared: Partial<MemberMetrics> = {};
  for (const metric of visible)
    (shared as Record<string, unknown>)[metric] = subject.metrics[metric];
  const isSelf = viewer.userId === subject.userId;
  return {
    memberId: subject.memberId,
    firstName: subject.firstName,
    role: subject.role,
    seatAssigned: subject.seatAssigned,
    joinedAt: subject.joinedAt,
    isSelf,
    visibleMetrics: visible,
    metrics: shared,
    ...(isSelf ? { permissions: subject.permissions } : {}),
  };
}

/** Household board: every figure is computed only over metrics the viewer may see. */
export function aggregateBoard(viewer: Viewer, members: MemberRecord[]) {
  const visible = <K extends ShareableMetric>(metric: K) =>
    members
      .filter((member) => canSee(viewer, member, metric))
      .map((member) => member.metrics[metric])
      .filter(
        (value): value is NonNullable<MemberMetrics[K]> => value !== null,
      );
  const progress = visible('routeProgress');
  const learning = visible('learning');
  const credit = visible('credit');
  return {
    members: members.length,
    beneficiaries: members.filter((member) => member.role !== 'SUPPORT').length,
    support: members.filter((member) => member.role === 'SUPPORT').length,
    routeProgress: progress.length
      ? {
          sharedBy: progress.length,
          averagePercent: Math.round(
            progress.reduce((total, row) => total + row.percent, 0) /
              progress.length,
          ),
        }
      : null,
    learning: learning.length
      ? {
          sharedBy: learning.length,
          lessonsCompleted: learning.reduce(
            (total, row) => total + row.lessonsCompleted,
            0,
          ),
          modulesCompleted: learning.reduce(
            (total, row) => total + row.modulesCompleted,
            0,
          ),
        }
      : null,
    credit: credit.length
      ? {
          sharedBy: credit.length,
          upToDate: credit.filter((row) => row.upToDate).length,
        }
      : null,
  };
}

export const MAX_HOUSEHOLD_MEMBERS = 12;

/** Seats of the buyer's plan: one is the buyer's own identity. */
export function seatUsage(input: {
  seats: number;
  beneficiaries: number;
  pendingSeatInvitations: number;
}) {
  const used = 1 + input.beneficiaries + input.pendingSeatInvitations;
  return {
    total: input.seats,
    used,
    available: Math.max(0, input.seats - used),
  };
}

export function inviteDecision(input: {
  inviterRole: HouseholdRole;
  role: 'BENEFICIARY' | 'SUPPORT';
  seatsAvailable: number;
  activeMembers: number;
  pendingInvitations: number;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.inviterRole !== 'OWNER')
    return {
      ok: false,
      code: 'owner_only',
      message: 'Solo quien creó el hogar puede invitar integrantes.',
    };
  if (input.activeMembers + input.pendingInvitations >= MAX_HOUSEHOLD_MEMBERS)
    return {
      ok: false,
      code: 'household_full',
      message: `Un hogar admite máximo ${MAX_HOUSEHOLD_MEMBERS} integrantes entre activos e invitados.`,
    };
  if (input.role === 'BENEFICIARY' && input.seatsAvailable < 1)
    return {
      ok: false,
      code: 'no_seats_available',
      message:
        'No tienes cupos disponibles en tu plan. Cambia a Dúo o Familia, o invita a esta persona como red de apoyo.',
    };
  return { ok: true };
}

export interface ContributionRecord {
  amountCOP: number;
  status: string;
}

/** Only contributions confirmed by the goal owner count toward the goal. */
export function goalProgress(
  targetCOP: number,
  contributions: ContributionRecord[],
) {
  const sum = (status: string) =>
    contributions
      .filter((row) => row.status === status)
      .reduce((total, row) => total + row.amountCOP, 0);
  const confirmedCOP = sum('CONFIRMED');
  return {
    confirmedCOP,
    pendingCOP: sum('DECLARED'),
    percent:
      targetCOP > 0
        ? Math.min(100, Math.round((confirmedCOP / targetCOP) * 100))
        : 0,
    reached: targetCOP > 0 && confirmedCOP >= targetCOP,
  };
}

/** The owner of the goal reconciles; nobody confirms a contribution on their behalf. */
export function canResolveContribution(
  viewerUserId: string,
  goalOwnerUserId: string,
) {
  return viewerUserId === goalOwnerUserId;
}
