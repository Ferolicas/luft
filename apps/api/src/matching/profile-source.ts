import { Injectable } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import {
  targetTaxYear,
  taxCheck,
  type FinancialContext,
  type TaxRule,
} from '../luft/journey';
import type { ProfileContext, ProfileSignals } from './facts';

/**
 * Category and archetype source.
 *
 * Matching and analytics never read LUFT tables directly: they ask a
 * `ProfileSource`. `LuftProfileSource` reads the category of the person's
 * active route (`UserRoute` → `ServiceCategory.code`), the current archetype
 * and goal from `FinancialProfile`, and the encrypted journey context. A
 * person without an active route has `category: null`, so rules on `category`
 * produce a "dato faltante" gap instead of counting as met. Category codes
 * are compared without accents or case.
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
    const [route, rule] = await Promise.all([
      this.db.luft.userRoute.findFirst({
        where: { userId, status: 'ACTIVE' },
        orderBy: { startedAt: 'desc' },
        select: { category: { select: { code: true } } },
      }),
      this.activeTaxRule(),
    ]);
    return {
      category: route?.category.code ?? null,
      archetype: profile?.archetype ?? null,
      primaryGoal: profile?.primaryGoal ?? null,
      completedSections: Object.entries(record(state.sections))
        .filter(([, completedAt]) => Boolean(completedAt))
        .map(([key]) => key),
      context,
      documents,
      taxAlert: this.taxAlert(context, rule),
    };
  }

  async segments(userIds: readonly string[]) {
    const result = new Map<string, UserSegment>();
    if (userIds.length === 0) return result;
    const profiles = await this.db.luft.financialProfile.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, archetype: true },
    });
    const routes = await this.db.luft.userRoute.findMany({
      where: { userId: { in: [...userIds] }, status: 'ACTIVE' },
      orderBy: { startedAt: 'asc' },
      select: { userId: true, category: { select: { code: true } } },
    });
    const categories = new Map(
      routes.map((route) => [route.userId, route.category.code]),
    );
    for (const profile of profiles)
      result.set(profile.userId, {
        category: categories.get(profile.userId) ?? null,
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

  /** Rule version in force for the taxable year being diagnosed, if any. */
  private async activeTaxRule(): Promise<TaxRule | null> {
    const row = await this.db.luft.taxRuleVersion.findFirst({
      where: { taxYear: targetTaxYear(), status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    return row
      ? {
          id: row.id,
          taxYear: row.taxYear,
          version: row.version,
          uvtCOP: row.uvtCOP,
          wealthUvt: row.wealthUvt,
          incomeUvt: row.incomeUvt,
          cardSpendUvt: row.cardSpendUvt,
          purchasesUvt: row.purchasesUvt,
          depositsUvt: row.depositsUvt,
          sourceDocument: row.sourceDocument,
          effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
        }
      : null;
  }

  /**
   * Orientation only: `null` until income, assets and debts are complete or
   * while no rule version is in force for the taxable year.
   */
  private taxAlert(
    context: ProfileContext,
    rule: TaxRule | null,
  ): boolean | null {
    try {
      const check = taxCheck(context as FinancialContext, rule);
      return check.ready && check.available ? check.mayHaveToFile : null;
    } catch {
      return null;
    }
  }
}
