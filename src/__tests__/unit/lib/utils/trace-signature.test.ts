/**
 * Unit tests for src/lib/utils/trace-signature.ts
 *
 * Tests cover:
 *  - computeTraceSignature: stability/normalization, span ordering, client override passthrough
 *  - deriveDbTimeMs: correct DB op detection, non-DB spans excluded
 *  - resolveRepoKey: confirmed re-exported (DB behaviour tested in error-fingerprint.test.ts)
 */
import { describe, it, expect } from "vitest";

import { computeTraceSignature, deriveDbTimeMs, resolveRepoKey, type Span } from "@/lib/utils/trace-signature";

// ── computeTraceSignature ─────────────────────────────────────────────────────

describe("computeTraceSignature", () => {
  it("returns a 64-char hex SHA-256", () => {
    const sig = computeTraceSignature({ transactionName: "GET /api/users", spans: [] });
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable: same inputs produce same signature", () => {
    const spans: Span[] = [
      { op: "db.query", durationMs: 10 },
      { op: "http.client", durationMs: 50 },
    ];
    const a = computeTraceSignature({ transactionName: "GET /api/users", spans });
    const b = computeTraceSignature({ transactionName: "GET /api/users", spans });
    expect(a).toBe(b);
  });

  it("differs when transactionName changes", () => {
    const spans: Span[] = [{ op: "db.query", durationMs: 10 }];
    const a = computeTraceSignature({ transactionName: "GET /api/users", spans });
    const b = computeTraceSignature({ transactionName: "POST /api/users", spans });
    expect(a).not.toBe(b);
  });

  it("differs when span op-types change", () => {
    const a = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "db.query", durationMs: 10 }],
    });
    const b = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "http.client", durationMs: 10 }],
    });
    expect(a).not.toBe(b);
  });

  it("same signature when only span timings differ (same shape)", () => {
    const a = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "db.query", durationMs: 10 }, { op: "serialize", durationMs: 2 }],
    });
    const b = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "db.query", durationMs: 999 }, { op: "serialize", durationMs: 5 }],
    });
    expect(a).toBe(b);
  });

  it("same signature when span names differ but ops are the same", () => {
    const a = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ name: "SELECT users", op: "db.query", durationMs: 10 }],
    });
    const b = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ name: "SELECT orders", op: "db.query", durationMs: 10 }],
    });
    expect(a).toBe(b);
  });

  it("normalizes op-type to lowercase for hashing", () => {
    const a = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "DB.QUERY", durationMs: 10 }],
    });
    const b = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "db.query", durationMs: 10 }],
    });
    expect(a).toBe(b);
  });

  it("handles empty spans (span-less transactions)", () => {
    const a = computeTraceSignature({ transactionName: "GET /api/health", spans: [] });
    const b = computeTraceSignature({ transactionName: "GET /api/health" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses clientSignature override when provided", () => {
    const override = "my-custom-grouping-key";
    const sig = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "db.query", durationMs: 10 }],
      clientSignature: override,
    });
    expect(sig).toBe(override);
  });

  it("ignores empty/whitespace clientSignature and computes hash instead", () => {
    const sig1 = computeTraceSignature({
      transactionName: "GET /api/users",
      clientSignature: "   ",
    });
    const sig2 = computeTraceSignature({ transactionName: "GET /api/users" });
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("order of spans affects signature (ordered sequence)", () => {
    const a = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "db.query", durationMs: 10 }, { op: "http.client", durationMs: 50 }],
    });
    const b = computeTraceSignature({
      transactionName: "GET /api/users",
      spans: [{ op: "http.client", durationMs: 50 }, { op: "db.query", durationMs: 10 }],
    });
    expect(a).not.toBe(b);
  });
});

// ── deriveDbTimeMs ────────────────────────────────────────────────────────────

describe("deriveDbTimeMs", () => {
  it("returns 0 for empty span array", () => {
    expect(deriveDbTimeMs([])).toBe(0);
  });

  it('sums spans with op "db"', () => {
    const spans: Span[] = [{ op: "db", durationMs: 20 }];
    expect(deriveDbTimeMs(spans)).toBe(20);
  });

  it('sums spans with op "db.query"', () => {
    const spans: Span[] = [
      { op: "db.query", durationMs: 10 },
      { op: "db.query", durationMs: 15 },
    ];
    expect(deriveDbTimeMs(spans)).toBe(25);
  });

  it('sums spans with op "db.sql"', () => {
    const spans: Span[] = [{ op: "db.sql", durationMs: 30 }];
    expect(deriveDbTimeMs(spans)).toBe(30);
  });

  it('sums any "db.*" prefixed ops', () => {
    const spans: Span[] = [
      { op: "db.execute", durationMs: 5 },
      { op: "db.transaction", durationMs: 12 },
      { op: "db.custom", durationMs: 8 },
    ];
    expect(deriveDbTimeMs(spans)).toBe(25);
  });

  it("excludes non-DB spans", () => {
    const spans: Span[] = [
      { op: "http.client", durationMs: 100 },
      { op: "serialize", durationMs: 5 },
      { op: "queue.publish", durationMs: 20 },
    ];
    expect(deriveDbTimeMs(spans)).toBe(0);
  });

  it("mixes DB and non-DB spans correctly", () => {
    const spans: Span[] = [
      { op: "http.server", durationMs: 3 },
      { op: "db.query", durationMs: 12 },
      { op: "http.client", durationMs: 80 },
      { op: "db.query", durationMs: 8 },
      { op: "serialize", durationMs: 2 },
    ];
    expect(deriveDbTimeMs(spans)).toBe(20);
  });

  it("is case-insensitive for op matching", () => {
    const spans: Span[] = [{ op: "DB.QUERY", durationMs: 15 }];
    expect(deriveDbTimeMs(spans)).toBe(15);
  });
});

// ── resolveRepoKey (re-export sanity check) ───────────────────────────────────
// DB-level behaviour (URL matching, fallback repoKey) is fully covered by
// error-fingerprint.test.ts which owns resolveRepoKey's implementation.
// Here we only verify the symbol is correctly re-exported.

describe("resolveRepoKey (re-exported from error-fingerprint)", () => {
  it("is correctly re-exported as a function", () => {
    expect(typeof resolveRepoKey).toBe("function");
  });
});
