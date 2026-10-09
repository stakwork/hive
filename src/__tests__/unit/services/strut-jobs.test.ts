/**
 * Unit tests for `services/strut-jobs.ts` — the one launch behind Jamie's
 * tools, the artifact-event door and a card's action. The tools' own
 * coverage (`lib/ai/strutJobTools.test.ts`) runs through this; here is
 * what the service adds: who it resolves the strut for, and the origin
 * row an EVENT turn writes once strut has the turn.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolve, mockDispatch, mockCancel, mockSetActiveRun, mockNotifyRunActive, mockGetPat, mockAppendEvent, mockStrutRunFindFirst, FakeDispatchError } =
  vi.hoisted(() => {
    class FakeDispatchError extends Error {
      constructor(
        public readonly code: string,
        message: string,
      ) {
        super(message);
        this.name = "StrutDispatchError";
      }
    }
    return {
      mockResolve: vi.fn(),
      mockDispatch: vi.fn(),
      mockCancel: vi.fn(),
      mockSetActiveRun: vi.fn(),
      mockNotifyRunActive: vi.fn(),
      mockGetPat: vi.fn(),
      mockAppendEvent: vi.fn(),
      mockStrutRunFindFirst: vi.fn(),
      FakeDispatchError,
    };
  });

vi.mock("@/services/strut-target", () => ({
  resolveStrutTarget: mockResolve,
  describeStrutTargetError: (e: { type: string }) => `target: ${e.type}`,
}));
vi.mock("@/services/strut-runs", () => ({ dispatchStrutRun: mockDispatch, cancelStrutRun: mockCancel, StrutDispatchError: FakeDispatchError }));
vi.mock("@/services/canvas-active-runs-hooks", () => ({ setActiveRun: mockSetActiveRun, notifyRunActive: mockNotifyRunActive }));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: mockGetPat }));
vi.mock("@/services/strut-runs/job-turn", () => ({ appendJobEventRow: mockAppendEvent }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: { strutRun: { findFirst: mockStrutRunFindFirst } } }));

import { firstJobTurn, jobHasLiveTurn, launchJobTurn } from "@/services/strut-jobs";

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const TARGET = { swarmId: "swarm-1", workspaceId: "ws-id", workspaceSlug: "acme", orgId: "org-1", swarmUrl: "", mcpBase: "", labBase: "", swarmApiKey: "k", actor: "alice" };
const target = { userId: "user-1", workspaceId: "ws-id", conversationId: "conv-1", publicBaseUrl: "https://hive.example.com" };
const LINE = "[artifact-event] pull_request https://github.com/acme/app/pull/12 merged";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue({ ok: true, target: TARGET });
  mockDispatch.mockResolvedValue({ runId: "row-2", strutRunId: "1790000000001", swarmId: "swarm-1" });
  mockSetActiveRun.mockResolvedValue({ abortSelf: false });
  mockNotifyRunActive.mockResolvedValue(undefined);
  mockGetPat.mockResolvedValue({ username: "alice", token: "ghp_test" });
  mockAppendEvent.mockResolvedValue("appended");
});

describe("launchJobTurn", () => {
  it("resolves the strut for the OWNER by the launch's workspace, and launches as them with their token", async () => {
    const out = await launchJobTurn(target, { jobId: JOB, title: "Dark mode plan", prompt: "Split step 2", started: false });
    expect(out).toEqual({ status: "continued", jobId: JOB, title: "Dark mode plan", runId: "row-2", note: expect.stringContaining("Job") });
    expect(mockResolve).toHaveBeenCalledWith({ purpose: "job", userId: "user-1", workspaceId: "ws-id" });
    expect(mockGetPat).toHaveBeenCalledWith("user-1", "acme");
    expect(mockDispatch).toHaveBeenCalledWith({
      workspaceId: "ws-id",
      userId: "user-1",
      kind: "job_turn",
      workflow: "job",
      purpose: "job",
      input: { prompt: "Split step 2", title: "Dark mode plan", workspace: "ws-id" },
      job: JOB,
      // The job's name on the launch (strut plans/job-index.md §1), beside
      // the copy on `input` the reply header reads.
      title: "Dark mode plan",
      publicBaseUrl: "https://hive.example.com",
      conversationId: "conv-1",
      actorSecrets: { GITHUB_TOKEN: "ghp_test" },
    });
    expect(mockSetActiveRun).toHaveBeenCalledWith("conv-1", expect.objectContaining({ requestId: "row-2", workspaceId: "ws-id" }), "row-2");
    // A person's turn writes no origin row: their words are already there.
    expect(mockAppendEvent).not.toHaveBeenCalled();
  });

  it("an owner who can no longer reach the workspace launches nothing", async () => {
    mockResolve.mockResolvedValue({ ok: false, error: { type: "ACCESS_DENIED" } });
    expect(await launchJobTurn(target, { jobId: JOB, title: "T", prompt: "p", started: false })).toEqual({ status: "error", error: "target: ACCESS_DENIED" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("an event turn writes its origin row — the event text, the job, the run — once strut has the turn", async () => {
    const out = await launchJobTurn(target, { jobId: JOB, title: "Dark mode plan", prompt: LINE, started: false, event: true });
    expect(out).toMatchObject({ status: "continued", runId: "row-2" });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      { id: "row-2", workspaceId: "ws-id", userId: "user-1", conversationId: "conv-1" },
      { content: LINE, source: { kind: "job_event", jobId: JOB, title: "Dark mode plan", runId: "row-2" } },
    );
    // After the dispatch: the row names the run.
    expect(mockDispatch.mock.invocationCallOrder[0]).toBeLessThan(mockAppendEvent.mock.invocationCallOrder[0]);
  });

  it("a refused launch writes no origin row: busy is busy, a missing workflow is an error", async () => {
    mockDispatch.mockRejectedValueOnce(new FakeDispatchError("strut_http", "job_busy: another turn holds the directory"));
    expect(await launchJobTurn(target, { jobId: JOB, title: "T", prompt: LINE, started: false, event: true })).toMatchObject({ status: "busy", jobId: JOB });
    mockDispatch.mockRejectedValueOnce(new FakeDispatchError("workflow_missing", "no job"));
    expect(await launchJobTurn(target, { jobId: JOB, title: "T", prompt: LINE, started: false, event: true })).toMatchObject({ status: "error", error: expect.stringContaining("no `job` workflow") });
    expect(mockAppendEvent).not.toHaveBeenCalled();
  });

  it("an origin row that cannot be written never fails the launch", async () => {
    mockAppendEvent.mockRejectedValueOnce(new Error("db down"));
    expect(await launchJobTurn(target, { jobId: JOB, title: "T", prompt: LINE, started: false, event: true })).toMatchObject({ status: "continued" });
  });
});

describe("the job's rows", () => {
  it("firstJobTurn reads the job's first turn; jobHasLiveTurn a PENDING one", async () => {
    mockStrutRunFindFirst.mockResolvedValueOnce({ id: "row-1" });
    expect(await firstJobTurn(JOB)).toEqual({ id: "row-1" });
    expect(mockStrutRunFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: JOB, kind: "job_turn" }, orderBy: { createdAt: "asc" } }));

    mockStrutRunFindFirst.mockResolvedValueOnce(null);
    expect(await jobHasLiveTurn(JOB)).toBe(false);
    expect(mockStrutRunFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { jobId: JOB, kind: "job_turn", status: "PENDING" } }));
    mockStrutRunFindFirst.mockResolvedValueOnce({ id: "row-3" });
    expect(await jobHasLiveTurn(JOB)).toBe(true);
  });
});
