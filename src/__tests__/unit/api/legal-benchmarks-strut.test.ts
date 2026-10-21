/**
 * The Legal Benchmarks routes of a strut workspace (`LEGAL_STRUT_SLUGS`):
 * launch `harvey-lab-run`, list its runs, download a deliverable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { StrutRunStatus } from "@prisma/client";

const { mockResolve, mockStrutRun, mockDispatch, mockArtifact } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockStrutRun: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  mockDispatch: vi.fn(),
  mockArtifact: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-access", () => ({ resolveWorkspaceAccess: mockResolve }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", async (orig) => ({
  ...(await orig<typeof import("@/services/strut-runs")>()),
  dispatchStrutRun: mockDispatch,
}));
vi.mock("@/services/strut-runs/openhealth", () => ({ settleFromStrut: vi.fn(async (row: unknown) => row) }));
vi.mock("@/services/strut-runs/lab", () => ({ fetchStrutArtifact: mockArtifact }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST as launch } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/run/route";
import { GET as list } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/runs/route";
import { GET as deliverable } from "@/app/api/workspaces/[slug]/legal/benchmarks/strut/runs/[runId]/deliverables/[name]/route";
import { StrutDispatchError } from "@/services/strut-runs";

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
