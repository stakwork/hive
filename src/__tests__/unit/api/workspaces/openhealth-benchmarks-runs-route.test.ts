/**
 * Unit tests for /api/workspaces/[slug]/openhealth/benchmarks/runs.
 *
 * Coverage:
 *   - GET lists the workspace's runs behind the gate;
 *   - POST launches one run for a task the catalogue lists, and refuses:
 *     a body that names no task, a split that is not offered, a task the
 *     catalogue does not list, a task already in flight (a run or a climb),
 *     a rate-limited workspace, a workspace with no strut.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockAuthorize,
  mockRateLimit,
  mockResolveTarget,
  mockTasks,
  mockList,
  mockPending,
  mockPendingClimb,
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
    mockTasks: vi.fn(),
    mockList: vi.fn(),
    mockPending: vi.fn(),
    mockPendingClimb: vi.fn(),
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
vi.mock("@/services/openhealth-benchmarks/tasks", () => ({ getOpenHealthTasks: mockTasks }));
vi.mock("@/services/strut-runs", () => ({ StrutDispatchError: FakeDispatchError }));
vi.mock("@/services/strut-runs/openhealth", () => ({
  listOpenHealthRuns: mockList,
  hasPendingOpenHealthRun: mockPending,
  hasPendingOpenHealthClimb: mockPendingClimb,
  launchOpenHealthRun: mockLaunch,
}));

import { GET, POST } from "@/app/api/workspaces/[slug]/openhealth/benchmarks/runs/route";

const URL = "http://hive.example/api/workspaces/hive/openhealth/benchmarks/runs";
const params = { params: Promise.resolve({ slug: "hive" }) };
const TARGET = { swarmId: "swarm-1", labBase: "https://swarm:3355/lab", swarmApiKey: "k", actor: "evan-1" };

const post = (body: unknown) =>
  POST(
    new NextRequest(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "hive.example" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params,
  );

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
  mockTasks.mockResolvedValue({ split: "public", total: 1, tasks: [{ gtId: 7532, difficulty: "hard" }] });
  mockPending.mockResolvedValue(false);
  mockPendingClimb.mockResolvedValue(false);
  mockLaunch.mockResolvedValue({ runId: "run-1", strutRunId: "1790614605308", swarmId: "swarm-1" });
});

describe("GET", () => {
  it("lists the workspace's runs", async () => {
    mockList.mockResolvedValue([{ id: "run-1" }]);

    const res = await GET(new NextRequest(URL), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [{ id: "run-1" }] });
    expect(mockList).toHaveBeenCalledWith("ws-1");
  });

  it("answers what the gate answers", async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));

    const res = await GET(new NextRequest(URL), params);

    expect(res.status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe("POST", () => {
  it("launches one run for a task the catalogue lists", async () => {
    const res = await post({ gtId: 7532 });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, runId: "run-1", strutRunId: "1790614605308" });
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), "hive", { launch: true });
    expect(mockTasks).toHaveBeenCalledWith(TARGET, "public");
    expect(mockLaunch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      gtId: 7532,
    });
  });

  it.each([{}, { gtId: "7532" }, { gtId: 7532.5 }, { gtId: -1 }, { gtId: null }, "not json"])(
    "refuses a body that names no task: %j",
    async (body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(mockLaunch).not.toHaveBeenCalled();
    },
  );

  it("refuses a split that is not offered", async () => {
    const res = await post({ gtId: 7532, split: "train" });
    expect(res.status).toBe(400);
    expect(mockTasks).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a task the catalogue does not list", async () => {
    const res = await post({ gtId: 999 });
    expect(res.status).toBe(400);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a second run of a task in flight", async () => {
    mockPending.mockResolvedValue(true);

    const res = await post({ gtId: 7532 });

    expect(res.status).toBe(409);
    expect(mockPending).toHaveBeenCalledWith("ws-1", 7532);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a run of a task a climb is working on", async () => {
    mockPendingClimb.mockResolvedValue(true);

    const res = await post({ gtId: 7532 });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A climb of this task is in progress" });
    expect(mockPendingClimb).toHaveBeenCalledWith("ws-1", 7532);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a rate-limited workspace before it asks strut anything", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });

    const res = await post({ gtId: 7532 });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(mockResolveTarget).not.toHaveBeenCalled();
  });

  it("answers 503 for a workspace with no strut", async () => {
    mockResolveTarget.mockResolvedValue({ ok: false, error: { type: "SWARM_NOT_CONFIGURED" } });
    expect((await post({ gtId: 7532 })).status).toBe(503);
  });

  it("answers 502 when the catalogue cannot be read", async () => {
    mockTasks.mockResolvedValue(null);
    const res = await post({ gtId: 7532 });
    expect(res.status).toBe(502);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable", 503],
    ["no_target", 503],
    ["workflow_missing", 502],
    ["callbacks_unsupported", 502],
  ])("maps a %s dispatch failure to %i", async (code, expected) => {
    mockLaunch.mockRejectedValue(new FakeDispatchError(code, "nope"));

    const res = await post({ gtId: 7532 });

    expect(res.status).toBe(expected);
    expect(await res.json()).toEqual({ error: "nope", code });
  });

  it("answers what the gate answers", async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: "Developer access required" }, { status: 403 }));

    const res = await post({ gtId: 7532 });

    expect(res.status).toBe(403);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});
