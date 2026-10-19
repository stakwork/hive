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
 *     alone; a 5xx throws (strut re-posts); no wake of any kind.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockTx, mockTransaction, mockNotify, mockLab, mockReadArtifacts, mockClearActiveRun, mockNotifyRunActive } =
  vi.hoisted(() => {
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
// The artifact list read is the job turn's; the mapping stays real.
vi.mock("@/services/strut-runs/job-turn", async (orig) => ({
  ...(await orig<typeof import("@/services/strut-runs/job-turn")>()),
  readRunArtifacts: mockReadArtifacts,
}));

import {
  handleOrchestratorTurnSettled,
  readRunProposals,
  renderProposalContent,
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
