/**
 * Unit tests for `adoptOrchestratorJobRun` — the `job_turn` row of a job the
 * orchestrator started inside strut:
 *   - `liveUpdates`: the row carries the orchestrator row's flag — the job
 *     inherited that turn's jobCallback (strut CALLBACKS.md §5) — read from
 *     the row when the caller (the settling turn) did not select it;
 *   - the workflow: the row records the job-shaped workflow the run is of
 *     (`job`, `builder` — strut plans/builder-job.md §2), `job` when the
 *     caller cannot say; a row of the same run is found whatever workflow it
 *     was minted under, and a PENDING one minted under another is re-recorded
 *     under the caller's (the run.end's word wins), a settled one left alone;
 *   - `recordedJobWorkflow`: the job's newest row on the swarm says what its
 *     turns run;
 *   - the canvas `focus`: the card the job is on (the job's first turn's,
 *     else the turn's), read from the row when the caller did not select it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindUnique, mockFindMany, mockFindFirst, mockUpsert, mockUpdate, mockWorkspaceFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    strutRun: { findUnique: mockFindUnique, findMany: mockFindMany, findFirst: mockFindFirst, upsert: mockUpsert, update: mockUpdate },
    workspace: { findUnique: mockWorkspaceFindUnique },
  },
}));
vi.mock("@/services/strut-runs", () => ({ hashStrutRunToken: () => "f".repeat(64) }));

import { adoptOrchestratorJobRun, recordedJobWorkflow, STRUT_RUN_WEBHOOK_SELECT } from "@/services/strut-runs/orchestrator-jobs";

const parent = { id: "orch-1", workspaceId: "ws-1", swarmId: "swarm-1", userId: "user-1", conversationId: "conv-1" };
const run = { job: "j-1", runId: "1790000000777", title: null };
const existing = (over: Record<string, unknown> = {}) => ({ id: "jt-1", workflow: "job", status: "PENDING", strutRunId: "1790000000777", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceFindUnique.mockResolvedValue({ slug: "acme" });
  mockFindMany.mockResolvedValue([]);
  mockUpsert.mockResolvedValue({ id: "jt-1" });
  mockFindFirst.mockResolvedValue(null);
});

const focus = { workspaceSlug: "acme", initiativeRefId: "init-1", initiativeName: "Onboarding", refId: "feat-1" };

describe("adoptOrchestratorJobRun — liveUpdates", () => {
  it("reads the orchestrator row's flag when the caller did not select it", async () => {
    mockFindUnique.mockResolvedValue({ liveUpdates: true });
    await adoptOrchestratorJobRun(parent, run);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "orch-1" }, select: { liveUpdates: true, input: true } });
    expect(mockUpsert.mock.calls[0][0].create.liveUpdates).toBe(true);

    mockFindUnique.mockResolvedValue(null);
    await adoptOrchestratorJobRun(parent, run);
    expect(mockUpsert.mock.calls[1][0].create.liveUpdates).toBe(false);
  });

  it("takes the caller's flag and input without a read", async () => {
    await adoptOrchestratorJobRun({ ...parent, liveUpdates: false, input: {} }, run);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpsert.mock.calls[0][0].create.liveUpdates).toBe(false);
  });
});

describe("adoptOrchestratorJobRun — the canvas card", () => {
  it("copies the turn's focus onto the job's row", async () => {
    await adoptOrchestratorJobRun({ ...parent, liveUpdates: true, input: { prompt: "@acme\nhi", focus } }, run);
    expect(mockUpsert.mock.calls[0][0].create.input).toMatchObject({ parentRunId: "orch-1", focus });
  });

  it("reads the turn's focus off its row when the caller (the webhook) did not select it", async () => {
    mockFindUnique.mockResolvedValue({ liveUpdates: true, input: { focus } });
    await adoptOrchestratorJobRun(parent, run);
    expect(mockUpsert.mock.calls[0][0].create.input.focus).toEqual(focus);
  });

  it("keeps a continued job on the card its first turn was on", async () => {
    const first = { ...focus, refId: "story-9" };
    mockFindFirst.mockResolvedValue({ input: { focus: first } });
    await adoptOrchestratorJobRun({ ...parent, liveUpdates: true, input: { focus } }, run);
    expect(mockUpsert.mock.calls[0][0].create.input.focus).toEqual(first);
  });
});

describe("adoptOrchestratorJobRun — the workflow", () => {
  const lean = { ...parent, liveUpdates: false, input: {} };

  it("records the workflow the run is of — a builder job's row is a builder row; `job` when the caller cannot say", async () => {
    await adoptOrchestratorJobRun(lean, { ...run, workflow: "builder" });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { swarmId: "swarm-1", kind: "job_turn", jobId: "j-1", strutRunId: "1790000000777" },
      select: STRUT_RUN_WEBHOOK_SELECT,
    });
    const builder = mockUpsert.mock.calls[0][0];
    expect(builder.where).toEqual({ swarmId_workflow_strutRunId: { swarmId: "swarm-1", workflow: "builder", strutRunId: "1790000000777" } });
    expect(builder.create).toMatchObject({ kind: "job_turn", workflow: "builder", jobId: "j-1", status: "PENDING" });

    await adoptOrchestratorJobRun(lean, run);
    expect(mockUpsert.mock.calls[1][0].create.workflow).toBe("job");
  });

  it("finds the run's row whatever workflow it was minted under, and writes nothing when it agrees", async () => {
    mockFindMany.mockResolvedValue([existing({ workflow: "builder" })]);
    await expect(adoptOrchestratorJobRun(lean, { ...run, workflow: "builder" })).resolves.toMatchObject({ id: "jt-1", workflow: "builder" });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("a PENDING row minted under another workflow is re-recorded under the caller's; a settled one is left alone", async () => {
    mockFindMany.mockResolvedValue([existing()]);
    mockUpdate.mockResolvedValue(existing({ workflow: "builder" }));
    await expect(adoptOrchestratorJobRun(lean, { ...run, workflow: "builder" })).resolves.toMatchObject({ workflow: "builder" });
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "jt-1" }, data: { workflow: "builder" }, select: STRUT_RUN_WEBHOOK_SELECT });
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([existing({ status: "SUCCESS" })]);
    await expect(adoptOrchestratorJobRun(lean, { ...run, workflow: "builder" })).resolves.toMatchObject({ workflow: "job", status: "SUCCESS" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("of two rows of the run, the one under the caller's workflow wins and nothing is re-recorded", async () => {
    mockFindMany.mockResolvedValue([existing(), existing({ id: "jt-2", workflow: "builder" })]);
    await expect(adoptOrchestratorJobRun(lean, { ...run, workflow: "builder" })).resolves.toMatchObject({ id: "jt-2" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("recordedJobWorkflow", () => {
  it("is the workflow of the job's newest row on the swarm; null when hive holds none", async () => {
    mockFindFirst.mockResolvedValue({ workflow: "builder" });
    await expect(recordedJobWorkflow("swarm-1", "j-1")).resolves.toBe("builder");
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { swarmId: "swarm-1", kind: "job_turn", jobId: "j-1" },
      orderBy: { createdAt: "desc" },
      select: { workflow: true },
    });
    mockFindFirst.mockResolvedValue(null);
    await expect(recordedJobWorkflow("swarm-1", "j-1")).resolves.toBeNull();
  });
});
