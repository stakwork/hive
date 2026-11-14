import { describe, it, expect, afterEach } from "vitest";
import { isPodMothershipBudgetEnabled, isPodMothershipBudgetConfigured } from "@/config/env";

describe("isPodMothershipBudgetEnabled", () => {
  const original = process.env.POD_MOTHERSHIP_BUDGET_ENABLED;

  afterEach(() => {
    if (original !== undefined) process.env.POD_MOTHERSHIP_BUDGET_ENABLED = original;
    else delete process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
  });

  it.each([undefined, "", "false", "False", "   "])("is off for %j", (value) => {
    if (value === undefined) delete process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
    else process.env.POD_MOTHERSHIP_BUDGET_ENABLED = value;
    expect(isPodMothershipBudgetEnabled("ws-1")).toBe(false);
    expect(isPodMothershipBudgetConfigured()).toBe(false);
  });

  it.each(["true", "all", "*", " TRUE "])("is on for every workspace when %j", (value) => {
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = value;
    expect(isPodMothershipBudgetEnabled("anything")).toBe(true);
    expect(isPodMothershipBudgetConfigured()).toBe(true);
  });

  it("matches a CSV allow-list of slugs, case-insensitively", () => {
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "Alpha, beta";
    expect(isPodMothershipBudgetEnabled("alpha")).toBe(true);
    expect(isPodMothershipBudgetEnabled("BETA")).toBe(true);
    expect(isPodMothershipBudgetEnabled("gamma")).toBe(false);
    expect(isPodMothershipBudgetEnabled("")).toBe(false);
    expect(isPodMothershipBudgetEnabled(undefined)).toBe(false);
  });

  it("is independent of BIFROST_ENABLED", () => {
    const b = process.env.BIFROST_ENABLED;
    delete process.env.BIFROST_ENABLED;
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "true";
    expect(isPodMothershipBudgetEnabled("ws")).toBe(true);
    if (b !== undefined) process.env.BIFROST_ENABLED = b;
  });
});
