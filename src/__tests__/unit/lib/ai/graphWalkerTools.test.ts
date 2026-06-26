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

    it("pg arm attaches a human-readable title to each neighbor (batched per type)", async () => {
      // Real-ish URN parser so attachPgTitles groups neighbors by type/id.
      mockParseUrn.mockImplementation((urn: string) => {
        const [, org, realm, type, ...idParts] = urn.split(":");
        if (realm === "kg") {
          const [workspace, kgType, ...rest] = [type, ...idParts];
          return { realm, org, workspace, type: kgType, id: rest.join(":") };
        }
        return { realm, org, type, id: idParts.join(":") };
      });

      mockPgNeighbors.mockResolvedValue([
        { urn: "urn:myorg:pg:initiative:init-1", edgeType: "BELONGS_TO_INITIATIVE", direction: "forward" },
        { urn: "urn:myorg:pg:milestone:ms-1", edgeType: "BELONGS_TO_MILESTONE", direction: "forward" },
        // opaque-external neighbor — no pg recipe, must pass through untouched
        { urn: "stakwork:workflow:42", edgeType: "REFERENCES_WORKFLOW", direction: "forward" },
      ]);
      dbInitiative.findMany.mockResolvedValue([{ id: "init-1", name: "Canvas Chat" }]);
      dbMilestone.findMany.mockResolvedValue([{ id: "ms-1", name: "Planner Agent & Tooling" }]);

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:pg:feature:feat-1" },
        {} as never,
      );

      // Batched: one query per distinct neighbor type
      expect(dbInitiative.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["init-1"] } },
        select: { id: true, name: true },
      });
      const neighbors = (result as { neighbors: Array<{ urn: string; title?: string }> }).neighbors;
      expect(neighbors.find((n) => n.urn.includes("init-1"))?.title).toBe("Canvas Chat");
      expect(neighbors.find((n) => n.urn.includes("ms-1"))?.title).toBe(
        "Planner Agent & Tooling",
      );
      // opaque-external neighbor stays untouched (no title)
      expect(neighbors.find((n) => n.urn === "stakwork:workflow:42")?.title).toBeUndefined();
    });

    it("pg arm labels cross-realm kg neighbors (implemented-by concepts) via a batched by-refs call", async () => {
      // Real-ish parser so both pg and kg URNs resolve to {realm,type,id,workspace}.
      mockParseUrn.mockImplementation((urn: string) => {
        const [, org, realm, type, ...idParts] = urn.split(":");
        if (realm === "kg") {
          const [workspace, kgType, ...rest] = [type, ...idParts];
          return { realm, org, workspace, type: kgType, id: rest.join(":") };
        }
        return { realm, org, type, id: idParts.join(":") };
      });

      // A pg feature whose neighbors include pg siblings AND kg concepts that
      // arrived through the Postgres UrnEdge bridge (no title from pgNeighbors).
      mockPgNeighbors.mockResolvedValue([
        { urn: "urn:myorg:pg:milestone:ms-1", edgeType: "BELONGS_TO_MILESTONE", direction: "forward" },
        { urn: "urn:myorg:kg:my-ws:concept:c1", edgeType: "implemented-by", direction: "forward" },
        { urn: "urn:myorg:kg:my-ws:concept:c2", edgeType: "implemented-by", direction: "forward" },
      ]);
      dbMilestone.findMany.mockResolvedValue([{ id: "ms-1", name: "Canvas Workflow" }]);

      mockResolveKgSeam.mockResolvedValue({
        workspace: "my-ws",
        swarmUrl: "https://jarvis.example.com",
        jarvisUrl: "https://jarvis.example.com",
        swarmApiKey: "key-123",
      });
      mockKgGetNodesByRefs.mockResolvedValue(
        new Map([
          ["c1", "Integration Tests"],
          ["c2", "Org Canvas"],
        ]),
      );

      const tools = getTools();
      const result = await tools.graph_neighbors.execute(
        { urn: "urn:myorg:pg:feature:feat-1" },
        {} as never,
      );

      // One batched call covering both concept ref_ids
      expect(mockKgGetNodesByRefs).toHaveBeenCalledTimes(1);
      expect(mockKgGetNodesByRefs).toHaveBeenCalledWith(
        "https://jarvis.example.com",
        "key-123",
        expect.arrayContaining(["c1", "c2"]),
      );

      const neighbors = (result as { neighbors: Array<{ urn: string; title?: string }> }).neighbors;
      expect(neighbors.find((n) => n.urn.includes("ms-1"))?.title).toBe("Canvas Workflow");
      expect(neighbors.find((n) => n.urn.includes("concept:c1"))?.title).toBe("Integration Tests");
      expect(neighbors.find((n) => n.urn.includes("concept:c2"))?.title).toBe("Org Canvas");
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

    it("pg URNs embed the org githubLogin, not the cuid", async () => {
      dbFeature.findMany.mockResolvedValue([{ id: "feat-9", title: "X" }]);

      const tools = getTools();
      await tools.graph_search.execute({ query: "X", realm: "pg" }, {} as never);

      // org segment must be the githubLogin so URNs round-trip through graph_get
      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({ org: "myorg", type: "feature", id: "feat-9" }),
      );
      expect(dbSourceControlOrg.findUnique).toHaveBeenCalledWith({
        where: { id: ORG_ID },
        select: { githubLogin: true },
      });
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

    it("matches features on title and plan columns (brief/requirements/architecture)", async () => {
      dbFeature.findMany.mockResolvedValue([{ id: "feat-7", title: "Billing" }]);

      const tools = getTools();
      await tools.graph_search.execute(
        { query: "webhook", realm: "pg", type: "feature" },
        {} as never,
      );

      expect(dbFeature.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted: false,
            workspace: { sourceControlOrgId: ORG_ID },
            OR: [
              { title: { contains: "webhook", mode: "insensitive" } },
              { brief: { contains: "webhook", mode: "insensitive" } },
              { requirements: { contains: "webhook", mode: "insensitive" } },
              { architecture: { contains: "webhook", mode: "insensitive" } },
            ],
          }),
        }),
      );
    });

    it("searches tasks in the pg arm", async () => {
      dbTask.findMany.mockResolvedValue([
        { id: "task-1", title: "Fix login bug" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "login", realm: "pg" },
        {} as never,
      );

      // Tasks scoped to the org via workspace, excluding deleted/archived
      expect(dbTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted: false,
            archived: false,
            workspace: { sourceControlOrgId: ORG_ID, deleted: false },
            OR: [
              { title: { contains: "login", mode: "insensitive" } },
              { description: { contains: "login", mode: "insensitive" } },
            ],
          }),
        }),
      );
      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({ realm: "pg", type: "task", id: "task-1" }),
      );
      const results = (
        result as { results: Array<{ type: string; title: string }> }
      ).results;
      expect(results).toContainEqual(
        expect.objectContaining({ type: "task", title: "Fix login bug", realm: "pg" }),
      );
    });

    it("searches workspaces in the pg arm (name/description/mission)", async () => {
      dbWorkspace.findMany.mockResolvedValue([
        { id: "ws-1", name: "Core Platform" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "platform", realm: "pg", type: "workspace" },
        {} as never,
      );

      expect(dbWorkspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceControlOrgId: ORG_ID,
            deleted: false,
            OR: [
              { name: { contains: "platform", mode: "insensitive" } },
              { description: { contains: "platform", mode: "insensitive" } },
              { mission: { contains: "platform", mode: "insensitive" } },
            ],
          }),
        }),
      );
      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({ realm: "pg", type: "workspace", id: "ws-1" }),
      );
      const results = (
        result as { results: Array<{ type: string; title: string }> }
      ).results;
      expect(results).toContainEqual(
        expect.objectContaining({ type: "workspace", title: "Core Platform", realm: "pg" }),
      );
    });

    it("searches repositories in the pg arm (name/description/URL)", async () => {
      dbRepository.findMany.mockResolvedValue([
        { id: "repo-1", name: "hive" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "hive", realm: "pg", type: "repository" },
        {} as never,
      );

      expect(dbRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace: { sourceControlOrgId: ORG_ID, deleted: false },
            OR: [
              { name: { contains: "hive", mode: "insensitive" } },
              { description: { contains: "hive", mode: "insensitive" } },
              { repositoryUrl: { contains: "hive", mode: "insensitive" } },
            ],
          }),
        }),
      );
      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({ realm: "pg", type: "repository", id: "repo-1" }),
      );
      const results = (
        result as { results: Array<{ type: string; title: string }> }
      ).results;
      expect(results).toContainEqual(
        expect.objectContaining({ type: "repository", title: "hive", realm: "pg" }),
      );
    });

    it("searches research docs in the pg arm (title/topic/summary/content)", async () => {
      dbResearch.findMany.mockResolvedValue([
        { id: "res-1", title: "OAuth deep-dive", topic: "oauth" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "oauth", realm: "pg", type: "research" },
        {} as never,
      );

      expect(dbResearch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: ORG_ID,
            OR: [
              { title: { contains: "oauth", mode: "insensitive" } },
              { topic: { contains: "oauth", mode: "insensitive" } },
              { summary: { contains: "oauth", mode: "insensitive" } },
              { content: { contains: "oauth", mode: "insensitive" } },
            ],
          }),
        }),
      );
      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({ realm: "pg", type: "research", id: "res-1" }),
      );
      const results = (
        result as { results: Array<{ type: string; title: string }> }
      ).results;
      expect(results).toContainEqual(
        expect.objectContaining({ type: "research", title: "OAuth deep-dive", realm: "pg" }),
      );
    });

    it("falls back to topic when a research title is empty", async () => {
      dbResearch.findMany.mockResolvedValue([
        { id: "res-2", title: "", topic: "rate limiting" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "rate", realm: "pg", type: "research" },
        {} as never,
      );

      const results = (
        result as { results: Array<{ title: string }> }
      ).results;
      expect(results).toContainEqual(
        expect.objectContaining({ title: "rate limiting" }),
      );
    });

    it("searches connection docs in the pg arm (name/summary/architecture)", async () => {
      dbConnection.findMany.mockResolvedValue([
        { id: "conn-1", name: "Sphinx ↔ Hive" },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "sphinx", realm: "pg", type: "connection" },
        {} as never,
      );

      expect(dbConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: ORG_ID,
            OR: [
              { name: { contains: "sphinx", mode: "insensitive" } },
              { summary: { contains: "sphinx", mode: "insensitive" } },
              { architecture: { contains: "sphinx", mode: "insensitive" } },
            ],
          }),
        }),
      );
      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({ realm: "pg", type: "connection", id: "conn-1" }),
      );
      const results = (
        result as { results: Array<{ type: string; title: string }> }
      ).results;
      expect(results).toContainEqual(
        expect.objectContaining({ type: "connection", title: "Sphinx ↔ Hive", realm: "pg" }),
      );
    });

    it("searches conversations in the pg arm via raw query", async () => {
      dbQueryRaw.mockResolvedValue([
        { id: "convo-1", title: "Roadmap chat" },
        { id: "convo-2", title: null },
      ]);

      const tools = getTools();
      const result = await tools.graph_search.execute(
        { query: "roadmap", realm: "pg" },
        {} as never,
      );

      expect(dbQueryRaw).toHaveBeenCalled();
      expect(mockFormatUrn).toHaveBeenCalledWith(
        expect.objectContaining({
          realm: "pg",
          type: "conversation",
          id: "convo-1",
        }),
      );
      const results = (
        result as { results: Array<{ type: string; title: string }> }
      ).results;
      expect(results).toContainEqual(
        expect.objectContaining({ type: "conversation", title: "Roadmap chat" }),
      );
      // Null titles fall back to a placeholder
      expect(results).toContainEqual(
        expect.objectContaining({
          type: "conversation",
          title: "(untitled conversation)",
        }),
      );
    });

    it("does not search conversations or tasks when type filters them out", async () => {
      const tools = getTools();
      await tools.graph_search.execute(
        { query: "x", realm: "pg", type: "feature" },
        {} as never,
      );

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
