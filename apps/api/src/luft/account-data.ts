import type { DatabaseService } from '../database/database.service';
import { PRIVATE_PERMISSIONS } from '../household/privacy';

type LuftDb = Pick<DatabaseService, 'luft'>;

/**
 * Account lifecycle for the V2 tables of the `luft` schema. Account closure
 * (AuthService.closeAccount) calls one of these two functions; encrypted files
 * live under PRIVATE_STORAGE_PATH/documents/<userId>/ and are removed there.
 */

/**
 * Erases everything V2 keeps about a person (accounts without financial
 * records). Confirmed contributions to someone else's goal stay, because they
 * are part of that person's goal; they no longer point to an existing user.
 */
export async function purgeLuftAccountData(db: LuftDb, userId: string) {
  const { luft } = db;
  await luft.$transaction([
    luft.notification.deleteMany({ where: { userId } }),
    luft.cardGuidance.deleteMany({ where: { userId } }),
    luft.cardAccount.deleteMany({ where: { userId } }),
    luft.lifeProject.deleteMany({ where: { userId } }),
    luft.openFinanceConnection.deleteMany({ where: { userId } }),
    luft.evidence.deleteMany({ where: { userId } }),
    luft.financialProfileSnapshot.deleteMany({ where: { userId } }),
    luft.archetypeAssignment.deleteMany({ where: { userId } }),
    luft.userRoute.deleteMany({ where: { userId } }),
    luft.formalizationCase.deleteMany({ where: { userId } }),
    luft.userDocument.deleteMany({ where: { userId } }),
    luft.contribution.deleteMany({
      where: { contributorUserId: userId, status: { not: 'CONFIRMED' } },
    }),
    luft.sharedGoal.deleteMany({ where: { ownerUserId: userId } }),
    luft.householdInvitation.updateMany({
      where: { invitedBy: userId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    }),
    luft.householdMember.deleteMany({ where: { userId } }),
    luft.household.deleteMany({ where: { ownerUserId: userId } }),
    luft.subscription.deleteMany({ where: { userId } }),
  ]);
}

/**
 * Closes an account that must be retained (financial records): the person
 * stops sharing, leaves or dissolves their household, and every Open Finance
 * connection and V2 authorization is revoked. Nothing is deleted.
 */
export async function closeLuftAccountData(db: LuftDb, userId: string) {
  const { luft } = db;
  const now = new Date();
  const owned = await luft.household.findUnique({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  await luft.$transaction([
    ...(owned
      ? [
          luft.householdMember.updateMany({
            where: { householdId: owned.id, status: 'ACTIVE' },
            data: {
              status: 'REMOVED',
              leftAt: now,
              permissions: PRIVATE_PERMISSIONS,
            },
          }),
          luft.householdInvitation.updateMany({
            where: { householdId: owned.id, status: 'PENDING' },
            data: { status: 'REVOKED', revokedAt: now },
          }),
          luft.sharedGoal.updateMany({
            where: { householdId: owned.id, status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
          }),
        ]
      : []),
    luft.householdMember.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'LEFT', leftAt: now, permissions: PRIVATE_PERMISSIONS },
    }),
    luft.sharedGoal.updateMany({
      where: { ownerUserId: userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    }),
    luft.openFinanceConnection.updateMany({
      where: { userId, status: { not: 'REVOKED' } },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        errorCode: 'ACCOUNT_CLOSED',
      },
    }),
    luft.consent.updateMany({
      where: {
        userId,
        revokedAt: null,
        kind: { in: ['HOUSEHOLD_SHARING', 'OPEN_FINANCE', 'TAX_ASSISTANCE'] },
      },
      data: { revokedAt: now, revokedReason: 'account_closed' },
    }),
    luft.subscription.updateMany({
      where: { userId, status: { in: ['SELECTED', 'ACTIVE'] } },
      data: { status: 'CANCELLED', endedAt: now },
    }),
    luft.notification.deleteMany({ where: { userId } }),
  ]);
}
