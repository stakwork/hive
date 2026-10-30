/**
 * The Legal Benchmarks routes of a strut workspace (`LEGAL_STRUT_SLUGS`):
 * launch `harvey-lab-run`, list its runs, download a deliverable, read and
 * export its trace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { StrutRunStatus } from "@prisma/client";

const {
  mockResolve,
  mockStrutRun,
  mockDispatch,
  mockArtifact,
  mockEvents,
  mockTranscript,
  mockSwarmAccess,
  mockPrefetch,
  mockHtml,
} = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockSwarmAccess: vi.fn(),
  mockPrefetch: vi.fn(),
  mockHtml: vi.fn(),
  mockStrutRun: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  mockDispatch: vi.fn(),
  mockArtifact: vi.fn(),
  mockEvents: vi.fn(),
  mockTranscript: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-access", () => ({ resolveWorkspaceAccess: mockResolve }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", async (orig) => ({
  ...(await orig<typeof import("@/services/strut-runs")>()),
  dispatchStrutRun: mockDispatch,
}));
vi.mock("@/services/strut-runs/openhealth", () => ({ settleFromStrut: vi.fn(async (row: unknown) => row) }));
vi.mock("@/services/strut-runs/lab", () => ({
  fetchStrutArtifact: mockArtifact,
  fetchStrutRunEvents: mockEvents,
  fetchStrutTranscript: mockTranscript,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/helpers/swarm-access", () => ({ getWorkspaceSwarmAccess: mockSwarmAccess }));
vi.mock("@/lib/run-report/export/peek-prefetch", () => ({ prefetchNodePeeks: mockPrefetch }));
vi.mock("@/lib/legal-cascade/export/offline-html", async (orig) => ({
  ...(await orig<typeof import("@/lib/legal-cascade/export/offline-html")>()),
  assembleCascadeOfflineHtml: mockHtml,
}));

import { POST as launch } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/run/route";
import { GET as list } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/runs/route";
import { GET as deliverable } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/runs/[runId]/deliverables/[name]/route";
import { GET as traceSessions } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/cascade/sessions/route";
import { GET as traceSession } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/cascade/session/route";
import { GET as traceTurns } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/cascade/turns/route";
import { GET as traceExport } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/cascade/export/route";
import { checkRateLimit } from "@/lib/rate-limit";
import { StrutDispatchError } from "@/services/strut-runs";
import { clearStrutTraceCache } from "@/services/strut-runs/legal-trace";

const SLUG = "banking-finance/identify-issues-in-compliance-certificate";
const member = (role = "DEVELOPER") => ({ kind: "member", userId: "user-1", workspaceId: "ws-1", slug: "openlaw-1", role });

const post = (slug: string, body: unknown) =>
  launch(
    new NextRequest(`http://localhost/api/workspaces/${slug}/legal/benchmarks/strut/run`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "hive.example" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const taskJson = {
  title: "Identify Issues",
  instructions: "Review it.",
  deliverables: { "memo.docx": "The memo" },
  criteria: [{ id: "C-001", title: "Cap", match_criteria: "PASS if …" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(member());
  mockStrutRun.findFirst.mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/task.json")
        ? json(taskJson)
        : json([{ type: "file", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/d.docx" }]),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("POST legal/benchmarks/strut/run", () => {
  it("is not there for openlaw, which keeps its Stakwork flow", async () => {
    expect((await post("openlaw", { taskSlug: SLUG })).status).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("takes a developer", async () => {
    mockResolve.mockResolvedValue(member("VIEWER"));
    expect((await post("openlaw-1", { taskSlug: SLUG })).status).toBe(403);
  });

  it("launches a catalogue task with the input built from GitHub", async () => {
    mockDispatch.mockResolvedValue({ runId: "row-1", strutRunId: "s1", swarmId: "sw" });
    const res = await post("openlaw-1", { taskSlug: SLUG, judgeModel: "anthropic/claude-sonnet-4-6", taskTitle: "ignored" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, run_id: "row-1" });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        kind: "benchmark:harvey-lab",
        workflow: "harvey-lab-run",
        publicBaseUrl: "https://hive.example",
        params: { judge_model: "claude-sonnet-4-6" },
        input: {
          task_slug: SLUG,
          task_title: "Identify Issues",
          task_goal: "Review it.",
          task_output_desc: "memo.docx",
          documents_json: ["https://raw.githubusercontent.com/stakwork/harvey-labs/main/d.docx"],
          rubrics_json: taskJson.criteria,
        },
      }),
    );
  });

  it("refuses what is not a catalogue task or a usable model", async () => {
    expect((await post("openlaw-1", { taskSlug: "not/a/task" })).status).toBe(400);
    expect((await post("openlaw-1", { taskSlug: SLUG, reasoningModel: "nope" })).status).toBe(400);
    expect((await post("openlaw-1", { taskSlug: SLUG, judgeModel: "openai/gpt-5" })).status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("answers 409 while the task has a run in flight", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "busy" });
    expect((await post("openlaw-1", { taskSlug: SLUG })).status).toBe(409);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("answers 502 when GitHub cannot describe the task", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    expect((await post("openlaw-1", { taskSlug: SLUG })).status).toBe(502);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("answers 503 when the workspace has no strut to run on", async () => {
    mockDispatch.mockRejectedValue(new StrutDispatchError("no_target", "No swarm"));
    expect((await post("openlaw-1", { taskSlug: SLUG })).status).toBe(503);
  });
});

const finished = {
  id: "row-1",
  workspaceId: "ws-1",
  swarmId: "sw",
  workflow: "harvey-lab-run",
  strutRunId: "179",
  status: StrutRunStatus.SUCCESS,
  input: { task_slug: SLUG, task_title: "Identify Issues" },
  output: {
    callback: {
      n_passed: 7,
      n_total: 8,
      final_output: { "memo.docx": "/artifacts/179/output/memo.docx" },
    },
  },
  error: null,
  createdAt: new Date("2026-10-21T00:00:00Z"),
  settledAt: new Date("2026-10-21T01:30:00Z"),
};

describe("GET legal/benchmarks/strut/runs", () => {
  it("lists runs in the row shape the legal hooks parse", async () => {
    mockResolve.mockResolvedValue(member("VIEWER"));
    mockStrutRun.findMany.mockResolvedValue([finished]);
    mockStrutRun.count.mockResolvedValue(1);
    const res = await list(new NextRequest("http://localhost/x"), { params: Promise.resolve({ slug: "openlaw-1" }) });
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.runs[0]).toMatchObject({ id: "row-1", type: "LEGAL_BENCHMARK_RUNNER", status: "COMPLETED" });
    expect(JSON.parse(body.runs[0].result)).toMatchObject({ n_passed: 7, n_total: 8, deliverables: ["memo.docx"] });
  });

  it("is not there for openlaw", async () => {
    const res = await list(new NextRequest("http://localhost/x"), { params: Promise.resolve({ slug: "openlaw" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET legal/benchmarks/strut/runs/:runId/deliverables/:name", () => {
  const get = (name: string) =>
    deliverable(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ slug: "openlaw-1", runId: "row-1", name }),
    });

  it("serves a declared deliverable from the run's own folder", async () => {
    mockStrutRun.findFirst.mockResolvedValue(finished);
    mockArtifact.mockResolvedValue({ body: new TextEncoder().encode("docx").buffer, contentType: "application/octet-stream" });
    const res = await get("memo.docx");
    expect(res.status).toBe(200);
    expect(mockArtifact).toHaveBeenCalledWith(finished, "output/memo.docx");
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''memo.docx");
  });

  it("serves nothing the run did not declare", async () => {
    mockStrutRun.findFirst.mockResolvedValue(finished);
    expect((await get("../scores.json")).status).toBe(404);
    expect((await get("checklist.md")).status).toBe(404);
    expect(mockArtifact).not.toHaveBeenCalled();
  });
});

describe("GET legal/benchmarks/strut/cascade/*", () => {
  const T = (sec: number) => new Date(Date.UTC(2026, 9, 21, 3, 0, sec)).toISOString();
  const log = [
    { type: "step.start", path: "harvey-lab-run/drafter", stepType: "agent", ts: T(1), input: { prompt: "Draft it." } },
    { type: "step.start", path: "harvey-lab-run/drafter/001-agent", stepType: "tool:agent", toolCallId: "c1", ts: T(2), input: { prompt: "Check." } },
  ];
  const get = (
    handler: (r: NextRequest, c: { params: Promise<{ slug: string }> }) => Promise<Response>,
    query: string,
    slug = "openlaw-1",
  ) => handler(new NextRequest(`http://localhost/x?${query}`), { params: Promise.resolve({ slug }) });

  beforeEach(() => {
    clearStrutTraceCache();
    mockResolve.mockResolvedValue(member("VIEWER"));
    mockStrutRun.findFirst.mockResolvedValue({ ...finished, status: StrutRunStatus.PENDING });
    mockEvents.mockResolvedValue(log);
  });

  it("is not there for openlaw, whose trace is stakgraph's", async () => {
    expect((await get(traceSessions, "runId=row-1", "openlaw")).status).toBe(404);
    expect(mockEvents).not.toHaveBeenCalled();
  });

  it("answers the cascade's shapes from the run's strut log", async () => {
    const sessions = await (await get(traceSessions, "runId=row-1")).json();
    expect(sessions).toMatchObject({ success: true, data: { sessions: [{ id: "drafter", status: "running", child_count: 1 }] } });
    expect(mockStrutRun.findFirst.mock.calls[0][0].where).toMatchObject({ id: "row-1", workspaceId: "ws-1", kind: "benchmark:harvey-lab" });

    const detail = await (await get(traceSession, "runId=row-1&sessionId=drafter")).json();
    expect(detail.data.descendants.map((d: { id: string; parent_session_id: string }) => [d.id, d.parent_session_id])).toEqual([
      ["drafter/001-agent", "drafter"],
    ]);

    const turns = await (await get(traceTurns, "runId=row-1&sessionId=drafter%2F001-agent&after=-1")).json();
    expect(turns.data).toMatchObject({ session_id: "drafter/001-agent", turns: [{ order: 0, content: "Check." }] });
  });

  it("refuses what it cannot answer", async () => {
    expect((await get(traceSessions, "")).status).toBe(400);
    expect((await get(traceTurns, "runId=row-1")).status).toBe(400);
    expect((await get(traceTurns, "runId=row-1&sessionId=drafter&after=x")).status).toBe(400);
    expect((await get(traceTurns, "runId=row-1&sessionId=nope")).status).toBe(404);
    mockStrutRun.findFirst.mockResolvedValue(null);
    expect((await get(traceSessions, "runId=other")).status).toBe(404);
  });

  it("says when strut could not be read", async () => {
    mockEvents.mockResolvedValue(null);
    expect((await get(traceSessions, "runId=row-1")).status).toBe(502);
  });
});

describe("GET legal/benchmarks/strut/cascade/export", () => {
  const T = (sec: number) => new Date(Date.UTC(2026, 9, 21, 3, 0, sec)).toISOString();
  const log = [
    { type: "step.start", path: "harvey-lab-run/drafter", stepType: "agent", ts: T(1), input: { prompt: "Draft it." } },
    { type: "step.start", path: "harvey-lab-run/drafter/001-graph_get", stepType: "tool:graph_graph_get", toolCallId: "c1", ts: T(2), input: { ref_id: "c-1" } },
    {
      type: "step.end",
      path: "harvey-lab-run/drafter/001-graph_get",
      stepType: "tool:graph_graph_get",
      toolCallId: "c1",
      ts: T(3),
      output: { name: "Cap" },
      nodes: [{ ref_id: "c-1", node_type: "Concept", name: "Cap" }],
    },
    { type: "step.start", path: "harvey-lab-run/drafter/002-agent", stepType: "tool:agent", toolCallId: "c2", ts: T(4), input: { prompt: "Check." } },
  ];
  const get = (query = "runId=row-1", slug = "openlaw-1") =>
    traceExport(new NextRequest(`http://localhost/x?${query}`), { params: Promise.resolve({ slug }) });

  beforeEach(() => {
    clearStrutTraceCache();
    mockResolve.mockResolvedValue(member("VIEWER"));
    mockStrutRun.findFirst.mockResolvedValue({ ...finished, status: StrutRunStatus.PENDING });
    mockEvents.mockResolvedValue(log);
    mockSwarmAccess.mockResolvedValue({ success: true, data: { swarmName: "swarm-1", swarmApiKey: "key-1" } });
    mockPrefetch.mockResolvedValue({ peeks: new Map([["c-1", { state: "done", payload: {} }]]), skipped: [] });
    mockHtml.mockReturnValue("<!DOCTYPE html><html>trace</html>");
  });

  it("builds the trace file from the run's strut log, with the Concepts it read", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toContain("run-trace-row-1.html");
    expect(await res.text()).toBe("<!DOCTYPE html><html>trace</html>");

    const [payload, title] = mockHtml.mock.calls[0];
    expect(title).toBe("Run trace · row-1");
    expect(payload.meta).toMatchObject({ runId: "row-1", identifier: "179", skippedPeeks: [] });
    expect(payload.model.summary).toMatchObject({ agents: 1, subAgents: 1, running: false });
    expect(Object.keys(payload.peeks)).toEqual(["c-1"]);
    expect(mockSwarmAccess).toHaveBeenCalledWith("openlaw-1", "user-1");
    expect(mockPrefetch).toHaveBeenCalledWith(["c-1"], { swarmName: "swarm-1", swarmApiKey: "key-1" }, expect.any(Object));
  });

  it("still exports the trace without swarm access, with no peeks", async () => {
    mockSwarmAccess.mockResolvedValue({ success: false, error: { type: "SWARM_NOT_ACTIVE" } });
    expect((await get()).status).toBe(200);
    expect(mockPrefetch).not.toHaveBeenCalled();
    expect(mockHtml.mock.calls[0][0].peeks).toEqual({});
  });

  it("is not there for openlaw, and refuses another workspace's run", async () => {
    expect((await get("runId=row-1", "openlaw")).status).toBe(404);
    expect((await get("")).status).toBe(400);
    mockStrutRun.findFirst.mockResolvedValue(null);
    expect((await get("runId=other")).status).toBe(404);
    expect(mockEvents).not.toHaveBeenCalled();
    expect(mockHtml).not.toHaveBeenCalled();
  });

  it("limits exports per user", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfter: 30 } as never);
    const res = await get();
    expect(res.status).toBe(429);
    expect(vi.mocked(checkRateLimit).mock.calls[0][0]).toBe("legal-cascade-export:user-1");
    expect(mockEvents).not.toHaveBeenCalled();
  });

  it("says when strut could not be read, and builds no file", async () => {
    mockEvents.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not read the run from strut" });
    expect(mockHtml).not.toHaveBeenCalled();
  });
});
