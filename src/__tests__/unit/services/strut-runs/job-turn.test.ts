/**
 * Unit tests for the `job_turn` completion handler
 * (`services/strut-runs/job-turn.ts`).
 *
 * Themes:
 *   - the mapping from strut's RESOLVED artifact list to hive's refs is
 *     pure and covers every branch: a strut-relative url → a `graph` ref
 *     the reader serves (html kept as `html`, a diff file as `code`); an
 *     absolute url → inline `{ url }` (kind kept for media, `url` for the
 *     rest); inline content per kind (markdown / log / code / json / a
 *     diff string as code); an entry with `error` dropped and named; a
 *     PEER's entry (`{ path, peer, job }`, strut CALLBACKS.md §4) → a
 *     `graph` ref on the swarm hive registered as that peer, keyed
 *     `/jobs/<job, percent-encoded>/files/<path>`, never resolved against
 *     the row's swarm — named instead when hive cannot place it;
 *   - what a settled row says: success text + `ask`, error (and the
 *     `job_busy:` wording), cancelled, LOST, an output not in shape;
 *   - delivery: ONE assistant row per turn, `job-<row.id>`, header the
 *     model reads the job id from, `source.kind: "job"`, `artifacts` on
 *     the row; idempotent on replay; read from the ROW's swarm; a 404
 *     from strut delivers the text alone; a 5xx throws (strut retries);
 *     an error row appends without reading strut;
 *   - the wake: once the row is appended (not on a replay, not without a
 *     conversation) strut's orchestrator is woken after the response with
 *     the outcome, the reply text, the question, the cards and the
 *     callback's host — whoever started the job; whether the orchestrator
 *     did (`via: "orchestrator"`) is said, never the engine;
 *   - the trace card: a successful turn that touched the graph carries a
 *     `run_graph` ref after the job's own, one id per job, counted from the
 *     run's log within a bounded read — never indexed, never named to the
 *     wake, and never a reason to fail or retry the delivery;
 *   - the claims card: a successful turn of a job that claims something
 *     carries a `claims` ref (its ledger, read off the row's swarm and
 *     enriched from the listing) between the job's refs and the trace, one
 *     id per job; none from a swarm without claims, and never a reason to
 *     fail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const {
  mockTx,
  mockTransaction,
  mockNotify,
  mockLab,
  mockClearActiveRun,
  mockNotifyRunActive,
  mockWorkspaceFindUnique,
  mockWorkspaceFindMany,
  mockOrchestratorWake,
  mockIndex,
  mockPending,
  mockRequeue,
  mockCheckFailure,
  mockCount,
  mockTurns,
  mockNudge,
  afterCallbacks,
} = vi.hoisted(() => {
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
    mockWorkspaceFindUnique: vi.fn(),
    mockWorkspaceFindMany: vi.fn(),
    mockOrchestratorWake: vi.fn(),
    mockIndex: vi.fn(),
    mockPending: vi.fn(),
    mockRequeue: vi.fn(),
    mockCheckFailure: vi.fn(),
    mockCount: vi.fn(),
    mockTurns: vi.fn(),
    mockNudge: vi.fn(),
    afterCallbacks: [] as Array<() => Promise<void>>,
  };
});

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void afterCallbacks.push(fn),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mockTransaction,
    workspace: { findUnique: mockWorkspaceFindUnique, findMany: mockWorkspaceFindMany },
    strutRun: { findMany: mockTurns },
  },
}));
vi.mock("@/services/strut-orchestrator-wake", () => ({ invokeOrchestratorOnJobTurn: mockOrchestratorWake }));
vi.mock("@/services/strut-jobs/artifact-events", () => ({
  indexJobArtifacts: mockIndex,
  launchPendingArtifactEvents: mockPending,
  requeueArtifactEvent: mockRequeue,
}));
vi.mock("@/services/strut-jobs/check-failures", () => ({ deliverCheckFailure: mockCheckFailure }));
vi.mock("@/lib/pusher", () => ({ notifyCanvasConversationUpdated: mockNotify }));
vi.mock("@/services/canvas-jobs", async (orig) => ({
  ...(await orig<typeof import("@/services/canvas-jobs")>()),
  nudgeCanvasCardJob: mockNudge,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/strut-runs", () => ({ labForRow: mockLab }));
vi.mock("@/services/strut-runs/run-graph", () => ({ countStrutRunGraph: mockCount }));
vi.mock("@/services/canvas-active-runs-hooks", () => ({
  clearActiveRun: mockClearActiveRun,
  notifyRunActive: mockNotifyRunActive,
}));

import {
  handleJobTurnSettled,
  jobRowId,
  mapStrutArtifacts,
  parseStrutArtifacts,
  peerSwarmsFor,
  replyPeerOf,
  pullRequestContent,
  renderJobContent,
  replyForRow,
  runGraphArtifact,
  runGraphArtifactId,
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
  mockWorkspaceFindUnique.mockResolvedValue({ slug: "acme" });
  mockWorkspaceFindMany.mockResolvedValue([]);
  mockOrchestratorWake.mockResolvedValue(undefined);
  mockIndex.mockResolvedValue(0);
  mockPending.mockResolvedValue("none");
  mockRequeue.mockResolvedValue(false);
  mockCheckFailure.mockResolvedValue({ jobs: [] });
  mockCount.mockResolvedValue(null);
  mockTurns.mockResolvedValue([]);
  afterCallbacks.length = 0;
});

/** Run what the handler scheduled for after the response. */
async function flushAfter(): Promise<void> {
  for (const fn of afterCallbacks.splice(0)) await fn();
}

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

  it("keeps a peer's tag and path as strut delivered them; a peer id that is no slug is not a tag", () => {
    const [tagged, junk] = parseStrutArtifacts([
      { id: "plan", kind: "markdown", title: "Plan", path: "plan.md", peer: "acme-web", job: "peer/build-1" },
      { id: "x", kind: "markdown", title: "X", path: "x.md", peer: "../evil", job: "peer/build-1" },
    ]);
    expect(tagged).toMatchObject({ path: "plan.md", peer: "acme-web", job: "peer/build-1" });
    expect(junk.peer).toBeUndefined();
  });
});

describe("mapStrutArtifacts", () => {
  it("a captcha with a strut-relative manifest url maps to a captcha graph ref", () => {
    const url = `/jobs/${JOB}/files/captcha/001/captcha.json`;
    const { refs, dropped } = mapStrutArtifacts([entry({ id: "captcha", kind: "captcha", title: "Captcha", url })], "swarm-1");
    expect(dropped).toEqual([]);
    expect(refs).toEqual([{ id: "captcha", kind: "captcha", title: "Captcha", source: { type: "graph", swarmId: "swarm-1", key: url } }]);
  });

  it("a tree card the agent copied under another kind maps to graph; unrelated json stays json", () => {
    const obj = { workspace: "hive", focus: "1d184bca-d7fd-4754-9977-f38d69d3f88f", layout: "tree" };
    const { refs, dropped } = mapStrutArtifacts(
      [
        entry({ id: "brainstorm-tree", kind: "json", title: "Tree", content: JSON.stringify(obj) }),
        entry({ id: "other", kind: "json", title: "Other", content: { focus: "x", workspace: "w", layout: "tree" } }),
        entry({ id: "brainstorm-tree", kind: "markdown", title: "Md", content: obj }),
        entry({ id: "nows", kind: "json", title: "No workspace", content: { focus: "x", layout: "tree" } }),
        entry({ id: "data", kind: "json", title: "Data", content: '{"a":1}' }),
      ],
      "swarm-1",
    );
    expect(refs.map((r) => [r.id, r.kind, r.source])).toEqual([
      ["brainstorm-tree", "graph", { type: "inline", content: obj }],
      ["other", "graph", { type: "inline", content: { focus: "x", workspace: "w", layout: "tree" } }],
      ["brainstorm-tree", "graph", { type: "inline", content: obj }],
      ["data", "json", { type: "inline", content: { value: { a: 1 } } }],
    ]);
    expect(dropped).toEqual([{ title: "No workspace", reason: "unsupported content" }]);
  });

  it("a graph card maps to an inline graph ref — record content, or JSON text; bad text is dropped", () => {
    const content = { workspace: "hive", focus: "c1" };
    const { refs, dropped } = mapStrutArtifacts(
      [
        entry({ id: "brainstorm-tree", kind: "graph", title: "Tree", content }),
        entry({ id: "t2", kind: "graph", title: "Tree 2", content: JSON.stringify(content) }),
        entry({ id: "bad", kind: "graph", title: "Bad", content: "not json" }),
        entry({ id: "arr", kind: "graph", title: "Arr", content: "[1]" }),
      ],
      "swarm-1",
    );
    expect(refs.map((r) => [r.id, r.kind, r.source])).toEqual([
      ["brainstorm-tree", "graph", { type: "inline", content }],
      ["t2", "graph", { type: "inline", content }],
    ]);
    expect(dropped.map((d) => d.reason)).toEqual(["unsupported content", "unsupported content"]);
  });

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

  it("a page strut wrote stays html (the frame reads it through the reader); a diff file or a pull request as code", () => {
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
      ["page", "html"],
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

  it("an absolute url → inline { url }: the kind kept for media and pages, a GitHub pull request link as the pull request, `url` for anything else", () => {
    const { refs } = mapStrutArtifacts(
      [
        entry({ id: "pod", kind: "url", url: "https://pod.example/" }),
        entry({ id: "shot", kind: "image", url: "https://cdn.example/shot.png" }),
        entry({ id: "doc", kind: "markdown", url: "https://docs.example/plan.md" }),
        entry({ id: "pr", kind: "pull_request", url: "https://github.com/acme/widgets/pull/7" }),
        entry({ id: "notpr", kind: "pull_request", url: "https://gitlab.example/acme/widgets/-/merge_requests/7" }),
      ],
      "swarm-1",
    );
    expect(refs.map((r) => [r.id, r.kind, r.source])).toEqual([
      ["pod", "url", { type: "inline", content: { url: "https://pod.example/" } }],
      ["shot", "image", { type: "inline", content: { url: "https://cdn.example/shot.png" } }],
      ["doc", "url", { type: "inline", content: { url: "https://docs.example/plan.md" } }],
      ["pr", "pull_request", { type: "inline", content: { url: "https://github.com/acme/widgets/pull/7", repo: "acme/widgets", number: 7, state: "open" } }],
      ["notpr", "url", { type: "inline", content: { url: "https://gitlab.example/acme/widgets/-/merge_requests/7" } }],
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
        entry({ id: "pr4", kind: "pull_request", content: "opened it" }),
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
      ["pr3", "pull_request", { type: "inline", content: { url: "https://github.com/a/b/pull/3", repo: "a/b", number: 3, state: "open" } }],
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

describe("pullRequestContent", () => {
  const PR = { url: "https://github.com/a/b/pull/5", repo: "a/b", number: 5, state: "open" };
  it("fills what the link implies: repo, number, and the link from repo + number", () => {
    expect(pullRequestContent({ url: PR.url })).toEqual(PR);
    expect(pullRequestContent({ repo: "a/b", number: 5 })).toEqual(PR);
    expect(pullRequestContent(PR.url)).toEqual(PR);
    expect(pullRequestContent(JSON.stringify({ url: PR.url }))).toEqual(PR);
  });
  it("state defaults to open, is lowercased, and anything else is open", () => {
    expect(pullRequestContent({ ...PR, state: "MERGED" })?.state).toBe("merged");
    expect(pullRequestContent({ ...PR, state: "shipped" })?.state).toBe("open");
  });
  it("a numeric string number is read; the given fields win over the link's", () => {
    expect(pullRequestContent({ ...PR, number: "5" })).toEqual(PR);
    expect(pullRequestContent({ url: PR.url, repo: "c/d", number: 9, body: "x" })).toEqual({ url: PR.url, repo: "c/d", number: 9, state: "open", body: "x" });
  });
  it("null when neither the fields nor the link say which pull request", () => {
    expect(pullRequestContent({ state: "open" })).toBeNull();
    expect(pullRequestContent({ repo: "a/b" })).toBeNull();
    expect(pullRequestContent("opened it")).toBeNull();
    expect(pullRequestContent("{not json")).toBeNull();
    expect(pullRequestContent(42)).toBeNull();
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

describe("mapStrutArtifacts — a peer's deliverable (strut CALLBACKS.md §4)", () => {
  const PEERS = new Map([["acme-web", "swarm-peer"]]);
  const tagged = (over: Partial<StrutArtifact>) => entry({ id: "plan", title: "Plan", path: "plan.md", peer: "acme-web", job: "peer/build-1", ...over });

  it("a tagged path is a graph ref on the PEER's swarm, keyed /jobs/<job, percent-encoded>/files/<path>", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [
        tagged({ label: "Plan", summary: "Two steps." }),
        tagged({ id: "page", kind: "html", title: "Page", path: "/site/index.html" }),
        // A strut-relative url naming a file of that same job is a link on the peer too.
        tagged({ id: "shot", kind: "image", title: "Shot", path: undefined, url: "/jobs/peer%2Fbuild-1/files/shots/1.png" }),
      ],
      "swarm-1",
      PEERS,
    );
    expect(dropped).toEqual([]);
    expect(refs).toEqual([
      { id: "plan", kind: "markdown", title: "Plan", label: "Plan", summary: "Two steps.", source: { type: "graph", swarmId: "swarm-peer", key: "/jobs/peer%2Fbuild-1/files/plan.md" } },
      { id: "page", kind: "html", title: "Page", source: { type: "graph", swarmId: "swarm-peer", key: "/jobs/peer%2Fbuild-1/files/site/index.html" } },
      { id: "shot", kind: "image", title: "Shot", source: { type: "graph", swarmId: "swarm-peer", key: "/jobs/peer%2Fbuild-1/files/shots/1.png" } },
    ]);
  });

  it("an absolute url or inline content on a peer's entry is what it is anywhere", () => {
    const { refs } = mapStrutArtifacts(
      [
        tagged({ id: "pr", kind: "pull_request", title: "PR", path: undefined, url: "https://github.com/a/b/pull/7" }),
        tagged({ id: "notes", kind: "markdown", title: "Notes", path: undefined, content: "# Notes" }),
      ],
      "swarm-1",
      PEERS,
    );
    expect(refs.map((r) => [r.id, r.source])).toEqual([
      ["pr", { type: "inline", content: { url: "https://github.com/a/b/pull/7", repo: "a/b", number: 7, state: "open" } }],
      ["notes", { type: "inline", content: { text: "# Notes" } }],
    ]);
  });

  it("never resolved against the row's swarm: a peer hive cannot place, or a file it cannot name there, is named instead", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [
        tagged({ title: "Unknown peer", peer: "elsewhere" }),
        tagged({ title: "No job", job: undefined }),
        tagged({ title: "Not ours", job: "build-1" }),
        tagged({ title: "A run's file", path: undefined, url: "/artifacts/1790000000000/x.md" }),
        tagged({ title: "Another job's file", path: undefined, url: "/jobs/peer%2Fother/files/x.md" }),
        tagged({ title: "Escape", path: "../../secrets" }),
      ],
      "swarm-1",
      PEERS,
    );
    expect(refs).toEqual([]);
    expect(dropped).toEqual([
      { title: "Unknown peer", reason: "on @elsewhere, which is no swarm of this org" },
      ...["No job", "Not ours", "A run's file", "Another job's file", "Escape"].map((title) => ({ title, reason: "on @acme-web, not a file hive can name there" })),
    ]);
    // Without the peers read, the same entry is still never this swarm's.
    expect(mapStrutArtifacts([tagged({})], "swarm-1").refs).toEqual([]);
  });

  it("an untagged entry stays as it was — its url on the row's swarm, whatever peers are known", () => {
    const local = entry({ id: "plan", title: "Plan", path: "plan.md", url: `/jobs/${JOB}/files/plan.md` });
    expect(mapStrutArtifacts([local], "swarm-1", PEERS)).toEqual(mapStrutArtifacts([local], "swarm-1"));
    expect(mapStrutArtifacts([local], "swarm-1", PEERS).refs[0].source).toEqual({ type: "graph", swarmId: "swarm-1", key: `/jobs/${JOB}/files/plan.md` });
  });
});

describe("mapStrutArtifacts — a job's app directory is no app (retired, strut plans/chained-orchestrators.md §6)", () => {
  const DOC = `/jobs/${JOB}/files/apps/tracker/dist/index.html`;

  it("parses no `app` off an entry that names a job's directory", () => {
    const [parsed] = parseStrutArtifacts([{ id: "tracker", kind: "app", title: "Visit tracker", url: DOC, app: { job: JOB, path: "apps/tracker" } }]);
    expect(parsed.app).toBeUndefined();
  });

  it("an `app` entry that names no workspace app is never an app ref — its link, or dropped as strut named it", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [
        entry({ id: "tracker", kind: "app", title: "Visit tracker", url: DOC }),
        entry({ id: "broken", kind: "app", title: "Broken", error: "an app is handed over by name once published" }),
      ],
      "swarm-1",
    );
    expect(refs.every((r) => r.kind !== "app")).toBe(true);
    expect(dropped).toEqual([{ title: "Broken", reason: "an app is handed over by name once published" }]);
  });
});

describe("mapStrutArtifacts — a workspace app by name (strut CALLBACKS.md §4, the builder's deliverable)", () => {
  // The entry as strut resolves it since 2026-10-22: the version's document, with the app's name and version beside it.
  const DOC = "/apps/visits/v2/files/dist/index.html";
  const visits = (over: Partial<StrutArtifact>) =>
    entry({ id: "visits", kind: "app", title: "Visits", url: DOC, app: { name: "visits", version: "v2" }, ...over });

  it("parses the app's name, version and build off strut's entry; a name or version hive would not put in a URL is no app", () => {
    const [full, badName, badVersion, unpinned] = parseStrutArtifacts([
      { id: "visits", kind: "app", title: "Visits", url: DOC, app: { name: "visits", version: "v2", hash: "9f2c", builtAt: "2026-10-22T10:04:11.201Z" } },
      { id: "x", kind: "app", title: "X", url: DOC, app: { name: "../escape", version: "v2" } },
      { id: "y", kind: "app", title: "Y", url: DOC, app: { name: "visits", version: "latest" } },
      { id: "z", kind: "app", title: "Z", app: { name: "acme/hvac/visits" }, peer: "acme-web" },
    ]);
    expect(full.app).toEqual({ name: "visits", version: "v2", hash: "9f2c", builtAt: "2026-10-22T10:04:11.201Z" });
    expect(badName.app).toBeUndefined();
    expect(badVersion.app).toBeUndefined();
    expect(unpinned.app).toEqual({ name: "acme/hvac/visits" });
  });

  it("the builder's run.end entry is an `app` ref keyed by the version's document on the row's swarm", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [entry({ id: "visits", kind: "app", title: "Visits", app: { name: "visits", version: "v2" }, url: DOC })],
      "swarm-1",
    );
    expect(dropped).toEqual([]);
    expect(refs).toEqual([{ id: "visits", kind: "app", title: "Visits", source: { type: "graph", swarmId: "swarm-1", key: DOC } }]);
  });

  it("a pinned version: the key is built from `app` when strut gave no url, or a url naming another app; a name with `/` is encoded whole, as strut links it", () => {
    expect(mapStrutArtifacts([visits({ url: undefined })], "swarm-1").refs[0].source).toEqual({ type: "graph", swarmId: "swarm-1", key: DOC });
    expect(mapStrutArtifacts([visits({ url: "/apps/other/v1/files/dist/index.html" })], "swarm-1").refs[0].source).toEqual({
      type: "graph",
      swarmId: "swarm-1",
      key: DOC,
    });
    const nested = visits({ url: "/apps/acme%2Fhvac%2Fvisits/v3/files/dist/index.html", app: { name: "acme/hvac/visits", version: "v3" } });
    expect(mapStrutArtifacts([nested], "swarm-1").refs[0].source).toEqual({
      type: "graph",
      swarmId: "swarm-1",
      key: "/apps/acme%2Fhvac%2Fvisits/v3/files/dist/index.html",
    });
  });

  it("a peer's entry: the app on the PEER's swarm, by name — its active version unless pinned; a peer the org has no swarm for is dropped and named", () => {
    const peers = new Map([["acme-web", "swarm-peer"]]);
    const unpinned = entry({ id: "visits", kind: "app", title: "Visits", app: { name: "visits" }, peer: "acme-web", job: "peer/build-1" });
    const pinned = entry({ id: "visits", kind: "app", title: "Visits", app: { name: "visits", version: "v2" }, peer: "acme-web", job: "peer/build-1" });
    expect(mapStrutArtifacts([unpinned, pinned], "swarm-1", peers).refs).toEqual([
      { id: "visits", kind: "app", title: "Visits", source: { type: "graph", swarmId: "swarm-peer", key: "/apps/visits/files/dist/index.html" } },
      { id: "visits", kind: "app", title: "Visits", source: { type: "graph", swarmId: "swarm-peer", key: DOC } },
    ]);
    const { refs, dropped } = mapStrutArtifacts([unpinned], "swarm-1");
    expect(refs).toEqual([]);
    expect(dropped).toEqual([{ title: "Visits", reason: "on @acme-web, which is no swarm of this org" }]);
  });

  it("a bad name is no app: the entry is the link it carries, which hive's reader does not serve, so it is dropped as today", () => {
    const entries = parseStrutArtifacts([
      { id: "visits", kind: "app", title: "Visits", url: "/apps/bad%20name/v2/files/dist/index.html", app: { name: "bad name", version: "v2" } },
    ]);
    expect(entries[0].app).toBeUndefined();
    const { refs, dropped } = mapStrutArtifacts(entries, "swarm-1");
    expect(refs).toEqual([]);
    expect(dropped).toEqual([{ title: "Visits", reason: "bad url" }]);
    // The mapper holds the same line on an entry handed to it unparsed.
    expect(mapStrutArtifacts([visits({ url: undefined, app: { name: "bad name", version: "v2" } })], "swarm-1").dropped).toEqual([{ title: "Visits", reason: "nothing to show" }]);
  });
});

describe("replyPeerOf", () => {
  it("is the reply's slug-shaped `peer`; nothing for a local build, junk, or no output", () => {
    expect(replyPeerOf({ output: { text: "t", peer: "acme-web" } })).toBe("acme-web");
    for (const output of [{ text: "t", peer: "" }, { text: "t" }, { peer: "../x" }, { peer: 7 }, null, "acme-web", ["acme-web"]]) {
      expect(replyPeerOf({ output } as never)).toBeUndefined();
    }
  });
});

describe("peerSwarmsFor", () => {
  it("reads the swarm of each named peer among the row's org's workspaces, by slug; nothing to read without a tag", async () => {
    mockWorkspaceFindUnique.mockResolvedValue({ sourceControlOrgId: "org-1" });
    mockWorkspaceFindMany.mockResolvedValue([
      { slug: "acme-web", swarm: { id: "swarm-peer" } },
      { slug: "no-swarm", swarm: null },
    ]);
    const peers = await peerSwarmsFor(row(), [
      entry({ peer: "acme-web" }),
      entry({ peer: "acme-web" }),
      entry({ peer: "no-swarm" }),
      entry({}),
    ]);
    expect([...peers]).toEqual([["acme-web", "swarm-peer"]]);
    expect(mockWorkspaceFindUnique).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { sourceControlOrgId: true } });
    expect(mockWorkspaceFindMany).toHaveBeenCalledWith({
      where: { slug: { in: ["acme-web", "no-swarm"] }, sourceControlOrgId: "org-1", deleted: false },
      select: { slug: true, swarm: { select: { id: true } } },
    });

    vi.clearAllMocks();
    expect([...(await peerSwarmsFor(row(), [entry({})]))]).toEqual([]);
    expect(mockWorkspaceFindUnique).not.toHaveBeenCalled();
    expect(mockWorkspaceFindMany).not.toHaveBeenCalled();
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

  it("keeps strut's reference entries on the row, beside the workspace whose strut ran the turn", async () => {
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    await handleJobTurnSettled(row());
    const messages = mockTx.sharedConversation.update.mock.calls[0][0].data.messages as Array<Record<string, unknown>>;
    expect(messages[0].strut).toEqual({ workspace: "acme", artifacts: artifactsBody.artifacts });
    expect(mockWorkspaceFindUnique).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { slug: true } });

    // No workspace to name them against: no envelope.
    mockTx.sharedConversation.update.mockClear();
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    mockWorkspaceFindUnique.mockResolvedValue(null);
    await handleJobTurnSettled(row());
    expect(mockTx.sharedConversation.update.mock.calls[0][0].data.messages[0]).not.toHaveProperty("strut");
  });

  it("tells the job's canvas card it settled: done on success, failed otherwise", async () => {
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    await handleJobTurnSettled(row());
    expect(mockNudge).toHaveBeenCalledWith(expect.objectContaining({ id: "row-1", jobId: JOB }), "done");
    await handleJobTurnSettled(row({ status: StrutRunStatus.ERROR, error: "boom", output: null }));
    expect(mockNudge).toHaveBeenLastCalledWith(expect.objectContaining({ id: "row-1" }), "failed");
  });

  it("a builder turn reads ITS run's list; a peer's deliverable lands as a ref on the peer's swarm", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/artifacts")
        ? json(200, {
            workflow: "builder",
            runId: "1790000000000",
            job: JOB,
            artifacts: [{ id: "wf", kind: "markdown", title: "Workflow", path: "digest.yaml.md", peer: "acme-web", job: `peer/${JOB}` }],
          })
        : json(404, {}),
    );
    mockWorkspaceFindUnique.mockResolvedValue({ slug: "acme", sourceControlOrgId: "org-1" });
    mockWorkspaceFindMany.mockResolvedValue([{ slug: "acme-web", swarm: { id: "swarm-peer" } }]);
    await handleJobTurnSettled(row({ workflow: "builder", output: { text: "Built the digest workflow.", artifacts: [], peer: "acme-web" } }));

    expect(mockFetch.mock.calls[0][0]).toBe("https://swarm1.sphinx.chat:3355/lab/workflows/builder/runs/1790000000000/artifacts");
    const [msg] = mockTx.sharedConversation.update.mock.calls[0][0].data.messages;
    // The reply's own `peer` names the strut the build ran on: the card shows @acme-web.
    expect(msg.source).toMatchObject({ kind: "job", jobId: JOB, workflow: "builder", status: "success", peer: "acme-web" });
    expect(msg.artifacts).toEqual([
      { id: "wf", kind: "markdown", title: "Workflow", source: { type: "graph", swarmId: "swarm-peer", key: `/jobs/peer%2F${JOB}/files/digest.yaml.md` } },
    ]);
  });

  it("a turn whose work ran here carries no peer on its source", async () => {
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    await handleJobTurnSettled(row({ workflow: "builder", output: { text: "Built it here.", artifacts: [], peer: "" } }));
    const [msg] = mockTx.sharedConversation.update.mock.calls[0][0].data.messages;
    expect(msg.source).not.toHaveProperty("peer");
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

describe("handleJobTurnSettled — the wake (a job hive launched)", () => {
  const artifactsBody = {
    artifacts: [
      { id: "plan", kind: "markdown", title: "Plan", label: "plan", url: `/jobs/${JOB}/files/plan.md` },
      { id: "pr", kind: "pull_request", title: "PR", url: "https://github.com/acme/app/pull/7" },
    ],
  };

  it("once the row is appended: after the response, with the outcome, the cards and the callback's host", async () => {
    mockFetch.mockResolvedValue(json(200, artifactsBody));
    await handleJobTurnSettled(row(), { publicBaseUrl: "https://hive.example.com" });

    // Scheduled, not run: the callback answers first. Three things wait on
    // the response: the wake, the artifact events that queued behind this
    // turn (plans/job-artifact-events.md §3), and the checks of the pull
    // request it reported (§5).
    expect(mockOrchestratorWake).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(3);
    await flushAfter();

    expect(mockWorkspaceFindUnique).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { slug: true } });
    expect(mockOrchestratorWake).toHaveBeenCalledTimes(1);
    expect(mockOrchestratorWake).toHaveBeenCalledWith({
      conversationId: "conv-1",
      wakeId: "job-row-1",
      workspaceSlug: "acme",
      jobId: JOB,
      title: "Dark mode plan",
      outcome: "success",
      artifacts: [
        { title: "Plan", kind: "markdown", label: "plan" },
        { title: "PR", kind: "pull_request" },
      ],
      publicBaseUrl: "https://hive.example.com",
      text: "Wrote the plan.",
      startedByOrchestrator: false,
    });
  });

  it("carries the job's question, and a failed turn's outcome", async () => {
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    await handleJobTurnSettled(row({ output: { text: "Two candidates.", ask: { message: "Which repo?" } } }), {
      publicBaseUrl: "https://hive.example.com",
    });
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0]).toMatchObject({ outcome: "success", ask: "Which repo?", artifacts: [] });

    mockOrchestratorWake.mockClear();
    await handleJobTurnSettled(row({ id: "row-2", status: StrutRunStatus.ERROR, output: null, error: "boom" }));
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0]).toMatchObject({ wakeId: "job-row-2", outcome: "error" });
    expect(mockOrchestratorWake.mock.calls[0][0].ask).toBeUndefined();
  });

  it("without a callback host (the reconcile path) the deployment's own URL is used", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://hive.internal");
    mockFetch.mockResolvedValue(json(200, { artifacts: [] }));
    await handleJobTurnSettled(row());
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0].publicBaseUrl).toBe("https://hive.internal");
    vi.unstubAllEnvs();
  });

  it("not on a replay, not without a conversation, not when the conversation is someone else's", async () => {
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    mockTx.$queryRaw.mockResolvedValue([{ messages: [{ id: "job-row-1", role: "assistant", content: "earlier" }] }]);
    await handleJobTurnSettled(row());
    await flushAfter();
    expect(mockOrchestratorWake).not.toHaveBeenCalled();

    mockTx.$queryRaw.mockResolvedValue([{ messages: [] }]);
    await handleJobTurnSettled(row({ conversationId: null }));
    await flushAfter();
    expect(mockOrchestratorWake).not.toHaveBeenCalled();

    mockTx.sharedConversation.findUnique.mockResolvedValue({ userId: "someone-else", sourceControlOrgId: "org-1", isShared: false });
    await handleJobTurnSettled(row());
    await flushAfter();
    expect(mockOrchestratorWake).not.toHaveBeenCalled();
  });

  it("a wake that fails never fails the delivery, and a workspace that is gone wakes nothing", async () => {
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    mockOrchestratorWake.mockRejectedValue(new Error("strut down"));
    await handleJobTurnSettled(row());
    await expect(flushAfter()).resolves.toBeUndefined();

    mockOrchestratorWake.mockClear();
    mockWorkspaceFindUnique.mockResolvedValue(null);
    await handleJobTurnSettled(row({ id: "row-3" }));
    await flushAfter();
    expect(mockOrchestratorWake).not.toHaveBeenCalled();
  });
});

describe("handleJobTurnSettled — the wake of a job the orchestrator started", () => {
  const adopted = (over: Record<string, unknown> = {}) =>
    row({ input: { prompt: "", title: "Dark mode", workspace: "acme", via: "orchestrator", parentRunId: "orch-row" }, ...over });

  it("wakes the orchestrator after the response, with the reply text inline, as the job's starter", async () => {
    mockFetch.mockResolvedValue(json(200, { artifacts: [{ id: "plan", kind: "markdown", title: "Plan", url: `/jobs/${JOB}/files/plan.md` }] }));
    await handleJobTurnSettled(adopted({ output: { text: "Wrote the plan.", ask: { message: "Which repo?" } } }), { publicBaseUrl: "https://hive.example.com" });
    expect(mockOrchestratorWake).not.toHaveBeenCalled();
    await flushAfter();
    expect(mockOrchestratorWake).toHaveBeenCalledTimes(1);
    expect(mockOrchestratorWake).toHaveBeenCalledWith({
      conversationId: "conv-1",
      wakeId: "job-row-1",
      workspaceSlug: "acme",
      jobId: JOB,
      title: "Dark mode",
      outcome: "success",
      ask: "Which repo?",
      text: "Wrote the plan.",
      artifacts: [{ title: "Plan", kind: "markdown" }],
      publicBaseUrl: "https://hive.example.com",
      startedByOrchestrator: true,
    });
    // The row itself landed like any job's.
    const messages = (mockTx.sharedConversation.update.mock.calls[0][0] as { data: { messages: Array<Record<string, unknown>> } }).data.messages;
    expect(messages[0]).toMatchObject({ id: "job-row-1", source: { kind: "job", jobId: JOB, status: "success" } });
  });

  it("a failed turn and an event's turn reach the orchestrator too; a replay wakes nothing", async () => {
    await handleJobTurnSettled(adopted({ id: "row-2", status: StrutRunStatus.ERROR, output: null, error: "boom" }));
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0]).toMatchObject({ wakeId: "job-row-2", outcome: "error", text: expect.stringContaining("boom") });

    mockOrchestratorWake.mockClear();
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    const line = "[artifact-event] pull_request https://github.com/acme/app/pull/7 merged";
    await handleJobTurnSettled(adopted({ id: "row-3", input: { prompt: line, title: "Dark mode", via: "orchestrator" } }));
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0]).toMatchObject({
      wakeId: "job-row-3",
      event: { kind: "pull_request", url: "https://github.com/acme/app/pull/7", what: "merged" },
    });

    mockOrchestratorWake.mockClear();
    mockTx.$queryRaw.mockResolvedValue([{ messages: [{ id: "job-row-1", role: "assistant", content: "earlier" }] }]);
    await handleJobTurnSettled(adopted());
    await flushAfter();
    expect(mockOrchestratorWake).not.toHaveBeenCalled();
  });

  it("a hive-launched job wakes the orchestrator too, without calling the job its own", async () => {
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    await handleJobTurnSettled(row());
    await flushAfter();
    expect(mockOrchestratorWake).toHaveBeenCalledTimes(1);
    expect(mockOrchestratorWake.mock.calls[0][0]).toMatchObject({ startedByOrchestrator: false, text: "Wrote the plan." });
  });
});

describe("handleJobTurnSettled — artifact events (strut plans/job-artifact-events.md §3)", () => {
  const PR = "https://github.com/acme/app/pull/12";
  const LINE = `[artifact-event] pull_request ${PR} merged`;
  const artifactsBody = {
    artifacts: [
      { id: "plan", kind: "markdown", title: "Plan", url: `/jobs/${JOB}/files/plan.md` },
      { id: "pr", kind: "pull_request", title: "PR", url: PR },
    ],
  };

  it("indexes the turn's refs under the launch's workspace before the row lands; a failure throws (strut re-posts)", async () => {
    mockFetch.mockImplementation(async () => json(200, artifactsBody));
    await handleJobTurnSettled(row());
    expect(mockIndex).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", swarmId: "swarm-1" }),
      JOB,
      expect.arrayContaining([expect.objectContaining({ id: "pr", kind: "pull_request" }), expect.objectContaining({ id: "plan" })]),
    );
    expect(mockIndex.mock.invocationCallOrder[0]).toBeLessThan(mockTx.sharedConversation.update.mock.invocationCallOrder[0]);

    mockIndex.mockRejectedValueOnce(new Error("db down"));
    await expect(handleJobTurnSettled(row())).rejects.toThrow("db down");
  });

  it("a turn with nothing to index, or one that failed, touches the index not at all", async () => {
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    await handleJobTurnSettled(row());
    await handleJobTurnSettled(row({ status: StrutRunStatus.ERROR, error: "boom", output: null }));
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("a turn an event started: the wake carries the event; a person's turn carries none", async () => {
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    await handleJobTurnSettled(row({ input: { prompt: `${LINE}\nhead: abc`, title: "Dark mode plan" } }), { publicBaseUrl: "https://hive.example.com" });
    await flushAfter();
    expect(mockOrchestratorWake).toHaveBeenCalledWith(expect.objectContaining({ event: { kind: "pull_request", url: PR, what: "merged" } }));

    mockOrchestratorWake.mockClear();
    await handleJobTurnSettled(row({ id: "row-2" }), { publicBaseUrl: "https://hive.example.com" });
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0]).not.toHaveProperty("event");
  });

  it("once the row has landed, the events that waited on the job go as the next turn — after the response", async () => {
    mockFetch.mockImplementation(async () => json(200, { artifacts: [] }));
    await handleJobTurnSettled(row(), { publicBaseUrl: "https://hive.example.com" });
    expect(mockPending).not.toHaveBeenCalled();
    await flushAfter();
    expect(mockPending).toHaveBeenCalledWith(JOB, "https://hive.example.com");
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it("the pull requests the turn reported have their checks read after the response, after the pending events — the first fix is hive's; a turn with none, or a replay, reads nothing", async () => {
    mockFetch.mockImplementation(async () => json(200, artifactsBody));
    await handleJobTurnSettled(row(), { publicBaseUrl: "https://hive.example.com" });
    expect(mockCheckFailure).not.toHaveBeenCalled();
    await flushAfter();
    expect(mockCheckFailure).toHaveBeenCalledTimes(1);
    expect(mockCheckFailure).toHaveBeenCalledWith({ workspaceId: "ws-1", url: PR, publicBaseUrl: "https://hive.example.com" });
    expect(mockCheckFailure.mock.invocationCallOrder[0]).toBeGreaterThan(mockPending.mock.invocationCallOrder[0]);

    mockCheckFailure.mockClear();
    mockFetch.mockImplementation(async () => json(200, { artifacts: [artifactsBody.artifacts[0]] }));
    await handleJobTurnSettled(row({ id: "row-2" }), { publicBaseUrl: "https://hive.example.com" });
    await flushAfter();
    expect(mockCheckFailure).not.toHaveBeenCalled();

    mockFetch.mockImplementation(async () => json(200, artifactsBody));
    mockTx.$queryRaw.mockResolvedValueOnce([{ messages: [{ id: jobRowId(row()) }] }]);
    await handleJobTurnSettled(row(), { publicBaseUrl: "https://hive.example.com" });
    await flushAfter();
    expect(mockCheckFailure).not.toHaveBeenCalled();
  });

  it("a failed or stopped turn launches what waited too; a replay, or a conversation that is gone, launches nothing", async () => {
    await handleJobTurnSettled(row({ status: StrutRunStatus.CANCELLED, output: null }));
    await flushAfter();
    expect(mockPending).toHaveBeenCalledTimes(1);

    mockTx.$queryRaw.mockResolvedValueOnce([{ messages: [{ id: jobRowId(row()) }] }]);
    await handleJobTurnSettled(row({ status: StrutRunStatus.CANCELLED, output: null }));
    await flushAfter();
    expect(mockPending).toHaveBeenCalledTimes(1);

    await handleJobTurnSettled(row({ status: StrutRunStatus.CANCELLED, output: null, conversationId: null }));
    await flushAfter();
    expect(mockPending).toHaveBeenCalledTimes(1);
  });

  it("a turn strut refused as job_busy gives its event back before the pending ones go", async () => {
    await handleJobTurnSettled(
      row({ status: StrutRunStatus.ERROR, error: "job_busy: another run holds the job", output: null, input: { prompt: LINE, title: "Dark mode plan" } }),
      { publicBaseUrl: "https://hive.example.com" },
    );
    await flushAfter();
    expect(mockRequeue).toHaveBeenCalledWith(JOB, LINE);
    expect(mockRequeue.mock.invocationCallOrder[0]).toBeLessThan(mockPending.mock.invocationCallOrder[0]);

    // A person's turn that hit job_busy has no event to give back.
    mockRequeue.mockClear();
    await handleJobTurnSettled(row({ id: "row-2", status: StrutRunStatus.ERROR, error: "job_busy: x", output: null }));
    await flushAfter();
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it("the pending launch failing never fails the delivery", async () => {
    mockPending.mockRejectedValueOnce(new Error("strut down"));
    await handleJobTurnSettled(row({ status: StrutRunStatus.CANCELLED, output: null }));
    await expect(flushAfter()).resolves.toBeUndefined();
  });
});

describe("handleJobTurnSettled — the trace card", () => {
  const plan = { id: "plan", kind: "markdown", title: "Plan", url: `/jobs/${JOB}/files/plan.md` };
  const body = (artifacts: unknown[]) => ({ workflow: "job", runId: "1790000000000", job: JOB, artifacts });
  const planRef = { id: "plan", kind: "markdown", title: "Plan", source: { type: "graph", swarmId: "swarm-1", key: `/jobs/${JOB}/files/plan.md` } };
  const traceRef = {
    id: `run-graph-${JOB}`,
    kind: "run_graph",
    title: "Dark mode plan",
    source: { type: "inline", content: { workspace: "acme", run: "row-1", calls: 14, nodes: 37 } },
  };
  const delivered = () => mockTx.sharedConversation.update.mock.calls[0][0].data.messages[0];

  it("is a pure ref, one id per job", () => {
    expect(runGraphArtifactId(JOB)).toBe(`run-graph-${JOB}`);
    expect(runGraphArtifact({ jobId: JOB, title: "Dark mode plan", workspace: "acme", run: "row-1", calls: 14, nodes: 37 })).toEqual(traceRef);
  });

  it("a turn that touched the graph: the card rides on the row after the job's refs, counted from the run's log within its budget", async () => {
    mockFetch.mockResolvedValue(json(200, body([plan])));
    mockCount.mockResolvedValue({ calls: 14, nodes: 37 });
    await handleJobTurnSettled(row());

    expect(mockCount).toHaveBeenCalledWith(expect.objectContaining({ id: "row-1", swarmId: "swarm-1", strutRunId: "1790000000000" }), 8_000);
    expect(mockWorkspaceFindUnique).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { slug: true } });
    expect(delivered().artifacts).toEqual([planRef, traceRef]);
  });

  it("is hive's card, not the job's: never indexed for events, never named to the wake", async () => {
    mockFetch.mockResolvedValue(json(200, body([plan])));
    mockCount.mockResolvedValue({ calls: 14, nodes: 37 });
    await handleJobTurnSettled(row());

    expect(mockIndex).toHaveBeenCalledWith(expect.anything(), JOB, [planRef]);
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0].artifacts).toEqual([{ title: "Plan", kind: "markdown" }]);
  });

  it("a turn that reported nothing of its own still carries its card", async () => {
    mockFetch.mockResolvedValue(json(200, body([])));
    mockCount.mockResolvedValue({ calls: 14, nodes: 37 });
    await handleJobTurnSettled(row());

    expect(delivered().artifacts).toEqual([traceRef]);
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("no card when the turn touched no node, its log was not read, its workspace is gone, or the read throws — the row lands either way", async () => {
    mockFetch.mockImplementation(async () => json(200, body([plan])));

    await handleJobTurnSettled(row());
    expect(delivered().artifacts).toEqual([planRef]);

    vi.clearAllMocks();
    mockCount.mockRejectedValue(new Error("boom"));
    await handleJobTurnSettled(row());
    expect(delivered().artifacts).toEqual([planRef]);

    vi.clearAllMocks();
    mockCount.mockResolvedValue({ calls: 2, nodes: 1 });
    mockWorkspaceFindUnique.mockResolvedValue(null);
    await handleJobTurnSettled(row());
    expect(delivered().artifacts).toEqual([planRef]);
  });

  it("a turn that did not succeed reads no log", async () => {
    await handleJobTurnSettled(row({ status: StrutRunStatus.ERROR, output: null, error: "agent failed: boom" }));
    await handleJobTurnSettled(row({ status: StrutRunStatus.CANCELLED, output: null }));
    expect(mockCount).not.toHaveBeenCalled();
  });
});

describe("handleJobTurnSettled — the claims card", () => {
  const plan = { id: "plan", kind: "markdown", title: "Plan", url: `/jobs/${JOB}/files/plan.md` };
  const planRef = { id: "plan", kind: "markdown", title: "Plan", source: { type: "graph", swarmId: "swarm-1", key: `/jobs/${JOB}/files/plan.md` } };
  const ledger = [
    {
      id: "c-page",
      text: "The settings page renders",
      status: "supported",
      assertedOnly: false,
      unverified: 0,
      latest: { content: "/settings reached", observed_at: 1790000060, mode: "observed", about: "1790000000000", locator: { url: `/jobs/${JOB}/files/shots/001.png` } },
      checks: [{ id: "k-page", name: "browser/verify" }],
    },
  ];
  const delivered = () => mockTx.sharedConversation.update.mock.calls[0][0].data.messages[0];

  /** Answers by URL: the turn's artifacts, the job's ledger, the listing. */
  function serve(opts: { ledger?: () => Response; listing?: () => Response } = {}) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/workflows/job/runs/1790000000000/artifacts")) return json(200, { artifacts: [plan] });
      if (url.endsWith(`/jobs/${JOB}/claims`)) return opts.ledger ? opts.ledger() : json(200, { enabled: true, job: JOB, claims: ledger });
      if (url.includes("/claims?")) return opts.listing ? opts.listing() : json(200, { enabled: true, claims: [{ id: "c-page", speaker: "ai", slots: [], checks: [] }] });
      return json(200, []);
    });
  }

  it("rides on the row after the job's own refs, read off the row's swarm, one id per job, every turn a version", async () => {
    serve();
    mockTurns.mockResolvedValue([{ strutRunId: "1789999990000" }, { strutRunId: "1790000000000" }]);
    await handleJobTurnSettled(row());

    const [mine, card] = delivered().artifacts;
    expect(mine).toEqual(planRef);
    expect(card).toMatchObject({ id: `claims-${JOB}`, kind: "claims", title: "Dark mode plan", summary: "1 supported" });
    expect(card.source).toEqual({
      type: "inline",
      content: {
        workspace: "acme",
        swarmId: "swarm-1",
        job: JOB,
        turn: "1790000000000",
        turns: { "1790000000000": 2 },
        claims: [expect.objectContaining({ id: "c-page", status: "supported", speaker: "ai", latest: expect.objectContaining({ about: "1790000000000", observedAt: 1790000060 }) })],
      },
    });
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`https://swarm1.sphinx.chat:3355/lab/jobs/${JOB}/claims`);
  });

  it("sits between the job's refs and the trace, and is hive's: never indexed, never named to the wake", async () => {
    serve();
    mockCount.mockResolvedValue({ calls: 3, nodes: 2 });
    await handleJobTurnSettled(row());
    expect(delivered().artifacts.map((a: { kind: string }) => a.kind)).toEqual(["markdown", "claims", "run_graph"]);
    expect(mockIndex).toHaveBeenCalledWith(expect.anything(), JOB, [planRef]);
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0].artifacts).toEqual([{ title: "Plan", kind: "markdown" }]);
  });

  it("no card from a swarm without claims, a job that claims nothing, or a read that fails — the row lands either way", async () => {
    for (const ledgerAnswer of [
      () => json(200, { enabled: false, job: JOB, claims: [] }),
      () => json(200, { enabled: true, job: JOB, claims: [] }),
      () => json(404, { error: "not found" }),
      () => {
        throw new Error("ECONNREFUSED");
      },
    ]) {
      vi.clearAllMocks();
      serve({ ledger: ledgerAnswer });
      await handleJobTurnSettled(row());
      expect(delivered().artifacts).toEqual([planRef]);
    }
  });

  it("a turn that did not succeed reads no claims", async () => {
    serve();
    await handleJobTurnSettled(row({ status: StrutRunStatus.ERROR, output: null, error: "agent failed: boom" }));
    expect(mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/claims"))).toEqual([]);
  });
});

describe("handleJobTurnSettled — the brainstorm run's card", () => {
  const plan = { id: "plan", kind: "markdown", title: "Plan", url: `/jobs/${JOB}/files/plan.md` };
  const tree = { id: "brainstorm-tree", kind: "graph", title: "Brainstorm: dark mode", content: '{"workspace":"hive","focus":"ref-1"}' };
  const treeRef = { id: "brainstorm-tree", kind: "graph", title: "Brainstorm: dark mode", source: { type: "inline", content: { workspace: "hive", focus: "ref-1" } } };
  const launch = (path: string, name: string, runId: string, extra: Record<string, unknown> = {}) => [
    { type: "step.start", path, input: { name, ...extra } },
    { type: "step.end", path, stepType: "tool:meta_run_workflow", output: { runId } },
  ];
  const delivered = () => mockTx.sharedConversation.update.mock.calls[0][0].data.messages[0];

  /** Answers by URL: the job's own artifacts, the turn's events, and each child run's artifacts. */
  function serve(opts: { own?: unknown[]; events?: unknown; children?: Record<string, unknown> }) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/workflows/job/runs/1790000000000/artifacts")) return json(200, { artifacts: opts.own ?? [plan] });
      if (url.endsWith("/workflows/job/runs/1790000000000/events")) return json(200, opts.events ?? []);
      const m = /\/workflows\/([^/]+)\/runs\/([^/]+)\/artifacts$/.exec(url);
      const child = m && opts.children?.[`${m[1]}/${m[2]}`];
      return child instanceof Response ? child : json(200, { artifacts: child ?? [] });
    });
  }
  // The claims card's reads are the job's, not a child run's.
  const childCalls = () => mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => !u.includes("/workflows/job/") && !u.includes("/claims"));

  it("collects the brainstorm run's tree when the agent did not copy it, from the row's swarm", async () => {
    serve({ events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": [tree, { id: "notes", kind: "markdown", title: "Notes", url: "/artifacts/1790000000111/n.md" }] } });
    await handleJobTurnSettled(row());

    expect(childCalls()).toEqual(["https://swarm1.sphinx.chat:3355/lab/workflows/brainstorm/runs/1790000000111/artifacts"]);
    expect(mockFetch.mock.calls.find((c) => String(c[0]).includes("brainstorm"))![1]).toMatchObject({ headers: { "x-api-token": "swarm-key" } });
    expect(delivered().artifacts.map((a: { id: string }) => a.id)).toEqual(["plan", "brainstorm-tree"]);
    expect(delivered().artifacts[1]).toEqual(treeRef);
    expect(mockIndex).toHaveBeenCalledWith(expect.anything(), JOB, [expect.objectContaining({ id: "plan" }), treeRef]);
    await flushAfter();
    expect(mockOrchestratorWake.mock.calls[0][0].artifacts.map((a: { title: string }) => a.title)).toEqual(["Plan", "Brainstorm: dark mode"]);
  });

  it("takes the last brainstorm launch", async () => {
    serve({
      events: [...launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), ...launch("job/002-meta_run_workflow", "brainstorm", "1790000000222")],
      children: { "brainstorm/1790000000111": [{ ...tree, title: "old" }], "brainstorm/1790000000222": [tree] },
    });
    await handleJobTurnSettled(row());
    expect(childCalls()).toEqual(["https://swarm1.sphinx.chat:3355/lab/workflows/brainstorm/runs/1790000000222/artifacts"]);
  });

  it("the run's card replaces the agent's copy of the id, whatever its kind, in its position", async () => {
    const copy = { id: "brainstorm-tree", kind: "json", title: "Tree", content: '{"workspace":"hive","focus":"1d184bca-d7fd-4754-9977-f38d69d3f88f","layout":"tree"}' };
    const notes = { id: "notes", kind: "markdown", title: "Notes", content: "hi" };
    serve({ own: [plan, copy, notes], events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": [tree] } });
    await handleJobTurnSettled(row());
    const cards = delivered().artifacts as Array<{ id: string; kind: string; title: string }>;
    expect(cards.map((a) => a.id)).toEqual(["plan", "brainstorm-tree", "notes"]);
    expect(cards.filter((a) => a.id === "brainstorm-tree")).toEqual([expect.objectContaining({ kind: "graph", title: "Brainstorm: dark mode" })]);
    const { logger } = await import("@/lib/logger");
    expect(logger.info).toHaveBeenCalledWith("Job turn delivered", "JOB_TURN", expect.objectContaining({
      brainstorm: { found: 1, launches: 1, replaced: "brainstorm-tree", reason: "replaced agent copy" },
    }));
  });

  it("logs the brainstorm reason: collected, no launch, no graph artifact, read failed", async () => {
    const { logger } = await import("@/lib/logger");
    const last = () => (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === "Job turn delivered").pop()![2] as { brainstorm: unknown };
    serve({ events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": [tree] } });
    await handleJobTurnSettled(row());
    expect(last().brainstorm).toEqual({ found: 1, launches: 1, replaced: null, reason: "collected" });
    serve({ events: [] });
    await handleJobTurnSettled(row());
    expect(last().brainstorm).toEqual({ found: 0, launches: 0, replaced: null, reason: "no brainstorm run launched" });
    serve({ events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": [{ ...tree, id: "other" }] } });
    await handleJobTurnSettled(row());
    expect(last().brainstorm).toEqual({ found: 0, launches: 1, replaced: null, reason: "run had no brainstorm-tree graph artifact" });
    serve({ events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": json(500, {}) } });
    await handleJobTurnSettled(row());
    expect(last().brainstorm).toEqual({ found: 0, launches: 1, replaced: null, reason: "read failed: HTTP 500" });
    expect(logger.info).toHaveBeenCalledWith("Job turn reading brainstorm run", "JOB_TURN", expect.objectContaining({ childRunId: "1790000000111" }));
  });

  it("ignores other workflows, peer children and non-tree artifacts", async () => {
    serve({
      events: [
        ...launch("job/001-meta_run_workflow", "explore", "1790000000111"),
        { type: "step.start", path: "job/002-strut_run_workflow", input: { workflow: "brainstorm", peer: "other" } },
        { type: "step.end", path: "job/002-strut_run_workflow", stepType: "tool:strut_run_workflow", output: { runId: "1790000000333", workflow: "brainstorm", peer: "other" } },
      ],
      children: { "explore/1790000000111": [tree], "brainstorm/1790000000333": [tree] },
    });
    await handleJobTurnSettled(row());
    expect(childCalls()).toEqual([]);

    serve({ events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": [{ ...tree, kind: "markdown" }, { ...tree, id: "other" }] } });
    mockTx.sharedConversation.update.mockClear();
    await handleJobTurnSettled(row());
    expect(delivered().artifacts.map((a: { id: string }) => a.id)).toEqual(["plan"]);
  });

  it("a failed read is ignored: the turn is delivered without it and a warn is logged", async () => {
    const { logger } = await import("@/lib/logger");
    serve({ events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": json(500, {}) } });
    await handleJobTurnSettled(row());
    expect(delivered().artifacts.map((a: { id: string }) => a.id)).toEqual(["plan"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("brainstorm"), "JOB_TURN", expect.anything());

    mockTx.sharedConversation.update.mockClear();
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/events")) throw new Error("boom");
      return json(200, { artifacts: [plan] });
    });
    await handleJobTurnSettled(row());
    expect(delivered().artifacts.map((a: { id: string }) => a.id)).toEqual(["plan"]);
  });

  it("logs every delivered card, the count, and which came from the brainstorm run", async () => {
    const { logger } = await import("@/lib/logger");
    serve({ events: launch("job/001-meta_run_workflow", "brainstorm", "1790000000111"), children: { "brainstorm/1790000000111": [tree] } });
    mockCount.mockResolvedValue({ calls: 2, nodes: 3 });
    await handleJobTurnSettled(row());
    expect(logger.info).toHaveBeenCalledWith(
      "Job turn delivered",
      "JOB_TURN",
      expect.objectContaining({
        artifacts: [{ id: "plan", kind: "markdown" }, { id: "brainstorm-tree", kind: "graph" }, { id: `run-graph-${JOB}`, kind: "run_graph" }],
        artifactCount: 3,
        collected: ["brainstorm-tree"],
      }),
    );
  });
});
