import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { MATCH_ENGINE_VERSION } from './fact-catalog';
import { canonicalJson, parseSnapshot } from './facts';
import {
  evaluatePolicy,
  explain,
  rulesFromSnapshot,
  storedExplanation,
  type StoredExplanation,
} from './rule-engine';
import {
  isoDay,
  PAGE_SIZE,
  pageNumber,
  paginated,
  parseId,
} from './validation';

interface ProductSnapshot {
  institutionName: string;
  name: string;
  kind: string;
}

/**
 * Risk review of match runs. Staff never receives the person's fact values:
 * a run is audited through its stored explanations and by re-executing the
 * engine on the encrypted snapshot to prove the result is reproducible.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async runs(query: { page?: string; userId?: string }) {
    const page = pageNumber(query.page);
    const where = query.userId ? { userId: parseId(query.userId) } : {};
    const [rows, total] = await Promise.all([
      this.db.scoring.matchRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          userId: true,
          createdAt: true,
          engineVersion: true,
          trigger: true,
          productsEvaluated: true,
          eligibleCount: true,
        },
      }),
      this.db.scoring.matchRun.count({ where }),
    ]);
    return paginated(rows, total, page);
  }

  async run(id: string) {
    const run = await this.load(id);
    return {
      id: run.id,
      userId: run.userId,
      createdAt: run.createdAt,
      engineVersion: run.engineVersion,
      trigger: run.trigger,
      factsHash: run.factsHash,
      productsEvaluated: run.productsEvaluated,
      results: run.results.map((result) => {
        const product = result.productSnapshot as unknown as ProductSnapshot;
        const stored = result.explanation as unknown as StoredExplanation;
        return {
          id: result.id,
          institutionId: result.institutionId,
          institutionName: product.institutionName,
          productId: result.productId,
          productName: product.name,
          productKind: product.kind,
          policyVersionId: result.policyVersionId,
          policyVersion: result.policyVersionNumber,
          policyEffectiveFrom: isoDay(result.policyEffectiveFrom),
          status: result.status,
          fitPercent: result.fitPercent,
          presentable: result.presentable,
          totals: stored.totals,
          explanation: explain(stored, 'staff'),
        };
      }),
    };
  }

  /**
   * Re-executes the engine with the stored snapshot and the stored rule copy
   * and compares against what was recorded at the time.
   */
  async verify(actor: AuthenticatedUser, id: string) {
    const run = await this.load(id);
    let canonical: string | null = null;
    try {
      canonical = this.crypto.decrypt(run.factsCiphertext);
    } catch {
      canonical = null;
    }
    const snapshot = canonical ? parseSnapshot(canonical) : null;
    const factsHashValid =
      canonical !== null &&
      snapshot !== null &&
      this.crypto.hash(canonical) === run.factsHash &&
      canonicalJson(snapshot) === canonical;
    const results = run.results.map((result) => {
      const product = result.productSnapshot as unknown as ProductSnapshot;
      const recomputed = snapshot
        ? evaluatePolicy(
            snapshot.facts,
            rulesFromSnapshot(result.rulesSnapshot),
          )
        : null;
      const same =
        recomputed !== null &&
        recomputed.status === result.status &&
        recomputed.fitPercent === result.fitPercent &&
        recomputed.presentable === result.presentable &&
        canonicalJson(storedExplanation(recomputed)) ===
          canonicalJson(result.explanation);
      return {
        resultId: result.id,
        productName: product.name,
        policyVersion: result.policyVersionNumber,
        reproducible: same,
        stored: { status: result.status, fitPercent: result.fitPercent },
        recomputed: recomputed
          ? { status: recomputed.status, fitPercent: recomputed.fitPercent }
          : null,
      };
    });
    const reproducible =
      factsHashValid && results.every((result) => result.reproducible);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'matching.run.verified',
      resource: 'MatchRun',
      resourceId: run.id,
      payload: {
        subjectUserId: run.userId,
        reproducible,
        factsHashValid,
        results: results.length,
      },
    });
    return {
      runId: run.id,
      engineVersion: run.engineVersion,
      currentEngineVersion: MATCH_ENGINE_VERSION,
      sameEngineVersion: run.engineVersion === MATCH_ENGINE_VERSION,
      factsHashValid,
      reproducible,
      results,
    };
  }

  private async load(id: string) {
    const run = await this.db.scoring.matchRun.findUnique({
      where: { id: parseId(id, 'Ejecución no encontrada.') },
      include: { results: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Ejecución no encontrada.');
    return run;
  }
}
