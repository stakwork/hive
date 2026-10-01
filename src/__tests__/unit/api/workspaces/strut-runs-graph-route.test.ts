/**
 * Unit tests for the strut run graph routes:
 *   /api/workspaces/[slug]/strut/runs/[runId]/graph
 *   /api/workspaces/[slug]/strut/runs/[runId]/graph/nodes/[refId]
 *
 * Coverage:
 *   - both are for the workspace's members, and scoped to its runs of any
 *     kind;
 *   - the trace is the projection, and strut not answering is said as such;
 *   - a node is read whole, a ref id that is not one never reaches the row
 *     lookup, and a node the graph no longer holds is told from a graph that
 *     did not answer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockAccess, mockFindRow, mockGraph, mockNode } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockFindRow: vi.fn(),
  mockGraph: vi.fn(),
  mockNode: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/workspace-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/workspace-access")>()),
  resolveWorkspaceAccess: mockAccess,
}));
vi.mock("@/services/strut-runs", () => ({ findStrutRunRow: mockFindRow }));
vi.mock("@/services/strut-runs/run-graph", () => ({ readStrutRunGraph: mockGraph, readStrutRunGraphNode: mockNode }));
vi.mock("@/lib/constants", () => ({ getSwarmVanityAddress: (name: string) => `${name}.sphinx.chat` }));
vi.mock("@/lib/utils/stakgraph-url", () => ({ getStakgraphUrl: (host: string) => `https://${host}:7799` }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { GET as getGraph } from "@/app/api/workspaces/[slug]/strut/runs/[runId]/graph/route";
import { GET as getNode } from "@/app/api/workspaces/[slug]/strut/runs/[runId]/graph/nodes/[refId]/route";

const BASE = "http://hive.example/api/workspaces/hive/strut/runs/run-1/graph";
const ROW = {
  id: "run-1",
  workspaceId: "ws-1",
  swarmId: "swarm-1",
  kind: "job_turn",
  workflow: "job-turn",
  strutRunId: "1790614605308",
};
const MEMBER = { kind: "member", userId: "user-1", workspaceId: "ws-1", slug: "hive", role: "VIEWER" };

const graph = () => getGraph(new NextRequest(BASE), { params: Promise.resolve({ slug: "hive", runId: "run-1" }) });
const node = (refId: string) =>
  getNode(new NextRequest(`${BASE}/nodes/${encodeURIComponent(refId)}`), {
    params: Promise.resolve({ slug: "hive", runId: "run-1", refId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(MEMBER);
  mockFindRow.mockResolvedValue(ROW);
});

describe("GET graph", () => {
  it("answers the run's trace, for a run of any kind", async () => {
    mockGraph.mockResolvedValue({
      calls: [],
      nodes: [],
      edges: [],
      nodesRead: true,
      edgesRead: true,
      truncated: false,
    });
    const res = await graph();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ calls: [], nodes: [] });
    expect(mockFindRow).toHaveBeenCalledWith("ws-1", "run-1");
    expect(mockGraph).toHaveBeenCalledWith(ROW);
  });

  it("answers 404 for a run of another workspace", async () => {
    mockFindRow.mockResolvedValue(null);
    expect((await graph()).status).toBe(404);
    expect(mockGraph).not.toHaveBeenCalled();
  });

  it("answers 502 when strut cannot be read", async () => {
    mockGraph.mockResolvedValue(null);
    expect((await graph()).status).toBe(502);
  });

  it.each([
    [{ kind: "unauthenticated" }, 401],
    [{ kind: "not-found" }, 404],
    [{ kind: "forbidden" }, 403],
    [{ kind: "public-viewer", userId: null, workspaceId: "ws-1", slug: "hive" }, 401],
  ])("is for members only: %o is a %i", async (access, status) => {
    mockAccess.mockResolvedValue(access);
    expect((await graph()).status).toBe(status);
    expect(mockFindRow).not.toHaveBeenCalled();
  });
});

describe("GET graph node", () => {
  const BODY = {
    ref_id: "c-1",
    node_type: "Concept",
    labels: ["Data_Bank", "Concept"],
    properties: { name: "Problem List", docs: "# Problem List" },
  };

  it("answers the node, whole", async () => {
    mockNode.mockResolvedValue({ found: true, node: BODY });
    const res = await node("c-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(BODY);
    expect(mockFindRow).toHaveBeenCalledWith("ws-1", "run-1");
    expect(mockNode).toHaveBeenCalledWith(ROW, "c-1");
  });

  it("refuses a ref id that is not one before looking anything up", async () => {
    expect((await node("'}) MATCH (n) DETACH DELETE n //")).status).toBe(400);
    expect(mockFindRow).not.toHaveBeenCalled();
    expect(mockNode).not.toHaveBeenCalled();
  });

  it("tells a node the graph no longer holds from a graph that did not answer", async () => {
    mockNode.mockResolvedValue({ found: false });
    const gone = await node("c-1");
    expect(gone.status).toBe(404);
    expect((await gone.json()).error).toBe("The graph no longer holds this node");

    mockNode.mockResolvedValue({ found: false, unread: "no answer in 20 s" });
    const unread = await node("c-1");
    expect(unread.status).toBe(502);
    expect((await unread.json()).error).toBe("The graph did not answer (no answer in 20 s)");
  });

  it("answers 502 when the run's swarm cannot be read", async () => {
    mockNode.mockResolvedValue(null);
    expect((await node("c-1")).status).toBe(502);
  });

  it("answers 404 for a run of another workspace", async () => {
    mockFindRow.mockResolvedValue(null);
    expect((await node("c-1")).status).toBe(404);
    expect(mockNode).not.toHaveBeenCalled();
  });

  it("is for members only", async () => {
    mockAccess.mockResolvedValue({ kind: "forbidden" });
    expect((await node("c-1")).status).toBe(403);
    expect(mockFindRow).not.toHaveBeenCalled();
  });
});
