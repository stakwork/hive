import { describe, test, expect } from "vitest";
import {
  computeNextRunAt,
  describeSchedule,
  isValidTimeOfDay,
  isValidTimezone,
} from "@/lib/automations/schedule";

describe("isValidTimeOfDay", () => {
  test("accepts valid 24h times", () => {
    expect(isValidTimeOfDay("00:00")).toBe(true);
    expect(isValidTimeOfDay("04:30")).toBe(true);
    expect(isValidTimeOfDay("23:59")).toBe(true);
  });
  test("rejects invalid times", () => {
    expect(isValidTimeOfDay("24:00")).toBe(false);
    expect(isValidTimeOfDay("4:00")).toBe(false);
    expect(isValidTimeOfDay("12:60")).toBe(false);
    expect(isValidTimeOfDay("noon")).toBe(false);
  });
});

describe("isValidTimezone", () => {
  test("accepts IANA zones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
  });
  test("rejects garbage", () => {
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("computeNextRunAt — UTC", () => {
  test("uses today's occurrence when still in the future", () => {
    const from = new Date("2026-01-01T03:00:00.000Z");
    const next = computeNextRunAt("04:00", "UTC", from);
    expect(next.toISOString()).toBe("2026-01-01T04:00:00.000Z");
  });

  test("rolls to tomorrow when the time already passed", () => {
    const from = new Date("2026-01-01T05:00:00.000Z");
    const next = computeNextRunAt("04:00", "UTC", from);
    expect(next.toISOString()).toBe("2026-01-02T04:00:00.000Z");
  });

  test("rolls across month boundary", () => {
    const from = new Date("2026-01-31T05:00:00.000Z");
    const next = computeNextRunAt("04:00", "UTC", from);
    expect(next.toISOString()).toBe("2026-02-01T04:00:00.000Z");
  });
});

describe("computeNextRunAt — zoned (DST-aware)", () => {
  test("America/New_York standard time (UTC-5): 04:00 local = 09:00Z", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = computeNextRunAt("04:00", "America/New_York", from);
    expect(next.toISOString()).toBe("2026-01-01T09:00:00.000Z");
  });

  test("America/New_York daylight time (UTC-4): 04:00 local = 08:00Z", () => {
    // July is DST in New York.
    const from = new Date("2026-07-01T00:00:00.000Z");
    const next = computeNextRunAt("04:00", "America/New_York", from);
    expect(next.toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });

  test("always returns an instant strictly after `from`", () => {
    const from = new Date("2026-03-15T12:34:00.000Z");
    const next = computeNextRunAt("09:00", "America/Los_Angeles", from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe("describeSchedule", () => {
  test("formats 12-hour label", () => {
    expect(describeSchedule("04:00")).toBe("Daily at 4:00 AM");
    expect(describeSchedule("00:00")).toBe("Daily at 12:00 AM");
    expect(describeSchedule("13:30")).toBe("Daily at 1:30 PM");
    expect(describeSchedule("12:00")).toBe("Daily at 12:00 PM");
  });
});
