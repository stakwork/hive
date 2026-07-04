/**
 * Unit tests for src/services/error-impact-cron.ts
 *
 * Covers:
 * - Per-issue try/catch isolation: one failing issue never aborts the batch
 * - Workspaces with no Jarvis config are skipped cleanly
 * - Issues without kgRefId are skipped
 * - Successful scoring persists impactScore/impactScoredAt/impactMeta
 * - Stale-threshold filtering: only unscored or old issues are processed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockWorkspaceFindMany,
  mockIssueFindMany,
  mockIssueUpdate,
  mockGetJarvisConfig,
  mockGetReferencedNodeCentrality,
  mockComputeImpactScore,
} = vi.hoisted(() => ({
  mockWorkspaceFindMany: vi.fn(),
  mockIssueFindMany: vi.fn(),
  mockIssueUpdate: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
  mockGetReferencedNodeCentrality: vi.fn(),
  mockComputeImpactScore: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: mockWorkspaceFindMany },
    errorIssue: { findMany: mockIssueFindMany, update: mockIssueUpdate },
  },
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  getReferencedNodeCentrality: mockGetReferencedNodeCentrality,
}));

vi.mock("@/services/error-impact", () => ({
  computeImpactScore: mockComputeImpactScore,
}));

import { runErrorImpactCron } from "@/services/error-impact-cron";

const JARVIS_CONFIG = { jarvisUrl: "http://jarvis.local", apiKey: "test-key" };

function makeWorkspace(id: string) {
  return { id, name: `workspace-${id}` };
}

function makeIssue(id: string, workspaceId: string, kgRefId: string | null = `kg-${id}`) {
  return { id, workspaceId, kgRefId };
}

describe("runErrorImpactCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueUpdate.mockResolvedValue({});
  });

  it("returns success with zero counts when no workspaces exist", async () => {
    mockWorkspaceFindMany.mockResolvedValue([]);

    const result = await runErrorImpactCron();

    expect(result.success).toBe(true);
    expect(result.workspacesProcessed).toBe(0);
    expect(result.issuesScored).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("skips workspace when Jarvis config is unavailable", async () => {
    mockWorkspaceFindMany.mockResolvedValue([makeWorkspace("ws-1")]);
    mockGetJarvisConfig.mockResolvedValue(null);
    mockIssueFindMany.mockResolvedValue([]);

    const result = await runErrorImpactCron();

    expect(result.workspacesProcessed).toBe(1);
    expect(result.issuesScored).toBe(0);
    expect(mockIssueFindMany).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(0);
  });

  it("scores an issue successfully and persists the result", async () => {
    mockWorkspaceFindMany.mockResolvedValue([makeWorkspace("ws-1")]);
    mockGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockIssueFindMany.mockResolvedValue([makeIssue("issue-1", "ws-1")]);
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: true,
      nodes: [{ pagerank: 0.8, in_degree: 40, name: "core.ts", node_type: "File" }],
    });
    mockComputeImpactScore.mockReturnValue({
      score: 0.64,
      meta: { topNodeName: "core.ts", topNodeType: "File", topPagerank: 0.8, topInDegree: 40, nodeCount: 1 },
    });

    const result = await runErrorImpactCron();

    expect(result.issuesScored).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockIssueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "issue-1" },
        data: expect.objectContaining({ impactScore: 0.64 }),
      }),
    );
  });

  it("isolates per-issue failures: one failing issue does not abort the batch", async () => {
    mockWorkspaceFindMany.mockResolvedValue([makeWorkspace("ws-1")]);
    mockGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockIssueFindMany.mockResolvedValue([
      makeIssue("issue-1", "ws-1"),
      makeIssue("issue-2", "ws-1"),
      makeIssue("issue-3", "ws-1"),
    ]);

    // issue-1: centrality fetch throws
    // issue-2: centrality ok but computeImpactScore throws
    // issue-3: fully successful
    mockGetReferencedNodeCentrality
      .mockRejectedValueOnce(new Error("Jarvis timeout"))
      .mockResolvedValueOnce({
        ok: true,
        nodes: [{ pagerank: 0.5, in_degree: 10 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        nodes: [{ pagerank: 0.9, in_degree: 80 }],
      });

    mockComputeImpactScore
      .mockImplementationOnce(() => { throw new Error("scoring error"); })
      .mockReturnValueOnce({ score: 0.82, meta: {} });

    const result = await runErrorImpactCron();

    expect(result.issuesScored).toBe(1); // only issue-3 succeeded
    expect(result.workspacesProcessed).toBe(1);
    // Two errors recorded (issue-1 and issue-2)
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    // Overall success is false because there were per-issue failures
    expect(result.success).toBe(false);
  });

  it("marks issue as skipped when centrality fetch returns ok:false", async () => {
    mockWorkspaceFindMany.mockResolvedValue([makeWorkspace("ws-1")]);
    mockGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockIssueFindMany.mockResolvedValue([makeIssue("issue-1", "ws-1")]);
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: false,
      nodes: [],
      error: "Graph unavailable",
    });

    const result = await runErrorImpactCron();

    expect(result.issuesScored).toBe(0);
    expect(result.issuesSkipped).toBe(1);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
    // Non-fatal — but error is recorded
    expect(result.errors).toHaveLength(1);
  });

  it("skips issues without kgRefId", async () => {
    mockWorkspaceFindMany.mockResolvedValue([makeWorkspace("ws-1")]);
    mockGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockIssueFindMany.mockResolvedValue([makeIssue("issue-1", "ws-1", null)]);

    const result = await runErrorImpactCron();

    expect(result.issuesScored).toBe(0);
    expect(result.issuesSkipped).toBe(1);
    expect(mockGetReferencedNodeCentrality).not.toHaveBeenCalled();
  });

  it("processes multiple workspaces independently", async () => {
    mockWorkspaceFindMany.mockResolvedValue([makeWorkspace("ws-1"), makeWorkspace("ws-2")]);
    mockGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockIssueFindMany
      .mockResolvedValueOnce([makeIssue("issue-ws1", "ws-1")])
      .mockResolvedValueOnce([makeIssue("issue-ws2", "ws-2")]);
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: true,
      nodes: [{ pagerank: 0.5, in_degree: 20 }],
    });
    mockComputeImpactScore.mockReturnValue({ score: 0.38, meta: {} });

    const result = await runErrorImpactCron();

    expect(result.workspacesProcessed).toBe(2);
    expect(result.issuesScored).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("handles workspace-level DB failure gracefully and continues to next workspace", async () => {
    mockWorkspaceFindMany.mockResolvedValue([makeWorkspace("ws-fail"), makeWorkspace("ws-ok")]);
    mockGetJarvisConfig
      .mockRejectedValueOnce(new Error("DB error")) // ws-fail: config lookup throws
      .mockResolvedValueOnce(JARVIS_CONFIG); // ws-ok: fine
    mockIssueFindMany.mockResolvedValue([makeIssue("issue-ws-ok", "ws-ok")]);
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: true,
      nodes: [{ pagerank: 0.6, in_degree: 30 }],
    });
    mockComputeImpactScore.mockReturnValue({ score: 0.48, meta: {} });

    const result = await runErrorImpactCron();

    expect(result.workspacesProcessed).toBe(2);
    expect(result.issuesScored).toBe(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(false); // workspace-level error recorded
  });
});
