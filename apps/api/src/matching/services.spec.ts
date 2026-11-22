import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

jest.mock('../database/database.service', () => ({
  DatabaseService: class {},
}));

import type { AuthenticatedUser } from '../auth/auth.types';
import { CryptoService } from '../common/crypto.service';
import { Role } from '../generated/identity/enums';
import { canonicalJson, type ProfileSignals } from './facts';
import { MatchingService } from './matching.service';
import { PolicyService } from './policy.service';
import { PresentationService } from './presentation.service';
import { ReviewService } from './review.service';
import { rulesFromSnapshot } from './rule-engine';

const crypto = new CryptoService({
  getOrThrow: () => 'unit-test-secret-with-enough-length-0123456789',
} as never);

const person = (role: Role, id: string = randomUUID()): AuthenticatedUser => ({
  id,
  email: `${id.slice(0, 8)}@example.com`,
  username: id.slice(0, 8),
  fullName: 'Persona de Prueba',
  stratum: 3,
  role,
  status: 'ACTIVE',
});

/** Reads the HTTP body of a Nest exception thrown by `action`. */
async function failure(action: Promise<unknown>) {
  try {
    await action;
  } catch (error) {
    return error as { getResponse(): Record<string, unknown> };
  }
  throw new Error('Se esperaba un error');
}

type Row = Record<string, any>;
/** Minimal Prisma-like filter: equality, `in`, `not` and `notIn`. */
const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    const value = row[key];
    if (
      condition &&
      typeof condition === 'object' &&
      !(condition instanceof Date)
    ) {
      if ('in' in condition) return (condition.in as unknown[]).includes(value);
      if ('notIn' in condition)
        return !(condition.notIn as unknown[]).includes(value);
      if ('not' in condition) return value !== condition.not;
      return true;
    }
    return value === condition;
  });

const ruleRow = (input: Row): Row => ({
  id: randomUUID(),
  position: 1,
  operator: 'gte',
  kind: 'REQUISITO',
  weight: 1,
  label: `Regla ${input.field}`,
  internal: false,
  exceptionAllowed: false,
  exceptionApprovalLevel: null,
  ...input,
});

const institution = {
  id: randomUUID(),
  name: 'Banco Ejemplo',
  kind: 'BANCO',
  active: true,
};
const productRow = (name = 'Libre inversión joven'): Row => ({
  id: randomUUID(),
  institutionId: institution.id,
  institution,
  name,
  kind: 'LIBRE_INVERSION',
  description: null,
  minAmountCOP: 1_000_000n,
  maxAmountCOP: 20_000_000n,
  minTermMonths: 6,
  maxTermMonths: 60,
  referenceRateEA: { toString: () => '0.28500' },
  guarantees: [],
  requiredDocuments: ['Cédula'],
  channel: 'Digital',
  active: true,
});

const versionRow = (input: Row = {}): Row => {
  const product = input.product ?? productRow();
  return {
    id: randomUUID(),
    productId: product.id,
    product,
    version: 1,
    status: 'BORRADOR',
    effectiveFrom: null,
    effectiveTo: null,
    sourceDocument: 'Manual de crédito 2026',
    sourceUrl: null,
    notes: null,
    responsibleUserId: 'author',
    createdBy: 'author',
    updatedBy: 'author',
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedByRole: null,
    approvedAt: null,
    approvalIndependence: null,
    activatedBy: null,
    activatedAt: null,
    supersededById: null,
    supersededAt: null,
    suspendedBy: null,
    suspendedAt: null,
    suspensionReason: null,
    clonedFromId: null,
    createdAt: new Date('2026-11-01T12:00:00Z'),
    updatedAt: new Date('2026-11-01T12:00:00Z'),
    rules: [ruleRow({ field: 'score', value: 600 })],
    events: [],
    ...input,
    _count: { rules: (input.rules ?? [1]).length },
  };
};

// ---------------------------------------------------------------- políticas

function policyFixture(
  current: Row,
  options: { previous?: Row; others?: number } = {},
) {
  const tx = {
    policyVersion: {
      findFirst: jest.fn().mockResolvedValue(options.previous ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    policyVersionEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const matchResult = {
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
  const db = {
    scoring: {
      policyVersion: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
      policyRule: {
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      matchResult,
      $transaction: jest.fn((argument: unknown) =>
        typeof argument === 'function'
          ? (argument as (client: typeof tx) => Promise<unknown>)(tx)
          : Promise.all(argument as Promise<unknown>[]),
      ),
    },
    identity: {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'RISK' }),
        count: jest.fn().mockResolvedValue(options.others ?? 1),
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new PolicyService(db as never, audit as never);
  return { service, db, tx, audit, matchResult };
}

describe('PolicyService · transitions', () => {
  const rules = {
    rules: [{ field: 'score', operator: 'gte', value: 650, kind: 'REQUISITO' }],
  };

  it('refuses to change the rules of a version that is no longer a draft', async () => {
    for (const status of [
      'REVISION',
      'APROBADA',
      'VIGENTE',
      'SUSTITUIDA',
      'SUSPENDIDA',
    ]) {
      const current = versionRow({ status });
      const { service, db } = policyFixture(current);
      const error = await failure(
        service.replaceRules(person(Role.RISK), current.id, rules),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().code).toBe('policy_not_editable');
      expect(db.scoring.policyRule.deleteMany).not.toHaveBeenCalled();
      expect(db.scoring.policyRule.createMany).not.toHaveBeenCalled();
      await expect(
        service.updateVersion(person(Role.RISK), current.id, {
          sourceDocument: 'Otro documento',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.deleteVersion(person(Role.RISK), current.id),
      ).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('rejects a transition outside the lifecycle', async () => {
    const current = versionRow({ status: 'BORRADOR' });
    const { service, tx } = policyFixture(current);
    const error = await failure(
      service.transition(person(Role.RISK), current.id, { to: 'VIGENTE' }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'invalid_transition',
      from: 'BORRADOR',
      allowed: ['REVISION'],
    });
    expect(tx.policyVersion.updateMany).not.toHaveBeenCalled();
  });

  it('does not send an incomplete draft to review', async () => {
    const current = versionRow({ rules: [] });
    const { service, tx } = policyFixture(current);
    const error = await failure(
      service.transition(person(Role.RISK), current.id, { to: 'REVISION' }),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      code: 'policy_incomplete',
      issues: ['Agrega al menos una regla.'],
    });
    expect(tx.policyVersion.updateMany).not.toHaveBeenCalled();
  });

  it('blocks the author from approving while someone else can', async () => {
    const current = versionRow({ status: 'REVISION' });
    const { service, tx } = policyFixture(current, { others: 2 });
    const error = await failure(
      service.transition(person(Role.RISK, 'author'), current.id, {
        to: 'APROBADA',
      }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().code).toBe('independent_approval_required');
    expect(tx.policyVersion.updateMany).not.toHaveBeenCalled();
  });

  it('records the approver, its role and the independence of the approval', async () => {
    const current = versionRow({ status: 'REVISION' });
    const { service, tx, audit } = policyFixture(current);
    const approver = person(Role.SUPERADMIN);
    await service.transition(approver, current.id, { to: 'APROBADA' });
    expect(tx.policyVersion.updateMany).toHaveBeenCalledWith({
      where: { id: current.id, status: 'REVISION' },
      data: expect.objectContaining({
        status: 'APROBADA',
        approvedBy: approver.id,
        approvedByRole: 'SUPERADMIN',
        approvalIndependence: 'OTRO_ROL',
        approvedAt: expect.any(Date),
      }),
    });
    expect(tx.policyVersionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'approved',
        fromStatus: 'REVISION',
        toStatus: 'APROBADA',
        actorUserId: approver.id,
        actorRole: 'SUPERADMIN',
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'matching.policy_version.approved',
        actorUserId: approver.id,
        resourceId: current.id,
      }),
    );
  });

  it('flags a self-approval when nobody else could approve', async () => {
    const current = versionRow({ status: 'REVISION' });
    const { service, tx } = policyFixture(current, { others: 0 });
    await service.transition(person(Role.SUPERADMIN, 'author'), current.id, {
      to: 'APROBADA',
    });
    expect(tx.policyVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvalIndependence: 'MISMA_PERSONA',
        }),
      }),
    );
  });

  it('supersedes the previous version when a new one comes into force', async () => {
    const product = productRow();
    const previous = versionRow({ product, version: 1, status: 'VIGENTE' });
    const current = versionRow({
      product,
      version: 2,
      status: 'APROBADA',
      approvedBy: 'approver',
    });
    const { service, tx, audit, matchResult } = policyFixture(current, {
      previous,
    });
    await service.transition(person(Role.RISK), current.id, { to: 'VIGENTE' });

    expect(tx.policyVersion.findFirst).toHaveBeenCalledWith({
      where: {
        productId: product.id,
        status: 'VIGENTE',
        id: { not: current.id },
      },
    });
    expect(tx.policyVersion.update).toHaveBeenCalledWith({
      where: { id: previous.id },
      data: expect.objectContaining({
        status: 'SUSTITUIDA',
        supersededById: current.id,
        supersededAt: expect.any(Date),
        effectiveTo: expect.any(Date),
      }),
    });
    expect(tx.policyVersion.updateMany).toHaveBeenCalledWith({
      where: { id: current.id, status: 'APROBADA' },
      data: expect.objectContaining({
        status: 'VIGENTE',
        effectiveFrom: expect.any(Date),
        activatedAt: expect.any(Date),
      }),
    });
    // The old version is superseded BEFORE the new one becomes VIGENTE.
    expect(tx.policyVersion.update.mock.invocationCallOrder[0]).toBeLessThan(
      tx.policyVersion.updateMany.mock.invocationCallOrder[0],
    );
    const actions = audit.record.mock.calls.map(([event]) => event.action);
    expect(actions).toEqual([
      'matching.policy_version.activated',
      'matching.policy_version.superseded',
    ]);
    // Historical results are never rewritten by a new version.
    for (const method of Object.values(matchResult))
      expect(method).not.toHaveBeenCalled();
  });

  it('does not activate with a future start date or without approval', async () => {
    const current = versionRow({ status: 'APROBADA', approvedBy: 'approver' });
    const { service } = policyFixture(current);
    const future = await failure(
      service.transition(person(Role.RISK), current.id, {
        to: 'VIGENTE',
        effectiveFrom: '2999-01-01',
      }),
    );
    expect(future.getResponse().code).toBe('effective_from_in_future');

    const unapproved = versionRow({ status: 'APROBADA', approvedBy: null });
    const second = policyFixture(unapproved);
    const error = await failure(
      second.service.transition(person(Role.RISK), unapproved.id, {
        to: 'VIGENTE',
      }),
    );
    expect(error.getResponse().code).toBe('approval_required');
  });

  it('asks for a reason to suspend and detects a concurrent change', async () => {
    const current = versionRow({ status: 'VIGENTE', approvedBy: 'approver' });
    const { service, tx } = policyFixture(current);
    const error = await failure(
      service.transition(person(Role.RISK), current.id, { to: 'SUSPENDIDA' }),
    );
    expect(error.getResponse().code).toBe('note_required');
    tx.policyVersion.updateMany.mockResolvedValueOnce({ count: 0 });
    const stale = await failure(
      service.transition(person(Role.RISK), current.id, {
        to: 'SUSPENDIDA',
        note: 'La entidad retiró el producto.',
      }),
    );
    expect(stale).toBeInstanceOf(ConflictException);
    expect(stale.getResponse().code).toBe('policy_changed');
  });
});

// ------------------------------------------------------------------ matching

const signals = (input: Partial<ProfileSignals> = {}): ProfileSignals => ({
  category: null,
  archetype: 'CONSTRUCTOR',
  primaryGoal: 'IMPROVE_SCORE',
  completedSections: ['employment', 'income', 'debts'],
  context: {
    employment: { situation: 'EMPLEADO', contractType: 'LABORAL' },
    income: { sources: [{ kind: 'SALARIO', monthlyCOP: 2_517_333 }] },
    debts: {
      totalDebtCOP: 3_000_000,
      fixedExpensesMonthlyCOP: 800_000,
      cardSpendMonthlyCOP: 200_000,
    },
  },
  documents: ['BANK_STATEMENTS'],
  taxAlert: false,
  ...input,
});

function matchingFixture(options: {
  versions: Row[];
  consent?: boolean;
  profile?: ProfileSignals;
}) {
  const store = {
    versions: options.versions,
    runs: [] as Row[],
    results: [] as Row[],
    presentations: [] as Row[],
  };
  const withRelations = (result: Row) => ({
    ...result,
    run: store.runs.find((run) => run.id === result.runId),
    presentation:
      store.presentations.find((row) => row.resultId === result.id) ?? null,
  });
  const scoring = {
    matchingSupplement: { findUnique: jest.fn().mockResolvedValue(null) },
    policyVersion: {
      findMany: jest.fn(({ where }: Row) =>
        Promise.resolve(
          store.versions.filter((version) =>
            where?.status
              ? version.status === where.status
              : matches(version, { id: where?.id }),
          ),
        ),
      ),
    },
    matchRun: {
      create: jest.fn(({ data }: Row) => {
        const run = {
          ...data,
          id: randomUUID(),
          createdAt: new Date(Date.now() + store.runs.length),
          results: undefined,
        };
        store.runs.push(run);
        for (const result of data.results.create as Row[])
          store.results.push({
            ...result,
            id: randomUUID(),
            runId: run.id,
            createdAt: run.createdAt,
          });
        return Promise.resolve({ id: run.id });
      }),
      findFirst: jest.fn(({ where, include }: Row) => {
        const found = [...store.runs]
          .reverse()
          .find((run) => matches(run, where));
        if (!found) return Promise.resolve(null);
        return Promise.resolve(
          include
            ? {
                ...found,
                results: store.results
                  .filter((result) => result.runId === found.id)
                  .map(withRelations),
              }
            : found,
        );
      }),
      findUnique: jest.fn(({ where }: Row) => {
        const found = store.runs.find((run) => run.id === where.id);
        return Promise.resolve(
          found
            ? {
                ...found,
                results: store.results.filter(
                  (result) => result.runId === found.id,
                ),
              }
            : null,
        );
      }),
    },
    matchResult: {
      findFirst: jest.fn(({ where }: Row) => {
        const found = store.results.find((result) => matches(result, where));
        return Promise.resolve(found ? withRelations(found) : null);
      }),
    },
    matchPresentation: {
      create: jest.fn(({ data }: Row) => {
        const row = {
          status: 'AUTORIZADA',
          authorizedAt: new Date(),
          revokedAt: null,
          presentedAt: null,
          decidedAt: null,
          approvedAmountCOP: null,
          approvedRateEA: null,
          approvedTermMonths: null,
          finalProductName: null,
          decisionReason: null,
          ...data,
          id: randomUUID(),
        };
        store.presentations.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where }: Row) =>
        Promise.resolve(
          store.presentations.filter((row) => matches(row, where)),
        ),
      ),
      findFirst: jest.fn(({ where }: Row) => {
        const found = store.presentations.find((row) => matches(row, where));
        return Promise.resolve(
          found
            ? {
                ...found,
                result: store.results.find((row) => row.id === found.resultId),
              }
            : null,
        );
      }),
      findUniqueOrThrow: jest.fn(({ where }: Row) =>
        Promise.resolve(store.presentations.find((row) => row.id === where.id)),
      ),
      updateMany: jest.fn(({ where, data }: Row) => {
        const found = store.presentations.filter((row) => matches(row, where));
        for (const row of found) Object.assign(row, data);
        return Promise.resolve({ count: found.length });
      }),
    },
  };
  const db = {
    scoring,
    luft: {
      consent: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.consent === false ? null : { id: 'c' }),
      },
      scoreInquiry: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ score: 640, existingHistory: true }),
      },
      financialProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    },
    startif: { loan: { findMany: jest.fn().mockResolvedValue([]) } },
    identity: {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          fullName: 'Ana Pérez',
          email: 'ana@example.com',
          phone: '+573001112233',
          documentCiphertext: crypto.encrypt('1020304050'),
        }),
      },
    },
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const realtime = { toUser: jest.fn(), toRole: jest.fn() };
  const profiles = {
    signals: jest.fn().mockResolvedValue(options.profile ?? signals()),
    segments: jest.fn(),
  };
  const policies = new PolicyService(db as never, audit as never);
  const service = new MatchingService(
    db as never,
    crypto,
    audit as never,
    realtime as never,
    policies,
    profiles,
  );
  const review = new ReviewService(db as never, crypto, audit as never);
  return { service, review, db, store, audit, realtime };
}

const inForce = (input: Row = {}) =>
  versionRow({
    status: 'VIGENTE',
    approvedBy: 'approver',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    ...input,
  });

describe('MatchingService · run', () => {
  it('lists what is missing instead of running without consent or profile', async () => {
    const { service, store, audit } = matchingFixture({
      versions: [inForce()],
      consent: false,
      profile: signals({ archetype: null, completedSections: ['employment'] }),
    });
    const user = person(Role.USER);
    const error = await failure(service.run(user, {}));
    expect(error).toBeInstanceOf(BadRequestException);
    const body = error.getResponse() as { code: string; missing: Row[] };
    expect(body.code).toBe('matching_requirements_missing');
    expect(body.missing.map((item) => item.code)).toEqual([
      'DATA_PROCESSING',
      'ARCHETYPE',
      'SECTION_INCOME',
      'SECTION_DEBTS',
    ]);
    expect(store.runs).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
    expect((await service.latest(user)).run).toBeNull();
  });

  it('stores the policy version, a copy of its rules and encrypted facts', async () => {
    const version = inForce({
      version: 4,
      rules: [
        ruleRow({ field: 'monthlyIncomeCOP', value: 2_000_000, position: 1 }),
        ruleRow({
          field: 'score',
          value: 700,
          position: 2,
          internal: true,
          label: 'Puntaje interno',
        }),
      ],
    });
    const { service, store, audit, realtime } = matchingFixture({
      versions: [version],
    });
    const user = person(Role.USER);
    const view = await service.run(user, { requestedAmountCOP: 5_000_000 });

    const [run] = store.runs;
    const [result] = store.results;
    expect(result).toMatchObject({
      userId: user.id,
      policyVersionId: version.id,
      policyVersionNumber: 4,
      productId: version.productId,
      institutionId: institution.id,
      status: 'CON_BRECHAS',
      fitPercent: 50,
      presentable: false,
    });
    expect(rulesFromSnapshot(result.rulesSnapshot)).toEqual(
      new PolicyService({} as never, {} as never).engineRules(version.rules),
    );
    // Facts: encrypted at rest, hashed, and absent from every plain column.
    expect(run.factsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.factsCiphertext.startsWith('v1.')).toBe(true);
    const json = (value: unknown) =>
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      );
    const plain = json({ ...run, factsCiphertext: '' }) + json(result);
    expect(plain).not.toContain('2517333');
    expect(JSON.stringify(result.explanation)).not.toContain('"actual"');
    const facts = JSON.parse(crypto.decrypt(run.factsCiphertext));
    expect(facts.facts).toMatchObject({
      monthlyIncomeCOP: 2_517_333,
      score: 640,
      requestedAmountCOP: 5_000_000,
      category: null,
    });
    expect(crypto.hash(crypto.decrypt(run.factsCiphertext))).toBe(
      run.factsHash,
    );

    // The audit trail records the run without the person's values.
    const event = audit.record.mock.calls[0][0];
    expect(event).toMatchObject({
      action: 'matching.run.created',
      actorUserId: user.id,
      resourceId: run.id,
    });
    expect(JSON.stringify(event)).not.toContain('2517333');
    expect(realtime.toUser).toHaveBeenCalledWith(user.id, 'matching:updated', {
      runId: run.id,
    });

    // The person sees their own value on public rules, never internal detail.
    const [shown] = view.results;
    expect(shown.policy).toMatchObject({ versionId: version.id, version: 4 });
    expect(shown.explanation.passed[0]).toMatchObject({
      field: 'monthlyIncomeCOP',
      actual: 2_517_333,
    });
    expect(shown.explanation.gaps[0]).toMatchObject({
      internal: true,
      label: 'Criterio interno de la entidad',
      field: null,
      expected: null,
      actual: null,
    });
    expect(JSON.stringify(view)).not.toContain('Puntaje interno');
    expect(JSON.stringify(view)).not.toMatch(/commission|agreementReference/);
    expect(view.disclaimer).toContain('No es una oferta ni una aprobación');
  });

  it('returns a valid empty run when no policy is in force', async () => {
    const { service } = matchingFixture({
      versions: [versionRow({ status: 'BORRADOR' })],
    });
    const view = await service.run(person(Role.USER), {});
    expect(view.results).toEqual([]);
    expect(view.run).toMatchObject({
      productsEvaluated: 0,
      summary: { eligible: 0, withGaps: 0, excluded: 0 },
    });
  });

  it('re-executing the stored snapshot gives the same result', async () => {
    const { service, review, store } = matchingFixture({
      versions: [
        inForce(),
        inForce({
          product: productRow('Tarjeta inicial'),
          rules: [
            ruleRow({ field: 'ageYears', value: 18 }),
            ruleRow({
              field: 'currentArrears',
              kind: 'EXCLUSION',
              operator: 'eq',
              value: true,
              position: 2,
            }),
          ],
        }),
      ],
    });
    await service.run(person(Role.USER), {});
    const staff = person(Role.RISK);
    const check = await review.verify(staff, store.runs[0].id);
    expect(check).toMatchObject({
      factsHashValid: true,
      reproducible: true,
      sameEngineVersion: true,
    });
    expect(check.results).toHaveLength(2);
    expect(check.results.every((item) => item.reproducible)).toBe(true);

    // Any tampering with the recorded result or the snapshot is detected.
    store.results[0].fitPercent = 99;
    expect((await review.verify(staff, store.runs[0].id)).reproducible).toBe(
      false,
    );
    store.results[0].fitPercent = 100;
    expect((await review.verify(staff, store.runs[0].id)).reproducible).toBe(
      true,
    );
    const snapshot = JSON.parse(crypto.decrypt(store.runs[0].factsCiphertext));
    snapshot.facts.score = 900;
    store.runs[0].factsCiphertext = crypto.encrypt(canonicalJson(snapshot));
    expect(await review.verify(staff, store.runs[0].id)).toMatchObject({
      factsHashValid: false,
      reproducible: false,
    });
  });

  it('a new policy version does not alter historical results', async () => {
    const product = productRow();
    const first = inForce({ product, version: 1 });
    const { service, store } = matchingFixture({ versions: [first] });
    const user = person(Role.USER);
    const before = await service.run(user, {});
    expect(before.results[0]).toMatchObject({
      status: 'ELEGIBLE',
      fitPercent: 100,
      policy: { version: 1 },
      authorization: { allowed: true },
    });

    // Risk publishes a stricter version 2; version 1 becomes SUSTITUIDA.
    first.status = 'SUSTITUIDA';
    first.rules = [ruleRow({ field: 'score', value: 900 })];
    store.versions.push(
      inForce({
        product,
        version: 2,
        rules: [ruleRow({ field: 'score', value: 900 })],
      }),
    );

    const history = await service.runDetail(user, before.run.id);
    expect(history.results[0]).toMatchObject({
      status: 'ELEGIBLE',
      fitPercent: 100,
      policy: { versionId: first.id, version: 1 },
    });
    expect(history.results[0].explanation).toEqual(
      before.results[0].explanation,
    );
    // …but an outdated result can no longer be authorized.
    expect(history.results[0].authorization).toMatchObject({
      allowed: false,
      blockedCode: 'result_outdated',
    });

    const after = await service.run(user, {});
    expect(after.results[0]).toMatchObject({
      status: 'CON_BRECHAS',
      policy: { version: 2 },
    });
    expect(store.results[0]).toMatchObject({
      status: 'ELEGIBLE',
      policyVersionNumber: 1,
    });
  });
});

describe('MatchingService · authorization', () => {
  const meta = { ip: '203.0.113.7', userAgent: 'jest' };

  async function eligibleRun() {
    const fixture = matchingFixture({
      versions: [
        inForce({
          rules: [
            ruleRow({ field: 'score', value: 600 }),
            ruleRow({
              field: 'monthlyIncomeCOP',
              value: 2_000_000,
              position: 2,
            }),
          ],
        }),
      ],
    });
    const user = person(Role.USER);
    const view = await fixture.service.run(user, {});
    return { ...fixture, user, resultId: view.results[0].id };
  }

  it('requires accepting the exact text that was shown', async () => {
    const { service, user, resultId, store } = await eligibleRun();
    const preview = await service.authorizationPreview(user, resultId);
    expect(preview.allowed).toBe(true);
    expect(preview.text).toContain('Banco Ejemplo');
    expect(preview.textHash).toBe(crypto.hash(preview.text));
    const error = await failure(
      service.authorize(user, resultId, {
        accepted: true,
        version: preview.version,
        textHash: 'a'.repeat(64),
      }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().code).toBe('authorization_text_changed');
    await expect(
      service.authorize(user, resultId, {
        accepted: false,
        version: preview.version,
        textHash: preview.textHash,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.presentations).toHaveLength(0);
  });

  it('records text, hash, hashed IP and only the authorized data', async () => {
    const { service, user, resultId, store, audit } = await eligibleRun();
    const preview = await service.authorizationPreview(user, resultId);
    const presentation = await service.authorize(
      user,
      resultId,
      { accepted: true, version: preview.version, textHash: preview.textHash },
      meta,
    );
    expect(presentation).toMatchObject({
      status: 'AUTORIZADA',
      canRevoke: true,
      institution: { name: 'Banco Ejemplo' },
    });
    const [row] = store.presentations;
    expect(row).toMatchObject({
      userId: user.id,
      institutionId: institution.id,
      authorizationText: preview.text,
      authorizationHash: preview.textHash,
      ipHash: crypto.hash(meta.ip),
      userAgent: 'jest',
    });
    expect(JSON.stringify({ ...row, sharedDataCiphertext: '' })).not.toContain(
      meta.ip,
    );
    expect(row.sharedDataCiphertext).not.toContain('1020304050');
    const shared = JSON.parse(crypto.decrypt(row.sharedDataCiphertext));
    expect(shared.applicant).toEqual({
      fullName: 'Ana Pérez',
      document: '1020304050',
      phone: '+573001112233',
      email: 'ana@example.com',
    });
    expect(shared.facts.map((item: Row) => item.key).sort()).toEqual([
      'monthlyIncomeCOP',
      'score',
    ]);
    const event = audit.record.mock.calls.at(-1)![0];
    expect(event).toMatchObject({
      action: 'matching.presentation.authorized',
      ip: meta.ip,
      payload: expect.objectContaining({ textHash: preview.textHash }),
    });
    expect(JSON.stringify(event.payload)).not.toContain('1020304050');

    // The same product cannot be authorized twice.
    const again = await failure(
      service.authorize(user, resultId, {
        accepted: true,
        version: preview.version,
        textHash: preview.textHash,
      }),
    );
    expect(again.getResponse().code).toBe('already_authorized');
  });

  it('lets the person revoke before presentation and destroys the shared copy', async () => {
    const { service, user, resultId, store, audit } = await eligibleRun();
    const preview = await service.authorizationPreview(user, resultId);
    await service.authorize(user, resultId, {
      accepted: true,
      version: preview.version,
      textHash: preview.textHash,
    });
    const revoked = await service.revoke(user, resultId, meta);
    expect(revoked).toMatchObject({ status: 'REVOCADA', canRevoke: false });
    expect(store.presentations[0]).toMatchObject({
      status: 'REVOCADA',
      sharedDataCiphertext: null,
      revokedAt: expect.any(Date),
    });
    expect(audit.record.mock.calls.at(-1)![0].action).toBe(
      'matching.presentation.revoked',
    );
    const error = await failure(service.revoke(user, resultId));
    expect(error.getResponse().code).toBe('not_revocable');
  });

  it('turns a revocation after presentation into a withdrawal', async () => {
    const { service, user, resultId, store } = await eligibleRun();
    const preview = await service.authorizationPreview(user, resultId);
    await service.authorize(user, resultId, {
      accepted: true,
      version: preview.version,
      textHash: preview.textHash,
    });
    store.presentations[0].status = 'PRESENTADA';
    store.presentations[0].presentedAt = new Date();
    const withdrawn = await service.revoke(user, resultId);
    expect(withdrawn.status).toBe('DESISTIDA');
    expect(store.presentations[0]).toMatchObject({
      decidedBy: user.id,
      decidedByRole: 'USER',
    });
  });

  it('never lets one person authorize or see the result of another', async () => {
    const { service, resultId, store } = await eligibleRun();
    const stranger = person(Role.USER);
    await expect(
      service.authorizationPreview(stranger, resultId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.runDetail(stranger, store.runs[0].id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.revoke(stranger, resultId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not allow authorizing an excluded product', async () => {
    const fixture = matchingFixture({
      versions: [
        inForce({
          rules: [
            ruleRow({
              field: 'hasCreditHistory',
              kind: 'EXCLUSION',
              operator: 'eq',
              value: true,
            }),
          ],
        }),
      ],
    });
    const user = person(Role.USER);
    const view = await fixture.service.run(user, {});
    expect(view.results[0].status).toBe('EXCLUIDO');
    expect(view.results[0].authorization).toMatchObject({
      allowed: false,
      blockedCode: 'not_presentable',
    });
    const error = await failure(
      fixture.service.authorize(user, view.results[0].id, {
        accepted: true,
        version: '2026-11-22',
        textHash: 'b'.repeat(64),
      }),
    );
    expect(error.getResponse().code).toBe('not_presentable');
  });
});

// ------------------------------------------------------- portal de la entidad

function presentationFixture(rows: Row[], link: Row | null) {
  const store = rows;
  const db = {
    scoring: {
      institutionUser: {
        findUnique: jest.fn().mockResolvedValue(link),
        findMany: jest
          .fn()
          .mockResolvedValue(link ? [{ userId: link.userId }] : []),
      },
      matchPresentation: {
        findMany: jest.fn(({ where }: Row) =>
          Promise.resolve(store.filter((row) => matches(row, where))),
        ),
        count: jest.fn(({ where }: Row) =>
          Promise.resolve(store.filter((row) => matches(row, where)).length),
        ),
        findFirst: jest.fn(({ where }: Row) =>
          Promise.resolve(store.find((row) => matches(row, where)) ?? null),
        ),
        findUnique: jest.fn(({ where }: Row) =>
          Promise.resolve(store.find((row) => row.id === where.id) ?? null),
        ),
        updateMany: jest.fn(({ where, data }: Row) => {
          const found = store.filter((row) => matches(row, where));
          for (const row of found) Object.assign(row, data);
          return Promise.resolve({ count: found.length });
        }),
      },
    },
    identity: { user: { findMany: jest.fn().mockResolvedValue([]) } },
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const realtime = { toUser: jest.fn(), toRole: jest.fn() };
  const service = new PresentationService(
    db as never,
    crypto,
    audit as never,
    realtime as never,
  );
  return { service, db, audit, realtime, store };
}

const presentationRow = (input: Row = {}): Row => {
  const product = productRow();
  const shared = {
    applicant: {
      fullName: 'Ana Pérez',
      document: '1020304050',
      phone: '+573001112233',
      email: 'ana@example.com',
    },
    facts: [
      {
        key: 'score',
        label: 'Puntaje de crédito',
        value: 640,
        display: '640 puntos',
      },
    ],
    match: {
      status: 'ELEGIBLE',
      fitPercent: 100,
      policyVersion: 1,
      evaluatedAt: '2026-11-20T12:00:00.000Z',
      requiresException: false,
    },
  };
  return {
    id: randomUUID(),
    resultId: randomUUID(),
    userId: randomUUID(),
    institutionId: 'bank-a',
    productId: product.id,
    policyVersionId: randomUUID(),
    status: 'PRESENTADA',
    authorizationVersion: '2026-11-22',
    authorizationText: 'Autorizo…',
    authorizationHash: 'h'.repeat(64),
    authorizedScope: {},
    authorizedAt: new Date('2026-11-20T12:00:00Z'),
    sharedDataCiphertext: crypto.encrypt(JSON.stringify(shared)),
    requiresException: false,
    exceptionApprovedBy: null,
    exceptionApprovedRole: null,
    exceptionNote: null,
    revokedAt: null,
    presentedAt: new Date('2026-11-21T12:00:00Z'),
    presentedBy: null,
    presentationChannel: 'Correo seguro',
    presentationNote: null,
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null,
    approvedAmountCOP: null,
    approvedRateEA: null,
    approvedTermMonths: null,
    finalProductName: null,
    decisionReason: null,
    result: {
      productSnapshot: {
        institutionId: 'bank-a',
        institutionName: 'Banco A',
        productId: product.id,
        name: product.name,
        kind: product.kind,
      },
      policyVersionNumber: 1,
      policyEffectiveFrom: new Date('2026-01-01T00:00:00Z'),
      status: 'ELEGIBLE',
      fitPercent: 100,
      createdAt: new Date('2026-11-20T12:00:00Z'),
      explanation: {
        totals: {},
        requiresException: false,
        exceptionApprovalLevels: [],
        passed: [],
        gaps: [],
        exclusions: [],
      },
    },
    ...input,
  };
};

const linkTo = (institutionId: string, active = true): Row => ({
  userId: randomUUID(),
  institutionId,
  institution: { id: institutionId, name: 'Banco A', kind: 'BANCO', active },
});

describe('PresentationService · institution portal', () => {
  const approve = {
    decision: 'APROBADA',
    approvedAmountCOP: 4_000_000,
    approvedRateEA: 0.285,
    approvedTermMonths: 36,
  };

  it('denies an INSTITUTION account without an active link', async () => {
    const officer = person(Role.INSTITUTION);
    for (const link of [null, linkTo('bank-a', false)]) {
      const { service, db } = presentationFixture([presentationRow()], link);
      for (const call of [
        service.institutionHome(officer),
        service.institutionList(officer, {}),
        service.institutionDetail(officer, randomUUID()),
        service.institutionDecide(officer, randomUUID(), approve),
      ]) {
        const error = await failure(call);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.getResponse().code).toBe('institution_link_required');
      }
      expect(db.scoring.matchPresentation.findMany).not.toHaveBeenCalled();
      expect(db.scoring.matchPresentation.findFirst).not.toHaveBeenCalled();
    }
  });

  it('lists only cases already presented to its own institution', async () => {
    const mine = presentationRow();
    const { service, db } = presentationFixture(
      [
        mine,
        presentationRow({ institutionId: 'bank-b' }),
        presentationRow({ status: 'AUTORIZADA' }),
        presentationRow({ status: 'REVOCADA' }),
      ],
      linkTo('bank-a'),
    );
    const list = await service.institutionList(person(Role.INSTITUTION), {});
    expect(list.total).toBe(1);
    expect(list.items.map((item) => item.id)).toEqual([mine.id]);
    expect(db.scoring.matchPresentation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          institutionId: 'bank-a',
          status: { in: ['PRESENTADA', 'APROBADA', 'RECHAZADA', 'DESISTIDA'] },
        },
      }),
    );
    // The list never carries the document or contact data.
    expect(JSON.stringify(list)).not.toContain('1020304050');
    expect(JSON.stringify(list)).not.toContain('ana@example.com');
  });

  it('answers 404 for a case of another institution or not yet presented', async () => {
    const foreign = presentationRow({ institutionId: 'bank-b' });
    const pending = presentationRow({ status: 'AUTORIZADA' });
    const revoked = presentationRow({ status: 'REVOCADA' });
    const { service, audit, store } = presentationFixture(
      [foreign, pending, revoked],
      linkTo('bank-a'),
    );
    const officer = person(Role.INSTITUTION);
    for (const row of [foreign, pending, revoked]) {
      await expect(
        service.institutionDetail(officer, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.institutionDecide(officer, row.id, approve),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(audit.record).not.toHaveBeenCalled();
    expect(store.map((row) => row.status)).toEqual([
      'PRESENTADA',
      'AUTORIZADA',
      'REVOCADA',
    ]);
  });

  it('shows strictly the authorized data and audits the access', async () => {
    const row = presentationRow();
    const { service, audit } = presentationFixture([row], linkTo('bank-a'));
    const officer = person(Role.INSTITUTION);
    const detail = (await service.institutionDetail(officer, row.id)) as Row;
    expect(detail.applicant).toEqual({
      fullName: 'Ana Pérez',
      document: '1020304050',
      phone: '+573001112233',
      email: 'ana@example.com',
    });
    expect(detail.facts).toEqual([
      {
        key: 'score',
        label: 'Puntaje de crédito',
        value: 640,
        display: '640 puntos',
      },
    ]);
    expect(detail.dataAvailable).toBe(true);
    // Nothing identifies the person beyond what they authorized.
    expect(JSON.stringify(detail)).not.toContain(row.userId);
    expect(detail).not.toHaveProperty('user');
    expect(detail).not.toHaveProperty('explanation');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'matching.presentation.viewed',
        actorUserId: officer.id,
        actorRole: 'INSTITUTION',
        payload: expect.objectContaining({
          audience: 'INSTITUTION',
          institutionId: 'bank-a',
          personalDataShown: true,
        }),
      }),
    );
  });

  it('stops showing personal data once the case is rejected or withdrawn', async () => {
    for (const status of ['RECHAZADA', 'DESISTIDA']) {
      const row = presentationRow({ status });
      const { service } = presentationFixture([row], linkTo('bank-a'));
      const detail = (await service.institutionDetail(
        person(Role.INSTITUTION),
        row.id,
      )) as Row;
      expect(detail.applicant).toBeNull();
      expect(detail.applicantName).toBeNull();
      expect(detail.facts).toEqual([]);
      expect(detail.dataAvailable).toBe(false);
      expect(JSON.stringify(detail)).not.toContain('1020304050');
    }
  });

  it('records the decision of the institution with amount, rate and product', async () => {
    const row = presentationRow();
    const { service, audit, realtime, store } = presentationFixture(
      [row],
      linkTo('bank-a'),
    );
    const officer = person(Role.INSTITUTION);
    const detail = (await service.institutionDecide(officer, row.id, {
      ...approve,
      finalProductName: 'Libre inversión plus',
    })) as Row;
    expect(store[0]).toMatchObject({
      status: 'APROBADA',
      approvedAmountCOP: 4_000_000n,
      approvedRateEA: '0.28500',
      approvedTermMonths: 36,
      finalProductName: 'Libre inversión plus',
      decidedBy: officer.id,
      decidedByRole: 'INSTITUTION',
    });
    expect(detail).toMatchObject({ status: 'APROBADA', canDecide: false });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'matching.presentation.decided',
        payload: expect.objectContaining({
          decision: 'APROBADA',
          registeredBy: 'INSTITUTION',
          approvedAmountCOP: 4_000_000,
        }),
      }),
    );
    expect(realtime.toUser).toHaveBeenCalledWith(
      row.userId,
      'matching:presentation',
      { id: row.id, status: 'APROBADA' },
    );
    // Other institutions never hear about the case.
    expect(realtime.toRole).not.toHaveBeenCalledWith(
      'INSTITUTION',
      expect.anything(),
      expect.anything(),
    );
    // A decided case cannot be decided again.
    await expect(
      service.institutionDecide(officer, row.id, {
        decision: 'RECHAZADA',
        reason: 'Cambio de criterio',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates the decision body', async () => {
    const row = presentationRow();
    const { service } = presentationFixture([row], linkTo('bank-a'));
    const officer = person(Role.INSTITUTION);
    for (const body of [
      { decision: 'APROBADA' },
      { ...approve, approvedAmountCOP: 0 },
      { decision: 'RECHAZADA' },
      { decision: 'PENDIENTE' },
    ])
      await expect(
        service.institutionDecide(officer, row.id, body),
      ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PresentationService · staff', () => {
  const present = { channel: 'Correo seguro de la entidad' };

  it('marks a case as presented only from AUTORIZADA', async () => {
    const row = presentationRow({ status: 'AUTORIZADA', presentedAt: null });
    const { service, store, audit } = presentationFixture([row], null);
    const staff = person(Role.COMMERCIAL);
    await service.present(staff, row.id, present);
    expect(store[0]).toMatchObject({
      status: 'PRESENTADA',
      presentedBy: staff.id,
      presentationChannel: 'Correo seguro de la entidad',
      presentedAt: expect.any(Date),
    });
    expect(audit.record.mock.calls.map(([event]) => event.action)).toContain(
      'matching.presentation.presented',
    );
    const error = await failure(service.present(staff, row.id, present));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().code).toBe('invalid_presentation_status');
  });

  it('demands the exception approval level before presenting a gap', async () => {
    const exceptionRow = () => {
      const row = presentationRow({
        status: 'AUTORIZADA',
        presentedAt: null,
        requiresException: true,
      });
      row.result.explanation.exceptionApprovalLevels = ['RISK'];
      return row;
    };
    const commercial = presentationFixture([exceptionRow()], null);
    const denied = await failure(
      commercial.service.present(
        person(Role.COMMERCIAL),
        commercial.store[0].id,
        present,
      ),
    );
    expect(denied).toBeInstanceOf(ForbiddenException);
    expect(denied.getResponse().code).toBe('exception_approval_required');
    expect(commercial.store[0].status).toBe('AUTORIZADA');

    const risk = presentationFixture([exceptionRow()], null);
    const analyst = person(Role.RISK);
    const missing = await failure(
      risk.service.present(analyst, risk.store[0].id, present),
    );
    expect(missing.getResponse().code).toBe('exception_note_required');
    await risk.service.present(analyst, risk.store[0].id, {
      ...present,
      exceptionNote: 'Ingresos demostrados con extractos de seis meses.',
    });
    expect(risk.store[0]).toMatchObject({
      status: 'PRESENTADA',
      exceptionApprovedBy: analyst.id,
      exceptionApprovedRole: 'RISK',
    });
  });

  it('cannot decide a case that was never presented', async () => {
    const row = presentationRow({ status: 'AUTORIZADA', presentedAt: null });
    const { service, store } = presentationFixture([row], null);
    await expect(
      service.staffDecide(person(Role.RISK), row.id, {
        decision: 'RECHAZADA',
        reason: 'No aplica',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store[0].status).toBe('AUTORIZADA');
  });
});
