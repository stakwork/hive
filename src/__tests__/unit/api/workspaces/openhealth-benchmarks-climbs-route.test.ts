/**
 * Unit tests for the climb routes:
 *   /api/workspaces/[slug]/openhealth/benchmarks/climbs           (GET, POST)
 *   /api/workspaces/[slug]/openhealth/benchmarks/climbs/[climbId]  (GET)
 *   …/climbs/[climbId]/cancel, …/graph, …/artifacts/[name]?iteration=N
 *
 * Coverage:
 *   - GET lists the workspace's climbs behind the gate;
 *   - POST launches `openhealth-improve-loop` on a task the catalogue lists,
 *     with the defaults or the member's target and run count, and refuses:
 *     a body that names no task, a split not offered, a target or run count
 *     out of range, a task the catalogue does not list, a task with a climb
 *     or a run in flight, a rate-limited workspace, a workspace with no strut;
 *   - the detail, cancel and graph routes are scoped to the workspace;
 *   - an iteration's file is asked for by name from a closed list and an
 *     iteration index, so neither a path nor the answer key can be asked for.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockAuthorize,
  mockRateLimit,
  mockResolveTarget,
  mockTasks,
  mockList,
  mockGet,
  mockFindRow,
  mockPendingClimb,
  mockPendingRun,
  mockLaunch,
  mockCancel,
  mockArtifact,
  mockGraph,
  FakeDispatchError,
} = vi.hoisted(() => {
  class FakeDispatchError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    mockAuthorize: vi.fn(),
    mockRateLimit: vi.fn(),
    mockResolveTarget: vi.fn(),
    mockTasks: vi.fn(),
    mockList: vi.fn(),
    mockGet: vi.fn(),
    mockFindRow: vi.fn(),
    mockPendingClimb: vi.fn(),
    mockPendingRun: vi.fn(),
    mockLaunch: vi.fn(),
    mockCancel: vi.fn(),
    mockArtifact: vi.fn(),
    mockGraph: vi.fn(),
    FakeDispatchError,
  };
});

vi.mock("@/lib/openhealth-benchmarks/access", () => ({ authorizeOpenHealth: mockAuthorize }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));
vi.mock("@/services/strut-target", () => ({
  resolveStrutTarget: mockResolveTarget,
  describeStrutTargetError: () => "The workspace has no swarm configured, so it has no strut.",
}));
vi.mock("@/services/openhealth-benchmarks/tasks", () => ({ getOpenHealthTasks: mockTasks }));
vi.mock("@/services/strut-runs", () => ({ StrutDispatchError: FakeDispatchError, cancelStrutRun: mockCancel }));
vi.mock("@/services/strut-runs/lab", () => ({ fetchStrutArtifact: mockArtifact }));
vi.mock("@/services/strut-runs/run-graph", () => ({ readStrutRunGraph: mockGraph }));
vi.mock("@/services/strut-runs/openhealth", () => ({
  listOpenHealthClimbs: mockList,
  getOpenHealthClimb: mockGet,
  findOpenHealthClimbRow: mockFindRow,
  hasPendingOpenHealthClimb: mockPendingClimb,
  hasPendingOpenHealthRun: mockPendingRun,
  launchOpenHealthClimb: mockLaunch,
}));

import { GET, POST } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/climbs/route";
import { GET as getClimb } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/climbs/[climbId]/route";
import { POST as cancel } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/climbs/[climbId]/cancel/route";
import { GET as getGraph } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/climbs/[climbId]/graph/route";
import { GET as getArtifact } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/climbs/[climbId]/artifacts/[name]/route";

const URL = "http://hive.example/api/workspaces/hive/openhealth/benchmarks/climbs";
const params = { params: Promise.resolve({ slug: "hive" }) };
const climbParams = { params: Promise.resolve({ slug: "hive", climbId: "climb-1" }) };
const TARGET = { swarmId: "swarm-1", labBase: "https://swarm:3355/lab", swarmApiKey: "k", actor: "evan-1" };
const ROW = {
  id: "climb-1",
  swarmId: "swarm-1",
  workflow: "openhealth-improve-loop",
  strutRunId: "1790830428092",
  status: "PENDING",
  input: { gtId: 7013, target: 1, maxRuns: 5 },
};

const post = (body: unknown) =>
  POST(
    new NextRequest(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "hive.example" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params,
  );

const artifact = (name: string, query = "?iteration=2") =>
  getArtifact(new NextRequest(`${URL}/climb-1/artifacts/${encodeURIComponent(name)}${query}`), {
    params: Promise.resolve({ slug: "hive", climbId: "climb-1", name }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({
    kind: "member",
    userId: "user-1",
    workspaceId: "ws-1",
    slug: "hive",
    role: "DEVELOPER",
  });
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockResolveTarget.mockResolvedValue({ ok: true, target: TARGET });
  mockTasks.mockResolvedValue({ split: "public", total: 1, tasks: [{ gtId: 7013, difficulty: "medium" }] });
  mockPendingClimb.mockResolvedValue(false);
  mockPendingRun.mockResolvedValue(false);
  mockLaunch.mockResolvedValue({ runId: "climb-1", strutRunId: "1790830428092", swarmId: "swarm-1" });
  mockFindRow.mockResolvedValue(ROW);
  mockCancel.mockResolvedValue(true);
});

describe("GET climbs", () => {
  it("lists the workspace's climbs", async () => {
    mockList.mockResolvedValue([{ id: "climb-1" }]);

    const res = await GET(new NextRequest(URL), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ climbs: [{ id: "climb-1" }] });
    expect(mockList).toHaveBeenCalledWith("ws-1");
  });

  it("answers what the gate answers", async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));
    const res = await GET(new NextRequest(URL), params);
    expect(res.status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe("POST climbs", () => {
  it("launches a climb with the defaults: target 1, five runs", async () => {
    const res = await post({ gtId: 7013 });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, climbId: "climb-1", strutRunId: "1790830428092" });
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), "hive", { launch: true });
    expect(mockTasks).toHaveBeenCalledWith(TARGET, "public");
    expect(mockLaunch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      gtId: 7013,
      targetF1: 1,
      maxRuns: 5,
    });
  });

  it("launches with the member's target and run count, on the split they chose", async () => {
    mockTasks.mockResolvedValue({ split: "heldout", total: 1, tasks: [{ gtId: 7013 }] });

    const res = await post({ gtId: 7013, split: "heldout", targetF1: 0.9, maxRuns: 3 });

    expect(res.status).toBe(202);
    expect(mockTasks).toHaveBeenCalledWith(TARGET, "heldout");
    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ targetF1: 0.9, maxRuns: 3 }));
  });

  it.each([
    [{}, "gtId must be a task id"],
    [{ gtId: "7013" }, "gtId must be a task id"],
    [{ gtId: 7013, split: "train" }, 'split must be "public" or "heldout"'],
    [{ gtId: 7013, targetF1: 0 }, "targetF1 must be a score above 0 and at most 1"],
    [{ gtId: 7013, targetF1: 1.5 }, "targetF1 must be a score above 0 and at most 1"],
    [{ gtId: 7013, maxRuns: 0 }, "maxRuns must be a whole number from 1 to 10"],
    [{ gtId: 7013, maxRuns: 11 }, "maxRuns must be a whole number from 1 to 10"],
    [{ gtId: 7013, maxRuns: 2.5 }, "maxRuns must be a whole number from 1 to 10"],
  ])("refuses %j before touching strut", async (body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mockResolveTarget).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a task the catalogue does not list", async () => {
    const res = await post({ gtId: 9999 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No task 9999 in the public split" });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a task with a climb in flight", async () => {
    mockPendingClimb.mockResolvedValue(true);
    const res = await post({ gtId: 7013 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A climb of this task is already in progress" });
    expect(mockPendingClimb).toHaveBeenCalledWith("ws-1", 7013);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a task with a run in flight", async () => {
    mockPendingRun.mockResolvedValue(true);
    const res = await post({ gtId: 7013 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A run of this task is already in progress" });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("rate-limits climbs per workspace", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });
    const res = await post({ gtId: 7013 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(mockRateLimit).toHaveBeenCalledWith("openhealth:climb:ws-1", 10, 3600);
    expect(mockResolveTarget).not.toHaveBeenCalled();
  });

  it("answers 503 for a workspace with no strut", async () => {
    mockResolveTarget.mockResolvedValue({ ok: false, error: { code: "no_swarm" } });
    const res = await post({ gtId: 7013 });
    expect(res.status).toBe(503);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable", 503],
    ["no_target", 503],
    ["workflow_missing", 502],
  ])("maps a %s dispatch failure to %i", async (code, expected) => {
    mockLaunch.mockRejectedValue(new FakeDispatchError(code, "nope"));
    const res = await post({ gtId: 7013 });
    expect(res.status).toBe(expected);
    expect(await res.json()).toEqual({ error: "nope", code });
  });

  it("refuses a member below DEVELOPER as the gate does", async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: "Developer access required" }, { status: 403 }));
    const res = await post({ gtId: 7013 });
    expect(res.status).toBe(403);
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});

describe("GET climb", () => {
  it("answers the climb with its detail", async () => {
    mockGet.mockResolvedValue({ id: "climb-1", status: "running" });
    const res = await getClimb(new NextRequest(`${URL}/climb-1`), climbParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "climb-1", status: "running" });
    expect(mockGet).toHaveBeenCalledWith("ws-1", "climb-1");
  });

  it("is a 404 for a climb that is not the workspace's", async () => {
    mockGet.mockResolvedValue(null);
    const res = await getClimb(new NextRequest(`${URL}/climb-1`), climbParams);
    expect(res.status).toBe(404);
  });
});

describe("POST cancel", () => {
  const request = () => new NextRequest(`${URL}/climb-1/cancel`, { method: "POST" });

  it("asks strut to cancel the loop", async () => {
    const res = await cancel(request(), climbParams);
    expect(res.status).toBe(202);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), "hive", { launch: true });
    expect(mockCancel).toHaveBeenCalledWith(ROW);
  });

  it("refuses a climb that is not in flight", async () => {
    mockFindRow.mockResolvedValue({ ...ROW, status: "SUCCESS" });
    const res = await cancel(request(), climbParams);
    expect(res.status).toBe(409);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("is a 502 when strut does not acknowledge", async () => {
    mockCancel.mockResolvedValue(false);
    const res = await cancel(request(), climbParams);
    expect(res.status).toBe(502);
  });

  it("is a 404 for a climb that is not the workspace's", async () => {
    mockFindRow.mockResolvedValue(null);
    const res = await cancel(request(), climbParams);
    expect(res.status).toBe(404);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe("GET graph", () => {
  it("answers the loop's trace", async () => {
    mockGraph.mockResolvedValue({ calls: [], nodes: [], edges: [] });
    const res = await getGraph(new NextRequest(`${URL}/climb-1/graph`), climbParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ calls: [], nodes: [], edges: [] });
    expect(mockGraph).toHaveBeenCalledWith(ROW);
  });

  it("is a 502 when strut cannot be read", async () => {
    mockGraph.mockResolvedValue(null);
    const res = await getGraph(new NextRequest(`${URL}/climb-1/graph`), climbParams);
    expect(res.status).toBe(502);
  });
});

describe("GET artifacts", () => {
  it.each([
    ["problem-list", "iter-2/output/problem-list.json", "application/json; charset=utf-8"],
    ["timeline", "iter-2/timeline.md", "text/markdown; charset=utf-8"],
    ["checklist", "iter-2/checklist.md", "text/markdown; charset=utf-8"],
  ])("serves %s from the iteration's own folder", async (name, path, contentType) => {
    mockArtifact.mockResolvedValue({ body: new TextEncoder().encode("content").buffer, contentType: "text/html" });

    const res = await artifact(name);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("content");
    expect(res.headers.get("Content-Type")).toBe(contentType);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockFindRow).toHaveBeenCalledWith("ws-1", "climb-1");
    expect(mockArtifact).toHaveBeenCalledWith(ROW, path);
  });

  it.each(["gold.json", "../gold.json", "output/problem-list.json", "digest"])(
    "is a 404 for %s, without reaching the database or the lab",
    async (name) => {
      const res = await artifact(name);
      expect(res.status).toBe(404);
      expect(mockFindRow).not.toHaveBeenCalled();
      expect(mockArtifact).not.toHaveBeenCalled();
    },
  );

  it.each(["", "?iteration=", "?iteration=-1", "?iteration=50", "?iteration=1.5", "?iteration=../gt-7013"])(
    "refuses the iteration %j",
    async (query) => {
      const res = await artifact("problem-list", query);
      expect(res.status).toBe(400);
      expect(mockArtifact).not.toHaveBeenCalled();
    },
  );

  it("is a 404 for a file the run never wrote", async () => {
    mockArtifact.mockResolvedValue(null);
    const res = await artifact("timeline");
    expect(res.status).toBe(404);
  });
});
