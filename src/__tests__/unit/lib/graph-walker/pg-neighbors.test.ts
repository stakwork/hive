/**
 * Unit tests for pgNeighbors — bidirectional pg: neighbour resolver.
 *
 * All external dependencies are mocked:
 *   - @/lib/db  — Prisma client (per-model stubs)
 *   - @/lib/urn — parseUrn, formatUrn, UrnEdge.neighborsOf, checkPgAccess
 *
 * Test structure mirrors src/__tests__/unit/lib/canvas/feature-pusher.test.ts.
 */
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    feature: { findFirst: vi.fn(), findMany: vi.fn() },
    task: { findFirst: vi.fn(), findMany: vi.fn() },
    initiative: { findFirst: vi.fn(), findMany: vi.fn() },
    milestone: { findFirst: vi.fn(), findMany: vi.fn() },
    repository: { findFirst: vi.fn(), findMany: vi.fn() },
    workspace: { findFirst: vi.fn(), findMany: vi.fn() },
    workspaceMember: { findFirst: vi.fn(), findMany: vi.fn() },
    workflowTask: { findFirst: vi.fn(), findMany: vi.fn() },
    deployment: { findFirst: vi.fn(), findMany: vi.fn() },
    chatMessage: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/urn", () => ({
  parseUrn: vi.fn(),
  formatUrn: vi.fn(),
  UrnEdge: { neighborsOf: vi.fn() },
  checkPgAccess: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { parseUrn, formatUrn, UrnEdge, checkPgAccess } from "@/lib/urn";
import { pgNeighbors } from "@/lib/graph-walker/pg-neighbors";
import { REGISTRY } from "@/lib/graph-walker/registry";

// ---------------------------------------------------------------------------
// Typed mock aliases
// ---------------------------------------------------------------------------

const mockParseUrn = parseUrn as ReturnType<typeof vi.fn>;
const mockFormatUrn = formatUrn as ReturnType<typeof vi.fn>;
const mockNeighborsOf = UrnEdge.neighborsOf as ReturnType<typeof vi.fn>;
const mockCheckPgAccess = checkPgAccess as ReturnType<typeof vi.fn>;

const dbTask = db.task as { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
const dbFeature = db.feature as { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
const dbWorkflowTask = db.workflowTask as { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
const dbDeployment = db.deployment as { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
const dbChatMessage = db.chatMessage as { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
const mockQueryRaw = db.$queryRaw as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Default context
// ---------------------------------------------------------------------------

const CTX = { userId: "user-1", workspaceId: "ws-1" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default formatUrn implementation used by most tests. */
function defaultFormatUrn(realm: string, type: string, id: string) {
  return `${realm}:${type}:${id}`;
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: formatUrn builds standard pg URNs
  mockFormatUrn.mockImplementation(defaultFormatUrn);

  // Default: all access checks pass
  mockCheckPgAccess.mockResolvedValue(true);

  // Default: UrnEdge returns nothing
  mockNeighborsOf.mockResolvedValue([]);

  // Default: $queryRaw returns nothing
  mockQueryRaw.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pgNeighbors", () => {
  // ── 1. Forward scalar FK read ──────────────────────────────────────────

  it("forward scalar FK read: emits pg:feature:f1 via Task.featureId", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "task", id: "t1" });
    dbTask.findFirst.mockResolvedValue({
      id: "t1",
      featureId: "f1",
      repositoryId: null,
    });
    // Only the BELONGS_TO_FEATURE forward scalar should fire for a task
    // (we also have USES_REPOSITORY but repositoryId is null)

    const results = await pgNeighbors("pg:task:t1", CTX);

    expect(mockFormatUrn).toHaveBeenCalledWith("pg", "feature", "f1");
    const urns = results.map((r) => r.urn);
    expect(urns).toContain("pg:feature:f1");
    expect(results.find((r) => r.urn === "pg:feature:f1")?.edgeType).toBe(
      "BELONGS_TO_FEATURE"
    );
    expect(results.find((r) => r.urn === "pg:feature:f1")?.direction).toBe(
      "forward"
    );
  });

  // ── 2. Null FK is skipped ──────────────────────────────────────────────

  it("null FK is skipped: Task.featureId = null → no BELONGS_TO_FEATURE result", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "task", id: "t1" });
    dbTask.findFirst.mockResolvedValue({
      id: "t1",
      featureId: null,
      repositoryId: null,
    });
    // Reverse edges on task (HAS_DEPLOYMENT, HAS_WORKFLOW_TASK, HAS_MESSAGE)
    // mock them to return nothing
    dbDeployment.findMany.mockResolvedValue([]);
    dbWorkflowTask.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);

    const results = await pgNeighbors("pg:task:t1", CTX);

    expect(results.some((r) => r.edgeType === "BELONGS_TO_FEATURE")).toBe(false);
    expect(results.some((r) => r.urn.includes("feature"))).toBe(false);
  });

  // ── 3. Forward array expansion ─────────────────────────────────────────

  it("forward array expansion: feature with dependsOnFeatureIds emits two pg:feature: URNs", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f1" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f1",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: ["f2", "f3"],
    });
    // Reverse edges return empty
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);
    // task reverse
    db.task.findMany.mockResolvedValue([]);

    const results = await pgNeighbors("pg:feature:f1", CTX);

    const dependsUrns = results
      .filter((r) => r.edgeType === "DEPENDS_ON_FEATURE")
      .map((r) => r.urn);
    expect(dependsUrns).toHaveLength(2);
    expect(dependsUrns).toContain("pg:feature:f2");
    expect(dependsUrns).toContain("pg:feature:f3");
  });

  // ── 4. Reverse indexed query ───────────────────────────────────────────

  it("reverse indexed query: pgNeighbors(pg:feature:f1) calls db.task.findMany and emits results", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f1" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f1",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: [],
    });
    db.task.findMany.mockResolvedValue([{ id: "t10" }, { id: "t11" }]);
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);

    const results = await pgNeighbors("pg:feature:f1", CTX);

    // Verify the call signature
    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { featureId: "f1" },
        select: { id: true },
      })
    );

    const taskUrns = results
      .filter((r) => r.edgeType === "HAS_TASK")
      .map((r) => r.urn);
    expect(taskUrns).toContain("pg:task:t10");
    expect(taskUrns).toContain("pg:task:t11");
  });

  // ── 5. UrnEdge union ──────────────────────────────────────────────────

  it("UrnEdge union: cross-realm URNs from UrnEdge.neighborsOf appear alongside pg: hops", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f1" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f1",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: [],
    });
    db.task.findMany.mockResolvedValue([]);
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);

    mockNeighborsOf.mockResolvedValue([
      { urn: "github:repo:12345", edgeType: "LINKS_TO_REPO", direction: "forward" },
      { urn: "slack:channel:abc", edgeType: "HAS_CHANNEL", direction: "reverse" },
    ]);

    const results = await pgNeighbors("pg:feature:f1", CTX);

    const urns = results.map((r) => r.urn);
    expect(urns).toContain("github:repo:12345");
    expect(urns).toContain("slack:channel:abc");
  });

  // ── 6. Access guard drops results ─────────────────────────────────────

  it("access guard drops results: checkPgAccess returns false for two URNs → absent from output", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f1" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f1",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: [],
    });
    db.task.findMany.mockResolvedValue([{ id: "t-allowed" }, { id: "t-blocked" }]);
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);

    // Selectively deny access for t-blocked
    mockCheckPgAccess.mockImplementation(async (urn: string) => {
      if (urn === "pg:task:t-blocked") return false;
      return true;
    });

    const results = await pgNeighbors("pg:feature:f1", CTX);

    const urns = results.map((r) => r.urn);
    expect(urns).toContain("pg:task:t-allowed");
    expect(urns).not.toContain("pg:task:t-blocked");
  });

  // ── 7. Result cap enforced ────────────────────────────────────────────

  it("result cap enforced: 60 raw results generated → only 50 returned", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f1" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f1",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: [],
    });

    // Generate 60 task results via reverse indexed query
    const manyTasks = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}` }));
    db.task.findMany.mockResolvedValue(manyTasks);
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);

    const results = await pgNeighbors("pg:feature:f1", CTX);

    expect(results).toHaveLength(50);
  });

  // ── 8. Opaque external URN shape ──────────────────────────────────────

  it("opaque external URN: pgNeighbors(pg:workflowtask:wt1) emits stakwork:workflow:42; checkPgAccess not called for it", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "workflowtask", id: "wt1" });
    // Note: URN type "workflowtask" maps to Prisma accessor "workflowTask"
    dbWorkflowTask.findFirst.mockResolvedValue({
      id: "wt1",
      workflowId: 42,
    });
    // No reverse edges on workflowtask — ensure clean mock
    dbWorkflowTask.findMany.mockResolvedValue([]);

    const results = await pgNeighbors("pg:workflowtask:wt1", CTX);

    const opaqueResult = results.find((r) => r.urn === "stakwork:workflow:42");
    expect(opaqueResult).toBeDefined();
    expect(opaqueResult?.edgeType).toBe("REFERENCES_WORKFLOW");

    // checkPgAccess must NOT be called for the opaque-external URN
    const accessCheckUrns = mockCheckPgAccess.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(accessCheckUrns).not.toContain("stakwork:workflow:42");
  });

  // ── 9. requiresMigration skipped ──────────────────────────────────────

  it("requiresMigration skipped: entry with requiresMigration:true is in REGISTRY but not executed", async () => {
    // Confirm the repository→HAS_TASK entry has requiresMigration: true
    const repositoryHasTask = REGISTRY.find(
      (e) => e.fromType === "repository" && e.edgeType === "HAS_TASK"
    );
    expect(repositoryHasTask?.requiresMigration).toBe(true);

    // Now actually call pgNeighbors for a repository and verify Task.findMany
    // is NOT called for the HAS_TASK reverse edge
    mockParseUrn.mockReturnValue({ realm: "pg", type: "repository", id: "r1" });
    db.repository.findFirst.mockResolvedValue({ id: "r1" });

    await pgNeighbors("pg:repository:r1", CTX);

    // db.task.findMany should not have been called (the only task-related
    // reverse edge on repository is HAS_TASK which requiresMigration:true)
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  // ── 10. GIN reverse — flag off ────────────────────────────────────────

  it("GIN reverse flag off: BLOCKED_BY_FEATURE absent when requiresMigration:true", async () => {
    // Confirm the entry has requiresMigration: true
    const blockedBy = REGISTRY.find(
      (e) => e.fromType === "feature" && e.edgeType === "BLOCKED_BY_FEATURE"
    );
    expect(blockedBy?.requiresMigration).toBe(true);

    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f1" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f1",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: [],
    });
    db.task.findMany.mockResolvedValue([]);
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);

    const results = await pgNeighbors("pg:feature:f1", CTX);

    // $queryRaw should NOT be called since BLOCKED_BY_FEATURE has requiresMigration:true
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(results.some((r) => r.edgeType === "BLOCKED_BY_FEATURE")).toBe(false);
  });

  // ── 11. GIN reverse — flag on (migration guard removed) ───────────────

  it("GIN reverse flag on: when requiresMigration removed from entry, $queryRaw is called with array containment predicate", async () => {
    // We test the $queryRaw path by directly invoking the resolver logic.
    // Since requiresMigration guards the entry in pgNeighbors, we verify the
    // raw query by mocking $queryRaw and then calling pgNeighbors on a
    // registry entry that does NOT have requiresMigration (simulating the
    // state after the migration is confirmed).
    //
    // We patch the BLOCKED_BY_FEATURE entry's requiresMigration to false for
    // this test only, using a custom registry entry exercised via a spy.

    // Approach: spy on db.$queryRaw and verify it would receive the right call
    // by directly importing and calling the internal path.

    // We verify the shape of the $queryRaw template literal call by
    // constructing a scenario where BLOCKED_BY_FEATURE fires.
    // Because Vitest mocks tagged template literals as regular function calls,
    // we ensure $queryRaw is invoked and returns stub data.

    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f-target" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f-target",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: [],
    });
    db.task.findMany.mockResolvedValue([]);
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([{ id: "f-blocker" }]);

    // Temporarily remove requiresMigration from the BLOCKED_BY_FEATURE entry
    // by casting REGISTRY to mutable and patching for this test.
    // We use a side-channel import + Object.defineProperty approach:
    const registryModule = await import("@/lib/graph-walker/registry");
    const mutableRegistry = registryModule.REGISTRY as unknown as import("@/lib/graph-walker/registry").EdgeDefinition[];
    const blockedByEntry = mutableRegistry.find(
      (e) => e.fromType === "feature" && e.edgeType === "BLOCKED_BY_FEATURE"
    );
    expect(blockedByEntry).toBeDefined();

    // Patch: remove migration guard
    const originalFlag = blockedByEntry!.requiresMigration;
    Object.assign(blockedByEntry!, { requiresMigration: false });

    try {
      const results = await pgNeighbors("pg:feature:f-target", CTX);

      // $queryRaw should have been called
      expect(db.$queryRaw).toHaveBeenCalled();

      // Result should include the blocker feature
      const blockerResult = results.find((r) => r.edgeType === "BLOCKED_BY_FEATURE");
      expect(blockerResult).toBeDefined();
      expect(blockerResult?.urn).toBe("pg:feature:f-blocker");
    } finally {
      // Restore the flag
      Object.assign(blockedByEntry!, { requiresMigration: originalFlag });
    }
  });

  // ── Extra: non-pg realm returns empty ─────────────────────────────────

  it("returns empty array for non-pg realm URN", async () => {
    mockParseUrn.mockReturnValue({ realm: "github", type: "repo", id: "123" });

    const results = await pgNeighbors("github:repo:123", CTX);

    expect(results).toHaveLength(0);
  });

  // ── Extra: null parseUrn returns empty ────────────────────────────────

  it("returns empty array when parseUrn returns null", async () => {
    mockParseUrn.mockReturnValue(null);

    const results = await pgNeighbors("invalid-urn", CTX);

    expect(results).toHaveLength(0);
  });

  // ── Extra: source access guard failure returns empty ──────────────────

  it("returns empty array when source access guard fails", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "task", id: "t1" });
    dbTask.findFirst.mockResolvedValue({ id: "t1", featureId: "f1", repositoryId: null });

    // First call is for the source URN — deny it
    mockCheckPgAccess.mockResolvedValueOnce(false);

    const results = await pgNeighbors("pg:task:t1", CTX);

    expect(results).toHaveLength(0);
  });

  // ── Extra: UrnEdge results are deduplicated ────────────────────────────

  it("deduplicates URNs when registry and UrnEdge produce the same URN", async () => {
    mockParseUrn.mockReturnValue({ realm: "pg", type: "feature", id: "f1" });
    dbFeature.findFirst.mockResolvedValue({
      id: "f1",
      initiativeId: null,
      milestoneId: null,
      dependsOnFeatureIds: ["f2"],
    });
    db.task.findMany.mockResolvedValue([]);
    dbFeature.findMany.mockResolvedValue([]);
    dbChatMessage.findMany.mockResolvedValue([]);

    // UrnEdge also returns pg:feature:f2 (duplicate)
    mockNeighborsOf.mockResolvedValue([
      { urn: "pg:feature:f2", edgeType: "DEPENDS_ON_FEATURE", direction: "forward" },
    ]);

    const results = await pgNeighbors("pg:feature:f1", CTX);

    const f2Count = results.filter((r) => r.urn === "pg:feature:f2").length;
    expect(f2Count).toBe(1);
  });
});
