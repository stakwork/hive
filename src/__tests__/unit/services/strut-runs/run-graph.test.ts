/**
 * Unit tests for `services/strut-runs/run-graph.ts`:
 *   - `countStrutRunGraph`: what a settled run did in the graph, as the trace
 *     card counts it — from the run's log alone, never the graph;
 *   - a peer workspace's graph (nodes a `strut/run-workflow` step folded in)
 *     is read only for a member of that workspace, in the run's org, from
 *     its own swarm;
 *   - a launching call's child run is found from the logs alone, walking
 *     down from the row's run, read from the swarm it ran on, and its calls
 *     put under the launching call's path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEvents, mockLab, mockWorkspaces, runners } = vi.hoisted(() => ({
  mockEvents: vi.fn(),
  mockLab: vi.fn(),
  mockWorkspaces: vi.fn(),
  runners: {} as Record<string, (query: string, limit: number) => Promise<unknown>>,
}));

vi.mock("@/services/strut-runs/lab", () => ({ fetchStrutRunEvents: mockEvents }));
vi.mock("@/services/strut-runs", () => ({ labForRow: mockLab }));
vi.mock("@/lib/db", () => ({ db: { workspace: { findMany: mockWorkspaces } } }));
vi.mock("@/lib/constants", () => ({ getSwarmVanityAddress: (name: string) => `${name}.sphinx.chat` }));
vi.mock("@/lib/utils/stakgraph-url", () => ({ getStakgraphUrl: (host: string) => `https://${host}:7799` }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/lib/strut-run-graph/hydrate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/strut-run-graph/hydrate")>()),
  // One fake graph per swarm, by name.
  swarmCypherRunner: ({ name }: { name: string }) => runners[name],
}));

import {
  countStrutRunGraph,
  readStrutRunGraph,
  readStrutRunGraphChild,
  readStrutRunGraphNode,
} from "@/services/strut-runs/run-graph";

const ROW = { id: "row-1", swarmId: "swarm-1", workflow: "job", strutRunId: "1790000000000" };

const end = (path: string, stepType: string, nodes: unknown[]) => ({ type: "step.end", path, stepType, nodes });

beforeEach(() => vi.clearAllMocks());

describe("countStrutRunGraph", () => {
  it("counts the run's graph calls and the distinct nodes they read or wrote — a search's hits are not nodes", async () => {
    mockEvents.mockResolvedValue([
      { type: "run.start", path: "job" },
      end("job/agent/001-graph_graph_search", "tool:graph_graph_search", [{ ref_id: "hit-1" }, { ref_id: "hit-2" }]),
      end("job/agent/002-graph_graph_get", "tool:graph_graph_get", [{ ref_id: "a" }, { ref_id: "b" }]),
      end("job/agent/003-graph_graph_get", "tool:graph_graph_get", [{ ref_id: "a" }]),
      end("job/agent/004-bash", "tool:bash", []),
    ]);
    expect(await countStrutRunGraph(ROW, 8_000)).toEqual({ calls: 3, nodes: 2 });
    expect(mockEvents).toHaveBeenCalledWith(ROW, 8_000);
  });

  it("null when the run touched the graph not at all, or its log could not be read", async () => {
    mockEvents.mockResolvedValue([{ type: "run.start", path: "job" }, end("job/agent/001-bash", "tool:bash", [])]);
    expect(await countStrutRunGraph(ROW)).toBeNull();
    mockEvents.mockResolvedValue(null);
    expect(await countStrutRunGraph(ROW)).toBeNull();
  });
});

describe("a peer workspace's graph", () => {
  const RUN = {
    id: "row-1",
    workspaceId: "ws-org",
    swarmId: "swarm-org",
    workflow: "job",
    strutRunId: "1790000000000",
  };
  /** A graph answering every node query with `name` for whatever ref id it was asked about. */
  const graph = (name: string) => async (query: string) => {
    const id = /'([^']+)'/.exec(query)?.[1] ?? "";
    if (query.includes("RETURN labels(n) AS labels, [k IN")) {
      return { columns: ["labels", "props"], rows: [[["Data_Bank", "Function"], [["name", name]]]] };
    }
    if (query.includes("-[r]->") || query.includes("PARENT_OF*")) return { columns: [], rows: [] };
    return { columns: ["ref_id", "labels", "name", "namespace"], rows: [[id, ["Data_Bank", "Function"], name, null]] };
  };
  const member = vi.fn(async (slug: string) =>
    slug === "apps" ? { workspaceId: "ws-apps" } : { reason: `you are not a member of @${slug}` },
  );

  beforeEach(() => {
    runners["swarm-org-name"] = graph("org node");
    runners["swarm-apps-name"] = graph("verifySphinxToken");
    mockLab.mockImplementation(async ({ swarmId }: { swarmId: string }) => ({
      labBase: "x",
      swarmApiKey: "k",
      swarmName: `${swarmId}-name`,
    }));
    mockWorkspaces.mockResolvedValue([
      { id: "ws-org", sourceControlOrgId: "org-1", swarm: { id: "swarm-org" } },
      { id: "ws-apps", sourceControlOrgId: "org-1", swarm: { id: "swarm-apps" } },
    ]);
  });

  it("reads a node of it from its own swarm for a member", async () => {
    const read = await readStrutRunGraphNode(RUN, "@apps:fn-1", member);
    expect(read).toMatchObject({ found: true, node: { ref_id: "fn-1", properties: { name: "verifySphinxToken" } } });
    expect(mockLab).toHaveBeenCalledWith({ swarmId: "swarm-apps" });
  });

  it("is denied to a non-member, and for a workspace of another org", async () => {
    expect(await readStrutRunGraphNode(RUN, "@secret:fn-1", member)).toEqual({
      found: false,
      denied: "you are not a member of @secret",
    });
    mockWorkspaces.mockResolvedValue([
      { id: "ws-org", sourceControlOrgId: "org-1", swarm: { id: "swarm-org" } },
      { id: "ws-apps", sourceControlOrgId: "org-2", swarm: { id: "swarm-apps" } },
    ]);
    expect(await readStrutRunGraphNode(RUN, "@apps:fn-1", member)).toEqual({
      found: false,
      denied: "@apps is not a workspace of this org",
    });
    expect(mockLab).not.toHaveBeenCalledWith({ swarmId: "swarm-apps" });
  });

  it("is never read without a viewer to check", async () => {
    expect(await readStrutRunGraphNode(RUN, "@apps:fn-1")).toMatchObject({ found: false, denied: expect.any(String) });
  });

  it("the trace resolves the peer's nodes from its graph and this run's from its own", async () => {
    mockEvents.mockResolvedValue([
      end("job/work/001-graph_graph_get", "tool:graph_graph_get", [{ ref_id: "c-1", node_type: "Concept" }]),
      end("job/work/002-strut_run_workflow", "tool:strut_run_workflow", [
        { ref_id: "fn-1", node_type: "Function", peer: "apps" },
        { ref_id: "fn-2", node_type: "Function", peer: "secret" },
      ]),
    ]);
    const trace = await readStrutRunGraph(RUN, member);
    expect(trace?.nodes).toEqual([
      expect.objectContaining({ ref_id: "c-1", name: "org node", found: true }),
      expect.objectContaining({ ref_id: "@apps:fn-1", name: "verifySphinxToken", found: true, peer: "apps" }),
      expect.objectContaining({ ref_id: "@secret:fn-2", found: false, peer: "secret" }),
    ]);
    expect(trace?.peers).toEqual([
      { slug: "apps", read: true },
      { slug: "secret", read: false, reason: "you are not a member of @secret" },
    ]);
  });
});

describe("a launching call's child run", () => {
  const RUN = { id: "row-1", workspaceId: "ws-org", swarmId: "swarm-org", workflow: "job", strutRunId: "100" };
  const start = (path: string, stepType: string, input: unknown) => ({ type: "step.start", path, stepType, input });
  const endWith = (path: string, stepType: string, nodes: unknown[], output: unknown) => ({
    type: "step.end",
    path,
    stepType,
    nodes,
    output,
  });
  /** Each run's log, by swarm / workflow / run id. */
  const LOGS: Record<string, unknown[]> = {
    "swarm-org/job/100": [
      start("job/work/002-meta_run_workflow", "tool:meta_run_workflow", { name: "explore" }),
      endWith("job/work/002-meta_run_workflow", "tool:meta_run_workflow", [{ ref_id: "a" }], { runId: "200" }),
      start("job/work/004-strut_run_workflow", "tool:strut_run_workflow", { peer: "apps", workflow: "explore" }),
      endWith("job/work/004-strut_run_workflow", "tool:strut_run_workflow", [{ ref_id: "x", peer: "apps" }], {
        peer: "apps",
        workflow: "explore",
        runId: "300",
      }),
    ],
    "swarm-org/explore/200": [
      end("explore/explore/001-graph_graph_get", "tool:graph_graph_get", [{ ref_id: "a" }]),
      start("explore/explore/002-meta_run_workflow", "tool:meta_run_workflow", { name: "deep" }),
      endWith(
        "explore/explore/002-meta_run_workflow",
        "tool:meta_run_workflow",
        [{ ref_id: "d" }],
        '{"runId":"201","sta',
      ),
    ],
    "swarm-org/deep/201": [end("deep/deep/001-graph_graph_get", "tool:graph_graph_get", [{ ref_id: "d" }])],
    "swarm-apps/explore/300": [
      end("explore/explore/001-graph_graph_search", "tool:graph_graph_get", [{ ref_id: "x" }]),
    ],
  };
  const member = vi.fn(async (slug: string) =>
    slug === "apps" ? { workspaceId: "ws-apps" } : { reason: `you are not a member of @${slug}` },
  );

  beforeEach(() => {
    mockEvents.mockImplementation(
      async (row: { swarmId: string; workflow: string; strutRunId: string }) =>
        LOGS[`${row.swarmId}/${row.workflow}/${row.strutRunId}`] ?? null,
    );
    mockWorkspaces.mockResolvedValue([
      { id: "ws-org", sourceControlOrgId: "org-1", swarm: { id: "swarm-org" } },
      { id: "ws-apps", sourceControlOrgId: "org-1", swarm: { id: "swarm-apps" } },
    ]);
  });

  it("reads a local child from the run's own swarm, its calls under the launching call", async () => {
    const read = await readStrutRunGraphChild(RUN, "job/work/002-meta_run_workflow", member);
    expect(read).toEqual({
      calls: [
        expect.objectContaining({ path: "job/work/002-meta_run_workflow/explore/explore/001-graph_graph_get" }),
        expect.objectContaining({
          path: "job/work/002-meta_run_workflow/explore/explore/002-meta_run_workflow",
          child: { workflow: "deep" },
        }),
      ],
    });
    expect(mockEvents).toHaveBeenLastCalledWith({
      id: "row-1",
      swarmId: "swarm-org",
      workflow: "explore",
      strutRunId: "200",
    });
  });

  it("walks down to a grandchild through the child's own log", async () => {
    const read = await readStrutRunGraphChild(
      RUN,
      "job/work/002-meta_run_workflow/explore/explore/002-meta_run_workflow",
      member,
    );
    expect(read).toEqual({
      calls: [
        expect.objectContaining({
          path: "job/work/002-meta_run_workflow/explore/explore/002-meta_run_workflow/deep/deep/001-graph_graph_get",
          nodes: [{ ref_id: "d" }],
        }),
      ],
    });
  });

  it("reads a peer's child from the peer's swarm for a member, its refs in the peer's graph", async () => {
    const read = await readStrutRunGraphChild(RUN, "job/work/004-strut_run_workflow", member);
    expect(read).toEqual({
      calls: [
        expect.objectContaining({
          path: "job/work/004-strut_run_workflow/explore/explore/001-graph_graph_search",
          nodes: [{ ref_id: "@apps:x", peer: "apps" }],
        }),
      ],
    });
    expect(mockEvents).toHaveBeenLastCalledWith({
      id: "row-1",
      swarmId: "swarm-apps",
      workflow: "explore",
      strutRunId: "300",
    });
  });

  it("is denied a peer's child for a non-member, and finds nothing where no run was launched", async () => {
    const outsider = vi.fn(async (slug: string) => ({ reason: `you are not a member of @${slug}` }));
    expect(await readStrutRunGraphChild(RUN, "job/work/004-strut_run_workflow", outsider)).toEqual({
      denied: "you are not a member of @apps",
    });
    expect(await readStrutRunGraphChild(RUN, "job/work/003-graph_graph_get", member)).toEqual({ notFound: true });
    expect(await readStrutRunGraphChild(RUN, "job/work/002-meta_run_workflowX", member)).toEqual({ notFound: true });
  });

  it("says so when a log cannot be read", async () => {
    LOGS["swarm-org/explore/200"] = undefined as unknown as unknown[];
    expect(await readStrutRunGraphChild(RUN, "job/work/002-meta_run_workflow", member)).toEqual({ unread: true });
  });
});
