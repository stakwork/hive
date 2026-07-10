/**
 * Unit tests for buildGraphWalkerTools (graph_walker capability).
 *
 * Tests:
 *   1. graph_get routes pg/canvas URNs to their resolvers; kg arm calls resolveKgSeam + kgGetNode
 *   2. graph_neighbors pg arm delegates entirely to pgNeighbors
 *   3. graph_neighbors canvas arm unions canvas edges + UrnEdge, deduplicates
 *   4. graph_neighbors kg arm calls resolveKgSeam + kgGetNeighbors; direction/importance/filters
 *   5. graph_search fan-out — pg + canvas arms called; kg arm uses resolveKgSeam + kgSearch
 *   6. resolveCapabilities(["roadmap"]) includes "graph_walker"
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
    task: { findMany: vi.fn() },
    workspace: { findMany: vi.fn() },
    repository: { findMany: vi.fn() },
    research: { findMany: vi.fn() },
    connection: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
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

vi.mock("@/lib/urn/resolvers/kg", () => ({
  resolveKgSeam: vi.fn(),
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNode: vi.fn(),
  kgGetNeighbors: vi.fn(),
  kgGetNodesByRefs: vi.fn(),
  kgSearch: vi.fn(),
  kgGetOntology: vi.fn(),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

// For capabilities.ts — mock all capability tool builders so importing
// capabilities.ts doesn't pull in heavy deps.
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/constants/prompt", () => ({
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
}));
vi.mock("ai", () => ({
  tool: vi.fn((t: unknown) => t),
}));
vi.mock("@/lib/proposals/types", () => ({
  PROPOSE_FEATURE_TOOL: "propose_feature",
  PROPOSE_INITIATIVE_TOOL: "propose_initiative",
  PROPOSE_MILESTONE_TOOL: "propose_milestone",
  PROPOSE_NEW_PROMPT_TOOL: "propose_new_prompt",
  PROPOSE_PROMPT_UPDATE_TOOL: "propose_prompt_update",
  PROPOSE_NEW_CONCEPT_TOOL: "propose_new_concept",
  PROPOSE_CONCEPT_UPDATE_TOOL: "propose_concept_update",
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
import { resolveKgSeam } from "@/lib/urn/resolvers/kg";
import { kgGetNode, kgGetNeighbors, kgGetNodesByRefs, kgSearch, kgGetOntology } from "@/lib/ai/kg-adapter";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";

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
const mockResolveKgSeam = resolveKgSeam as ReturnType<typeof vi.fn>;
const mockKgGetNode = kgGetNode as ReturnType<typeof vi.fn>;
const mockKgGetNeighbors = kgGetNeighbors as ReturnType<typeof vi.fn>;
const mockKgGetNodesByRefs = kgGetNodesByRefs as ReturnType<typeof vi.fn>;
const mockKgSearch = kgSearch as ReturnType<typeof vi.fn>;
const mockKgGetOntology = kgGetOntology as ReturnType<typeof vi.fn>;
const mockGetSwarmAccessByWorkspaceId = getSwarmAccessByWorkspaceId as ReturnType<typeof vi.fn>;

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
const dbTask = db.task as { findMany: ReturnType<typeof vi.fn> };
const dbWorkspace = db.workspace as { findMany: ReturnType<typeof vi.fn> };
const dbRepository = db.repository as { findMany: ReturnType<typeof vi.fn> };
const dbResearch = db.research as { findMany: ReturnType<typeof vi.fn> };
const dbConnection = db.connection as { findMany: ReturnType<typeof vi.fn> };
const dbQueryRaw = (db as unknown as { $queryRaw: ReturnType<typeof vi.fn> })
  .$queryRaw;

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

    it("pg realm is DISABLED: returns a disabled note without calling resolvePgNode", async () => {
      mockParseUrn.mockReturnValue({
        realm: "pg",
        org: "myorg",
        type: "feature",
        id: "feat-1",
      });
      mockResolvePgNode.mockResolvedValue({ id: "feat-1", title: "My Feature" });

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:pg:feature:feat-1" },
        {} as never,
      );

      // pg is gated off — the resolver is never consulted and the caller is
      // told to use the kg realm instead.
      expect(mockResolvePgNode).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("pg realm is disabled") });
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

    it("kg arm: returns error when resolveKgSeam returns null (IDOR guard)", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-workspace",
        type: "concept",
        id: "concept-1",
      });
      mockResolveKgSeam.mockResolvedValue(null);

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:kg:my-workspace:concept:concept-1" },
        {} as never,
      );

      expect(result).toEqual({ error: "swarm not configured or access denied" });
      // IDOR guard fires before any fetch
      expect(mockKgGetNode).not.toHaveBeenCalled();
      expect(mockResolvePgNode).not.toHaveBeenCalled();
      expect(mockResolveCanvasNode).not.toHaveBeenCalled();
    });

    it("kg arm: happy path returns node fields", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-workspace",
        type: "concept",
        id: "concept-1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-workspace",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNode.mockResolvedValue({
        ref_id: "concept-1",
        node_type: "concept",
        name: "Concept One",
        properties: { foo: "bar" },
      });

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:kg:my-workspace:concept:concept-1" },
        {} as never,
      );

      expect(result).toEqual({
        ref_id: "concept-1",
        node_type: "concept",
        name: "Concept One",
        properties: { foo: "bar" },
      });
      // resolveKgSeam called BEFORE kgGetNode
      const resolveOrder = mockResolveKgSeam.mock.invocationCallOrder[0];
      const getOrder = mockKgGetNode.mock.invocationCallOrder[0];
      expect(resolveOrder).toBeLessThan(getOrder);
    });

    it("kg arm: returns error when kgGetNode returns null (node not found)", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-workspace",
        type: "concept",
        id: "missing",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-workspace",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNode.mockResolvedValue(null);

      const tools = getTools();
      const result = await tools.graph_get.execute(
        { urn: "urn:myorg:kg:my-workspace:concept:missing" },
        {} as never,
      );

      expect(result).toEqual({ error: "node not found" });
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

    it("pg realm is DISABLED: returns a disabled note without calling pgNeighbors", async () => {
      mockParseUrn.mockReturnValue({
        realm: "pg",
        org: "myorg",
        type: "feature",
        id: "feat-1",
      });
      mockPgNeighbors.mockResolvedValue([
        { urn: "urn:myorg:pg:initiative:init-1", edgeType: "initiative", direction: "forward" },
      ]);

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:pg:feature:feat-1" },
        {} as never,
      );

      expect(mockPgNeighbors).not.toHaveBeenCalled();
      expect(result).toMatchObject({ error: expect.stringContaining("pg realm is disabled") });
    });

    it("kg arm maps the derived node name onto each neighbor's title", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNeighbors.mockResolvedValue({
        neighbors: [
          {
            urn: "",
            edgeType: "MODIFIES",
            direction: "forward",
            node_type: "File",
            ref_id: "file-ref",
            name: "graphWalkerTools.ts",
          },
        ],
        reachable: true,
      });
      mockFormatUrn.mockImplementation(
        (p: { realm: string; org: string; workspace?: string; type: string; id: string }) =>
          `urn:${p.org}:${p.realm}:${p.workspace ? p.workspace + ":" : ""}${p.type}:${p.id}`,
      );

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      const neighbors = (result as { neighbors: Array<{ title?: string; name?: string }> }).neighbors;
      expect(neighbors[0].title).toBe("graphWalkerTools.ts");
      // raw `name` is folded into `title`, not duplicated on the output
      expect(neighbors[0].name).toBeUndefined();
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

    it("kg arm: null seam → swarm not configured error", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue(null);

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      expect(result).toEqual({ error: "swarm not configured or access denied" });
      expect(mockPgNeighbors).not.toHaveBeenCalled();
      expect(mockKgGetNeighbors).not.toHaveBeenCalled();
    });

    it("kg arm: reachable:false → swarm unreachable error", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: false });

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      expect(result).toEqual({ error: "swarm unreachable" });
    });

    it("kg arm: reachable:true with empty neighbors → { neighbors: [] } (not an error)", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: true });

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      expect(result).toEqual({ neighbors: [] });
    });

    it("kg arm: forward direction neighbor gets minted URN", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNeighbors.mockResolvedValue({
        neighbors: [
          {
            urn: "",
            edgeType: "MODIFIES",
            direction: "forward",
            node_type: "File",
            ref_id: "file-ref",
          },
        ],
        reachable: true,
      });
      mockFormatUrn.mockImplementation(
        (p: { realm: string; org: string; workspace?: string; type: string; id: string }) =>
          `urn:${p.org}:${p.realm}:${p.workspace ? p.workspace + ":" : ""}${p.type}:${p.id}`,
      );

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      const neighbors = (result as { neighbors: Array<{ urn: string; direction: string }> }).neighbors;
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].direction).toBe("forward");
      expect(neighbors[0].urn).toContain("myorg");
      expect(neighbors[0].urn).toContain("my-ws");
      expect(neighbors[0].urn).toContain("file-ref");
    });

    it("kg arm: reverse direction neighbor", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNeighbors.mockResolvedValue({
        neighbors: [
          {
            urn: "",
            edgeType: "TOUCHES",
            direction: "reverse",
            node_type: "Function",
            ref_id: "fn-ref",
          },
        ],
        reachable: true,
      });

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      const neighbors = (result as { neighbors: Array<{ direction: string }> }).neighbors;
      expect(neighbors[0].direction).toBe("reverse");
    });

    it("kg arm: importance forwarded to output neighbor", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNeighbors.mockResolvedValue({
        neighbors: [
          {
            urn: "",
            edgeType: "MODIFIES",
            direction: "forward",
            node_type: "File",
            ref_id: "f-ref",
            importance: 0.9,
          },
        ],
        reachable: true,
      });

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:kg:my-ws:concept:c1" },
        {} as never,
      );

      const neighbors = (result as { neighbors: Array<{ importance?: number }> }).neighbors;
      expect(neighbors[0].importance).toBe(0.9);
    });

    it("kg arm: edge_type and node_type filters forwarded to kgGetNeighbors", async () => {
      mockParseUrn.mockReturnValue({
        realm: "kg",
        org: "myorg",
        workspace: "my-ws",
        type: "concept",
        id: "c1",
      });
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: true });

      const tools = getTools();
      await tools.graph_neighbors.execute(
        {
          urn: "urn:myorg:kg:my-ws:concept:c1",
          edge_type: ["MODIFIES", "CITES"],
          node_type: ["File"],
        } as { urn: string; edge_type?: string[]; node_type?: string[] },
        {} as never,
      );

      expect(mockKgGetNeighbors).toHaveBeenCalledWith(
        "https://jarvis.example.com",
        "key-123",
        "c1",
        { edgeTypes: ["MODIFIES", "CITES"], nodeTypes: ["File"] },
      );
    });
  });

  // -------------------------------------------------------------------------
  // graph_search
  // -------------------------------------------------------------------------

  describe("graph_search", () => {
    beforeEach(() => {
      // graph_search resolves the org's githubLogin once for URN construction.
      dbSourceControlOrg.findUnique.mockResolvedValue({ githubLogin: "myorg" });
      // Default: every arm returns nothing
      dbFeature.findMany.mockResolvedValue([]);
      dbInitiative.findMany.mockResolvedValue([]);
      dbMilestone.findMany.mockResolvedValue([]);
      dbTask.findMany.mockResolvedValue([]);
      dbWorkspace.findMany.mockResolvedValue([]);
      dbRepository.findMany.mockResolvedValue([]);
      dbResearch.findMany.mockResolvedValue([]);
      dbConnection.findMany.mockResolvedValue([]);
      dbCanvas.findMany.mockResolvedValue([]);
      dbQueryRaw.mockResolvedValue([]);
    });

    it("searches canvas + kg (fan-out) when no realm specified; pg is skipped", async () => {
      // pg is disabled — even though a feature exists, the pg arm must not run.
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
      // kg fan-out: one member workspace with a reachable swarm.
      dbWorkspace.findMany.mockResolvedValue([{ id: "ws-1", slug: "workspace-one" }]);
      mockGetSwarmAccessByWorkspaceId.mockResolvedValue({
        success: true,
        data: { swarmUrl: "https://jarvis1.example.com", swarmName: "swarm-one", swarmApiKey: "key-1" },
      });
      mockKgSearch.mockResolvedValue([
        { ref_id: "hf-1", node_type: "HiveFeature", name: "Auth system" },
      ]);
      mockFormatUrn.mockImplementation(
        (p: { realm: string; org: string; workspace?: string; type: string; id: string }) =>
          `urn:${p.org}:${p.realm}:${p.workspace ? p.workspace + ":" : ""}${p.type}:${p.id}`,
      );

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "Auth system" },
        {} as never,
      );

      // pg arm never runs
      expect(dbFeature.findMany).not.toHaveBeenCalled();
      const results = (result as { results: Array<{ realm: string }> }).results;
      expect(results.some((r) => r.realm === "pg")).toBe(false);
      expect(results.some((r) => r.realm === "canvas")).toBe(true);
      expect(results.some((r) => r.realm === "kg")).toBe(true);
    });

    it("returns nothing for realm='pg' (disabled) and never queries Postgres", async () => {
      dbFeature.findMany.mockResolvedValue([
        { id: "feat-2", title: "Search feature" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "Search", realm: "pg" },
        {} as never,
      );

      // pg disabled: no arms run, empty results.
      expect(dbFeature.findMany).not.toHaveBeenCalled();
      expect(dbCanvas.findMany).not.toHaveBeenCalled();
      const results = (result as { results: Array<{ realm: string }> }).results;
      expect(results).toEqual([]);
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

    it("kg arm with workspace param: resolveKgSeam called with synthetic URN; hits mapped to kg URNs", async () => {
      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-kg",
      });
      mockKgSearch.mockResolvedValue([
        { ref_id: "n1", node_type: "Function", name: "doThing" },
      ]);
      mockFormatUrn.mockImplementation(
        (p: { realm: string; org: string; workspace?: string; type: string; id: string }) =>
          `urn:${p.org}:${p.realm}:${p.workspace ? p.workspace + ":" : ""}${p.type}:${p.id}`,
      );

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "doThing", realm: "kg", workspace: "my-ws" },
        {} as never,
      );

      // resolveKgSeam called with a synthetic kg URN
      expect(mockResolveKgSeam).toHaveBeenCalledWith(
        expect.stringContaining("kg"),
        { userId: USER_ID },
      );
      // pg and canvas arms not called
      expect(dbFeature.findMany).not.toHaveBeenCalled();
      expect(dbCanvas.findMany).not.toHaveBeenCalled();

      const results = (result as { results: Array<{ urn: string; type: string; title: string; realm: string }> }).results;
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: "Function",
        title: "doThing",
        realm: "kg",
      });
      expect(results[0].urn).toContain("n1");
    });

    it("kg arm without workspace: fans out to all member workspaces, skips unreachable", async () => {
      dbWorkspace.findMany.mockResolvedValue([
        { id: "ws-1", slug: "workspace-one" },
        { id: "ws-2", slug: "workspace-two" },
      ]);
      // ws-1 has swarm; ws-2 does not
      mockGetSwarmAccessByWorkspaceId
        .mockResolvedValueOnce({
          success: true,
          data: { swarmUrl: "https://jarvis1.example.com", swarmName: "swarm-one", swarmApiKey: "key-1" },
        })
        .mockResolvedValueOnce({ success: false, error: { type: "SWARM_NOT_CONFIGURED" } });
      mockKgSearch.mockResolvedValue([
        { ref_id: "n2", node_type: "File", name: "utils.ts" },
      ]);
      mockFormatUrn.mockImplementation(
        (p: { realm: string; org: string; workspace?: string; type: string; id: string }) =>
          `urn:${p.org}:${p.realm}:${p.workspace ? p.workspace + ":" : ""}${p.type}:${p.id}`,
      );

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "utils", realm: "kg" },
        {} as never,
      );

      // Membership filter query called
      expect(dbWorkspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            members: { some: { userId: USER_ID } },
          }),
        }),
      );
      // getSwarmAccessByWorkspaceId called for both workspaces
      expect(mockGetSwarmAccessByWorkspaceId).toHaveBeenCalledTimes(2);
      // kgSearch only called for the reachable workspace (ws-1)
      expect(mockKgSearch).toHaveBeenCalledTimes(1);

      const results = (result as { results: Array<{ realm: string; title: string }> }).results;
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ title: "utils.ts", realm: "kg" });
    });

    it("returns { results: [] } when the org cannot be resolved", async () => {
      dbSourceControlOrg.findUnique.mockResolvedValue(null);
      dbFeature.findMany.mockResolvedValue([{ id: "feat-1", title: "Auth" }]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "Auth" },
        {} as never,
      );

      expect(result).toEqual({ results: [] });
      // Arms must not run without a valid org
      expect(dbFeature.findMany).not.toHaveBeenCalled();
    });

    it("pg-realm entities (features/tasks/etc.) are never queried in Postgres", async () => {
      // pg is disabled — regardless of realm/type, none of the pg-backed
      // Prisma models are touched. Roadmap/chat discovery flows through kg now
      // (HiveFeature / HiveTask / HiveChatMessage).
      dbFeature.findMany.mockResolvedValue([{ id: "feat-7", title: "Billing" }]);
      dbTask.findMany.mockResolvedValue([{ id: "task-1", title: "Fix login" }]);

      const tools = getTools();
      await tools.graph_search.execute(
        { query: "webhook", realm: "pg", type: "feature" },
        {} as never,
      );

      expect(dbFeature.findMany).not.toHaveBeenCalled();
      expect(dbTask.findMany).not.toHaveBeenCalled();
      expect(dbWorkspace.findMany).not.toHaveBeenCalled();
      expect(dbRepository.findMany).not.toHaveBeenCalled();
      expect(dbResearch.findMany).not.toHaveBeenCalled();
      expect(dbConnection.findMany).not.toHaveBeenCalled();
      expect(dbQueryRaw).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// graph_ontology
// ---------------------------------------------------------------------------

describe("graph_ontology", () => {
  const SEAM = { jarvisUrl: "https://jarvis.example.com", swarmApiKey: "key-abc" };

  beforeEach(() => {
    vi.clearAllMocks();
    dbSourceControlOrg.findUnique.mockResolvedValue({ githubLogin: "my-org" });
    mockFormatUrn.mockReturnValue("urn:my-org:kg:test-ws:node:x");
    mockResolveKgSeam.mockResolvedValue(SEAM);
    mockKgGetOntology.mockResolvedValue([
      { type: "File", description: "A source file." },
      { type: "Function", description: "A code function." },
    ]);
  });

  it("returns node_types on a resolvable, authorized seam", async () => {
    const tools = getTools();
    const result = await tools.graph_ontology.execute(
      { workspace: "test-ws" },
      {} as never,
    );

    expect(result).toEqual({
      node_types: [
        { type: "File", description: "A source file." },
        { type: "Function", description: "A code function." },
      ],
    });
    expect(mockKgGetOntology).toHaveBeenCalledWith(SEAM.jarvisUrl, SEAM.swarmApiKey);
  });

  it("uses formatUrn to build a synthetic kg URN for the IDOR guard", async () => {
    const tools = getTools();
    await tools.graph_ontology.execute({ workspace: "test-ws" }, {} as never);

    expect(mockFormatUrn).toHaveBeenCalledWith(
      expect.objectContaining({
        realm: "kg",
        org: "my-org",
        workspace: "test-ws",
        type: "node",
        id: "x",
      }),
    );
    expect(mockResolveKgSeam).toHaveBeenCalledWith(
      "urn:my-org:kg:test-ws:node:x",
      { userId: USER_ID },
    );
  });

  it("returns { error } when resolveKgSeam returns null (IDOR denied)", async () => {
    mockResolveKgSeam.mockResolvedValue(null);
    const tools = getTools();

    const result = await tools.graph_ontology.execute(
      { workspace: "test-ws" },
      {} as never,
    );

    expect(result).toEqual({ error: "swarm not configured or access denied" });
    expect(mockKgGetOntology).not.toHaveBeenCalled();
  });

  it("returns { error } when org is not found", async () => {
    dbSourceControlOrg.findUnique.mockResolvedValue(null);
    const tools = getTools();

    const result = await tools.graph_ontology.execute(
      { workspace: "test-ws" },
      {} as never,
    );

    expect(result).toEqual({ error: "org not found" });
    expect(mockResolveKgSeam).not.toHaveBeenCalled();
    expect(mockKgGetOntology).not.toHaveBeenCalled();
  });

  it("forwards empty node_types array when kgGetOntology returns []", async () => {
    mockKgGetOntology.mockResolvedValue([]);
    const tools = getTools();

    const result = await tools.graph_ontology.execute(
      { workspace: "test-ws" },
      {} as never,
    );

    expect(result).toEqual({ node_types: [] });
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
