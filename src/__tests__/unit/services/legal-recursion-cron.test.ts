/**
 * Unit tests for legal-recursion-cron (deprecated no-op stub).
 */

import { describe, test, expect } from "vitest";
import { executeScheduledLegalBenchmarkRecursion } from "@/services/legal-recursion-cron";

describe("executeScheduledLegalBenchmarkRecursion (deprecated no-op)", () => {
  test("returns a successful no-op result", async () => {
    const result = await executeScheduledLegalBenchmarkRecursion();
    expect(result.success).toBe(true);
    expect(result.entriesProcessed).toBe(0);
    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.deactivated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.timestamp).toBeInstanceOf(Date);
  });
});
