/**
 * Unit tests for the `job_turn` completion handler
 * (`services/strut-runs/job-turn.ts`).
 *
 * Themes:
 *   - the mapping from strut's RESOLVED artifact list to hive's refs is
 *     pure and covers every branch: a strut-relative url → a `graph` ref
 *     the reader serves (html shown as `url`, a diff file as `code`); an
 *     absolute url → inline `{ url }` (kind kept for media, `url` for the
 *     rest); inline content per kind (markdown / log / code / json / a
 *     diff string as code); an entry with `error` dropped and named;
 *   - what a settled row says: success text + `ask`, error (and the
 *     `job_busy:` wording), cancelled, LOST, an output not in shape;
 *   - delivery: ONE assistant row per turn, `job-<row.id>`, header the
 *     model reads the job id from, `source.kind: "job"`, `artifacts` on
 *     the row; idempotent on replay; read from the ROW's swarm; a 404
 *     from strut delivers the text alone; a 5xx throws (strut retries);
 *     an error row appends without reading strut.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockTx, mockTransaction, mockNotify, mockLab, mockClearActiveRun, mockNotifyRunActive } = vi.hoisted(() => {
  const mockTx = {
    workspace: { findUnique: vi.fn() },
    sharedConversation: { findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    mockTx,
    mockTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
    mockNotify: vi.fn(),
    mockLab: vi.fn(),
    mockClearActiveRun: vi.fn(),
    mockNotifyRunActive: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: { $transaction: mockTransaction } }));
vi.mock("@/lib/pusher", () => ({ notifyCanvasConversationUpdated: mockNotify }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/strut-runs", () => ({ labForRow: mockLab }));
vi.mock("@/services/canvas-active-runs-hooks", () => ({
  clearActiveRun: mockClearActiveRun,
  notifyRunActive: mockNotifyRunActive,
}));

import {
  handleJobTurnSettled,
  jobRowId,
  mapStrutArtifacts,
  parseStrutArtifacts,
  renderJobContent,
  replyForRow,
  type StrutArtifact,
} from "@/services/strut-runs/job-turn";
import type { StrutRunRow } from "@/services/strut-runs";

const mockFetch = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";

function row(over: Record<string, unknown> = {}): StrutRunRow {
  return {
    id: "row-1",
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "job_turn",
    workflow: "job",
    strutRunId: "1790000000000",
    status: StrutRunStatus.SUCCESS,
    input: { prompt: "Plan dark mode", title: "Dark mode plan" },
    output: { text: "Wrote the plan.", artifacts: [{ id: "plan", title: "Plan", path: "plan.md" }], cost: 0.01 },
    error: null,
    durationMs: 1200,
    conversationId: "conv-1",
    proposalId: null,
    jobId: JOB,
    createdAt: new Date("2026-09-30T10:00:00Z"),
    settledAt: new Date("2026-09-30T10:01:00Z"),
    ...over,
  } as StrutRunRow;
}

const entry = (over: Partial<StrutArtifact>): StrutArtifact => ({ id: "a", kind: "markdown", title: "A", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockLab.mockResolvedValue({ labBase: "https://swarm1.sphinx.chat:3355/lab", swarmApiKey: "swarm-key", swarmName: "swarm1" });
  mockTx.workspace.findUnique.mockResolvedValue({ sourceControlOrgId: "org-1" });
  mockTx.sharedConversation.findUnique.mockResolvedValue({ userId: "user-1", sourceControlOrgId: "org-1", isShared: false });
  mockTx.$queryRaw.mockResolvedValue([{ messages: [] }]);
  mockTx.sharedConversation.update.mockResolvedValue({});
  mockClearActiveRun.mockResolvedValue({ wasLast: true });
  mockNotifyRunActive.mockResolvedValue(undefined);
});

describe("parseStrutArtifacts", () => {
  it("keeps whole entries in order and drops the rest", () => {
    expect(
      parseStrutArtifacts([
        { id: "plan", kind: "markdown", title: "Plan", label: "Plan", summary: "Three steps.", url: `/jobs/${JOB}/files/plan.md` },
        { id: "", title: "no id" },
        "not an entry",
        { id: "x", title: "no kind → url" },
      ]),
    ).toEqual([
      { id: "plan", kind: "markdown", title: "Plan", label: "Plan", summary: "Three steps.", url: `/jobs/${JOB}/files/plan.md`, content: undefined, error: undefined },
      { id: "x", kind: "url", title: "no kind → url", label: undefined, summary: undefined, url: undefined, content: undefined, error: undefined },
    ]);
    expect(parseStrutArtifacts(undefined)).toEqual([]);
  });
});

describe("mapStrutArtifacts", () => {
  it("a strut-relative url → a graph ref the reader serves, kind as strut said", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [entry({ id: "plan", title: "Plan", label: "Plan", summary: "Three steps.", url: `/jobs/${JOB}/files/plan.md` })],
      "swarm-1",
    );
    expect(dropped).toEqual([]);
    expect(refs).toEqual([
      { id: "plan", kind: "markdown", title: "Plan", label: "Plan", summary: "Three steps.", source: { type: "graph", swarmId: "swarm-1", key: `/jobs/${JOB}/files/plan.md` } },
    ]);
  });

  it("a run's own artifact link is a graph ref too", () => {
    const { refs } = mapStrutArtifacts([entry({ kind: "image", url: "/artifacts/1790000000000/shot.png" })], "swarm-1");
    expect(refs[0]).toMatchObject({ kind: "image", source: { type: "graph", swarmId: "swarm-1", key: "/artifacts/1790000000000/shot.png" } });
  });

  it("a page strut wrote is shown as `url` (a static page through the reader); a diff file or a pull request as code", () => {
    const { refs } = mapStrutArtifacts(
      [
        entry({ id: "page", kind: "html", url: `/jobs/${JOB}/files/index.html` }),
        entry({ id: "d", kind: "diff", url: `/jobs/${JOB}/files/change.diff` }),
        entry({ id: "pr", kind: "pull_request", url: `/jobs/${JOB}/files/pr.json` }),
        entry({ id: "odd", kind: "spreadsheet", url: `/jobs/${JOB}/files/x.xlsx` }),
      ],
      "swarm-1",
    );
    expect(refs.map((r) => [r.id, r.kind])).toEqual([
      ["page", "url"],
      ["d", "code"],
      ["pr", "code"],
      ["odd", "url"],
    ]);
    expect(refs.every((r) => r.source.type === "graph")).toBe(true);
  });

  it("a strut-relative url outside the two link shapes, or with `..`, is dropped", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [entry({ id: "a", title: "Secrets", url: "/secrets" }), entry({ id: "b", title: "Up", url: `/jobs/${JOB}/files/../../secrets.json` })],
      "swarm-1",
    );
    expect(refs).toEqual([]);
    expect(dropped).toEqual([
      { title: "Secrets", reason: "bad url" },
      { title: "Up", reason: "bad url" },
    ]);
  });

  it("an absolute url → inline { url }: the kind kept for media and pages, `url` for anything else", () => {
    const { refs } = mapStrutArtifacts(
      [
        entry({ id: "pod", kind: "url", url: "https://pod.example/" }),
        entry({ id: "shot", kind: "image", url: "https://cdn.example/shot.png" }),
        entry({ id: "doc", kind: "markdown", url: "https://docs.example/plan.md" }),
        entry({ id: "pr", kind: "pull_request", url: "https://github.com/acme/widgets/pull/7" }),
      ],
      "swarm-1",
    );
    expect(refs.map((r) => [r.id, r.kind, r.source])).toEqual([
      ["pod", "url", { type: "inline", content: { url: "https://pod.example/" } }],
      ["shot", "image", { type: "inline", content: { url: "https://cdn.example/shot.png" } }],
      ["doc", "url", { type: "inline", content: { url: "https://docs.example/plan.md" } }],
      ["pr", "url", { type: "inline", content: { url: "https://github.com/acme/widgets/pull/7" } }],
    ]);
  });

  it("inline content per kind", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [
        entry({ id: "md", kind: "markdown", content: "# Notes" }),
        entry({ id: "log", kind: "log", content: "line 1\nline 2" }),
        entry({ id: "code", kind: "code", content: "const a = 1;" }),
        entry({ id: "json", kind: "json", content: '{"a":1}' }),
        entry({ id: "json2", kind: "json", content: { a: 1 } }),
        entry({ id: "json3", kind: "json", content: 42 }),
        entry({ id: "diff", kind: "diff", content: "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n" }),
        entry({ id: "html", kind: "html", content: "<h1>hi</h1>" }),
        entry({ id: "link", kind: "url", content: "https://example.test/" }),
        entry({ id: "pr", kind: "pull_request", content: { url: "https://github.com/a/b/pull/1", repo: "a/b", number: 1, state: "open" } }),
        entry({ id: "pr2", kind: "pull_request", content: '{"url":"https://github.com/a/b/pull/2","repo":"a/b","number":2,"state":"open"}' }),
        entry({ id: "pr3", kind: "pull_request", content: "https://github.com/a/b/pull/3" }),
        entry({ id: "img", kind: "image", content: "not an address" }),
        entry({ id: "big", kind: "markdown", content: "x".repeat(50_001) }),
      ],
      "swarm-1",
    );
    expect(refs.map((r) => [r.id, r.kind, r.source])).toEqual([
      ["md", "markdown", { type: "inline", content: { text: "# Notes" } }],
      ["log", "log", { type: "inline", content: { text: "line 1\nline 2" } }],
      ["code", "code", { type: "inline", content: { code: "const a = 1;" } }],
      ["json", "json", { type: "inline", content: { value: { a: 1 } } }],
      ["json2", "json", { type: "inline", content: { a: 1 } }],
      ["json3", "json", { type: "inline", content: { value: 42 } }],
      ["diff", "code", { type: "inline", content: { code: "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n", language: "diff" } }],
      ["html", "code", { type: "inline", content: { code: "<h1>hi</h1>", language: "html" } }],
      ["link", "url", { type: "inline", content: { url: "https://example.test/" } }],
      ["pr", "pull_request", { type: "inline", content: { url: "https://github.com/a/b/pull/1", repo: "a/b", number: 1, state: "open" } }],
      ["pr2", "pull_request", { type: "inline", content: { url: "https://github.com/a/b/pull/2", repo: "a/b", number: 2, state: "open" } }],
    ]);
    expect(dropped).toEqual([
      { title: "A", reason: "unsupported content" },
      { title: "A", reason: "unsupported content" },
      { title: "A", reason: "unsupported content" },
    ]);
  });

  it("an entry strut could not resolve is dropped and named", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [entry({ id: "missing", title: "Missing", error: "not found" }), entry({ id: "nothing", title: "Nothing" })],
      "swarm-1",
    );
    expect(refs).toEqual([]);
    expect(dropped).toEqual([
      { title: "Missing", reason: "not found" },
      { title: "Nothing", reason: "nothing to show" },
    ]);
  });
});

describe("replyForRow", () => {
  it("success → the agent's text, and its question when it asked one", () => {
    expect(replyForRow(row())).toEqual({ outcome: "success", text: "Wrote the plan." });
    expect(replyForRow(row({ output: { text: "Two options.", ask: { message: "Which auth provider?" }, artifacts: [] } }))).toEqual({
      outcome: "success",
      text: "Two options.",
      ask: "Which auth provider?",
    });
    expect(replyForRow(row({ output: { artifacts: [] } })).text).toBe("_(no reply text)_");
  });

  it("an output not in shape is said so", () => {
    expect(replyForRow(row({ output: "just a string" }))).toMatchObject({ outcome: "error", error: "unexpected output" });
  });

  it("error / job_busy / cancelled / lost", () => {
    expect(replyForRow(row({ status: StrutRunStatus.ERROR, output: null, error: "agent failed after 3 step(s): boom" }))).toEqual({
      outcome: "error",
      text: "The turn did not complete: agent failed after 3 step(s): boom",
      error: "agent failed after 3 step(s): boom",
    });
    expect(replyForRow(row({ status: StrutRunStatus.ERROR, output: null, error: 'job_busy: job "x" is in use by run 1' })).text).toMatch(
      /previous turn of this job was still running/,
    );
    expect(replyForRow(row({ status: StrutRunStatus.CANCELLED, output: null }))).toEqual({ outcome: "cancelled", text: "The turn was stopped." });
    expect(replyForRow(row({ status: StrutRunStatus.LOST, output: null, error: "no live run" })).outcome).toBe("lost");
  });
});

describe("renderJobContent", () => {
  it("header the model reads the job id from, the text, the question, the unavailable ones", () => {
    expect(
      renderJobContent({
        jobId: JOB,
        title: "Dark mode plan",
        reply: { outcome: "success", text: "Split step 2.", ask: "Keep the old toggle?" },
        dropped: [{ title: "Screenshot", reason: "not found" }],
      }),
    ).toBe(`**Job · ${JOB} · Dark mode plan**\n\nSplit step 2.\n\n**Question for you:** Keep the old toggle?\n\n_Unavailable: Screenshot (not found)_`);
  });
});

describe("handleJobTurnSettled", () => {
  const artifactsBody = {
    workflow: "job",
    runId: "1790000000000",
    job: JOB,
    artifacts: [{ id: "plan", kind: "markdown", title: "Plan", url: `/jobs/${JOB}/files/plan.md` }],
  };

  it("success: reads the resolved list from the ROW's swarm and appends one row with the refs", async () => {
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    await handleJobTurnSettled(row());

    expect(mockLab).toHaveBeenCalledWith(expect.objectContaining({ swarmId: "swarm-1" }));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://swarm1.sphinx.chat:3355/lab/workflows/job/runs/1790000000000/artifacts");
    expect(init.headers["x-api-token"]).toBe("swarm-key");

    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    const update = mockTx.sharedConversation.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "conv-1" });
    const messages = update.data.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: jobRowId(row()),
      role: "assistant",
      content: `**Job · ${JOB} · Dark mode plan**\n\nWrote the plan.`,
      source: { kind: "job", jobId: JOB, strutRunId: "1790000000000", workflow: "job", status: "success", title: "Dark mode plan" },
      artifacts: [{ id: "plan", kind: "markdown", title: "Plan", source: { type: "graph", swarmId: "swarm-1", key: `/jobs/${JOB}/files/plan.md` } }],
    });
    expect(typeof messages[0].timestamp).toBe("string");
    expect(mockNotify).toHaveBeenCalledWith("conv-1", "job");
    expect(mockClearActiveRun).toHaveBeenCalledWith("conv-1", "row-1");
    expect(mockNotifyRunActive).toHaveBeenCalledWith("conv-1", false);
  });

  it("is idempotent: a replay finds the row and appends nothing", async () => {
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    mockTx.$queryRaw.mockResolvedValue([{ messages: [{ id: "job-row-1", role: "assistant", content: "earlier" }] }]);
    await handleJobTurnSettled(row());
    expect(mockTx.sharedConversation.update).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("a conversation that is not the user's, or another org's, gets nothing", async () => {
    mockFetch.mockImplementation(async () => json(200, artifactsBody));
    mockTx.sharedConversation.findUnique.mockResolvedValue({ userId: "someone-else", sourceControlOrgId: "org-1", isShared: false });
    await handleJobTurnSettled(row());
    expect(mockTx.sharedConversation.update).not.toHaveBeenCalled();

    mockTx.sharedConversation.findUnique.mockResolvedValue({ userId: "user-1", sourceControlOrgId: "org-2", isShared: true });
    await handleJobTurnSettled(row());
    expect(mockTx.sharedConversation.update).not.toHaveBeenCalled();
  });

  it("a shared conversation of the org is a delivery target", async () => {
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    mockTx.sharedConversation.findUnique.mockResolvedValue({ userId: "someone-else", sourceControlOrgId: "org-1", isShared: true });
    await handleJobTurnSettled(row());
    expect(mockTx.sharedConversation.update).toHaveBeenCalledTimes(1);
  });

  it("strut has lost the run (404): the text is delivered alone, the artifacts named unavailable", async () => {
    mockFetch.mockResolvedValue(json(404, { error: "not found" }));
    await handleJobTurnSettled(row());
    const [msg] = mockTx.sharedConversation.update.mock.calls[0][0].data.messages;
    expect(msg.artifacts).toBeUndefined();
    expect(msg.content).toContain("_Unavailable: the turn's artifacts (run not found on strut)_");
  });

  it("strut unreachable or 5xx: throws so the webhook answers 5xx and strut re-posts", async () => {
    mockFetch.mockResolvedValue(json(503, {}));
    await expect(handleJobTurnSettled(row())).rejects.toThrow(/artifacts unavailable/);
    expect(mockTx.sharedConversation.update).not.toHaveBeenCalled();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(handleJobTurnSettled(row())).rejects.toThrow(/ECONNREFUSED/);
  });

  it("an error row appends a row saying so without reading strut", async () => {
    await handleJobTurnSettled(row({ status: StrutRunStatus.ERROR, output: null, error: "agent failed: boom" }));
    expect(mockFetch).not.toHaveBeenCalled();
    const [msg] = mockTx.sharedConversation.update.mock.calls[0][0].data.messages;
    expect(msg.content).toBe(`**Job · ${JOB} · Dark mode plan**\n\nThe turn did not complete: agent failed: boom`);
    expect(msg.source).toMatchObject({ kind: "job", status: "error" });
    expect(msg.artifacts).toBeUndefined();
  });

  it("a row with no job id delivers nothing", async () => {
    await handleJobTurnSettled(row({ jobId: null }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
