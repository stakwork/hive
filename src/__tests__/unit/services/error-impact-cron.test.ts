/**
 * Unit tests for error-impact-cron service.
 *
 * Covers:
 * - Workspace/issue iteration and scoring happy path
 * - Per-issue try/catch isolation: one failing issue must not abort the batch
 * - Graph failure → issueSkipped, no throws
 * - Cron disabled → empty summary
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockFindManyWorkspace,
  mockFindManyIssue,
  mockUpdateIssue,
  mockGetJarvisConfig,
  mockGetReferencedNodeCentrality,
  mockComputeImpactScore,
} = vi.hoisted(() => ({
  mockFindManyWorkspace: vi.fn(),
  mockFindManyIssue: vi.fn(),
  mockUpdateIssue: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
  mockGetReferencedNodeCentrality: vi.fn(),
  mockComputeImpactScore: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: mockFindManyWorkspace },
    errorIssue: { findMany: mockFindManyIssue, update: mockUpdateIssue },
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const fakeJarvis = { jarvisUrl: "https://jarvis.example.com", apiKey: "test-key" };

function makeWorkspaces(ids: string[]) {
  return ids.map((id) => ({ id }));
}

function makeIssues(overrides: Array<{ id: string; kgRefId?: string | null }>) {
  return overrides.map(({ id, kgRefId = `kg-${id}` }) => ({ id, kgRefId }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runErrorImpactCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJarvisConfig.mockResolvedValue(fakeJarvis);
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: true,
      nodes: [{ pagerank: 0.8, in_degree: 100, name: "api.ts", node_type: "File" }],
    });
    mockComputeImpactScore.mockReturnValue({
      score: 0.75,
      meta: { topNodeName: "api.ts", topNodeType: "File", topPagerank: 0.8, topInDegree: 100, nodeCount: 1 },
    });
    mockUpdateIssue.mockResolvedValue({});
  });

  it("returns empty summary when no workspaces have qualifying issues", async () => {
    mockFindManyWorkspace.mockResolvedValue([]);

    const result = await runErrorImpactCron();

    expect(result.success).toBe(true);
    expect(result.workspacesProcessed).toBe(0);
    expect(result.issuesScored).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("skips workspace when jarvis config is unavailable", async () => {
    mockFindManyWorkspace.mockResolvedValue(makeWorkspaces(["ws-1"]));
    mockGetJarvisConfig.mockResolvedValue(null);

    const result = await runErrorImpactCron();

    expect(result.workspacesProcessed).toBe(0);
    expect(result.issuesScored).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("scores issues in a workspace", async () => {
    mockFindManyWorkspace.mockResolvedValue(makeWorkspaces(["ws-1"]));
    mockFindManyIssue.mockResolvedValue(makeIssues([{ id: "issue-1" }, { id: "issue-2" }]));

    const result = await runErrorImpactCron();

    expect(result.workspacesProcessed).toBe(1);
    expect(result.issuesScored).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
  });

  it("isolates failures: one failing issue does not abort the batch", async () => {
    mockFindManyWorkspace.mockResolvedValue(makeWorkspaces(["ws-1"]));
    mockFindManyIssue.mockResolvedValue(
      makeIssues([{ id: "issue-good" }, { id: "issue-bad" }, { id: "issue-also-good" }]),
    );

    // issue-bad throws from the centrality read
    mockGetReferencedNodeCentrality
      .mockResolvedValueOnce({ ok: true, nodes: [{ pagerank: 0.5, in_degree: 50 }] })
      .mockRejectedValueOnce(new Error("Jarvis unreachable"))
      .mockResolvedValueOnce({ ok: true, nodes: [{ pagerank: 0.3, in_degree: 20 }] });

    const result = await runErrorImpactCron();

    // Two good issues scored, one errored
    expect(result.issuesScored).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].issueId).toBe("issue-bad");
    expect(result.errors[0].error).toContain("Jarvis unreachable");
    // success = false because there was at least one error
    expect(result.success).toBe(false);
  });

  it("skips issues with no kgRefId", async () => {
    mockFindManyWorkspace.mockResolvedValue(makeWorkspaces(["ws-1"]));
    mockFindManyIssue.mockResolvedValue(makeIssues([{ id: "issue-no-kg", kgRefId: null }]));

    const result = await runErrorImpactCron();

    expect(result.issuesScored).toBe(0);
    expect(result.issuesSkipped).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("handles graph read failure gracefully (ok: false)", async () => {
    mockFindManyWorkspace.mockResolvedValue(makeWorkspaces(["ws-1"]));
    mockFindManyIssue.mockResolvedValue(makeIssues([{ id: "issue-1" }]));
    mockGetReferencedNodeCentrality.mockResolvedValue({
      ok: false,
      nodes: [],
      error: "timeout",
    });

    const result = await runErrorImpactCron();

    expect(result.issuesSkipped).toBe(1);
    expect(result.issuesScored).toBe(0);
    expect(result.errors).toHaveLength(0); // graph failure is logged, not an error
  });

  it("persists null score when computeImpactScore returns null (no nodes resolved)", async () => {
    mockFindManyWorkspace.mockResolvedValue(makeWorkspaces(["ws-1"]));
    mockFindManyIssue.mockResolvedValue(makeIssues([{ id: "issue-1" }]));
    mockGetReferencedNodeCentrality.mockResolvedValue({ ok: true, nodes: [] });
    mockComputeImpactScore.mockReturnValue(null);

    const result = await runErrorImpactCron();

    expect(result.issuesScored).toBe(1);
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ impactScore: null }),
      }),
    );
  });

  it("processes multiple workspaces independently", async () => {
    mockFindManyWorkspace.mockResolvedValue(makeWorkspaces(["ws-1", "ws-2"]));
    mockFindManyIssue
      .mockResolvedValueOnce(makeIssues([{ id: "issue-ws1" }]))
      .mockResolvedValueOnce(makeIssues([{ id: "issue-ws2-a" }, { id: "issue-ws2-b" }]));

    const result = await runErrorImpactCron();

    expect(result.workspacesProcessed).toBe(2);
    expect(result.issuesScored).toBe(3);
  });
});
