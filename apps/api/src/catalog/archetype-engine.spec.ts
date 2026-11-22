import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  archetypeRulesSchema,
  assignArchetype,
  decisionFingerprint,
  evaluateRules,
  LEGACY_ARCHETYPE_EQUIVALENCE,
  type ArchetypeDefinition,
  type ArchetypeFacts,
  type ArchetypeRules,
} from './archetype-engine';
import {
  categoryConfigSchema,
  planView,
  pricePerSeat,
  quoteSubscription,
  suggestCategory,
} from './catalog-rules';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/luft/migrations/202611220001_v2_dominio/migration.sql',
  ),
  'utf8',
);

/** Reads the archetypes exactly as the migration seeds them. */
function seededArchetypes() {
  const pattern =
    /\('(21000000-[0-9a-f-]+)', \(SELECT "id" FROM "ServiceCategory" WHERE "code" = '([A-Z]+)'\), '([A-Z_]+)', '([^']+)', '([^']+)', (\d+), (\d+), (true|false), (true|false), '(\{.*\})'::jsonb\)/g;
  const rows: Array<ArchetypeDefinition & { category: string }> = [];
  for (const match of migration.matchAll(pattern))
    rows.push({
      id: match[1],
      category: match[2],
      code: match[3],
      name: match[4],
      description: match[5],
      priority: Number(match[6]),
      version: Number(match[7]),
      isDefault: match[8] === 'true',
      active: match[9] === 'true',
      rules: JSON.parse(match[10]),
    });
  return rows;
}

const seeded = seededArchetypes();
const of = (category: string) =>
  seeded.filter((row) => row.category === category);
const pick = (
  category: string,
  facts: ArchetypeFacts,
  legacyCode?: string | null,
) =>
  assignArchetype(of(category), facts, { categoryCode: category, legacyCode });

describe('seeded catalogs', () => {
  it('seeds the twelve archetypes with valid, explainable rules and one default per category', () => {
    expect(seeded).toHaveLength(12);
    for (const row of seeded)
      expect(archetypeRulesSchema.safeParse(row.rules).success).toBe(true);
    for (const category of ['JOVEN', 'ADULTO', 'FAMILIA']) {
      expect(of(category)).toHaveLength(4);
      expect(of(category).filter((row) => row.isDefault)).toHaveLength(1);
    }
    expect(seeded.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'Explorador consciente',
        'Universitario independiente',
        'Emprendedor emergente',
        'Próximo al egreso',
        'Profesional sin historial',
        'Independiente en consolidación',
        'Emprendedor establecido',
        'Reinicio financiero',
        'Familia impulsora',
        'Hogar planificador',
        'Red intergeneracional',
        'Familia emprendedora',
      ]),
    );
  });

  it('seeds three valid category configurations and maps every legacy code', () => {
    const configs = [
      ...migration.matchAll(
        /CURRENT_TIMESTAMP, '(\{"onboarding".*\})'::jsonb\)/g,
      ),
    ].map((match) => JSON.parse(match[1]));
    expect(configs).toHaveLength(3);
    for (const config of configs)
      expect(categoryConfigSchema.safeParse(config).success).toBe(true);
    const codes = new Set(seeded.map((row) => `${row.category}:${row.code}`));
    for (const mapping of Object.values(LEGACY_ARCHETYPE_EQUIVALENCE))
      for (const [category, code] of Object.entries(mapping))
        expect(codes.has(`${category}:${code}`)).toBe(true);
  });
});

describe('archetype engine', () => {
  it('assigns each young archetype from facts the app collects', () => {
    expect(pick('JOVEN', { creditExperience: 'NONE' })?.archetype.code).toBe(
      'EXPLORADOR_CONSCIENTE',
    );
    expect(
      pick('JOVEN', {
        creditExperience: 'NONE',
        employmentSituation: 'ESTUDIANTE',
        monthlyIncomeCOP: 600_000,
        incomeKinds: ['OTROS'],
      })?.archetype.code,
    ).toBe('UNIVERSITARIO_INDEPENDIENTE');
    expect(
      pick('JOVEN', {
        employmentSituation: 'INDEPENDIENTE',
        incomeKinds: ['VENTAS'],
        monthlyIncomeCOP: 1_500_000,
      })?.archetype.code,
    ).toBe('EMPRENDEDOR_EMERGENTE');
    expect(
      pick('JOVEN', {
        employmentSituation: 'ESTUDIANTE',
        contractType: 'APRENDIZAJE',
        monthlyIncomeCOP: 1_000_000,
      })?.archetype.code,
    ).toBe('PROXIMO_AL_EGRESO');
  });

  it('assigns each adult archetype, with the highest priority winning', () => {
    expect(
      pick('ADULTO', {
        creditExperience: 'NONE',
        employmentSituation: 'EMPLEADO',
      })?.archetype.code,
    ).toBe('PROFESIONAL_SIN_HISTORIAL');
    expect(
      pick('ADULTO', {
        creditExperience: 'UP_TO_DATE',
        contractType: 'PRESTACION_SERVICIOS',
      })?.archetype.code,
    ).toBe('INDEPENDIENTE_EN_CONSOLIDACION');
    expect(
      pick('ADULTO', {
        employmentSituation: 'INDEPENDIENTE',
        incomeKinds: ['VENTAS'],
        socialSecurity: 'INDEPENDIENTE',
      })?.archetype.code,
    ).toBe('EMPRENDEDOR_ESTABLECIDO');
    // Late payments outrank everything else in the adult category.
    expect(
      pick('ADULTO', {
        creditExperience: 'LATE',
        employmentSituation: 'INDEPENDIENTE',
        incomeKinds: ['VENTAS'],
        socialSecurity: 'INDEPENDIENTE',
      })?.archetype.code,
    ).toBe('REINICIO_FINANCIERO');
  });

  it('assigns each family archetype', () => {
    expect(pick('FAMILIA', { goal: 'GUIDE_YOUTH' })?.archetype.code).toBe(
      'FAMILIA_IMPULSORA',
    );
    expect(
      pick('FAMILIA', { goal: 'GUIDE_YOUTH', sharedGoals: 1 })?.archetype.code,
    ).toBe('HOGAR_PLANIFICADOR');
    expect(
      pick('FAMILIA', { sharedGoals: 2, householdSupportMembers: 1 })?.archetype
        .code,
    ).toBe('RED_INTERGENERACIONAL');
    expect(
      pick('FAMILIA', { incomeKinds: ['VENTAS', 'PENSION'] })?.archetype.code,
    ).toBe('FAMILIA_EMPRENDEDORA');
  });

  it('explains the decision with the rules that were met', () => {
    const decision = pick('JOVEN', {
      employmentSituation: 'ESTUDIANTE',
      monthlyIncomeCOP: 800_000,
    });
    expect(decision?.explanation.basis).toBe('RULES');
    expect(decision?.explanation.matched.map((hit) => hit.fact)).toEqual([
      'employmentSituation',
      'monthlyIncomeCOP',
    ]);
    expect(decision?.explanation.matched[1].value).toBe('800000');
    expect(decision?.explanation.summary).toContain(
      'Universitario independiente',
    );
    expect(decision?.explanation.evaluated).toHaveLength(4);
  });

  it('falls back to the documented legacy equivalence and then to the default', () => {
    const legacy = pick('ADULTO', {}, 'CONSTRUCTOR');
    expect(legacy?.archetype.code).toBe('INDEPENDIENTE_EN_CONSOLIDACION');
    expect(legacy?.explanation).toMatchObject({
      basis: 'LEGACY_EQUIVALENCE',
      legacyCode: 'CONSTRUCTOR',
    });
    const fallback = pick('FAMILIA', {});
    expect(fallback?.archetype.code).toBe('FAMILIA_IMPULSORA');
    expect(fallback?.explanation.basis).toBe('DEFAULT');
    // A rule that matches always beats the legacy code.
    expect(
      pick('ADULTO', { creditExperience: 'LATE' }, 'INICIADOR')?.archetype.code,
    ).toBe('REINICIO_FINANCIERO');
  });

  it('ignores inactive or malformed definitions and returns null without a catalog', () => {
    const facts = { employmentSituation: 'ESTUDIANTE', monthlyIncomeCOP: 1 };
    const broken = of('JOVEN').map((row) =>
      row.code === 'UNIVERSITARIO_INDEPENDIENTE'
        ? { ...row, rules: { broken: true } }
        : row,
    );
    const decision = assignArchetype(broken, facts, { categoryCode: 'JOVEN' });
    expect(decision?.archetype.code).toBe('EXPLORADOR_CONSCIENTE');
    expect(decision?.explanation.basis).toBe('DEFAULT');
    const inactive = of('JOVEN').map((row) =>
      row.code === 'UNIVERSITARIO_INDEPENDIENTE'
        ? { ...row, active: false }
        : row,
    );
    expect(
      assignArchetype(inactive, facts, { categoryCode: 'JOVEN' })?.archetype
        .code,
    ).toBe('EXPLORADOR_CONSCIENTE');
    expect(assignArchetype([], {}, { categoryCode: 'JOVEN' })).toBeNull();
  });

  it('keeps the fingerprint stable until the decision really changes', () => {
    const a = pick('JOVEN', { creditExperience: 'NONE', lessonsCompleted: 1 });
    const b = pick('JOVEN', { creditExperience: 'NONE', lessonsCompleted: 9 });
    const c = pick('JOVEN', { employmentSituation: 'INDEPENDIENTE' });
    expect(a && b && decisionFingerprint(a) === decisionFingerprint(b)).toBe(
      true,
    );
    expect(a && c && decisionFingerprint(a) === decisionFingerprint(c)).toBe(
      false,
    );
  });

  it('evaluates nested groups and rejects malformed rules', () => {
    const rules: ArchetypeRules = {
      all: [
        {
          fact: 'incomeSourceCount',
          op: 'gte',
          value: 2,
          label: 'Dos fuentes',
        },
        {
          any: [
            { fact: 'paysRent', op: 'isTrue', label: 'Paga arriendo' },
            { fact: 'currentScore', op: 'exists', label: 'Tiene puntaje' },
          ],
        },
      ],
    };
    expect(archetypeRulesSchema.safeParse(rules).success).toBe(true);
    expect(
      evaluateRules(rules, { incomeSourceCount: 2, paysRent: true }).matched,
    ).toBe(true);
    expect(
      evaluateRules(rules, { incomeSourceCount: 2, paysRent: false }).matched,
    ).toBe(false);
    expect(evaluateRules(rules, { incomeSourceCount: 1 }).hits).toEqual([]);
    for (const bad of [
      { all: [{ fact: 'unknown', op: 'eq', value: 1, label: 'Nope' }] },
      { all: [{ fact: 'goal', op: 'gt', value: 'x', label: 'Mal tipo' }] },
      { all: [{ fact: 'goal', op: 'in', value: 'START', label: 'Sin lista' }] },
      { all: [{ fact: 'goal', op: 'isTrue', value: true, label: 'Sobra' }] },
      { any: [] },
      { fact: 'goal', op: 'eq', value: 'START', label: 'Sin grupo' },
    ])
      expect(archetypeRulesSchema.safeParse(bad).success).toBe(false);
  });
});

describe('categories and plans', () => {
  it('suggests the category from the classification goal', () => {
    expect(suggestCategory('START')).toBe('JOVEN');
    expect(suggestCategory('IMPROVE_SCORE')).toBe('ADULTO');
    expect(suggestCategory('GUIDE_YOUTH')).toBe('FAMILIA');
    expect(suggestCategory(undefined)).toBe('JOVEN');
  });

  it('prices a seat with the plan discount and validates seat limits', () => {
    const family = {
      code: 'FAMILIA',
      name: 'Familia',
      description: 'Hasta cinco identidades',
      minSeats: 3,
      maxSeats: 5,
      basePriceCOP: 600_000,
      discountPercent: 0,
    };
    expect(planView(family)).toMatchObject({
      basePriceCOP: 600_000,
      discountPercent: 0,
      pricePerSeatCOP: 600_000,
    });
    expect(pricePerSeat(600_000, 12.5)).toBe(525_000);
    expect(quoteSubscription(family, 4)).toMatchObject({
      ok: true,
      seats: 4,
      totalCOP: 2_400_000,
    });
    expect(
      quoteSubscription({ ...family, discountPercent: 10 }, 5),
    ).toMatchObject({ pricePerSeatCOP: 540_000, totalCOP: 2_700_000 });
    expect(quoteSubscription(family, 2).ok).toBe(false);
    expect(quoteSubscription(family, 6).ok).toBe(false);
    expect(
      quoteSubscription({ ...family, minSeats: 1, maxSeats: 1 }, 2),
    ).toMatchObject({ ok: false });
  });
});
