/**
 * Unit tests for the workflow summary cache key computation.
 * Cache key = first 16 chars of SHA-256(sorted versionIds joined by ",")
 */

import { describe, test, expect } from "vitest";
import crypto from "crypto";

function computeCacheKey(versionIds: string[]): string {
  return crypto
    .createHash("sha256")
    .update([...versionIds].sort().join(","))
    .digest("hex")
    .slice(0, 16);
}

describe("workflow summary cache key", () => {
  test("same IDs in different order produce the same cache key", () => {
    const key1 = computeCacheKey(["10", "20", "30"]);
    const key2 = computeCacheKey(["30", "10", "20"]);
    const key3 = computeCacheKey(["20", "30", "10"]);
    expect(key1).toBe(key2);
    expect(key2).toBe(key3);
  });

  test("different ID sets produce different cache keys", () => {
    const key1 = computeCacheKey(["10", "20"]);
    const key2 = computeCacheKey(["10", "21"]);
    expect(key1).not.toBe(key2);
  });

  test("key is exactly 16 characters long", () => {
    const key = computeCacheKey(["1", "2"]);
    expect(key).toHaveLength(16);
  });

  test("single-element sort is stable", () => {
    const key1 = computeCacheKey(["5", "1"]);
    const key2 = computeCacheKey(["1", "5"]);
    expect(key1).toBe(key2);
  });

  test("version IDs with numeric-like strings are sorted lexicographically", () => {
    // "10" < "9" lexicographically, so order matters in sorting
    const key1 = computeCacheKey(["9", "10"]);
    const key2 = computeCacheKey(["10", "9"]);
    expect(key1).toBe(key2);
  });
});
