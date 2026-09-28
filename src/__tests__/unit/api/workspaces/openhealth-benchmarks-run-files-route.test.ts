/**
 * Unit tests for the routes that read a run back from strut:
 *   /api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/artifacts/[name]
 *   /api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/graph
 *
 * Coverage:
 *   - a file is asked for by name from a closed list; anything else — the
 *     answer key above all — is a 404 that reaches neither the database nor
 *     the lab;
 *   - the graph route answers the projection of the run's events, never
 *     the events themselves.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockAuthorize, mockFindRow, mockArtifact, mockEvents, mockLab, mockHydrate } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockFindRow: vi.fn(),
  mockArtifact: vi.fn(),
  mockEvents: vi.fn(),
  mockLab: vi.fn(),
  mockHydrate: vi.fn(),
}));

vi.mock("@/lib/openhealth-benchmarks/access", () => ({ authorizeOpenHealth: mockAuthorize }));
vi.mock("@/services/strut-runs/openhealth", () => ({ findOpenHealthRunRow: mockFindRow }));
vi.mock("@/services/strut-runs/lab", () => ({ fetchStrutArtifact: mockArtifact, fetchStrutRunEvents: mockEvents }));
vi.mock("@/services/strut-runs", () => ({ labForRow: mockLab }));
vi.mock("@/lib/strut-run-graph/hydrate", () => ({
  hydrateRunGraph: mockHydrate,
  swarmCypherRunner: () => async () => null,
}));

import { GET as getArtifact } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/artifacts/[name]/route";
import { GET as getGraph } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/graph/route";

const BASE = "http://hive.example/api/workspaces/hive/openhealth/benchmarks/runs/run-1";
const ROW = {
  id: "run-1",
  swarmId: "swarm-1",
  workflow: "openhealth-run",
  strutRunId: "1790614605308",
  input: { gtId: 7532, workdir: "gt-7532" },
};

const artifact = (name: string) =>
  getArtifact(new NextRequest(`${BASE}/artifacts/${encodeURIComponent(name)}`), {
    params: Promise.resolve({ slug: "hive", runId: "run-1", name }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({ kind: "member", userId: "user-1", workspaceId: "ws-1", slug: "hive", role: "VIEWER" });
  mockFindRow.mockResolvedValue(ROW);
});

describe("artifacts", () => {
  it.each([
    ["problem-list", "gt-7532/output/problem-list.json", "application/json; charset=utf-8"],
    ["timeline", "gt-7532/timeline.md", "text/markdown; charset=utf-8"],
    ["checklist", "gt-7532/checklist.md", "text/markdown; charset=utf-8"],
  ])("serves %s from the run's own folder", async (name, path, contentType) => {
    mockArtifact.mockResolvedValue({ body: new TextEncoder().encode("content").buffer, contentType: "text/html" });

    const res = await artifact(name);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("content");
    expect(mockFindRow).toHaveBeenCalledWith("ws-1", "run-1");
    expect(mockArtifact).toHaveBeenCalledWith(ROW, path);
    // The type is the name's, not whatever the lab said.
    expect(res.headers.get("Content-Type")).toBe(contentType);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it.each(["gold", "gold.json", "task.json", "../gold.json", "gt-7532/gold.json", "problem-list/../gold.json", "chart"])(
    "refuses %s without asking the database or the lab",
    async (name) => {
      const res = await artifact(name);

      expect(res.status).toBe(404);
      expect(mockFindRow).not.toHaveBeenCalled();
      expect(mockArtifact).not.toHaveBeenCalled();
    },
  );

  it("takes the folder from the row, never from the request", async () => {
    mockFindRow.mockResolvedValue({ ...ROW, input: { gtId: "../../other", workdir: "../../other" } });

    const res = await artifact("timeline");

    expect(res.status).toBe(404);
    expect(mockArtifact).not.toHaveBeenCalled();
  });

  it("answers 404 for a run of another workspace or kind", async () => {
    mockFindRow.mockResolvedValue(null);
    expect((await artifact("timeline")).status).toBe(404);
    expect(mockArtifact).not.toHaveBeenCalled();
  });

  it("answers 404 when the run wrote no such file", async () => {
    mockArtifact.mockResolvedValue(null);
    expect((await artifact("checklist")).status).toBe(404);
  });
});

describe("graph", () => {
  const graph = () =>
    getGraph(new NextRequest(`${BASE}/graph`), { params: Promise.resolve({ slug: "hive", runId: "run-1" }) });

  it("answers the projection of the run's events, never the events", async () => {
    mockLab.mockResolvedValue({ labBase: "https://swarm:3355/lab", swarmApiKey: "k", swarmName: "swarm38" });
    mockEvents.mockResolvedValue([
      { type: "step.end", path: "openhealth-run/task", stepType: "openhealth/load-task", output: { groundTruth: ["I10"] } },
      { type: "step.start", path: "openhealth-run/produce/001-graph_graph_get", stepType: "tool:graph_graph_get", input: { ref_id: "a" } },
      {
        type: "step.end",
        path: "openhealth-run/produce/001-graph_graph_get",
        stepType: "tool:graph_graph_get",
        output: '{"properties":{"groundTruth":"I10"}}',
        nodes: [{ ref_id: "a", node_type: "Concept" }],
      },
    ]);
    mockHydrate.mockResolvedValue({
      nodes: [{ ref_id: "a", node_type: "Concept", name: "Problem List", namespace: "default", found: true }],
      edges: [],
      truncated: false,
    });

    const res = await graph();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({ path: "openhealth-run/produce/001-graph_graph_get", query: { ref_id: "a" } });
    expect(body.nodes).toHaveLength(1);
    expect(mockHydrate).toHaveBeenCalledWith([{ ref_id: "a", node_type: "Concept" }], expect.any(Function));
    expect(JSON.stringify(body)).not.toContain("groundTruth");
  });

  it("answers 502 when strut cannot be read", async () => {
    mockLab.mockResolvedValue({ labBase: "x", swarmApiKey: "k", swarmName: "swarm38" });
    mockEvents.mockResolvedValue(null);
    expect((await graph()).status).toBe(502);
    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it("answers 404 for a run of another workspace or kind", async () => {
    mockFindRow.mockResolvedValue(null);
    expect((await graph()).status).toBe(404);
    expect(mockEvents).not.toHaveBeenCalled();
  });
});
