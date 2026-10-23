import { describe, it, expect } from "vitest";
import { graphEpochToMs, graphTimeToMs } from "@/lib/graph-time";

describe("graphEpochToMs", () => {
  it("maps a live ms stamp to 2026, not year 58770", () => {
    const ms = graphEpochToMs(1792441061009)!;
    expect(ms).toBe(1792441061009);
    expect(new Date(ms).getFullYear()).toBe(2026);
  });
});

describe("graphTimeToMs", () => {
  const ms = Date.parse("2026-05-01T00:00:00Z");
  it("reads ISO, epoch ms, legacy float seconds and numeric strings; else undefined", () => {
    expect(graphTimeToMs("2026-05-01T00:00:00Z")).toBe(ms);
    expect(graphTimeToMs(ms)).toBe(ms);
    expect(graphTimeToMs(String(ms))).toBe(ms);
    expect(graphTimeToMs(ms / 1000)).toBe(ms);
    expect(graphTimeToMs(`${ms / 1000}`)).toBe(ms);
    for (const bad of [null, undefined, "", "nope", 0, -5, {}, NaN]) expect(graphTimeToMs(bad)).toBeUndefined();
  });
});
