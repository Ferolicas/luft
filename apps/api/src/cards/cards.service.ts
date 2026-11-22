import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DatabaseService } from '../database/database.service';
import type {
  CardAccount,
  CardGuidance,
  CardPurchase,
} from '../generated/luft/client';
import { RealtimeService } from '../realtime/realtime.service';
import { capacityFacts } from '../route/facts';
import { ProfileFactsService } from '../route/profile-facts.service';
import {
  activePurchases,
  capacityView,
  cardInputSchema,
  cardSummary,
  cardTips,
  cardUpdateSchema,
  GUIDANCE_MEASURE_AFTER_DAYS,
  guidanceEffectiveness,
  monthlyCardInstallments,
  purchaseInputSchema,
  SCORE_DISCLAIMER,
  simulatePurchase,
  simulationInputSchema,
  utilization,
  utilizationBand,
  type CapacityFacts,
  type CardFacts,
  type CardTip,
  type PurchaseFacts,
} from './cards';

const MAX_CARDS = 10;
const MAX_PURCHASES_PER_CARD = 60;
type CardWithPurchases = CardAccount & { purchases: CardPurchase[] };

@Injectable()
export class CardsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly profileFacts: ProfileFactsService,
  ) {}

  private facts(card: CardAccount): CardFacts {
    return {
      id: card.id,
      issuer: card.issuer,
      creditLimitCOP: Number(card.creditLimitCOP),
      usedBalanceCOP: Number(card.usedBalanceCOP),
      statementDay: card.statementDay,
      paymentDay: card.paymentDay,
      minimumPaymentCOP:
        card.minimumPaymentCOP === null ? null : Number(card.minimumPaymentCOP),
      annualEffectiveRate:
        card.annualEffectiveRate === null
          ? null
          : Number(card.annualEffectiveRate),
    };
  }

  private purchaseFacts(purchases: CardPurchase[]): PurchaseFacts[] {
    return purchases.map((purchase) => ({
      amountCOP: Number(purchase.amountCOP),
      installments: purchase.installments,
      purchasedAt: purchase.purchasedAt,
      isCashAdvance: purchase.isCashAdvance,
    }));
  }

  private view(card: CardAccount) {
    const facts = this.facts(card);
    return {
      id: card.id,
      source: card.source,
      issuer: card.issuer,
      alias: card.alias,
      last4: card.last4,
      creditLimitCOP: facts.creditLimitCOP,
      usedBalanceCOP: facts.usedBalanceCOP,
      statementDay: card.statementDay,
      paymentDay: card.paymentDay,
      minimumPaymentCOP: facts.minimumPaymentCOP,
      annualEffectiveRatePercent:
        facts.annualEffectiveRate === null
          ? null
          : Math.round(facts.annualEffectiveRate * 10_000) / 100,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  }

  private purchaseView(purchase: CardPurchase, today: Date) {
    const [active] = activePurchases(this.purchaseFacts([purchase]), today);
    return {
      id: purchase.id,
      amountCOP: Number(purchase.amountCOP),
      installments: purchase.installments,
      remainingInstallments: active?.remainingInstallments ?? 0,
      purchasedAt: purchase.purchasedAt.toISOString().slice(0, 10),
      description: purchase.description,
      isCashAdvance: purchase.isCashAdvance,
    };
  }

  private guidanceView(guidance: CardGuidance) {
    return {
      id: guidance.id,
      cardId: guidance.cardId,
      code: guidance.code,
      severity: guidance.severity,
      title: guidance.title,
      body: guidance.body,
      variables: guidance.variables,
      status: guidance.status,
      shownAt: guidance.shownAt,
      respondedAt: guidance.respondedAt,
      baselineUtilizationPercent:
        guidance.baselineUtilization === null
          ? null
          : Number(guidance.baselineUtilization),
      measuredUtilizationPercent:
        guidance.measuredUtilization === null
          ? null
          : Number(guidance.measuredUtilization),
      effectiveness: guidance.effectiveness,
      measuredAt: guidance.measuredAt,
      disclaimer: SCORE_DISCLAIMER,
    };
  }

  private cards(userId: string): Promise<CardWithPurchases[]> {
    return this.db.luft.cardAccount.findMany({
      where: { userId, archivedAt: null },
      include: { purchases: { orderBy: { purchasedAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async card(userId: string, id: string): Promise<CardWithPurchases> {
    const card = await this.db.luft.cardAccount.findFirst({
      where: { id, userId, archivedAt: null },
      include: { purchases: { orderBy: { purchasedAt: 'desc' } } },
    });
    if (!card) throw new NotFoundException('Tarjeta no encontrada.');
    return card;
  }

  private async capacity(userId: string): Promise<CapacityFacts | null> {
    return capacityFacts((await this.profileFacts.load(userId)).input);
  }

  async list(user: AuthenticatedUser) {
    const cards = await this.cards(user.id);
    return { cards: cards.map((card) => this.view(card)) };
  }

  async create(user: AuthenticatedUser, body: unknown) {
    const input = cardInputSchema.parse(body);
    const count = await this.db.luft.cardAccount.count({
      where: { userId: user.id, archivedAt: null },
    });
    if (count >= MAX_CARDS)
      throw new BadRequestException(
        `Puedes registrar máximo ${MAX_CARDS} tarjetas.`,
      );
    const card = await this.db.luft.cardAccount.create({
      data: {
        userId: user.id,
        issuer: input.issuer,
        alias: input.alias,
        last4: input.last4,
        creditLimitCOP: BigInt(input.creditLimitCOP),
        usedBalanceCOP: BigInt(input.usedBalanceCOP),
        statementDay: input.statementDay,
        paymentDay: input.paymentDay,
        minimumPaymentCOP:
          input.minimumPaymentCOP === undefined
            ? undefined
            : BigInt(input.minimumPaymentCOP),
        annualEffectiveRate:
          input.annualEffectiveRatePercent === undefined
            ? undefined
            : input.annualEffectiveRatePercent / 100,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'cards.card.created',
      resource: 'CardAccount',
      resourceId: card.id,
      payload: { issuer: card.issuer, source: card.source },
    });
    return this.overview(user);
  }

  async update(user: AuthenticatedUser, id: string, body: unknown) {
    const input = cardUpdateSchema.parse(body);
    const card = await this.card(user.id, id);
    await this.db.luft.cardAccount.update({
      where: { id: card.id },
      data: {
        issuer: input.issuer,
        alias: input.alias,
        last4: input.last4,
        statementDay: input.statementDay,
        paymentDay: input.paymentDay,
        creditLimitCOP:
          input.creditLimitCOP === undefined
            ? undefined
            : BigInt(input.creditLimitCOP),
        usedBalanceCOP:
          input.usedBalanceCOP === undefined
            ? undefined
            : BigInt(input.usedBalanceCOP),
        minimumPaymentCOP:
          input.minimumPaymentCOP === undefined
            ? undefined
            : input.minimumPaymentCOP === null
              ? null
              : BigInt(input.minimumPaymentCOP),
        annualEffectiveRate:
          input.annualEffectiveRatePercent === undefined
            ? undefined
            : input.annualEffectiveRatePercent === null
              ? null
              : input.annualEffectiveRatePercent / 100,
      },
    });
    return this.overview(user);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const card = await this.card(user.id, id);
    await this.db.luft.cardAccount.update({
      where: { id: card.id },
      data: { archivedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'cards.card.removed',
      resource: 'CardAccount',
      resourceId: card.id,
    });
    return this.overview(user);
  }

  async addPurchase(user: AuthenticatedUser, cardId: string, body: unknown) {
    const input = purchaseInputSchema.parse(body);
    const card = await this.card(user.id, cardId);
    if (card.purchases.length >= MAX_PURCHASES_PER_CARD)
      throw new BadRequestException(
        `Puedes registrar máximo ${MAX_PURCHASES_PER_CARD} compras por tarjeta. Elimina las que ya terminaste de pagar.`,
      );
    if (input.purchasedAt.getTime() > Date.now() + 86_400_000)
      throw new BadRequestException(
        'La fecha de la compra no puede ser futura.',
      );
    await this.db.luft.$transaction([
      this.db.luft.cardPurchase.create({
        data: {
          cardId: card.id,
          userId: user.id,
          amountCOP: BigInt(input.amountCOP),
          installments: input.installments,
          purchasedAt: input.purchasedAt,
          description: input.description,
          isCashAdvance: input.isCashAdvance,
        },
      }),
      ...(input.applyToBalance
        ? [
            this.db.luft.cardAccount.update({
              where: { id: card.id },
              data: { usedBalanceCOP: { increment: BigInt(input.amountCOP) } },
            }),
          ]
        : []),
    ]);
    return this.overview(user);
  }

  async removePurchase(
    user: AuthenticatedUser,
    cardId: string,
    purchaseId: string,
  ) {
    const card = await this.card(user.id, cardId);
    const removed = await this.db.luft.cardPurchase.deleteMany({
      where: { id: purchaseId, cardId: card.id },
    });
    if (!removed.count) throw new NotFoundException('Compra no encontrada.');
    return this.overview(user);
  }

  /**
   * Keeps the recommendations in step with the user's numbers: new contextual
   * tips are recorded as shown, tips whose cause disappeared are resolved, and
   * answered tips get their effectiveness measured a cycle later.
   */
  private async syncGuidance(
    userId: string,
    cards: CardWithPurchases[],
    tips: CardTip[],
    today: Date,
  ) {
    const existing = await this.db.luft.cardGuidance.findMany({
      where: { userId },
      orderBy: { shownAt: 'desc' },
    });
    const percentOf = (cardId: string | null) => {
      const card = cards.find((item) => item.id === cardId);
      return card
        ? utilization(Number(card.usedBalanceCOP), Number(card.creditLimitCOP))
        : null;
    };
    const cooldown = today.getTime() - GUIDANCE_MEASURE_AFTER_DAYS * 86_400_000;
    const writes: Array<Promise<unknown>> = [];
    const created: Array<Promise<CardGuidance>> = [];
    for (const tip of tips) {
      const same = existing.filter(
        (row) => row.cardId === tip.cardId && row.code === tip.code,
      );
      const open = same.find((row) => row.status === 'SHOWN');
      if (open) {
        if (open.title !== tip.title || open.body !== tip.body)
          writes.push(
            this.db.luft.cardGuidance.update({
              where: { id: open.id },
              data: {
                title: tip.title,
                body: tip.body,
                severity: tip.severity,
                variables: tip.variables,
              },
            }),
          );
        continue;
      }
      // An answered tip is not repeated until its cycle was measured.
      const recent = same.find(
        (row) =>
          ['ACCEPTED', 'DISMISSED'].includes(row.status) &&
          (row.respondedAt?.getTime() ?? 0) > cooldown,
      );
      if (recent) continue;
      created.push(
        this.db.luft.cardGuidance.create({
          data: {
            userId,
            cardId: tip.cardId,
            code: tip.code,
            severity: tip.severity,
            title: tip.title,
            body: tip.body,
            variables: tip.variables,
            baselineUtilization: percentOf(tip.cardId) ?? undefined,
          },
        }),
      );
    }
    const current = new Set(tips.map((tip) => `${tip.cardId}|${tip.code}`));
    for (const row of existing) {
      const percent = percentOf(row.cardId);
      const measurable =
        percent !== null && row.baselineUtilization !== null && !row.measuredAt;
      const measured = measurable
        ? {
            measuredUtilization: percent,
            measuredAt: today,
            effectiveness: guidanceEffectiveness(
              Number(row.baselineUtilization),
              percent,
            ),
          }
        : {};
      if (row.status === 'SHOWN' && !current.has(`${row.cardId}|${row.code}`))
        writes.push(
          this.db.luft.cardGuidance.update({
            where: { id: row.id },
            data: { status: 'RESOLVED', respondedAt: today, ...measured },
          }),
        );
      else if (
        ['ACCEPTED', 'DISMISSED'].includes(row.status) &&
        measurable &&
        (row.respondedAt?.getTime() ?? Infinity) <= cooldown
      )
        writes.push(
          this.db.luft.cardGuidance.update({
            where: { id: row.id },
            data: measured,
          }),
        );
    }
    const fresh = await Promise.all(created);
    await Promise.all(writes);
    for (const guidance of fresh)
      if (guidance.severity !== 'INFO')
        this.realtime.toUser(userId, 'cards:guidance', {
          guidanceId: guidance.id,
          title: guidance.title,
          body: guidance.body,
        });
    return fresh.length || writes.length
      ? this.db.luft.cardGuidance.findMany({
          where: { userId },
          orderBy: { shownAt: 'desc' },
        })
      : existing;
  }

  async overview(user: AuthenticatedUser) {
    const today = new Date();
    const [cards, capacity, loans] = await Promise.all([
      this.cards(user.id),
      this.capacity(user.id),
      this.db.startif.loan.count({
        where: { userId: user.id, status: 'ACTIVE' },
      }),
    ]);
    const obligations = cards.length + loans;
    const tips = cards.flatMap((card) =>
      cardTips({
        card: this.facts(card),
        purchases: this.purchaseFacts(card.purchases),
        capacity,
        obligations,
        today,
      }),
    );
    const guidance = await this.syncGuidance(user.id, cards, tips, today);
    const limit = cards.reduce(
      (total, card) => total + Number(card.creditLimitCOP),
      0,
    );
    const used = cards.reduce(
      (total, card) => total + Number(card.usedBalanceCOP),
      0,
    );
    const percent = utilization(used, limit);
    const installments = cards.reduce(
      (total, card) =>
        total +
        monthlyCardInstallments(this.purchaseFacts(card.purchases), today),
      0,
    );
    const open = guidance.filter((row) => row.status === 'SHOWN');
    return {
      cards: cards.map((card) => ({
        ...this.view(card),
        summary: cardSummary(
          this.facts(card),
          this.purchaseFacts(card.purchases),
          today,
        ),
        purchases: card.purchases.map((purchase) =>
          this.purchaseView(purchase, today),
        ),
      })),
      totals: cards.length
        ? {
            creditLimitCOP: limit,
            usedBalanceCOP: used,
            availableCOP: Math.max(0, limit - used),
            utilizationPercent: percent,
            band: utilizationBand(percent),
            monthlyInstallmentsCOP: installments,
          }
        : null,
      capacity: capacityView(capacity, installments),
      obligations,
      recommendations: open.map((row) => this.guidanceView(row)),
      history: guidance
        .filter((row) => row.status !== 'SHOWN')
        .slice(0, 20)
        .map((row) => this.guidanceView(row)),
      disclaimer: SCORE_DISCLAIMER,
    };
  }

  async simulate(user: AuthenticatedUser, cardId: string, body: unknown) {
    const input = simulationInputSchema.parse(body);
    const [card, capacity] = await Promise.all([
      this.card(user.id, cardId),
      this.capacity(user.id),
    ]);
    return simulatePurchase({
      card: this.facts(card),
      purchases: this.purchaseFacts(card.purchases),
      capacity,
      amountCOP: input.amountCOP,
      installments: input.installments,
      isCashAdvance: input.isCashAdvance,
      today: new Date(),
    });
  }

  async respond(
    user: AuthenticatedUser,
    guidanceId: string,
    status: 'ACCEPTED' | 'DISMISSED',
  ) {
    const updated = await this.db.luft.cardGuidance.updateMany({
      where: { id: guidanceId, userId: user.id, status: 'SHOWN' },
      data: { status, respondedAt: new Date() },
    });
    if (!updated.count) {
      const exists = await this.db.luft.cardGuidance.findFirst({
        where: { id: guidanceId, userId: user.id },
      });
      if (!exists) throw new NotFoundException('Recomendación no encontrada.');
      throw new ConflictException('Ya respondiste esta recomendación.');
    }
    return this.overview(user);
  }
}
