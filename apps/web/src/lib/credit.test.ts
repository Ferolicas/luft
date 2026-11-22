import { describe, expect, it } from "vitest";
import { money } from "./api";
import { installmentsLabel, planMilestones, planSteps } from "./credit";
import { lessonXp, LESSON_XP } from "./lessons";

describe("payment plan helpers", () => {
  it("places the milestones of the six-installment plan", () => {
    expect(planMilestones(6)).toEqual({ constancy: 3, review: 4, goal: 6 });
  });

  it("adapts the milestones to any plan length the API sends", () => {
    expect(planMilestones(12)).toEqual({ constancy: 3, review: 10, goal: 12 });
    expect(planMilestones(4)).toEqual({ constancy: 3, review: null, goal: 4 });
    expect(planMilestones(2)).toEqual({ constancy: null, review: null, goal: 2 });
  });

  it("builds one step per installment with paid, current and milestone marks", () => {
    const steps = planSteps(6, 2, 3);
    expect(steps).toHaveLength(6);
    expect(steps.map((step) => step.state ?? "todo")).toEqual(["paid", "paid", "now", "todo", "todo", "todo"]);
    expect(steps[2]).toMatchObject({ tone: "amber", state: "now" });
    expect(steps[3]).toMatchObject({ tone: "violet", icon: "verified_user" });
    expect(steps[5]).toMatchObject({ tone: "green", icon: "flag" });
  });

  it("labels installments in singular and plural", () => {
    expect(installmentsLabel(1)).toBe("1 cuota");
    expect(installmentsLabel(6)).toBe("6 cuotas");
  });
});

describe("amounts and XP", () => {
  it("formats credit amounts without a space after the sign, as the design does", () => {
    expect(money(600000)).toBe("$600.000");
    expect(money("167320")).toBe("$167.320");
    expect(money(-5000)).toBe("-$5.000");
    expect(money(null)).toBe("$0");
  });

  it("reads the lesson XP from the learning mission and falls back to the default", () => {
    expect(lessonXp({ missions: [{ key: "lesson", xp: 15 }, { key: "profile", xp: 0 }] })).toBe(15);
    expect(lessonXp({ missions: [{ key: "profile", xp: 0 }] })).toBe(LESSON_XP);
  });
});
