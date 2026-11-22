import { describe, expect, it } from "vitest";
import { addMonths, annualEffective, geometricPlan, planTotals } from "./credit-plan";

describe("plan de cuotas mostrado en la consola", () => {
  it("reproduce la tabla del crédito constructor 1", () => {
    const plan = geometricPlan(600_000, 6, 0.01, 0.2, "2026-11-22");
    expect(plan.map((row) => row.amountCOP)).toEqual([167_320, 133_856, 107_085, 85_668, 68_534, 54_827]);
    expect(planTotals(plan)).toEqual({ totalCOP: 617_290, totalInterestCOP: 17_290, firstInstallmentCOP: 167_320, lastInstallmentCOP: 54_827 });
    expect(plan.at(-1)?.closingBalanceCOP).toBe(0);
    expect(plan.reduce((sum, row) => sum + row.principalCOP, 0)).toBe(600_000);
    expect(plan[0].dueDate).toBe("2026-12-22");
  });

  it("no calcula con condiciones incompletas o inválidas", () => {
    expect(geometricPlan(0, 6, 0.01, 0.2)).toEqual([]);
    expect(geometricPlan(600_000, 0, 0.01, 0.2)).toEqual([]);
    expect(geometricPlan(600_000, 6, Number.NaN, 0.2)).toEqual([]);
    expect(geometricPlan(600_000, 6, 0.01, 1)).toEqual([]);
  });

  it("ajusta el día al último del mes y convierte la tasa", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(annualEffective(0.01)).toBeCloseTo(0.126825, 6);
  });
});
