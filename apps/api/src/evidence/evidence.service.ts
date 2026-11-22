import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import type { Evidence } from '../generated/luft/client';
import { isUniqueViolation } from '../luft/http';
import { profileBlocks } from '../luft/journey';
import type { ProfileBundle } from '../route/profile-facts.service';
import {
  buildEvidence,
  countVerified,
  effectiveStatus,
  EVIDENCE_SOURCE_LABELS,
  stableStringify,
  type EvidenceDraft,
  type EvidenceSourceKind,
} from './evidence';

const WITHDRAWABLE = ['DOCUMENT_UPLOADED', 'PROFILE_SECTION'];

@Injectable()
export class EvidenceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
  ) {}

  private consentId(bundle: ProfileBundle, draft: EvidenceDraft) {
    if (!draft.consentKind) return null;
    if (draft.consentKind === 'STARTIF_CREDIT') return bundle.startifConsentId;
    const candidates = bundle.consents.filter(
      (consent) => consent.kind === draft.consentKind,
    );
    return (
      candidates.find(
        (consent) => consent.acceptedAt.getTime() <= draft.occurredAt.getTime(),
      )?.id ??
      candidates.at(-1)?.id ??
      null
    );
  }

  /**
   * Idempotent: the same facts leave the table untouched. New facts create
   * evidence, changed facts update it and removed sources are withdrawn.
   */
  async sync(bundle: ProfileBundle): Promise<Evidence[]> {
    const drafts = buildEvidence({
      kyc: bundle.kyc,
      inquiries: bundle.inquiries.map((row) => ({
        id: row.id,
        type: row.type,
        provider: row.provider,
        status: row.status,
        score: row.score,
        existingHistory: row.existingHistory,
        completedAt: row.completedAt,
      })),
      sections: bundle.state.sections ?? {},
      documents: bundle.state.documents ?? [],
      modules: bundle.modules,
      lessons: bundle.lessons,
      installments: bundle.applications.flatMap(
        (application) => application.loan?.installments ?? [],
      ),
      taxCase: bundle.taxCase
        ? {
            id: bundle.taxCase.id,
            taxYear: bundle.taxCase.taxYear,
            status: bundle.taxCase.status,
            verifiedAt: bundle.taxCase.verifiedAt,
            verifiedBy: bundle.taxCase.verifiedBy,
          }
        : null,
    });
    const existing = await this.db.luft.evidence.findMany({
      where: { userId: bundle.userId },
    });
    const byKey = new Map(
      existing.map((row) => [`${row.type}|${row.sourceRef}`, row]),
    );
    const seen = new Set<string>();
    const creates: EvidenceDraft[] = [];
    const writes: Array<Promise<unknown>> = [];
    for (const draft of drafts) {
      const key = `${draft.type}|${draft.sourceRef}`;
      seen.add(key);
      const current = byKey.get(key);
      if (!current) {
        creates.push(draft);
        continue;
      }
      const changed =
        current.status !== draft.status ||
        current.label !== draft.label ||
        current.occurredAt.getTime() !== draft.occurredAt.getTime() ||
        (current.validUntil?.getTime() ?? null) !==
          (draft.validUntil?.getTime() ?? null);
      if (changed)
        writes.push(
          this.db.luft.evidence.update({
            where: { id: current.id },
            data: {
              status: draft.status,
              label: draft.label,
              occurredAt: draft.occurredAt,
              validUntil: draft.validUntil,
              validatedBy: draft.validatedBy,
              validatedAt:
                draft.status === 'VERIFIED' ? draft.occurredAt : null,
            },
          }),
        );
    }
    for (const row of existing)
      if (
        WITHDRAWABLE.includes(row.type) &&
        row.status !== 'WITHDRAWN' &&
        !seen.has(`${row.type}|${row.sourceRef}`)
      )
        writes.push(
          this.db.luft.evidence.update({
            where: { id: row.id },
            data: { status: 'WITHDRAWN' },
          }),
        );
    if (creates.length)
      writes.push(
        this.db.luft.evidence.createMany({
          skipDuplicates: true,
          data: creates.map((draft) => ({
            userId: bundle.userId,
            type: draft.type,
            sourceKind: draft.sourceKind,
            sourceRef: draft.sourceRef,
            label: draft.label,
            status: draft.status,
            occurredAt: draft.occurredAt,
            validUntil: draft.validUntil,
            validatedBy: draft.validatedBy,
            validatedAt: draft.status === 'VERIFIED' ? draft.occurredAt : null,
            consentId: this.consentId(bundle, draft),
            value:
              draft.value && !draft.sensitive
                ? (draft.value as object)
                : undefined,
            valueCiphertext:
              draft.value && draft.sensitive
                ? this.crypto.encrypt(JSON.stringify(draft.value))
                : undefined,
          })),
        }),
      );
    if (!writes.length) return existing;
    await Promise.all(writes);
    return this.db.luft.evidence.findMany({ where: { userId: bundle.userId } });
  }

  summary(evidences: Evidence[]) {
    const active = evidences.filter((row) => row.status !== 'WITHDRAWN');
    return {
      verified: countVerified(active),
      total: active.length,
    };
  }

  view(evidence: Evidence) {
    return {
      id: evidence.id,
      type: evidence.type,
      label: evidence.label,
      source: evidence.sourceKind,
      sourceLabel:
        EVIDENCE_SOURCE_LABELS[evidence.sourceKind as EvidenceSourceKind] ??
        evidence.sourceKind,
      status: effectiveStatus(evidence),
      occurredAt: evidence.occurredAt,
      validUntil: evidence.validUntil,
      validatedBy: evidence.validatedBy,
      validatedAt: evidence.validatedAt,
      consentId: evidence.consentId,
      sensitive: Boolean(evidence.valueCiphertext),
    };
  }

  list(evidences: Evidence[]) {
    const items = evidences
      .filter((row) => row.status !== 'WITHDRAWN')
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map((row) => this.view(row));
    return { ...this.summary(evidences), items };
  }

  /**
   * Versioned photograph of the financial profile. A new version is stored
   * only when the content really changed, so matching and archetype
   * decisions can be reproduced with the data that existed at that moment.
   */
  async snapshot(
    bundle: ProfileBundle,
    reason: string,
    extra: {
      categoryCode: string | null;
      archetypeCode: string | null;
      archetypeVersion: number | null;
      stage: string | null;
    },
  ) {
    const { state, profile } = bundle;
    const blocks = profileBlocks(state.sections ?? {}, state.documents ?? []);
    const summary = {
      categoryCode: extra.categoryCode,
      archetypeCode: extra.archetypeCode,
      archetypeVersion: extra.archetypeVersion,
      stage: extra.stage,
      classified: Boolean(state.classification),
      completionPercent: blocks.percent,
      blocks: blocks.blocks,
      hasScore: profile?.currentScore != null,
      lessonsCompleted: bundle.lessons.length,
      documents: (state.documents ?? []).map((item) => item.kind).sort(),
    };
    const payload = {
      classification: state.classification
        ? {
            goal: state.classification.goal,
            creditExperience: state.classification.creditExperience,
          }
        : null,
      context: bundle.context,
      sections: state.sections ?? {},
      documents: (state.documents ?? []).map((item) => ({
        id: item.id,
        kind: item.kind,
        sha256: item.sha256,
      })),
      currentScore: profile?.currentScore ?? null,
      existingHistory: profile?.existingHistory ?? null,
      summary,
    };
    const serialized = stableStringify(payload);
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    const latest = await this.db.luft.financialProfileSnapshot.findFirst({
      where: { userId: bundle.userId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, contentHash: true },
    });
    if (latest?.contentHash === contentHash) return latest;
    try {
      return await this.db.luft.financialProfileSnapshot.create({
        data: {
          userId: bundle.userId,
          version: (latest?.version ?? 0) + 1,
          reason: reason.slice(0, 80),
          summary,
          payloadCiphertext: this.crypto.encrypt(serialized),
          contentHash,
        },
        select: { id: true, version: true, contentHash: true },
      });
    } catch (error) {
      // Another request stored the same version at the same time.
      if (isUniqueViolation(error)) return latest;
      throw error;
    }
  }
}
