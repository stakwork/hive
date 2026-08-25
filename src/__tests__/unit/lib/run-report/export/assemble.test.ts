/**
 * Tests for the composable assembly layer.
 *
 * Uses existing fixtures from:
 *   - src/app/api/mock/run-report/fixtures (RUN_REPORT_FIXTURES / FULL_BUNDLE)
 *   - src/lib/run-report/fixtures/consolidated-report.fixture.json
 *
 * Mocks:
 *   - loadRunReport (from @/lib/run-report/load) — we control what the pipeline returns
 *   - prefetchNodePeeks — to assert it is called/not called and verify args
 *   - packDocuments — same
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunReportPayload } from "@/lib/run-report/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockLoadRunReport = vi.fn<() => Promise<RunReportPayload>>();
vi.mock("@/lib/run-report/load", () => ({
  loadRunReport: (...args: unknown[]) => mockLoadRunReport(...(args as Parameters<typeof mockLoadRunReport>)),
}));

const mockPrefetchNodePeeks = vi.fn();
vi.mock("@/lib/run-report/export/peek-prefetch", () => ({
  prefetchNodePeeks: (...args: unknown[]) => mockPrefetchNodePeeks(...args),
}));

const mockPackDocuments = vi.fn();
vi.mock("@/lib/run-report/export/pack-documents", () => ({
  packDocuments: (...args: unknown[]) => mockPackDocuments(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  assembleRunExport,
  assembleAttemptExport,
  assembleConsolidatedExport,
  extractRefIdsFromProjection,
} from "@/lib/run-report/export/assemble";
import { FULL_BUNDLE } from "@/app/api/mock/run-report/fixtures/full";
import { projectBundle } from "@/lib/run-report/project";
import consolidatedFixtureRaw from "@/lib/run-report/fixtures/consolidated-report.fixture.json";
import type { WorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import type { ConsolidatedReportProjection, RunReportProjection } from "@/lib/run-report/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SWARM: WorkspaceSwarmAccess = {
  workspaceId: "ws-1",
  swarmName: "test-swarm",
  swarmUrl: "https://test-swarm.sphinx.chat/api",
  swarmApiKey: "test-key",
  swarmStatus: "ACTIVE",
  poolName: "pool-1",
  swarmSecretAlias: null,
};

const OPTS = { swarmAccess: SWARM };

/** Build a full RunReportPayload from the FULL_BUNDLE fixture via the real pipeline. */
function makeFullRunPayload(): RunReportPayload {
  const outcome = projectBundle(JSON.stringify(FULL_BUNDLE));
  if (outcome.status !== "ok") throw new Error("FULL_BUNDLE fixture failed to project");
  return { runId: "run-1", hasReport: true, projection: outcome.projection };
}

/**
 * Build a RunReportPayload with synthetic ref_id nodeIdentities injected so
 * extractRefIdsFromProjection produces a non-empty list and prefetchNodePeeks
 * is actually called during assembly.
 */
function makePayloadWithRefIds(refIds: string[]): RunReportPayload {
  const outcome = projectBundle(JSON.stringify(FULL_BUNDLE));
  if (outcome.status !== "ok" || "consolidated" in outcome.projection) {
    throw new Error("FULL_BUNDLE fixture failed to project");
  }
  const proj = outcome.projection as RunReportProjection;
  const syntheticIdentities: RunReportProjection["toolActivity"]["nodeIdentities"] = refIds.map((id) => ({
    canonicalKey: id,
    identity: id,
    identityKind: "ref_id" as const,
    name: `Node ${id}`,
    nodeType: "Concept",
    runStatus: "retrieved" as const,
    runBasis: "tool-class" as const,
    agents: [],
    hasOffScreenEvidence: false,
  }));
  return {
    runId: "run-1",
    hasReport: true,
    projection: {
      ...proj,
      toolActivity: {
        ...proj.toolActivity,
        present: true,
        nodeIdentities: [
          ...proj.toolActivity.nodeIdentities,
          ...syntheticIdentities,
        ],
      },
    },
  };
}

/** Build a ConsolidatedReportPayload from the consolidated fixture. */
function makeConsolidatedPayload(): RunReportPayload {
  const outcome = projectBundle(JSON.stringify(consolidatedFixtureRaw));
  if (outcome.status !== "ok") throw new Error("Consolidated fixture failed to project");
  return { runId: "run-cons", hasReport: true, projection: outcome.projection };
}

function emptyPeekResult() {
  return { peeks: new Map(), skipped: [] };
}

function emptyPackResult() {
  return { packed: [], skipped: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrefetchNodePeeks.mockResolvedValue(emptyPeekResult());
  mockPackDocuments.mockResolvedValue(emptyPackResult());
});

// ── assembleRunExport ─────────────────────────────────────────────────────────

describe("assembleRunExport", () => {
  it("calls loadRunReport with the provided runId and reportUrl", async () => {
    const payload = makeFullRunPayload();
    mockLoadRunReport.mockResolvedValue(payload);

    await assembleRunExport("run-1", "https://s3.example.com/report.json", OPTS);

    expect(mockLoadRunReport).toHaveBeenCalledWith(
      "run-1",
      "https://s3.example.com/report.json",
    );
  });

  it("calls prefetchNodePeeks when projection is valid and has ref_ids", async () => {
    // makePayloadWithRefIds injects synthetic ref_id identities so the extractor
    // finds non-empty ref_ids and the prefetch is actually triggered.
    const payload = makePayloadWithRefIds(["ref-abc"]);
    mockLoadRunReport.mockResolvedValue(payload);

    await assembleRunExport("run-1", "https://example.com/r.json", OPTS);

    expect(mockPrefetchNodePeeks).toHaveBeenCalled();
  });

  it("includes prefetched peeks in the returned payload", async () => {
    const payload = makePayloadWithRefIds(["ref-abc", "ref-skipped"]);
    mockLoadRunReport.mockResolvedValue(payload);

    const peeked = new Map([["ref-abc", { state: "done" as const, payload: { name: "ConceptX" } }]]);
    mockPrefetchNodePeeks.mockResolvedValue({ peeks: peeked, skipped: ["ref-skipped"] });

    const result = await assembleRunExport("run-1", "https://example.com/r.json", OPTS);

    expect(result.peeks.get("ref-abc")).toEqual({ state: "done", payload: { name: "ConceptX" } });
    expect(result.skipped.peeks).toContain("ref-skipped");
  });

  it("does NOT call packDocuments for run exports", async () => {
    const payload = makeFullRunPayload();
    mockLoadRunReport.mockResolvedValue(payload);

    await assembleRunExport("run-1", "https://example.com/r.json", OPTS);

    expect(mockPackDocuments).not.toHaveBeenCalled();
  });

  it("passes through the rubricRoster and fixSnapshots from opts", async () => {
    const payload = makeFullRunPayload();
    mockLoadRunReport.mockResolvedValue(payload);
    const roster = [{ id: "crit-1", title: "Test criterion" }];
    const snaps = [{ ref_id: "fix-ref" }];

    const result = await assembleRunExport("run-1", "url", {
      ...OPTS,
      rubricRoster: roster,
      fixSnapshots: snaps,
    });

    expect(result.rubricRoster).toBe(roster);
    expect(result.fixSnapshots).toBe(snaps);
  });

  it("passes skipped peeks through to the result", async () => {
    // Inject ref_ids so the extractor finds something and prefetch is triggered.
    const payload = makePayloadWithRefIds(["ref-A", "ref-B"]);
    mockLoadRunReport.mockResolvedValue(payload);
    mockPrefetchNodePeeks.mockResolvedValue({
      peeks: new Map(),
      skipped: ["ref-A", "ref-B"],
    });

    const result = await assembleRunExport("run-1", "url", OPTS);
    expect(result.skipped.peeks).toEqual(["ref-A", "ref-B"]);
    expect(result.skipped.documents).toEqual([]);
  });
});

// ── Error branch pass-through ─────────────────────────────────────────────────

describe("assembleRunExport — error branch pass-through", () => {
  it("passes through 'unavailable' error with empty skipped", async () => {
    const payload: RunReportPayload = {
      runId: "run-err",
      hasReport: true,
      error: "unavailable",
      projection: null,
    };
    mockLoadRunReport.mockResolvedValue(payload);

    const result = await assembleRunExport("run-err", "url", OPTS);

    expect(result.report).toBe(payload);
    expect(result.peeks.size).toBe(0);
    expect(result.skipped.peeks).toEqual([]);
    expect(result.skipped.documents).toEqual([]);
    expect(mockPrefetchNodePeeks).not.toHaveBeenCalled();
  });

  it("passes through 'url_rejected' error with empty skipped", async () => {
    const payload: RunReportPayload = {
      runId: "run-rej",
      hasReport: true,
      error: "url_rejected",
      projection: null,
    };
    mockLoadRunReport.mockResolvedValue(payload);

    const result = await assembleRunExport("run-rej", "url", OPTS);

    expect(result.report.error).toBe("url_rejected");
    expect(result.peeks.size).toBe(0);
    expect(mockPrefetchNodePeeks).not.toHaveBeenCalled();
  });

  it("passes through no-report payload (hasReport: false) with empty skipped", async () => {
    const payload: RunReportPayload = {
      runId: "run-none",
      hasReport: false,
      projection: null,
    };
    mockLoadRunReport.mockResolvedValue(payload);

    const result = await assembleRunExport("run-none", null, OPTS);

    expect(result.report.hasReport).toBe(false);
    expect(result.peeks.size).toBe(0);
    expect(mockPrefetchNodePeeks).not.toHaveBeenCalled();
  });
});

// ── assembleAttemptExport ─────────────────────────────────────────────────────

describe("assembleAttemptExport", () => {
  it("has the same shape as assembleRunExport (delegates to it)", async () => {
    // Inject ref_ids so prefetch is triggered (FULL_BUNDLE has no ref_id identities).
    const payload = makePayloadWithRefIds(["ref-attempt-1"]);
    mockLoadRunReport.mockResolvedValue(payload);

    const result = await assembleAttemptExport("ref-123", "https://example.com/r.json", OPTS);

    expect(result.report).toBe(payload);
    expect(mockPrefetchNodePeeks).toHaveBeenCalled();
    expect(mockPackDocuments).not.toHaveBeenCalled();
  });

  it("passes refId as the first argument to loadRunReport", async () => {
    mockLoadRunReport.mockResolvedValue({ runId: "ref-123", hasReport: false, projection: null });

    await assembleAttemptExport("ref-123", null, OPTS);

    expect(mockLoadRunReport).toHaveBeenCalledWith("ref-123", null);
  });
});

// ── assembleConsolidatedExport ────────────────────────────────────────────────

describe("assembleConsolidatedExport", () => {
  it("calls loadRunReport", async () => {
    const payload = makeConsolidatedPayload();
    mockLoadRunReport.mockResolvedValue(payload);

    await assembleConsolidatedExport("run-cons", "url");

    expect(mockLoadRunReport).toHaveBeenCalledWith("run-cons", "url");
  });

  it("NEVER calls prefetchNodePeeks for consolidated exports", async () => {
    const payload = makeConsolidatedPayload();
    mockLoadRunReport.mockResolvedValue(payload);

    await assembleConsolidatedExport("run-cons", "url");

    expect(mockPrefetchNodePeeks).not.toHaveBeenCalled();
  });

  it("calls packDocuments with sourceFileLinks from the projection", async () => {
    const payload = makeConsolidatedPayload();
    mockLoadRunReport.mockResolvedValue(payload);

    await assembleConsolidatedExport("run-cons", "url");

    expect(mockPackDocuments).toHaveBeenCalledWith(
      (payload.projection as ConsolidatedReportProjection).sourceFileLinks,
    );
  });

  it("includes packed documents in the returned payload", async () => {
    const payload = makeConsolidatedPayload();
    mockLoadRunReport.mockResolvedValue(payload);
    const packed = [{ url: "https://example.com/doc.pdf", entryName: "doc.pdf", bytes: new Uint8Array([1, 2, 3]) }];
    mockPackDocuments.mockResolvedValue({ packed, skipped: ["https://example.com/skipped.pdf"] });

    const result = await assembleConsolidatedExport("run-cons", "url");

    expect(result.packedDocuments).toHaveLength(1);
    expect(result.packedDocuments[0].entryName).toBe("doc.pdf");
    expect(result.skipped.documents).toContain("https://example.com/skipped.pdf");
    expect(result.skipped.peeks).toEqual([]);
  });

  it("passes through error branches with empty enrichment", async () => {
    const payload: RunReportPayload = {
      runId: "run-cons-err",
      hasReport: true,
      error: "unavailable",
      projection: null,
    };
    mockLoadRunReport.mockResolvedValue(payload);

    const result = await assembleConsolidatedExport("run-cons-err", "url");

    expect(result.report.error).toBe("unavailable");
    expect(result.packedDocuments).toHaveLength(0);
    expect(result.skipped.documents).toEqual([]);
    expect(mockPackDocuments).not.toHaveBeenCalled();
  });

  it("does not call packDocuments when projection is not consolidated", async () => {
    // Return a non-consolidated projection — assemble must not call packDocuments
    const payload = makeFullRunPayload(); // standard RunReportProjection
    mockLoadRunReport.mockResolvedValue(payload);

    const result = await assembleConsolidatedExport("run-bad", "url");

    expect(mockPackDocuments).not.toHaveBeenCalled();
    expect(result.packedDocuments).toHaveLength(0);
  });
});

// ── extractRefIdsFromProjection ───────────────────────────────────────────────

describe("extractRefIdsFromProjection", () => {
  function makeProjectionWithIdentities(identities: unknown[]): RunReportProjection {
    const outcome = projectBundle(JSON.stringify(FULL_BUNDLE));
    if (outcome.status !== "ok" || "consolidated" in outcome.projection) {
      throw new Error("fixture projection failed");
    }
    const proj = outcome.projection as RunReportProjection;
    // Inject nodeIdentities
    return {
      ...proj,
      toolActivity: {
        ...proj.toolActivity,
        present: true,
        nodeIdentities: identities as RunReportProjection["toolActivity"]["nodeIdentities"],
      },
    };
  }

  it("extracts ref_id identity rows from toolActivity.nodeIdentities", () => {
    const proj = makeProjectionWithIdentities([
      { identityKind: "ref_id", identity: "ref-abc" },
      { identityKind: "ref_id", identity: "ref-def" },
    ]);
    const ids = extractRefIdsFromProjection(proj, null);
    expect(ids).toContain("ref-abc");
    expect(ids).toContain("ref-def");
  });

  it("ignores non-ref_id identity rows", () => {
    const proj = makeProjectionWithIdentities([
      { identityKind: "name", identity: "SomeConcept" },
      { identityKind: "ref_id", identity: "ref-valid" },
    ]);
    const ids = extractRefIdsFromProjection(proj, null);
    expect(ids).toContain("ref-valid");
    expect(ids).not.toContain("SomeConcept");
  });

  it("deduplicates ref_ids", () => {
    const proj = makeProjectionWithIdentities([
      { identityKind: "ref_id", identity: "ref-dup" },
      { identityKind: "ref_id", identity: "ref-dup" },
    ]);
    const ids = extractRefIdsFromProjection(proj, null);
    expect(ids.filter((id) => id === "ref-dup")).toHaveLength(1);
  });

  it("extracts ref_ids from fix snapshots (ref_id field)", () => {
    const proj = makeProjectionWithIdentities([]);
    const fixSnapshots = [{ ref_id: "fix-ref-1" }, { ref_id: "fix-ref-2" }];
    const ids = extractRefIdsFromProjection(proj, fixSnapshots);
    expect(ids).toContain("fix-ref-1");
    expect(ids).toContain("fix-ref-2");
  });

  it("extracts ref_ids from fix snapshots (camelCase refId field)", () => {
    const proj = makeProjectionWithIdentities([]);
    const fixSnapshots = [{ refId: "fix-camel-ref" }];
    const ids = extractRefIdsFromProjection(proj, fixSnapshots);
    expect(ids).toContain("fix-camel-ref");
  });

  it("handles null fixSnapshots gracefully", () => {
    const proj = makeProjectionWithIdentities([]);
    expect(() => extractRefIdsFromProjection(proj, null)).not.toThrow();
    const ids = extractRefIdsFromProjection(proj, null);
    expect(Array.isArray(ids)).toBe(true);
  });

  it("handles non-array fixSnapshots gracefully", () => {
    const proj = makeProjectionWithIdentities([]);
    expect(() => extractRefIdsFromProjection(proj, "not-an-array")).not.toThrow();
  });

  it("ignores blank ref_id strings", () => {
    const proj = makeProjectionWithIdentities([
      { identityKind: "ref_id", identity: "   " },
      { identityKind: "ref_id", identity: "" },
    ]);
    const ids = extractRefIdsFromProjection(proj, null);
    expect(ids.every((id) => id.trim().length > 0)).toBe(true);
  });

  it("returns empty array when toolActivity is not present", () => {
    const outcome = projectBundle(JSON.stringify(FULL_BUNDLE));
    if (outcome.status !== "ok" || "consolidated" in outcome.projection) {
      throw new Error("fixture failed");
    }
    const proj = outcome.projection as RunReportProjection;
    const projNoActivity = {
      ...proj,
      toolActivity: { ...proj.toolActivity, present: false, nodeIdentities: [] },
    };
    const ids = extractRefIdsFromProjection(projNoActivity, null);
    expect(Array.isArray(ids)).toBe(true);
  });
});

// ── prefetchNodePeeks integration with fixSnapshots ───────────────────────────

describe("assembleRunExport — fix snapshot ref_ids fed to peek prefetch", () => {
  it("includes fix-snapshot ref_ids in the peek prefetch call", async () => {
    const payload = makeFullRunPayload();
    mockLoadRunReport.mockResolvedValue(payload);
    const fixSnapshots = [{ ref_id: "fix-ref-123" }];

    await assembleRunExport("run-1", "url", {
      ...OPTS,
      fixSnapshots,
    });

    const [refIds] = mockPrefetchNodePeeks.mock.calls[0] as [string[], WorkspaceSwarmAccess];
    expect(refIds).toContain("fix-ref-123");
  });
});
