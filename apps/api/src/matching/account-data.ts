import type { DatabaseService } from '../database/database.service';

/**
 * Account closure/erasure for the matching domain. Presentations that were
 * already delivered to an entity (and the run that backs them) are kept as
 * evidence of an authorization the person gave; everything else is deleted.
 */
export async function eraseMatchingAccountData(
  db: Pick<DatabaseService, 'scoring'>,
  userId: string,
) {
  const kept = await db.scoring.matchPresentation.findMany({
    where: { userId, presentedAt: { not: null } },
    select: { result: { select: { runId: true } } },
  });
  const keptRuns = [...new Set(kept.map((row) => row.result.runId))];
  await db.scoring.$transaction([
    db.scoring.matchPresentation.deleteMany({
      where: { userId, presentedAt: null },
    }),
    db.scoring.matchRun.deleteMany({
      where: { userId, id: { notIn: keptRuns } },
    }),
    db.scoring.matchingSupplement.deleteMany({ where: { userId } }),
    db.scoring.allyReferral.deleteMany({ where: { userId } }),
  ]);
  return { retainedPresentations: kept.length };
}
