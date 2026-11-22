import { Injectable } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { taxCheck, type FinancialContext } from '../luft/journey';
import type { ProfileContext, ProfileSignals } from './facts';

/**
 * EXTENSION POINT — category and archetype catalog.
 *
 * Matching and analytics never read LUFT tables directly: they ask a
 * `ProfileSource`. Today the only implementation (`LuftProfileSource`) reads
 * `FinancialProfile.archetype` / `primaryGoal` and the encrypted journey
 * context, and reports `category: null` because the category catalog does not
 * exist yet. Rules on `category` therefore produce a "dato faltante" gap.
 *
 * When the LUFT domain publishes its category/archetype tables, change ONLY
 * `LuftProfileSource.signals` and `LuftProfileSource.segments` to return the
 * category code (and the versioned archetype), or bind another class to the
 * `PROFILE_SOURCE` token in `MatchingModule`. Category codes are compared
 * without case or accents; the catalog suggests JOVEN, ADULTO and FAMILIA.
 */
export const PROFILE_SOURCE = Symbol('MATCHING_PROFILE_SOURCE');

export interface UserSegment {
  category: string | null;
  archetype: string | null;
}

export interface ProfileSource {
  /** Everything matching needs from the LUFT profile of one person. */
  signals(userId: string): Promise<ProfileSignals>;
  /** Non-sensitive segmentation for aggregated analytics. */
  segments(userIds: readonly string[]): Promise<Map<string, UserSegment>>;
}

interface StoredJourney {
  context?: unknown;
  sections?: unknown;
  documents?: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class LuftProfileSource implements ProfileSource {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
  ) {}

  async signals(userId: string): Promise<ProfileSignals> {
    const profile = await this.db.luft.financialProfile.findUnique({
      where: { userId },
    });
    const state = record(profile?.demographicAnswers) as StoredJourney;
    const context = this.context(state.context);
    const documents = Array.isArray(state.documents)
      ? state.documents.flatMap((item: any) =>
          typeof item?.kind === 'string' ? [item.kind as string] : [],
        )
      : [];
    return {
      // No category catalog yet: see the extension point above.
      category: null,
      archetype: profile?.archetype ?? null,
      primaryGoal: profile?.primaryGoal ?? null,
      completedSections: Object.entries(record(state.sections))
        .filter(([, completedAt]) => Boolean(completedAt))
        .map(([key]) => key),
      context,
      documents,
      taxAlert: this.taxAlert(context),
    };
  }

  async segments(userIds: readonly string[]) {
    const result = new Map<string, UserSegment>();
    if (userIds.length === 0) return result;
    const profiles = await this.db.luft.financialProfile.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, archetype: true },
    });
    for (const profile of profiles)
      result.set(profile.userId, {
        category: null,
        archetype: profile.archetype ?? null,
      });
    return result;
  }

  private context(ciphertext: unknown): ProfileContext {
    if (typeof ciphertext !== 'string' || !ciphertext) return {};
    try {
      return record(JSON.parse(this.crypto.decrypt(ciphertext)));
    } catch {
      // An unreadable context is treated as "unknown", never as met.
      return {};
    }
  }

  /** Orientation only: `null` until income, assets and debts are complete. */
  private taxAlert(context: ProfileContext): boolean | null {
    try {
      const check = taxCheck(context as FinancialContext);
      return check.ready ? check.mayHaveToFile : null;
    } catch {
      return null;
    }
  }
}
