import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

jest.mock('../database/database.service', () => ({
  DatabaseService: class {},
}));

import { AdminController } from '../admin/admin.controller';
import { AnalyticsController } from '../analytics/analytics.controller';
import { ROLES_KEY } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { Role } from '../generated/identity/enums';
import { MatchingController } from './matching.controller';
import { PolicyController } from './policy.controller';
import {
  AllyPortalController,
  InstitutionPortalController,
} from './portal.controller';
import {
  ANALYTICS_STAFF,
  EXTERNAL_ROLES,
  INTERNAL_STAFF,
  isInternalStaff,
  MATCHING_USERS,
  POLICY_READERS,
  POLICY_WRITERS,
  PRESENTATION_STAFF,
} from './roles';

type Controller = abstract new (...args: never[]) => object;

/** Effective roles of every route of a controller (handler overrides class). */
function routeRoles(controller: Controller) {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter(
      (name) =>
        name !== 'constructor' &&
        typeof prototype[name] === 'function' &&
        Reflect.hasMetadata('path', prototype[name] as object),
    )
    .map((name) => ({
      name,
      roles: (Reflect.getMetadata(ROLES_KEY, prototype[name] as object) ??
        Reflect.getMetadata(ROLES_KEY, controller) ??
        []) as Role[],
    }));
}

/** Runs the real AuthGuard for a session of the given role. */
async function canReach(controller: Controller, handler: string, role: Role) {
  const guard = new AuthGuard(
    {
      userFromSession: jest.fn().mockResolvedValue({ id: 'u', role }),
    } as never,
    { get: () => 'luft_session' } as never,
    new Reflector(),
  );
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ signedCookies: { luft_session: 'token' } }),
    }),
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
  };
  try {
    return await guard.canActivate(context as never);
  } catch (error) {
    if (error instanceof UnauthorizedException) return false;
    throw error;
  }
}

describe('roles ALLY and INSTITUTION are external', () => {
  it('exist in identity and are never part of an internal staff list', () => {
    expect(Role.ALLY).toBe('ALLY');
    expect(Role.INSTITUTION).toBe('INSTITUTION');
    for (const role of EXTERNAL_ROLES) {
      expect(isInternalStaff(role)).toBe(false);
      for (const list of [
        INTERNAL_STAFF,
        POLICY_READERS,
        POLICY_WRITERS,
        PRESENTATION_STAFF,
        ANALYTICS_STAFF,
        MATCHING_USERS,
      ])
        expect(list).not.toContain(role);
    }
    expect(isInternalStaff(Role.USER)).toBe(false);
    // Every other identity role is either the customer or internal staff.
    const known = new Set<string>([
      Role.USER,
      ...INTERNAL_STAFF,
      ...EXTERNAL_ROLES,
    ]);
    expect(Object.values(Role).filter((role) => !known.has(role))).toEqual([]);
  });

  it.each([
    ['AdminController', AdminController],
    ['PolicyController', PolicyController],
    ['AnalyticsController', AnalyticsController],
  ])('%s: every route names internal roles only', (_name, controller) => {
    const routes = routeRoles(controller);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.roles.length).toBeGreaterThan(0);
      for (const role of route.roles) expect(INTERNAL_STAFF).toContain(role);
    }
  });

  it('gives policy writing only to RISK and SUPERADMIN', () => {
    const writes = [
      'createInstitution',
      'updateInstitution',
      'deleteInstitution',
      'createProduct',
      'updateProduct',
      'deleteProduct',
      'createVersion',
      'updateVersion',
      'deleteVersion',
      'cloneVersion',
      'transition',
      'replaceRules',
      'addRule',
      'updateRule',
      'deleteRule',
    ];
    const routes = routeRoles(PolicyController);
    for (const name of writes) {
      const route = routes.find((item) => item.name === name);
      expect(route?.roles.slice().sort()).toEqual(
        [Role.RISK, Role.SUPERADMIN].sort(),
      );
    }
    // COMMERCIAL reads the console but cannot change a policy.
    expect(routes.find((item) => item.name === 'catalog')?.roles).toContain(
      Role.COMMERCIAL,
    );
    for (const name of [
      'linkInstitutionUser',
      'unlinkInstitutionUser',
      'linkAllyUser',
      'unlinkAllyUser',
      'createAlly',
      'addReferral',
    ])
      expect(routes.find((item) => item.name === name)?.roles).toEqual([
        Role.SUPERADMIN,
      ]);
  });

  it('opens analytics to RISK, FINANCE and SUPERADMIN only', () => {
    for (const route of routeRoles(AnalyticsController))
      expect(route.roles.slice().sort()).toEqual(
        [Role.RISK, Role.FINANCE, Role.SUPERADMIN].sort(),
      );
  });

  it('scopes each portal to its own role', () => {
    expect(routeRoles(InstitutionPortalController).length).toBe(4);
    expect(routeRoles(AllyPortalController).length).toBe(2);
    expect(routeRoles(MatchingController).length).toBeGreaterThan(8);
    for (const route of routeRoles(InstitutionPortalController))
      expect(route.roles).toEqual([Role.INSTITUTION]);
    for (const route of routeRoles(AllyPortalController))
      expect(route.roles).toEqual([Role.ALLY]);
  });

  it('the guard rejects partner accounts on every staff route', async () => {
    for (const controller of [
      AdminController,
      PolicyController,
      AnalyticsController,
    ])
      for (const route of routeRoles(controller))
        for (const role of [Role.ALLY, Role.INSTITUTION, Role.USER])
          expect(await canReach(controller, route.name, role)).toBe(false);
    expect(await canReach(PolicyController, 'transition', Role.RISK)).toBe(
      true,
    );
    expect(
      await canReach(PolicyController, 'transition', Role.COMMERCIAL),
    ).toBe(false);
    expect(await canReach(PolicyController, 'catalog', Role.COMMERCIAL)).toBe(
      true,
    );
    expect(await canReach(AnalyticsController, 'cohorts', Role.FINANCE)).toBe(
      true,
    );
    expect(
      await canReach(AnalyticsController, 'cohorts', Role.COMMERCIAL),
    ).toBe(false);
  });

  it('the guard keeps each portal closed to everyone else', async () => {
    const others = Object.values(Role).filter(
      (role) => role !== Role.INSTITUTION,
    );
    for (const route of routeRoles(InstitutionPortalController)) {
      expect(
        await canReach(
          InstitutionPortalController,
          route.name,
          Role.INSTITUTION,
        ),
      ).toBe(true);
      for (const role of others)
        expect(
          await canReach(InstitutionPortalController, route.name, role),
        ).toBe(false);
    }
    for (const route of routeRoles(AllyPortalController)) {
      expect(await canReach(AllyPortalController, route.name, Role.ALLY)).toBe(
        true,
      );
      for (const role of [Role.INSTITUTION, Role.USER, Role.SUPERADMIN])
        expect(await canReach(AllyPortalController, route.name, role)).toBe(
          false,
        );
    }
  });

  it('keeps personal matching away from partner accounts', async () => {
    for (const route of routeRoles(MatchingController)) {
      expect(await canReach(MatchingController, route.name, Role.USER)).toBe(
        true,
      );
      for (const role of EXTERNAL_ROLES)
        expect(await canReach(MatchingController, route.name, role)).toBe(
          false,
        );
    }
  });
});
