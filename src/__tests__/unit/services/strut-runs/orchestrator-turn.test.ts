/**
 * Unit tests for the `orchestrator_turn` completion handler
 * (`services/strut-runs/orchestrator-turn.ts`) — Jamie on strut.
 *
 *   - what a settled row says: success text + `ask`, error (and the
 *     `session_busy:` wording), cancelled, LOST, an output not in shape;
 *   - delivery: ONE reply row `orchestrator-<row.id>` (`source.kind:
 *     "orchestrator"`, artifacts mapped by `mapStrutArtifacts`) plus ONE
 *     row per proposal the run reported (`source.kind: "proposal"`, read
 *     from the ROW's swarm), in one transaction, idempotent by row id; an
 *     error row appends without reading strut; a 404 delivers the text
 *     alone; a 5xx throws (strut re-posts); no wake of any kind;
 *   - the jobs the turn launched (`job/start`, `job/continue`), read from
 *     its event log: each gets its job row minted and rides the reply row
 *     as `source.jobs`, so the chat shows a running card while it works.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const {
  mockTx,
  mockTransaction,
  mockNotify,
  mockLab,
  mockReadArtifacts,
  mockClearActiveRun,
  mockNotifyRunActive,
  mockEvents,
  mockAdopt,
  mockRecorded,
  mockJobWorkflow,
  mockWorkspace,
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
      mockReadArtifacts: vi.fn(),
      mockClearActiveRun: vi.fn(),
      mockNotifyRunActive: vi.fn(),
      mockEvents: vi.fn(),
      mockAdopt: vi.fn(),
      mockRecorded: vi.fn(),
      mockJobWorkflow: vi.fn(),
      mockWorkspace: vi.fn(),
    };
  });

vi.mock("@/lib/db", () => ({ db: { $transaction: mockTransaction, workspace: { findUnique: mockWorkspace } } }));
vi.mock("@/lib/pusher", () => ({ notifyCanvasConversationUpdated: mockNotify }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/strut-runs", () => ({ labForRow: mockLab }));
vi.mock("@/services/canvas-active-runs-hooks", () => ({
  clearActiveRun: mockClearActiveRun,
  notifyRunActive: mockNotifyRunActive,
}));
vi.mock("@/services/strut-runs/lab", () => ({ fetchStrutRunEvents: mockEvents, fetchStrutJobWorkflow: mockJobWorkflow }));
vi.mock("@/services/strut-runs/orchestrator-jobs", () => ({ adoptOrchestratorJobRun: mockAdopt, recordedJobWorkflow: mockRecorded }));
// The artifact list read is the job turn's; the mapping stays real.
vi.mock("@/services/strut-runs/job-turn", async (orig) => ({
  ...(await orig<typeof import("@/services/strut-runs/job-turn")>()),
  readRunArtifacts: mockReadArtifacts,
}));

import {
  handleOrchestratorTurnSettled,
  readRunProposals,
  renderProposalContent,
  renderOrchestratorContent,
  replyForOrchestratorRow,
} from "@/services/strut-runs/orchestrator-turn";
import type { StrutRunRow } from "@/services/strut-runs";

const mockFetch = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function row(over: Record<string, unknown> = {}): StrutRunRow {
  return {
    id: "row-1",
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "orchestrator_turn",
    workflow: "orchestrator",
    strutRunId: "1790000000000",
    status: StrutRunStatus.SUCCESS,
    input: {
      prompt: "@acme\nAdd a Concept",
      session: "conv-1",
      context: { line: "Mon 19 Oct, 14:02, Europe/London. " },
    },
    output: { text: "I proposed a Concept for billing retries.", artifacts: [], cost: 0.01, session: "conv-1" },
    error: null,
    durationMs: 1200,
    conversationId: "conv-1",
    proposalId: null,
    jobId: null,
    createdAt: new Date("2026-10-19T13:02:00Z"),
    settledAt: new Date("2026-10-19T13:03:00Z"),
    ...over,
  } as StrutRunRow;
}

const BRIEF = {
  id: "p3f9aKq2",
  step: "graph/create-batch-triplet",
  title: "Assert several facts at once.",
  status: "pending",
  url: "/proposals/p3f9aKq2",
  rationale: "The Concept is missing.",
  createdAt: "2026-10-19T13:02:30Z",
};

/** The messages the transaction wrote. */
const written = (): Array<Record<string, unknown>> =>
  (mockTx.sharedConversation.update.mock.calls[0]?.[0] as { data: { messages: Array<Record<string, unknown>> } }).data
    .messages;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockLab.mockResolvedValue({
    labBase: "https://swarm1.sphinx.chat:3355/lab",
    swarmApiKey: "swarm-key",
    swarmName: "swarm1",
  });
  mockReadArtifacts.mockResolvedValue({ ok: true, artifacts: [] });
  mockFetch.mockResolvedValue(json(200, { workflow: "orchestrator", runId: "1790000000000", proposals: [BRIEF] }));
  mockTx.workspace.findUnique.mockResolvedValue({ sourceControlOrgId: "org-1" });
  mockTx.sharedConversation.findUnique.mockResolvedValue({
    userId: "user-1",
    sourceControlOrgId: "org-1",
    isShared: false,
  });
  mockTx.$queryRaw.mockResolvedValue([{ messages: [] }]);
  mockTx.sharedConversation.update.mockResolvedValue({});
  mockClearActiveRun.mockResolvedValue({ wasLast: true });
  mockNotifyRunActive.mockResolvedValue(undefined);
  mockEvents.mockResolvedValue([]);
  mockAdopt.mockImplementation(async (_parent: unknown, run: { runId: string }) => ({ id: `jobrow-${run.runId}` }));
  mockRecorded.mockResolvedValue(null);
  mockJobWorkflow.mockResolvedValue(null);
  mockWorkspace.mockResolvedValue({ slug: "acme" });
});

describe("replyForOrchestratorRow", () => {
  it("success: the text and the question", () => {
    expect(
      replyForOrchestratorRow(row({ output: { text: "Done.", artifacts: [], ask: { message: "Which parent?" } } })),
    ).toEqual({
      outcome: "success",
      text: "Done.",
      ask: "Which parent?",
    });
    expect(replyForOrchestratorRow(row({ output: { artifacts: [] } })).text).toBe("_(no reply text)_");
  });

  it("session_busy is 'still working', other errors say what failed; cancelled, lost, a result out of shape", () => {
    const busy = replyForOrchestratorRow(
      row({
        status: StrutRunStatus.ERROR,
        error: 'session_busy: session "conv-1" is in use by run 1 (orchestrator/turn)',
      }),
    );
    expect(busy.outcome).toBe("error");
    expect(busy.text).toContain("Still working on your last message");
    expect(replyForOrchestratorRow(row({ status: StrutRunStatus.ERROR, error: "model refused" })).text).toBe(
      "The turn did not complete: model refused",
    );
    expect(replyForOrchestratorRow(row({ status: StrutRunStatus.CANCELLED }))).toEqual({
      outcome: "cancelled",
      text: "The turn was stopped.",
    });
    expect(replyForOrchestratorRow(row({ status: StrutRunStatus.LOST })).outcome).toBe("lost");
    expect(replyForOrchestratorRow(row({ output: "nope" }))).toEqual({
      outcome: "error",
      text: expect.stringContaining("not in the shape"),
      error: "unexpected output",
    });
  });
});

describe("replyForOrchestratorRow — the stay-silent convention", () => {
  it("the marker alone is a silent reply with no text; quoting and a trailing stop are tolerated", () => {
    for (const text of ["[silent]", "  [SILENT]  ", "`[silent]`", "**[silent]**.", "\"[silent]\""]) {
      expect(replyForOrchestratorRow(row({ output: { text, artifacts: [] } }))).toEqual({ outcome: "silent", text: "" });
    }
  });

  it("the marker beside anything else, or with a question, is an ordinary reply", () => {
    expect(replyForOrchestratorRow(row({ output: { text: "[silent] — done", artifacts: [] } }))).toMatchObject({ outcome: "success", text: "[silent] — done" });
    expect(replyForOrchestratorRow(row({ output: { text: "[silent]", artifacts: [], ask: { message: "Which?" } } }))).toMatchObject({
      outcome: "success",
      ask: "Which?",
    });
  });

  it("renders as nothing — only what could not be shown", () => {
    expect(renderOrchestratorContent({ outcome: "silent", text: "" }, [])).toBe("");
    expect(renderOrchestratorContent({ outcome: "silent", text: "" }, [{ title: "a card", reason: "gone" }])).toBe("_Unavailable: a card (gone)_");
  });
});

describe("readRunProposals", () => {
  it("reads the run's list from the ROW's swarm; 404 is permanent, 5xx transient", async () => {
    expect(await readRunProposals(row())).toEqual({ ok: true, proposals: [BRIEF] });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://swarm1.sphinx.chat:3355/lab/workflows/orchestrator/runs/1790000000000/proposals",
      expect.objectContaining({ headers: { "x-api-token": "swarm-key" } }),
    );
    mockFetch.mockResolvedValue(json(404, { error: "no such run" }));
    expect(await readRunProposals(row())).toEqual({ ok: false, permanent: true, reason: "run not found on strut" });
    mockFetch.mockResolvedValue(json(503, {}));
    expect(await readRunProposals(row())).toEqual({ ok: false, permanent: false, reason: "HTTP 503" });
    expect(await readRunProposals(row({ strutRunId: null }))).toEqual({
      ok: false,
      permanent: true,
      reason: "no strut run id",
    });
  });
});

describe("handleOrchestratorTurnSettled", () => {
  it("appends the reply row and one row per proposal, in one transaction, and tells the conversation", async () => {
    mockReadArtifacts.mockResolvedValue({
      ok: true,
      artifacts: [{ id: "notes", kind: "markdown", title: "Notes", url: "/artifacts/1790000000000/notes.md" }],
    });
    await handleOrchestratorTurnSettled(
      row({ output: { text: "I proposed it.", artifacts: [], ask: { message: "OK to also link it?" } } }),
    );

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const rows = written();
    expect(rows.map((r) => r.id)).toEqual(["orchestrator-row-1", "orchestrator-row-1-proposal-p3f9aKq2"]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: "I proposed it.\n\n**Question for you:** OK to also link it?",
        source: {
          kind: "orchestrator",
          runId: "row-1",
          strutRunId: "1790000000000",
          status: "success",
          ask: "OK to also link it?",
        },
        artifacts: [
          {
            id: "notes",
            kind: "markdown",
            title: "Notes",
            source: { type: "graph", swarmId: "swarm-1", key: "/artifacts/1790000000000/notes.md" },
          },
        ],
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: renderProposalContent(BRIEF),
        source: {
          kind: "proposal",
          runId: "row-1",
          proposalId: "p3f9aKq2",
          url: "/proposals/p3f9aKq2",
          step: "graph/create-batch-triplet",
          status: "pending",
          title: "Assert several facts at once.",
          rationale: "The Concept is missing.",
          createdAt: "2026-10-19T13:02:30Z",
        },
      }),
    );
    expect(mockNotify).toHaveBeenCalledWith("conv-1", "orchestrator");
    // The Stop button: the run is done.
    expect(mockClearActiveRun).toHaveBeenCalledWith("conv-1", "row-1");
    expect(mockNotifyRunActive).toHaveBeenCalledWith("conv-1", false);
  });

  it("keeps strut's reference entries on the reply row as they came, with the row's workspace", async () => {
    const plan = { id: "plan", kind: "markdown", title: "Plan", url: "/jobs/j-1/files/plan.md", hash: "later-field" };
    const shot = { id: "shot", kind: "image", title: "Shot", peer: "web", via: "billing", job: "peer/j-7", path: "a.png" };
    const app = { id: "ui", kind: "app", title: "Bench", peer: "web", app: { name: "bench" } };
    const raw = [
      plan,
      shot,
      app,
      { id: "gone", kind: "markdown", title: "Gone", error: "not found" },
      { id: "tree", kind: "json", title: "Tree", content: { focus: "x" } },
    ];
    mockReadArtifacts.mockResolvedValue({ ok: true, artifacts: [], raw });
    await handleOrchestratorTurnSettled(row());
    expect(mockWorkspace).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { slug: true } });
    expect(written()[0].strut).toEqual({ workspace: "acme", artifacts: [plan, shot, app] });
  });

  it("a reply with no reference entries carries no strut", async () => {
    mockReadArtifacts.mockResolvedValue({ ok: true, artifacts: [], raw: [{ id: "t", title: "T", content: "x" }] });
    await handleOrchestratorTurnSettled(row());
    expect("strut" in written()[0]).toBe(false);
    expect(mockWorkspace).not.toHaveBeenCalled();
  });

  it("a job the turn launched gets its row minted and rides the reply as source.jobs", async () => {
    mockFetch.mockResolvedValue(json(200, { workflow: "orchestrator", runId: "1790000000000", proposals: [] }));
    mockEvents.mockResolvedValue([
      { type: "step.start", path: "orchestrator/agent/001-job_start", stepType: "tool:job_start", input: { prompt: "Research", title: "Flights to Lisbon" } },
      { type: "step.end", path: "orchestrator/agent/001-job_start", stepType: "tool:job_start", output: '{"job":"j-1","runId":"1790000000500","callback":true}' },
    ]);
    await handleOrchestratorTurnSettled(row({ output: { text: "Started a job for flights.", artifacts: [] } }));

    expect(mockEvents).toHaveBeenCalledWith(expect.objectContaining({ id: "row-1", workflow: "orchestrator" }), expect.any(Number));
    expect(mockAdopt).toHaveBeenCalledWith(expect.objectContaining({ id: "row-1" }), {
      job: "j-1",
      runId: "1790000000500",
      title: "Flights to Lisbon",
      // job/start named none: strut's default.
      workflow: "job",
    });
    expect(mockRecorded).not.toHaveBeenCalled();
    expect(mockJobWorkflow).not.toHaveBeenCalled();
    expect(written()[0]).toEqual(
      expect.objectContaining({
        id: "orchestrator-row-1",
        source: expect.objectContaining({
          kind: "orchestrator",
          jobs: [{ jobId: "j-1", title: "Flights to Lisbon", runId: "jobrow-1790000000500" }],
        }),
      }),
    );
  });

  it("each job's row is minted under the workflow its turn runs: job/start's, else the job's own (hive's row, then strut's record)", async () => {
    mockFetch.mockResolvedValue(json(200, { workflow: "orchestrator", runId: "1790000000000", proposals: [] }));
    const call = (n: string, tool: "job_start" | "job_continue", input: Record<string, unknown>, job: string) => [
      { type: "step.start", path: `o/agent/${n}-${tool}`, stepType: `tool:${tool}`, input },
      { type: "step.end", path: `o/agent/${n}-${tool}`, stepType: `tool:${tool}`, output: { job, runId: `r-${job}`, callback: true } },
    ];
    mockEvents.mockResolvedValue([
      ...call("001", "job_start", { prompt: "Build it", title: "Digest", workflow: "builder", peer: "acme-web" }, "j-1"),
      ...call("002", "job_continue", { job: "j-2", prompt: "go on" }, "j-2"),
      ...call("003", "job_continue", { job: "j-3", prompt: "go on" }, "j-3"),
      ...call("004", "job_continue", { job: "j-4", prompt: "go on" }, "j-4"),
    ]);
    mockRecorded.mockImplementation(async (_swarm: string, job: string) => (job === "j-2" ? "builder" : null));
    mockJobWorkflow.mockImplementation(async (_row: unknown, job: string) => (job === "j-3" ? "builder" : null));
    await handleOrchestratorTurnSettled(row({ output: { text: "On it.", artifacts: [] } }));

    const adopted = Object.fromEntries(mockAdopt.mock.calls.map(([, run]) => [run.job, run.workflow]));
    expect(adopted).toEqual({ "j-1": "builder", "j-2": "builder", "j-3": "builder", "j-4": undefined });
    // Hive's own record first, on the orchestrator row's swarm; strut is asked only when hive holds none.
    expect(mockRecorded).toHaveBeenCalledWith("swarm-1", "j-2");
    expect(mockRecorded).not.toHaveBeenCalledWith("swarm-1", "j-1");
    expect(mockJobWorkflow.mock.calls.map(([, job]) => job)).toEqual(["j-3", "j-4"]);
    expect(mockJobWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: "row-1", swarmId: "swarm-1" }), "j-3", expect.any(Number));
    // The running card's @slug: the job/start's peer rides on its launch.
    expect(written()[0].source).toEqual(
      expect.objectContaining({
        jobs: [
          { jobId: "j-1", title: "Digest", runId: "jobrow-r-j-1", peer: "acme-web" },
          { jobId: "j-2", title: "", runId: "jobrow-r-j-2" },
          { jobId: "j-3", title: "", runId: "jobrow-r-j-3" },
          { jobId: "j-4", title: "", runId: "jobrow-r-j-4" },
        ],
      }),
    );
  });

  it("a log strut cannot serve, or a row that cannot be minted, delivers the reply without the job", async () => {
    mockFetch.mockImplementation(async () => json(200, { workflow: "orchestrator", runId: "1790000000000", proposals: [] }));
    mockEvents.mockResolvedValue(null);
    await handleOrchestratorTurnSettled(row());
    expect(written()[0].source).not.toHaveProperty("jobs");

    vi.clearAllMocks();
    mockTx.$queryRaw.mockResolvedValue([{ messages: [] }]);
    mockEvents.mockResolvedValue([
      { type: "step.end", path: "a/001-job_start", stepType: "tool:job_start", output: { job: "j-1", runId: "1790000000500", callback: true } },
    ]);
    mockAdopt.mockRejectedValue(new Error("db down"));
    await handleOrchestratorTurnSettled(row());
    expect(written()[0].source).not.toHaveProperty("jobs");
  });

  it("is idempotent: rows already there are not written again, nothing is announced", async () => {
    mockTx.$queryRaw.mockResolvedValue([
      { messages: [{ id: "orchestrator-row-1" }, { id: "orchestrator-row-1-proposal-p3f9aKq2" }] },
    ]);
    await handleOrchestratorTurnSettled(row());
    expect(mockTx.sharedConversation.update).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("a conversation that is not the row's owner's (and not shared) gets nothing", async () => {
    mockTx.sharedConversation.findUnique.mockResolvedValue({
      userId: "someone-else",
      sourceControlOrgId: "org-1",
      isShared: false,
    });
    await handleOrchestratorTurnSettled(row());
    expect(mockTx.sharedConversation.update).not.toHaveBeenCalled();
  });

  it("a silent turn appends a silent row with no text (the working card lands on it), still carrying what the turn produced", async () => {
    mockFetch.mockResolvedValue(json(200, { workflow: "orchestrator", runId: "1790000000000", proposals: [] }));
    await handleOrchestratorTurnSettled(row({ output: { text: "[silent]", artifacts: [] } }));
    expect(written()).toEqual([
      expect.objectContaining({
        id: "orchestrator-row-1",
        role: "assistant",
        content: "",
        source: { kind: "orchestrator", runId: "row-1", strutRunId: "1790000000000", status: "silent" },
      }),
    ]);
    expect(written()[0]).not.toHaveProperty("artifacts");
    expect(mockNotify).toHaveBeenCalledWith("conv-1", "orchestrator");
    // Its cards and proposals are read like a success's.
    expect(mockReadArtifacts).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("an error row appends the reason without reading strut; session_busy reads as still working", async () => {
    await handleOrchestratorTurnSettled(
      row({ status: StrutRunStatus.ERROR, error: "session_busy: in use", output: null }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockReadArtifacts).not.toHaveBeenCalled();
    const rows = written();
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("Still working on your last message");
    expect(rows[0].source).toEqual({
      kind: "orchestrator",
      runId: "row-1",
      strutRunId: "1790000000000",
      status: "error",
    });
  });

  it("a run gone from strut delivers the text alone; a strut that cannot answer makes the webhook retry", async () => {
    mockFetch.mockResolvedValue(json(404, {}));
    await handleOrchestratorTurnSettled(row());
    expect(written().map((r) => r.id)).toEqual(["orchestrator-row-1"]);

    mockTx.sharedConversation.update.mockClear();
    mockFetch.mockResolvedValue(json(503, {}));
    await expect(handleOrchestratorTurnSettled(row())).rejects.toThrow(/proposals unavailable/);
    expect(mockTx.sharedConversation.update).not.toHaveBeenCalled();

    mockFetch.mockResolvedValue(json(200, { proposals: [] }));
    mockReadArtifacts.mockResolvedValue({ ok: false, permanent: false, reason: "HTTP 502" });
    await expect(handleOrchestratorTurnSettled(row())).rejects.toThrow(/artifacts unavailable/);
  });
});
