/**
 * Unit tests for graphEpochToIso in eval-normalizers.ts.
 *
 * Jarvis writes `date_added_to_graph` as epoch milliseconds
 * (`int(time.time() * 1000)`), but older/legacy writes stamped epoch
 * seconds. graphEpochToIso must disambiguate the two using the same
 * `1e12` threshold as Jarvis's TimeFormatter.epoch_value_to_ms.
 */
import { describe, it, expect } from "vitest";
import { graphEpochToIso } from "@/lib/harvey-lab/eval-normalizers";

describe("graphEpochToIso", () => {
  it("returns null for null", () => {
    expect(graphEpochToIso(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(graphEpochToIso(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(graphEpochToIso("")).toBeNull();
  });

  it("returns null for 0", () => {
    expect(graphEpochToIso(0)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(graphEpochToIso("abc")).toBeNull();
  });

  it("returns null for negative values", () => {
    expect(graphEpochToIso(-1)).toBeNull();
  });

  it("treats a legacy Unix-seconds number as seconds (multiplies by 1000)", () => {
    const iso = graphEpochToIso(1720000000);
    expect(iso).not.toBeNull();
    expect(iso).toBe(new Date(1720000000 * 1000).toISOString());
    expect(iso!.startsWith("2024-07-03")).toBe(true);
  });

  it("treats a legacy Unix-seconds numeric string the same as the number form", () => {
    const iso = graphEpochToIso("1720000000");
    expect(iso).toBe(graphEpochToIso(1720000000));
  });

  it("treats a canonical epoch-milliseconds number as already-ms (no extra *1000)", () => {
    // Real Hive prod log timestamp from 2026.
    const msValue = 1788527805693;
    const iso = graphEpochToIso(msValue);
    expect(iso).not.toBeNull();
    expect(iso).toBe(new Date(msValue).toISOString());
    expect(new Date(iso!).getUTCFullYear()).toBe(2026);
    // Sanity: must NOT have been multiplied by 1000 again (that would land
    // in the year ~58000, not 2026).
    expect(Math.abs(Date.parse(iso!) - msValue)).toBeLessThan(1000);
  });

  it("treats a canonical epoch-milliseconds numeric string the same as the number form", () => {
    const iso = graphEpochToIso("1788527805693");
    expect(iso).toBe(graphEpochToIso(1788527805693));
    expect(new Date(iso!).getUTCFullYear()).toBe(2026);
  });

  it("threshold: exactly 1e12 is still treated as legacy seconds (multiplied)", () => {
    const iso = graphEpochToIso(1e12);
    expect(iso).toBe(new Date(1e12 * 1000).toISOString());
  });

  it("threshold: 1e12 + 1 is treated as already-milliseconds (not multiplied)", () => {
    const iso = graphEpochToIso(1e12 + 1);
    expect(iso).toBe(new Date(1e12 + 1).toISOString());
  });
});
