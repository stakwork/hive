/**
 * Unit tests for `start_job` / `continue_job` (`lib/ai/strutTools.ts`,
 * strut `plans/jobs.md` V1).
 *
 * Coverage:
 *   - start_job: the org gate (a workspace outside the active org, no
 *     access → error, nothing dispatched); a UUID is minted and goes on
 *     the LAUNCH as `job` (never in `input`); the dispatch is a `job_turn`
 *     row of the `job` workflow with purpose `job`, `input.title` riding
 *     along; the run is registered for the Stop button; the result names
 *     the job.
 *   - no canvas conversation / no public URL → error, nothing dispatched.
 *   - continue_job: refuses another user's job and a job of another org;
 *     a job whose first turn ran on another swarm; `busy` while a turn is
 *     PENDING; otherwise the same launch with the same id and the first
 *     turn's title.
 *   - dispatch refusals: `workflow_missing` → a clear message; a strut
 *     `job_busy:` refusal → `busy`.
 *   - the user's GitHub token rides to strut as the actor secret
 *     `GITHUB_TOKEN` on EVERY turn (start and continue), never in `input`;
 *     no token, or a lookup that throws, launches without it.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const { mockResolveStrutTarget, mockResolveConversation, mockDispatch, mockCancel, mockStrutRunFindFirst, mockWorkspaceFindFirst, mockSetActiveRun, mockNotifyRunActive, mockGetPat, FakeDispatchError } =
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
      mockResolveStrutTarget: vi.fn(),
      mockResolveConversation: vi.fn(),
      mockDispatch: vi.fn(),
      mockCancel: vi.fn(),
      mockStrutRunFindFirst: vi.fn(),
      mockWorkspaceFindFirst: vi.fn(),
      mockSetActiveRun: vi.fn(),
      mockNotifyRunActive: vi.fn(),
      mockGetPat: vi.fn(),
      FakeDispatchError,
    };
  });

vi.mock("@/services/strut-target", () => ({ resolveStrutTarget: mockResolveStrutTarget }));
vi.mock("@/services/org-canvas-conversation", () => ({ resolveOrgConversationRowId: mockResolveConversation }));
vi.mock("@/services/bifrost/strut-delegation", () => ({ STRUT_ACTOR_HEADER: "x-strut-actor", ensureStrutDelegation: vi.fn() }));
vi.mock("@/services/strut-runs", () => ({
  dispatchStrutRun: mockDispatch,
  cancelStrutRun: mockCancel,
  StrutDispatchError: FakeDispatchError,
}));
vi.mock("@/services/canvas-active-runs-hooks", () => ({ setActiveRun: mockSetActiveRun, notifyRunActive: mockNotifyRunActive }));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: mockGetPat }));
vi.mock("@/lib/db", () => ({
  db: {
    strutRun: { findFirst: mockStrutRunFindFirst },
    workspace: { findFirst: mockWorkspaceFindFirst },
    agentRun: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

import { buildStrutTools, START_JOB_TOOL, CONTINUE_JOB_TOOL } from "@/lib/ai/strutTools";
import type { CapabilityContext } from "@/lib/ai/capabilities";

const TARGET = {
  swarmId: "swarm-1",
  workspaceId: "ws-id",
  workspaceSlug: "acme",
  orgId: "org-1",
  swarmUrl: "https://swarm1.sphinx.chat/api",
  mcpBase: "https://swarm1.sphinx.chat:3355",
  labBase: "https://swarm1.sphinx.chat:3355/lab",
  swarmApiKey: "swarm-key",
  actor: "alice-user-1",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOB = "6f1c0d3e-1111-4222-8333-444455556666";

function makeCtx(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    orgId: "org-1",
    userId: "user-1",
    currentCanvasConversationId: "conv-1",
    publicBaseUrl: "https://hive.example.com",
    ...overrides,
  } as CapabilityContext;
}

function execute<T>(name: string, input: T, ctx = makeCtx()) {
  const t = buildStrutTools(ctx)[name] as unknown as { execute: (i: T) => Promise<Record<string, unknown>> };
  return t.execute(input);
}

const start = (input: Partial<{ workspace: string; title: string; prompt: string }> = {}, ctx?: CapabilityContext) =>
  execute(START_JOB_TOOL, { workspace: "acme", title: "Dark mode plan", prompt: "Write a plan for dark mode", ...input }, ctx);
const cont = (input: Partial<{ workspace: string; jobId: string; prompt: string }> = {}, ctx?: CapabilityContext) =>
  execute(CONTINUE_JOB_TOOL, { workspace: "acme", jobId: JOB, prompt: "Split step 2", ...input }, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveStrutTarget.mockResolvedValue({ ok: true, target: TARGET });
  mockResolveConversation.mockResolvedValue("conv-1");
  mockDispatch.mockResolvedValue({ runId: "row-1", strutRunId: "1790000000000", swarmId: "swarm-1" });
  mockSetActiveRun.mockResolvedValue({ abortSelf: false });
  mockNotifyRunActive.mockResolvedValue(undefined);
  mockWorkspaceFindFirst.mockResolvedValue({ id: "ws-id" });
  mockGetPat.mockResolvedValue({ username: "alice", token: "ghp_test_token" });
});

describe("start_job", () => {
  test("the org gate: no access → error before any dispatch", async () => {
    mockResolveStrutTarget.mockResolvedValue({ ok: false, error: { type: "ACCESS_DENIED" } });
    const out = await start();
    expect(out).toMatchObject({ status: "error", error: expect.stringContaining("not found, or you do not have access") });
    expect(mockResolveStrutTarget).toHaveBeenCalledWith({ purpose: "job", workspaceSlug: "acme", userId: "user-1" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("a workspace outside the active org is refused", async () => {
    mockResolveStrutTarget.mockResolvedValue({ ok: true, target: { ...TARGET, orgId: "other-org" } });
    expect(await start()).toMatchObject({ status: "error", error: expect.stringContaining("active org") });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("no canvas conversation, or no public URL → error, nothing dispatched", async () => {
    expect(await start({}, makeCtx({ currentCanvasConversationId: undefined }))).toMatchObject({ status: "error" });
    expect(await start({}, makeCtx({ publicBaseUrl: undefined }))).toMatchObject({ status: "error" });
    mockResolveConversation.mockResolvedValue(null);
    expect(await start()).toMatchObject({ status: "error" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("mints a UUID, launches a job_turn of `job` with it on the LAUNCH, registers Stop, names the job", async () => {
    const out = await start();
    expect(out).toMatchObject({ status: "started", title: "Dark mode plan", note: expect.stringContaining("Job") });
    expect(out.jobId).toMatch(UUID);

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const args = mockDispatch.mock.calls[0][0];
    expect(args).toMatchObject({
      workspaceId: "ws-id",
      userId: "user-1",
      kind: "job_turn",
      workflow: "job",
      purpose: "job",
      // The home workspace rides on the input by SLUG: the name strut's
      // peers use for every other workspace (its input block declares it).
      input: { prompt: "Write a plan for dark mode", title: "Dark mode plan", workspace: "acme" },
      job: out.jobId,
      publicBaseUrl: "https://hive.example.com",
      conversationId: "conv-1",
      // The user's GitHub token, as the actor secret the launch pushes first.
      actorSecrets: { GITHUB_TOKEN: "ghp_test_token" },
    });
    expect(mockGetPat).toHaveBeenCalledWith("user-1", "acme");
    // The id is a sibling of `input`, never inside it — and so is the token.
    expect(args.input.job).toBeUndefined();
    expect(JSON.stringify(args.input)).not.toContain("ghp_test_token");
    expect(mockResolveConversation).toHaveBeenCalledWith({ conversationId: "conv-1", userId: "user-1", orgId: "org-1" });

    expect(mockSetActiveRun).toHaveBeenCalledWith("conv-1", expect.objectContaining({ requestId: "row-1", workspaceId: "ws-id" }), "row-1");
    expect(mockNotifyRunActive).toHaveBeenCalledWith("conv-1", true);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  test("no GitHub token, or a lookup that throws → the turn launches without one", async () => {
    mockGetPat.mockResolvedValue(null);
    expect(await start()).toMatchObject({ status: "started" });
    expect(mockDispatch.mock.calls[0][0].actorSecrets).toEqual({ GITHUB_TOKEN: null });
    mockGetPat.mockRejectedValue(new Error("github down"));
    expect(await start()).toMatchObject({ status: "started" });
    expect(mockDispatch.mock.calls[1][0].actorSecrets).toEqual({ GITHUB_TOKEN: null });
  });

  test("two starts are two jobs", async () => {
    const a = await start();
    const b = await start();
    expect(a.jobId).not.toBe(b.jobId);
  });

  test("a Stop that landed first cancels the run on strut", async () => {
    mockSetActiveRun.mockResolvedValue({ abortSelf: true });
    await start();
    expect(mockCancel).toHaveBeenCalledWith({ id: "row-1", swarmId: "swarm-1", workflow: "job", strutRunId: "1790000000000" });
  });

  test("workflow_missing → a message naming the seed; other refusals carry strut's message", async () => {
    mockDispatch.mockRejectedValue(new FakeDispatchError("workflow_missing", 'Strut on this swarm has no "job" workflow (not seeded yet).'));
    expect(await start()).toMatchObject({ status: "error", error: expect.stringContaining("no `job` workflow yet") });
    mockDispatch.mockRejectedValue(new FakeDispatchError("unreachable", "Could not reach strut on the workspace swarm."));
    expect(await start()).toEqual({ status: "error", error: "Could not reach strut on the workspace swarm." });
    mockDispatch.mockRejectedValue(new Error("boom"));
    expect(await start()).toEqual({ status: "error", error: "The job turn could not be started." });
  });
});

describe("continue_job", () => {
  const firstTurn = { id: "row-0", workspaceId: "ws-id", swarmId: "swarm-1", input: { prompt: "Write a plan", title: "Dark mode plan" } };

  test("the next turn: the same id on the launch, the first turn's title, status continued", async () => {
    mockStrutRunFindFirst.mockResolvedValueOnce(firstTurn).mockResolvedValueOnce(null);
    const out = await cont();
    expect(out).toMatchObject({ status: "continued", jobId: JOB, title: "Dark mode plan" });
    expect(mockStrutRunFindFirst.mock.calls[0][0]).toMatchObject({
      where: { jobId: JOB, kind: "job_turn", userId: "user-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(mockWorkspaceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ws-id", sourceControlOrgId: "org-1", deleted: false } }),
    );
    expect(mockDispatch.mock.calls[0][0]).toMatchObject({
      kind: "job_turn",
      workflow: "job",
      purpose: "job",
      // Every turn pushes the token, not only the first.
      actorSecrets: { GITHUB_TOKEN: "ghp_test_token" },
      job: JOB,
      input: { prompt: "Split step 2", title: "Dark mode plan", workspace: "acme" },
      conversationId: "conv-1",
    });
  });

  test("refuses another user's job (no row of theirs) and a job of another org", async () => {
    mockStrutRunFindFirst.mockResolvedValue(null);
    expect(await cont()).toMatchObject({ status: "error", error: expect.stringContaining("of yours") });
    expect(mockDispatch).not.toHaveBeenCalled();

    mockStrutRunFindFirst.mockResolvedValue(firstTurn);
    mockWorkspaceFindFirst.mockResolvedValue(null);
    expect(await cont()).toMatchObject({ status: "error", error: expect.stringContaining("of yours") });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("a job whose first turn ran on another swarm cannot be continued here", async () => {
    mockStrutRunFindFirst.mockResolvedValue({ ...firstTurn, swarmId: "swarm-2" });
    expect(await cont()).toMatchObject({ status: "error", error: expect.stringContaining("another swarm") });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("busy while a turn of the job is still PENDING — no dispatch", async () => {
    mockStrutRunFindFirst.mockResolvedValueOnce(firstTurn).mockResolvedValueOnce({ id: "row-9" });
    expect(await cont()).toMatchObject({ status: "busy", jobId: JOB });
    expect(mockStrutRunFindFirst.mock.calls[1][0].where).toMatchObject({ jobId: JOB, status: "PENDING" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("a strut refusal that starts job_busy: is busy, not an error", async () => {
    mockStrutRunFindFirst.mockResolvedValueOnce(firstTurn).mockResolvedValueOnce(null);
    mockDispatch.mockRejectedValue(new FakeDispatchError("bad_job", 'job_busy: job "x" is in use by run 1'));
    expect(await cont()).toMatchObject({ status: "busy", jobId: JOB });
  });

  test("a job with no title on its first turn is headed Job", async () => {
    mockStrutRunFindFirst.mockResolvedValueOnce({ ...firstTurn, input: { prompt: "p" } }).mockResolvedValueOnce(null);
    expect(await cont()).toMatchObject({ status: "continued", title: "Job" });
  });
});
