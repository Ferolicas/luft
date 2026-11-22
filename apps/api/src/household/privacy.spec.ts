import {
  aggregateBoard,
  canResolveContribution,
  canSee,
  goalProgress,
  inviteDecision,
  memberView,
  normalizePermissions,
  PRIVATE_PERMISSIONS,
  seatUsage,
  SHAREABLE_METRICS,
  type MemberMetrics,
  type MemberRecord,
  type Viewer,
} from './privacy';

const metrics = (percent: number): MemberMetrics => ({
  routeProgress: { percent, stage: 'FORMACION', stageLabel: 'Formación' },
  archetype: {
    categoryCode: 'JOVEN',
    categoryBrand: 'LUFT Impulso',
    archetypeName: 'Explorador consciente',
  },
  learning: { lessonsCompleted: 4, modulesCompleted: 1 },
  credit: {
    state: 'ACTIVE',
    installmentsPaid: 2,
    installmentsTotal: 6,
    upToDate: true,
  },
  score: { value: 668 },
});

const member = (
  userId: string,
  role: MemberRecord['role'],
  permissions: Partial<MemberRecord['permissions']>,
  percent = 40,
): MemberRecord => ({
  memberId: `m-${userId}`,
  userId,
  firstName: userId,
  role,
  seatAssigned: role !== 'SUPPORT',
  joinedAt: '2026-11-01T00:00:00.000Z',
  permissions: { ...PRIVATE_PERMISSIONS, ...permissions },
  metrics: metrics(percent),
});

const owner: Viewer = { userId: 'ana', role: 'OWNER' };
const beneficiary: Viewer = { userId: 'mateo', role: 'BENEFICIARY' };
const support: Viewer = { userId: 'abuela', role: 'SUPPORT' };

describe('household privacy', () => {
  it('shares nothing by default: a package never merges profiles', () => {
    const mateo = member('mateo', 'BENEFICIARY', {});
    for (const viewer of [owner, support])
      for (const metric of SHAREABLE_METRICS)
        expect(canSee(viewer, mateo, metric)).toBe(false);
    const view = memberView(owner, mateo);
    expect(view.visibleMetrics).toEqual([]);
    expect(view.metrics).toEqual({});
    expect(view).not.toHaveProperty('permissions');
    expect(JSON.stringify(view)).not.toContain('668');
  });

  it('lets every member see all of their own metrics and permissions', () => {
    const view = memberView(beneficiary, member('mateo', 'BENEFICIARY', {}));
    expect(view.isSelf).toBe(true);
    expect(view.visibleMetrics).toEqual([...SHAREABLE_METRICS]);
    expect(view.metrics.score).toEqual({ value: 668 });
    expect(view.permissions).toEqual(PRIVATE_PERMISSIONS);
  });

  it('shows a support member only what was opened to support', () => {
    const mateo = member('mateo', 'BENEFICIARY', {
      routeProgress: 'ALL',
      learning: 'BENEFICIARIES',
      score: 'BENEFICIARIES',
    });
    expect(memberView(support, mateo).visibleMetrics).toEqual([
      'routeProgress',
    ]);
    expect(memberView(support, mateo).metrics).toEqual({
      routeProgress: mateo.metrics.routeProgress,
    });
    expect(memberView(owner, mateo).visibleMetrics).toEqual([
      'routeProgress',
      'learning',
      'score',
    ]);
    expect(memberView(owner, mateo).metrics).not.toHaveProperty('credit');
    expect(memberView(owner, mateo).metrics).not.toHaveProperty('archetype');
  });

  it('applies the same rule to the owner: buying the plan grants no extra access', () => {
    const laura = member('laura', 'BENEFICIARY', { credit: 'NONE' });
    expect(canSee(owner, laura, 'credit')).toBe(false);
    const ana = member('ana', 'OWNER', { routeProgress: 'BENEFICIARIES' });
    expect(canSee(beneficiary, ana, 'routeProgress')).toBe(true);
    expect(canSee(support, ana, 'routeProgress')).toBe(false);
  });

  it('aggregates the board only over metrics authorized for the viewer', () => {
    const members = [
      member('ana', 'OWNER', { routeProgress: 'ALL' }, 80),
      member('mateo', 'BENEFICIARY', { routeProgress: 'BENEFICIARIES' }, 40),
      member('laura', 'BENEFICIARY', {}, 10),
      member('abuela', 'SUPPORT', {}, 0),
    ];
    const forOwner = aggregateBoard(owner, members);
    expect(forOwner).toMatchObject({
      members: 4,
      beneficiaries: 3,
      support: 1,
    });
    // Laura did not share: her 10% never enters the average.
    expect(forOwner.routeProgress).toEqual({ sharedBy: 2, averagePercent: 60 });
    // The owner's own learning and credit are the only ones visible to her.
    expect(forOwner.learning).toEqual({
      sharedBy: 1,
      lessonsCompleted: 4,
      modulesCompleted: 1,
    });
    expect(forOwner.credit).toEqual({ sharedBy: 1, upToDate: 1 });
    const forSupport = aggregateBoard(support, members);
    // Support sees Ana's (ALL) and her own; Mateo's is for beneficiaries only.
    expect(forSupport.routeProgress).toEqual({
      sharedBy: 2,
      averagePercent: 40,
    });
    const forLaura = aggregateBoard(
      { userId: 'laura', role: 'BENEFICIARY' },
      members,
    );
    expect(forLaura.routeProgress).toEqual({ sharedBy: 3, averagePercent: 43 });
  });

  it('normalizes stored permissions and rejects unknown levels or metrics', () => {
    expect(normalizePermissions(null)).toEqual(PRIVATE_PERMISSIONS);
    expect(normalizePermissions({ score: 'ALL' })).toEqual({
      ...PRIVATE_PERMISSIONS,
      score: 'ALL',
    });
    expect(normalizePermissions({ score: 'EVERYONE' })).toEqual(
      PRIVATE_PERMISSIONS,
    );
    expect(normalizePermissions({ salary: 'ALL' })).toEqual(
      PRIVATE_PERMISSIONS,
    );
  });
});

describe('seats, invitations and contributions', () => {
  it('counts the buyer, active beneficiaries and pending seat invitations', () => {
    expect(
      seatUsage({ seats: 5, beneficiaries: 2, pendingSeatInvitations: 1 }),
    ).toEqual({ total: 5, used: 4, available: 1 });
    expect(
      seatUsage({ seats: 1, beneficiaries: 0, pendingSeatInvitations: 0 }),
    ).toEqual({ total: 1, used: 1, available: 0 });
  });

  it('lets only the owner invite, and a beneficiary only with a free seat', () => {
    const baseInput = {
      inviterRole: 'OWNER' as const,
      seatsAvailable: 0,
      activeMembers: 1,
      pendingInvitations: 0,
    };
    // LUFT Familia also exists in the individual plan: support needs no seat.
    expect(inviteDecision({ ...baseInput, role: 'SUPPORT' })).toEqual({
      ok: true,
    });
    expect(inviteDecision({ ...baseInput, role: 'BENEFICIARY' })).toMatchObject(
      { ok: false, code: 'no_seats_available' },
    );
    expect(
      inviteDecision({ ...baseInput, role: 'BENEFICIARY', seatsAvailable: 1 }),
    ).toEqual({ ok: true });
    expect(
      inviteDecision({
        ...baseInput,
        inviterRole: 'BENEFICIARY',
        role: 'SUPPORT',
      }),
    ).toMatchObject({ ok: false, code: 'owner_only' });
    expect(
      inviteDecision({
        ...baseInput,
        role: 'SUPPORT',
        activeMembers: 8,
        pendingInvitations: 4,
      }),
    ).toMatchObject({ ok: false, code: 'household_full' });
  });

  it('counts only contributions confirmed by the goal owner', () => {
    const progress = goalProgress(5_800_000, [
      { amountCOP: 3_200_000, status: 'CONFIRMED' },
      { amountCOP: 1_000_000, status: 'DECLARED' },
      { amountCOP: 900_000, status: 'REJECTED' },
    ]);
    expect(progress).toEqual({
      confirmedCOP: 3_200_000,
      pendingCOP: 1_000_000,
      percent: 55,
      reached: false,
    });
    expect(
      goalProgress(1_000_000, [{ amountCOP: 1_200_000, status: 'CONFIRMED' }]),
    ).toMatchObject({ percent: 100, reached: true });
    expect(canResolveContribution('ana', 'ana')).toBe(true);
    expect(canResolveContribution('abuela', 'ana')).toBe(false);
  });
});
