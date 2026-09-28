/**
 * Unit tests for /api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/improve.
 *
 * Coverage:
 *   - GET lists the improve runs of a benchmark run behind the gate;
 *   - POST launches one improve run over a scored run, and refuses: a run
 *     that is not the workspace's, a run without a score, a run already
 *     being improved, a rate-limited workspace, a workspace with no strut,
 *     a run made on a swarm the workspace no longer uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockAuthorize,
  mockRateLimit,
  mockResolveTarget,
  mockFindRow,
  mockList,
  mockPending,
  mockLaunch,
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
    mockFindRow: vi.fn(),
    mockList: vi.fn(),
    mockPending: vi.fn(),
    mockLaunch: vi.fn(),
    FakeDispatchError,
  };
});

vi.mock("@/lib/openhealth-benchmarks/access", () => ({ authorizeOpenHealth: mockAuthorize }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));
vi.mock("@/services/strut-target", () => ({
  resolveStrutTarget: mockResolveTarget,
  describeStrutTargetError: () => "The workspace has no swarm configured, so it has no strut.",
}));
vi.mock("@/services/strut-runs", () => ({ StrutDispatchError: FakeDispatchError }));
vi.mock("@/services/strut-runs/openhealth", () => ({
  findOpenHealthRunRow: mockFindRow,
  listOpenHealthImprovements: mockList,
  hasPendingOpenHealthImprove: mockPending,
  launchOpenHealthImprove: mockLaunch,
}));

import { GET, POST } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/improve/route";

const URL = "http://hive.example/api/workspaces/hive/openhealth/benchmarks/runs/run-1/improve";
const params = { params: Promise.resolve({ slug: "hive", runId: "run-1" }) };

const SCORED = {
  id: "run-1",
  swarmId: "swarm-1",
  strutRunId: "1790614605308",
  status: "SUCCESS",
  output: { gtId: 7532, weighted_problem_list_f1_neutral: 0.82 },
};

const post = () => POST(new NextRequest(URL, { method: "POST", headers: { host: "hive.example" } }), params);

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
  mockResolveTarget.mockResolvedValue({ ok: true, target: { swarmId: "swarm-1" } });
  mockFindRow.mockResolvedValue(SCORED);
  mockPending.mockResolvedValue(false);
  mockLaunch.mockResolvedValue({ runId: "improve-1", strutRunId: "1790625755699", swarmId: "swarm-1" });
});

describe("GET", () => {
  it("lists the improve runs of the run", async () => {
    mockList.mockResolvedValue([{ id: "improve-1" }]);

    const res = await GET(new NextRequest(URL), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ improvements: [{ id: "improve-1" }] });
    expect(mockFindRow).toHaveBeenCalledWith("ws-1", "run-1");
    expect(mockList).toHaveBeenCalledWith("ws-1", "1790614605308");
  });

  it("is empty for a run strut never started", async () => {
    mockFindRow.mockResolvedValue({ ...SCORED, strutRunId: null, status: "ERROR", output: null });

    const res = await GET(new NextRequest(URL), params);

    expect(await res.json()).toEqual({ improvements: [] });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("answers 404 for a run that is not the workspace's", async () => {
    mockFindRow.mockResolvedValue(null);
    expect((await GET(new NextRequest(URL), params)).status).toBe(404);
  });

  it("answers what the gate answers", async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));

    const res = await GET(new NextRequest(URL), params);

    expect(res.status).toBe(404);
    expect(mockFindRow).not.toHaveBeenCalled();
  });
});

describe("POST", () => {
  it("launches one improve run over the scored run", async () => {
    const res = await post();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, improveId: "improve-1", strutRunId: "1790625755699" });
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), "hive", { launch: true });
    expect(mockLaunch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      strutRunId: "1790614605308",
    });
  });

  it("answers 404 for a run that is not the workspace's", async () => {
    mockFindRow.mockResolvedValue(null);

    const res = await post();

    expect(res.status).toBe(404);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it.each([
    ["in flight", { status: "PENDING", output: null }],
    ["failed", { status: "ERROR", output: null }],
    ["cancelled", { status: "CANCELLED", output: null }],
    ["finished without a score", { status: "SUCCESS", output: { gtId: 7532, gradeError: "scorer down" } }],
    ["never started on strut", { strutRunId: null }],
  ])("refuses a run that is %s", async (_label, overrides) => {
    mockFindRow.mockResolvedValue({ ...SCORED, ...overrides });

    const res = await post();

    expect(res.status).toBe(409);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a second improve run of a run being improved", async () => {
    mockPending.mockResolvedValue(true);

    const res = await post();

    expect(res.status).toBe(409);
    expect(mockPending).toHaveBeenCalledWith("ws-1", "1790614605308");
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a rate-limited workspace before it asks strut anything", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });

    const res = await post();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(mockRateLimit).toHaveBeenCalledWith("openhealth:improve:ws-1", 20, 3600);
    expect(mockResolveTarget).not.toHaveBeenCalled();
  });

  it("answers 503 for a workspace with no strut", async () => {
    mockResolveTarget.mockResolvedValue({ ok: false, error: { type: "SWARM_NOT_CONFIGURED" } });

    const res = await post();

    expect(res.status).toBe(503);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a run made on a swarm the workspace no longer uses", async () => {
    mockResolveTarget.mockResolvedValue({ ok: true, target: { swarmId: "swarm-2" } });

    const res = await post();

    expect(res.status).toBe(409);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable", 503],
    ["no_target", 503],
    ["workflow_missing", 502],
    ["callbacks_unsupported", 502],
  ])("maps a %s dispatch failure to %i", async (code, expected) => {
    mockLaunch.mockRejectedValue(new FakeDispatchError(code, "nope"));

    const res = await post();

    expect(res.status).toBe(expected);
    expect(await res.json()).toEqual({ error: "nope", code });
  });

  it("answers what the gate answers", async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: "Developer access required" }, { status: 403 }));

    const res = await post();

    expect(res.status).toBe(403);
    expect(mockFindRow).not.toHaveBeenCalled();
  });
});
