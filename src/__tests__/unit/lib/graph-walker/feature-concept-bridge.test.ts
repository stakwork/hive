/**
 * Unit tests for feature-concept-bridge.ts
 *
 * All external dependencies are mocked:
 *   - @/lib/db                     — Prisma client
 *   - @/lib/urn/edges              — upsertEdge
 *   - @/lib/urn/parse              — formatUrn
 *   - @/lib/helpers/swarm-access   — getSwarmAccessByWorkspaceId
 *   - @/lib/github/pr-monitor      — parsePRUrl
 *   - global fetch
 */
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    feature: { findUnique: vi.fn(), findMany: vi.fn() },
    artifact: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/urn/edges", () => ({
  upsertEdge: vi.fn(),
}));

vi.mock("@/lib/urn/parse", () => ({
  formatUrn: vi.fn((parts: { realm: string; org: string; workspace?: string; type: string; id: string }) => {
    if (parts.realm === "kg") {
      return `urn:${parts.org}:kg:${parts.workspace}:${parts.type}:${parts.id}`;
    }
    return `urn:${parts.org}:${parts.realm}:${parts.type}:${parts.id}`;
  }),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/github/pr-monitor", () => ({
  parsePRUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { upsertEdge } from "@/lib/urn/edges";
import { formatUrn } from "@/lib/urn/parse";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { parsePRUrl } from "@/lib/github/pr-monitor";
import { linkFeatureToConcepts, backfillFeatureConceptEdges } from "@/lib/graph-walker/feature-concept-bridge";

// ---------------------------------------------------------------------------
// Typed mock aliases
// ---------------------------------------------------------------------------

const mockDb = db as {
  feature: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  artifact: { findMany: ReturnType<typeof vi.fn> };
};
const mockUpsertEdge = upsertEdge as ReturnType<typeof vi.fn>;
const mockFormatUrn = formatUrn as ReturnType<typeof vi.fn>;
const mockGetSwarmAccess = getSwarmAccessByWorkspaceId as ReturnType<typeof vi.fn>;
const mockParsePRUrl = parsePRUrl as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FEATURE_ID = "feat-001";
const ORG_ID = "org-001";
const ORG_LOGIN = "acme";
const WORKSPACE_ID = "ws-001";
const WORKSPACE_SLUG = "my-workspace";

const SWARM_DATA = {
  workspaceId: WORKSPACE_ID,
  swarmName: "test-swarm",
  swarmUrl: "http://localhost:3355",
  swarmApiKey: "secret-key",
  swarmStatus: "ACTIVE",
  poolName: "pool-1",
  swarmSecretAlias: null,
};

const FEATURE_ROW = {
  workspace: {
    id: WORKSPACE_ID,
    slug: WORKSPACE_SLUG,
    sourceControlOrg: {
      id: ORG_ID,
      githubLogin: ORG_LOGIN,
    },
  },
};

const PR_ARTIFACT = {
  content: { url: "https://github.com/acme/repo/pull/42", repo: "repo", status: "open" },
};

const PR_PARSED = { owner: "acme", repo: "repo", prNumber: 42 };

const CONCEPT_WITH_REF = {
  id: "concept-node-id",
  name: "AuthService",
  ref_id: "ref-uuid-1234",
  description: "Handles authentication",
};

const CONCEPT_WITHOUT_REF = {
  id: "concept-no-ref",
  name: "OrphanNode",
  description: "No ref_id",
};

function mockFetchSuccess(concepts: unknown[]) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => concepts,
  } as unknown as Response);
}

function mockFetch404() {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ error: "not found" }),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: real formatUrn passthrough (already set in vi.mock factory)
  mockFormatUrn.mockImplementation((parts: { realm: string; org: string; workspace?: string; type: string; id: string }) => {
    if (parts.realm === "kg") {
      return `urn:${parts.org}:kg:${parts.workspace}:${parts.type}:${parts.id}`;
    }
    return `urn:${parts.org}:${parts.realm}:${parts.type}:${parts.id}`;
  });
});

describe("linkFeatureToConcepts", () => {
  describe("Test 1: Valid PR URL → correct :3355 URL is fetched", () => {
    it("calls fetch with the correct stakgraph URL derived from parsePRUrl", async () => {
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockFetchSuccess([CONCEPT_WITH_REF]);
      mockUpsertEdge.mockResolvedValue({});

      await linkFeatureToConcepts(FEATURE_ID);

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("/gitree/prs/42");
      expect(url).toContain("repo=acme%2Frepo");
      expect((opts as RequestInit).headers).toMatchObject({ "x-api-token": "secret-key" });
    });
  });

  describe("Test 2: Duplicate PR URLs → deduplicated", () => {
    it("calls fetch exactly once for duplicate PR artifacts", async () => {
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      // Two artifacts with the same PR URL
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT, PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockFetchSuccess([CONCEPT_WITH_REF]);
      mockUpsertEdge.mockResolvedValue({});

      await linkFeatureToConcepts(FEATURE_ID);

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Test 3: Concept with valid ref_id → upsertEdge called correctly", () => {
    it("calls upsertEdge with pg:feature URN, kg:concept URN and 'implemented-by' type", async () => {
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockFetchSuccess([CONCEPT_WITH_REF]);
      mockUpsertEdge.mockResolvedValue({});

      const result = await linkFeatureToConcepts(FEATURE_ID);

      expect(mockUpsertEdge).toHaveBeenCalledTimes(1);
      expect(mockUpsertEdge).toHaveBeenCalledWith(
        ORG_ID,
        `urn:${ORG_LOGIN}:pg:feature:${FEATURE_ID}`,
        `urn:${ORG_LOGIN}:kg:${WORKSPACE_SLUG}:concept:${CONCEPT_WITH_REF.ref_id}`,
        "implemented-by",
      );
      expect(result.edgesUpserted).toBe(1);
      expect(result.skippedNoRefId).toBe(0);
    });
  });

  describe("Test 4: Concept with ref_id undefined → upsertEdge NOT called", () => {
    it("increments skippedNoRefId and does not call upsertEdge", async () => {
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockFetchSuccess([CONCEPT_WITHOUT_REF]);
      mockUpsertEdge.mockResolvedValue({});

      const result = await linkFeatureToConcepts(FEATURE_ID);

      expect(mockUpsertEdge).not.toHaveBeenCalled();
      expect(result.skippedNoRefId).toBe(1);
      expect(result.edgesUpserted).toBe(0);
    });
  });

  describe("Test 5: Re-run → idempotent (upsertEdge called twice)", () => {
    it("upsertEdge is called twice but returns consistent count each run", async () => {
      // Setup mocks to return same state each time
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockUpsertEdge.mockResolvedValue({});

      // First run
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [CONCEPT_WITH_REF],
        } as unknown as Response)
        // Second run
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [CONCEPT_WITH_REF],
        } as unknown as Response);

      const result1 = await linkFeatureToConcepts(FEATURE_ID);
      const result2 = await linkFeatureToConcepts(FEATURE_ID);

      // Both runs succeed; upsertEdge handles dedup in DB via unique constraint
      expect(result1.edgesUpserted).toBe(1);
      expect(result2.edgesUpserted).toBe(1);
      expect(mockUpsertEdge).toHaveBeenCalledTimes(2);
      // Both calls had identical args — DB constraint makes second a no-op
      expect(mockUpsertEdge.mock.calls[0]).toEqual(mockUpsertEdge.mock.calls[1]);
    });
  });

  describe("Test 6: No active swarm → returns zeroes, no throw", () => {
    it("returns { edgesUpserted:0, skipped:0, skippedNoRefId:0 } when swarm is inactive", async () => {
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: false, error: { type: "SWARM_NOT_CONFIGURED" } });

      const result = await linkFeatureToConcepts(FEATURE_ID);

      expect(result).toEqual({ edgesUpserted: 0, skipped: 0, skippedNoRefId: 0 });
      expect(mockUpsertEdge).not.toHaveBeenCalled();
    });
  });

  describe("Test 7: stakgraph 404 → skipped++, continues", () => {
    it("increments skipped on 404 and does not throw", async () => {
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockFetch404();

      const result = await linkFeatureToConcepts(FEATURE_ID);

      expect(result.skipped).toBe(1);
      expect(result.edgesUpserted).toBe(0);
      expect(mockUpsertEdge).not.toHaveBeenCalled();
    });
  });

  describe("Test 8: Mixed batch — one concept with ref_id, one without", () => {
    it("counts edgesUpserted=1 and skippedNoRefId=1", async () => {
      mockDb.feature.findUnique.mockResolvedValue(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockFetchSuccess([CONCEPT_WITH_REF, CONCEPT_WITHOUT_REF]);
      mockUpsertEdge.mockResolvedValue({});

      const result = await linkFeatureToConcepts(FEATURE_ID);

      expect(result.edgesUpserted).toBe(1);
      expect(result.skippedNoRefId).toBe(1);
      expect(mockUpsertEdge).toHaveBeenCalledTimes(1);
    });
  });
});

describe("backfillFeatureConceptEdges", () => {
  describe("Test 9: workspaceId filter → only features in that workspace queried", () => {
    it("calls db.feature.findMany with the correct where clause including workspaceId", async () => {
      const TARGET_WS = "ws-target";
      mockDb.feature.findMany.mockResolvedValue([]);

      await backfillFeatureConceptEdges({ orgId: ORG_ID, workspaceId: TARGET_WS });

      expect(mockDb.feature.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace: expect.objectContaining({
              sourceControlOrgId: ORG_ID,
              id: TARGET_WS,
            }),
          }),
        }),
      );
    });

    it("calls db.feature.findMany without id when workspaceId is omitted", async () => {
      mockDb.feature.findMany.mockResolvedValue([]);

      await backfillFeatureConceptEdges({ orgId: ORG_ID });

      const call = mockDb.feature.findMany.mock.calls[0][0];
      expect(call.where.workspace).not.toHaveProperty("id");
    });

    it("accumulates totals across features", async () => {
      const features = [{ id: "f1" }, { id: "f2" }];
      mockDb.feature.findMany.mockResolvedValue(features);

      // For each feature: findUnique, swarm, artifacts, fetch
      mockDb.feature.findUnique
        .mockResolvedValueOnce(FEATURE_ROW)
        .mockResolvedValueOnce(FEATURE_ROW);
      mockGetSwarmAccess.mockResolvedValue({ success: true, data: SWARM_DATA });
      mockDb.artifact.findMany.mockResolvedValue([PR_ARTIFACT]);
      mockParsePRUrl.mockReturnValue(PR_PARSED);
      mockUpsertEdge.mockResolvedValue({});

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [CONCEPT_WITH_REF],
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [CONCEPT_WITH_REF],
        } as unknown as Response);

      const result = await backfillFeatureConceptEdges({ orgId: ORG_ID });

      expect(result.featuresProcessed).toBe(2);
      expect(result.edgesUpserted).toBe(2);
    });
  });
});
