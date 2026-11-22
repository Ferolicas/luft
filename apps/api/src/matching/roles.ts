import { Role } from '../generated/identity/enums';

/**
 * Role sets of the matching and analytics modules.
 *
 * `ALLY` and `INSTITUTION` are EXTERNAL roles. They are never part of an
 * internal list: every staff route names its roles explicitly, so a partner
 * account cannot reach `/api/admin/*` and only sees its own portal.
 */
export const INTERNAL_STAFF: Role[] = [
  Role.COMMERCIAL,
  Role.LEGAL,
  Role.SUPPORT,
  Role.COLLECTIONS,
  Role.RISK,
  Role.FINANCE,
  Role.SUPERADMIN,
];

export const EXTERNAL_ROLES: Role[] = [Role.ALLY, Role.INSTITUTION];

/** People who can run their own matching (partner accounts cannot). */
export const MATCHING_USERS: Role[] = [Role.USER, ...INTERNAL_STAFF];

export const POLICY_READERS: Role[] = [
  Role.RISK,
  Role.COMMERCIAL,
  Role.SUPERADMIN,
];
export const POLICY_WRITERS: Role[] = [Role.RISK, Role.SUPERADMIN];
export const PRESENTATION_STAFF: Role[] = [
  Role.COMMERCIAL,
  Role.RISK,
  Role.SUPERADMIN,
];
export const ANALYTICS_STAFF: Role[] = [
  Role.RISK,
  Role.FINANCE,
  Role.SUPERADMIN,
];

export function isInternalStaff(role: string): boolean {
  return INTERNAL_STAFF.includes(role as Role);
}
