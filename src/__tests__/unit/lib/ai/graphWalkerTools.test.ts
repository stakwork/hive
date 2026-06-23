/**
 * Unit tests for buildGraphWalkerTools (graph_walker capability).
 *
 * Tests:
 *   1. graph_get routes pg/canvas URNs to their resolvers; kg returns stub
 *   2. graph_neighbors pg arm delegates entirely to pgNeighbors
 *   3. graph_neighbors canvas arm unions canvas edges + UrnEdge, deduplicates
 *   4. graph_search fan-out — pg + canvas arms called; kg stub returned without throwing
 *   5. resolveCapabilities(["roadmap"]) includes "graph_walker"
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before module imports
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: { findUnique: vi.fn() },
    canvas: { findUnique: vi.fn(), findMany: vi.fn() },
    feature: { findMany: vi.fn() },
    initiative: { findMany: vi.fn() },
    milestone: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/canvas/io", () => ({
  asBlob: vi.fn(),
}));

vi.mock("@/lib/urn", () => ({
  parseUrn: vi.fn(),
  formatUrn: vi.fn(),
  UrnEdge: { neighborsOf: vi.fn() },
  resolvePgNode: vi.fn(),
  resolveCanvasNode: vi.fn(),
  parseCanvasId: vi.fn(),
}));

vi.mock("@/lib/graph-walker", () => ({
  pgNeighbors: vi.fn(),
}));

// For capabilities.ts — mock all capability tool builders so importing
// capabilities.ts doesn't pull in heavy deps.
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/constants/prompt", () => ({
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
}));
vi.mock("ai", () => ({
  tool: vi.fn((t: unknown) => t),
}));
vi.mock("@/lib/proposals/types", () => ({
  PROPOSE_FEATURE_TOOL: "propose_feature",
  PROPOSE_INITIATIVE_TOOL: "propose_initiative",
  PROPOSE_MILESTONE_TOOL: "propose_milestone",
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { asBlob } from "@/lib/canvas/io";
import {
  parseUrn,
  formatUrn,
  UrnEdge,
  resolvePgNode,
  resolveCanvasNode,
  parseCanvasId,
} from "@/lib/urn";
import { pgNeighbors } from "@/lib/graph-walker";
import { buildGraphWalkerTools } from "@/lib/ai/graphWalkerTools";
import { resolveCapabilities } from "@/lib/ai/capabilities";

// ---------------------------------------------------------------------------
// Typed mock aliases
// ---------------------------------------------------------------------------

const mockParseUrn = parseUrn as ReturnType<typeof vi.fn>;
const mockFormatUrn = formatUrn as ReturnType<typeof vi.fn>;
const mockParseCanvasId = parseCanvasId as ReturnType<typeof vi.fn>;
const mockResolvePgNode = resolvePgNode as ReturnType<typeof vi.fn>;
const mockResolveCanvasNode = resolveCanvasNode as ReturnType<typeof vi.fn>;
const mockUrnEdgeNeighborsOf = UrnEdge.neighborsOf as ReturnType<typeof vi.fn>;
const mockPgNeighbors = pgNeighbors as ReturnType<typeof vi.fn>;
const mockAsBlob = asBlob as ReturnType<typeof vi.fn>;

const dbSourceControlOrg = db.sourceControlOrg as {
  findUnique: ReturnType<typeof vi.fn>;
};
const dbCanvas = db.canvas as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};
const dbFeature = db.feature as { findMany: ReturnType<typeof vi.fn> };
const dbInitiative = db.initiative as { findMany: ReturnType<typeof vi.fn> };
const dbMilestone = db.milestone as { findMany: ReturnType<typeof vi.fn> };

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ORG_ID = "org-db-id-001";
const USER_ID = "user-id-001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTools() {
  return buildGraphWalkerTools(ORG_ID, USER_ID);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGraphWalkerTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatUrn.mockImplementation(
      (parts: { realm: string; org: string; type: string; id: string }) =>
        `urn:${parts.org}:${parts.realm}:${parts.type}:${parts.id}`,
    );
    // Default: URN org resolves to the authorized orgId
    dbSourceControlOrg.findUnique.mockResolvedValue({ id: ORG_ID });
  });

  // -------------------------------------------------------------------------
  // graph_get
  // -------------------------------------------------------------------------

  describe("graph_get", () => {
    it("returns error for invalid URN", async () => {
      mockParseUrn.mockReturnValue(null);
      const tools = getTools();
      const result = await tools.graph_get.execute({ urn: "not-a-urn" }, {} as never);
      expect(result).toEqual({ error: "invalid URN" });
    });

    it("denies access when URN org does not match the authorized orgId (IDOR guard)", async () => {
      mockParseUrn.mockReturnValue({
        realm: "pg",
        org: "other-org",
        type: "feature",
        id: "feat-x",
      });
      // The URN's org resolves to a DIFFERENT DB id
      dbSourceControlOrg.findUnique.mockResolvedValue({ id: "different-org-db-id" });

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:other-org:pg:feature:feat-x" },
        {} as never,
      );

      expect(result).toEqual({ error: "not found or access denied" });
      expect(mockResolvePgNode).not.toHaveBeenCalled();
      expect(mockResolveCanvasNode).not.toHaveBeenCalled();
    });

    it("calls resolvePgNode for pg realm and returns node", async () => {
      mockParseUrn.mockReturnValue({
        realm: "pg",
        org: "myorg",
        type: "feature",
        id: "feat-1",
      });
      const fakeNode = { id: "feat-1", title: "My Feature" };
      mockResolvePgNode.mockResolvedValue(fakeNode);

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:pg:feature:feat-1" },
        {} as never,
      );

      expect(mockResolvePgNode).toHaveBeenCalledWith("urn:myorg:pg:feature:feat-1");
      expect(result).toEqual(fakeNode);
    });

    it("returns access denied error when resolvePgNode returns null", async () => {
      mockParseUrn.mockReturnValue({
        realm: "pg",
        org: "myorg",
        type: "feature",
        id: "feat-missing",
      });
      mockResolvePgNode.mockResolvedValue(null);

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:pg:feature:feat-missing" },
        {} as never,
      );
      expect(result).toEqual({ error: "not found or access denied" });
    });

    it("calls resolveCanvasNode for canvas realm and returns node", async () => {
      mockParseUrn.mockReturnValue({
        realm: "canvas",
        org: "myorg",
        type: "node",
        id: "ref~.node-1",
      });
      const fakeNode = { id: "node-1", type: "text", text: "Hello" };
      mockResolveCanvasNode.mockResolvedValue(fakeNode);

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:canvas:node:ref~.node-1" },
        {} as never,
      );

      expect(mockResolveCanvasNode).toHaveBeenCalledWith(
        "urn:myorg:canvas:node:ref~.node-1",
      );
      expect(result).toEqual(fakeNode);
    });

    it("returns kg stub for kg realm without calling any resolver", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-workspace",
        type: "concept",
        id: "concept-1",
      });

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:kg:my-workspace:concept:concept-1" },
        {} as never,
      );

      expect(result).toEqual({ error: "kg realm not yet enabled" });
      expect(mockResolvePgNode).not.toHaveBeenCalled();
      expect(mockResolveCanvasNode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // graph_neighbors
  // -------------------------------------------------------------------------

  describe("graph_neighbors", () => {
    it("returns error for invalid URN", async () => {
      mockParseUrn.mockReturnValue(null);
      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "bad-urn" },
        {} as never,
      );
      expect(result).toEqual({ error: "invalid URN" });
    });

    it("pg arm delegates entirely to pgNeighbors and passes through result", async () => {
      mockParseUrn.mockReturnValue({
        realm: "pg",
        org: "myorg",
        type: "feature",
        id: "feat-1",
      });
      const fakeNeighbors = [
        { urn: "urn:myorg:pg:initiative:init-1", edgeType: "initiative", direction: "forward" },
      ];
      mockPgNeighbors.mockResolvedValue(fakeNeighbors);

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:pg:feature:feat-1" },
        {} as never,
      );

      expect(mockPgNeighbors).toHaveBeenCalledWith(
        "urn:myorg:pg:feature:feat-1",
        { userId: USER_ID, orgId: ORG_ID },
      );
      expect(result).toEqual({ neighbors: fakeNeighbors });
    });

    it("canvas arm unions canvas structural edges with UrnEdge neighbors and deduplicates", async () => {
      const canvasUrn = "urn:myorg:canvas:node:ws~ref1.nodeA";
      mockParseUrn.mockReturnValue({
        realm: "canvas",
        org: "myorg",
        type: "node",
        id: "ws~ref1.nodeA",
      });
      mockParseCanvasId.mockReturnValue({ ref: "ws:ref1", nodeId: "nodeA" });

      // Canvas row has two edges involving nodeA
      dbCanvas.findUnique.mockResolvedValue({
        data: {},
      });
      mockAsBlob.mockReturnValue({
        nodes: [],
        edges: [
          { id: "e1", fromNode: "nodeA", toNode: "nodeB", label: "links" },
          { id: "e2", fromNode: "nodeC", toNode: "nodeA", label: "connects" },
          // duplicate of first but from UrnEdge — should be deduplicated
        ],
      });

      // UrnEdge returns one neighbor — same as the canvas forward edge (duplicate) plus a unique one
      mockUrnEdgeNeighborsOf.mockResolvedValue([
        {
          urn: "urn:myorg:canvas:node:ws~ref1.nodeB",
          edgeType: "urn_edge",
          direction: "forward",
        },
        {
          urn: "urn:myorg:pg:feature:feat-99",
          edgeType: "cross_realm",
          direction: "forward",
        },
      ]);

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: canvasUrn },
        {} as never,
      );

      expect(result).toHaveProperty("neighbors");
      const neighbors = (result as { neighbors: unknown[] }).neighbors;
      // nodeB appears from both canvas edges and UrnEdge → should be deduplicated to 1
      const nodeBEntries = neighbors.filter((n: unknown) =>
        (n as { urn: string }).urn.includes("nodeB"),
      );
      expect(nodeBEntries).toHaveLength(1);
      // nodeC (reverse edge) should appear
      const nodeCEntries = neighbors.filter((n: unknown) =>
        (n as { urn: string }).urn.includes("nodeC"),
      );
      expect(nodeCEntries).toHaveLength(1);
      // feat-99 cross-realm should appear
      const featEntries = neighbors.filter((n: unknown) =>
        (n as { urn: string }).urn.includes("feat-99"),
      );
      expect(featEntries).toHaveLength(1);
    });

    it("kg arm returns stub without calling pgNeighbors or canvas helpers", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      expect(result).toEqual({ error: "kg realm not yet enabled" });
      expect(mockPgNeighbors).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // graph_search
  // -------------------------------------------------------------------------

  describe("graph_search", () => {
    beforeEach(() => {
      // Default: pg returns nothing, canvas returns nothing
      dbFeature.findMany.mockResolvedValue([]);
      dbInitiative.findMany.mockResolvedValue([]);
      dbMilestone.findMany.mockResolvedValue([]);
      dbCanvas.findMany.mockResolvedValue([]);
    });

    it("searches pg + canvas when no realm specified", async () => {
      // pg returns a feature
      dbFeature.findMany.mockResolvedValue([{ id: "feat-1", title: "Auth system" }]);
      // canvas returns a node
      dbCanvas.findMany.mockResolvedValue([
        {
          ref: "ws:ws1",
          data: {},
          org: { githubLogin: "myorg" },
        },
      ]);
      mockAsBlob.mockReturnValue({
        nodes: [{ id: "n1", type: "text", text: "Auth system design" }],
        edges: [],
      });

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "Auth system" },
        {} as never,
      );

      expect(result).toHaveProperty("results");
      const results = (result as { results: Array<{ realm: string }> }).results;
      // Should have both pg and canvas results
      expect(results.some((r) => r.realm === "pg")).toBe(true);
      expect(results.some((r) => r.realm === "canvas")).toBe(true);
    });

    it("only searches pg when realm='pg'", async () => {
      dbFeature.findMany.mockResolvedValue([
        { id: "feat-2", title: "Search feature" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "Search", realm: "pg" },
        {} as never,
      );

      expect(dbCanvas.findMany).not.toHaveBeenCalled();
      const results = (result as { results: Array<{ realm: string }> }).results;
      expect(results.every((r) => r.realm === "pg")).toBe(true);
    });

    it("only searches canvas when realm='canvas'", async () => {
      dbCanvas.findMany.mockResolvedValue([
        {
          ref: "",
          data: {},
          org: { githubLogin: "myorg" },
        },
      ]);
      mockAsBlob.mockReturnValue({
        nodes: [{ id: "n2", type: "text", text: "Canvas node about search" }],
        edges: [],
      });

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "Canvas", realm: "canvas" },
        {} as never,
      );

      expect(dbFeature.findMany).not.toHaveBeenCalled();
      const results = (result as { results: Array<{ realm: string }> }).results;
      expect(results.every((r) => r.realm === "canvas")).toBe(true);
    });

    it("returns kg stub without throwing when realm='kg'", async () => {
      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "anything", realm: "kg" },
        {} as never,
      );

      expect(result).toHaveProperty("results");
      const results = (result as { results: unknown[] }).results;
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ error: "kg realm not yet enabled" });
      // pg and canvas should not be queried
      expect(dbFeature.findMany).not.toHaveBeenCalled();
      expect(dbCanvas.findMany).not.toHaveBeenCalled();
    });

    it("pg results include correct urn, type, title, realm fields", async () => {
      dbFeature.findMany.mockResolvedValue([{ id: "feat-3", title: "Feature Alpha" }]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "Alpha", realm: "pg" },
        {} as never,
      );

      const results = (
        result as {
          results: Array<{ urn: string; type: string; title: string; realm: string }>;
        }
      ).results;

      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({ realm: "pg", type: "feature", id: "feat-3" }),
      );
      expect(results[0]).toMatchObject({
        type: "feature",
        title: "Feature Alpha",
        realm: "pg",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCapabilities — graph_walker included in roadmap expansion
// ---------------------------------------------------------------------------

describe("resolveCapabilities", () => {
  it('resolveCapabilities(["roadmap"]) includes "graph_walker"', () => {
    const resolved = resolveCapabilities(["roadmap"]);
    expect(resolved).toContain("graph_walker");
  });

  it('graph_walker is not included when only "planner" is selected', () => {
    const resolved = resolveCapabilities(["planner"]);
    expect(resolved).not.toContain("graph_walker");
  });
});
