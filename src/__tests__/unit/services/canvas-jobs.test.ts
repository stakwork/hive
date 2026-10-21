/**
 * Unit tests for `services/canvas-jobs.ts`: the org-channel nudge about a
 * job on a canvas card, and the read of an initiative's jobs with the
 * artifacts their turns delivered.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const {
  mockFindMany,
  mockWorkspaceFindMany,
  mockWorkspaceFindUnique,
  mockUserFindMany,
  mockQueryRaw,
  mockAccess,
  mockNotify,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockWorkspaceFindMany: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
  mockUserFindMany: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockAccess: vi.fn(),
  mockNotify: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    strutRun: { findMany: mockFindMany },
    workspace: { findMany: mockWorkspaceFindMany, findUnique: mockWorkspaceFindUnique },
    user: { findMany: mockUserFindMany },
    $queryRaw: mockQueryRaw,
  },
}));
vi.mock("@/lib/pusher", () => ({ notifyCanvasCardJob: mockNotify }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: mockAccess,
  getWorkspaceOrgGithubLogin: async (id: string) =>
    ((await mockWorkspaceFindUnique({ where: { id } })) as { sourceControlOrg?: { githubLogin: string } } | null)
      ?.sourceControlOrg?.githubLogin ?? null,
}));

import { canvasJobStateOf, listCanvasJobs, nudgeCanvasCardJob } from "@/services/canvas-jobs";

const FOCUS = { workspaceSlug: "acme", initiativeRefId: "init-1", initiativeName: "Onboarding", refId: "feat-1" };
const at = (min: number) => new Date(Date.UTC(2026, 9, 21, 10, min));

const turn = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  jobId: "j-1",
  workspaceId: "ws-1",
  userId: "u-1",
  status: StrutRunStatus.SUCCESS,
  input: { prompt: "", title: "Build the repo picker", focus: FOCUS },
  conversationId: "conv-1",
  createdAt: at(0),
  settledAt: at(5),
  ...over,
});

const ref = (id: string, title = id) => ({
  id,
  kind: "markdown",
  title,
  source: { type: "inline", content: { text: title } },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-1", slug: "acme" }]);
  mockAccess.mockResolvedValue({ canRead: true });
  mockUserFindMany.mockResolvedValue([{ id: "u-1", name: "Ana" }]);
  mockQueryRaw.mockResolvedValue([]);
});

describe("canvasJobStateOf", () => {
  it("is running while pending, done on success, failed otherwise", () => {
    expect(canvasJobStateOf(StrutRunStatus.PENDING)).toBe("running");
    expect(canvasJobStateOf(StrutRunStatus.SUCCESS)).toBe("done");
    for (const s of [StrutRunStatus.ERROR, StrutRunStatus.CANCELLED, StrutRunStatus.LOST])
      expect(canvasJobStateOf(s)).toBe("failed");
  });
});

describe("nudgeCanvasCardJob", () => {
  it("nudges the org of the row's workspace with ids and state only", async () => {
    mockWorkspaceFindUnique.mockResolvedValue({ sourceControlOrg: { githubLogin: "acme-gh" } });
    await nudgeCanvasCardJob(
      { id: "row-1", jobId: "j-1", workspaceId: "ws-nudge", input: { focus: FOCUS } },
      "running",
      { kind: "image" },
    );
    expect(mockNotify).toHaveBeenCalledWith("acme-gh", {
      jobId: "j-1",
      runId: "row-1",
      state: "running",
      refId: "feat-1",
      initiativeRefId: "init-1",
      workspaceSlug: "acme",
      at: expect.any(Number),
      latest: { kind: "image" },
    });
    // The org of a workspace is looked up once.
    await nudgeCanvasCardJob({ jobId: "j-1", workspaceId: "ws-nudge", input: { focus: FOCUS } }, "done");
    expect(mockWorkspaceFindUnique).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[1][1]).not.toHaveProperty("runId");
  });

  it("does nothing for a row with no canvas focus, or no job", async () => {
    await nudgeCanvasCardJob({ jobId: "j-1", workspaceId: "ws-1", input: { prompt: "" } }, "done");
    await nudgeCanvasCardJob({ jobId: null, workspaceId: "ws-1", input: { focus: FOCUS } }, "done");
    expect(mockWorkspaceFindUnique).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    mockWorkspaceFindUnique.mockRejectedValue(new Error("db down"));
    await expect(
      nudgeCanvasCardJob({ jobId: "j-1", workspaceId: "ws-broken", input: { focus: FOCUS } }, "done"),
    ).resolves.toBeUndefined();
  });
});

describe("listCanvasJobs", () => {
  it("reads job turns whose focus names the initiative", async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await listCanvasJobs("org-1", "u-2", "init-1")).toEqual({ jobs: [], artifactsByRef: {} });
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({
      kind: "job_turn",
      input: { path: ["focus", "initiativeRefId"], equals: "init-1" },
    });
  });

  it("one job per id: the newest turn's state, the first turn's title and starter, its card", async () => {
    mockFindMany.mockResolvedValue([
      turn({
        id: "row-2",
        status: StrutRunStatus.PENDING,
        userId: "u-1",
        createdAt: at(10),
        settledAt: null,
        input: { prompt: "", title: "Later", focus: FOCUS },
      }),
      turn(),
      turn({
        id: "row-9",
        jobId: "j-2",
        status: StrutRunStatus.ERROR,
        createdAt: at(1),
        settledAt: at(2),
        input: { title: "Brainstorm", focus: { ...FOCUS, refId: "init-1" } },
      }),
    ]);
    const { jobs } = await listCanvasJobs("org-1", "u-2", "init-1");
    expect(jobs).toEqual([
      {
        jobId: "j-1",
        runId: "row-2",
        title: "Build the repo picker",
        state: "running",
        startedBy: { id: "u-1", name: "Ana" },
        refId: "feat-1",
        initiativeRefId: "init-1",
        updatedAt: at(10).getTime(),
      },
      expect.objectContaining({ jobId: "j-2", state: "failed", refId: "init-1", updatedAt: at(2).getTime() }),
    ]);
  });

  it("leaves out workspaces of another org or that the caller cannot read", async () => {
    mockFindMany.mockResolvedValue([
      turn(),
      turn({ id: "row-3", jobId: "j-3", workspaceId: "ws-2" }),
      turn({ id: "row-4", jobId: "j-4", workspaceId: "ws-3" }),
    ]);
    mockWorkspaceFindMany.mockResolvedValue([
      { id: "ws-1", slug: "acme" },
      { id: "ws-2", slug: "secret" },
    ]);
    mockAccess.mockImplementation(async (slug: string) => ({ canRead: slug !== "secret" }));
    const { jobs } = await listCanvasJobs("org-1", "u-2", "init-1");
    expect(mockWorkspaceFindMany.mock.calls[0][0].where).toMatchObject({ sourceControlOrgId: "org-1", deleted: false });
    expect(jobs.map((j) => j.jobId)).toEqual(["j-1"]);
  });

  it("each card gets its jobs' delivered artifacts, a later turn's version of an id replacing the earlier", async () => {
    mockFindMany.mockResolvedValue([
      turn({ id: "row-2", createdAt: at(10), settledAt: at(12) }),
      turn(),
      turn({ id: "row-5", status: StrutRunStatus.PENDING, settledAt: null, createdAt: at(20) }),
    ]);
    mockQueryRaw.mockResolvedValue([
      { id: "job-row-1", artifacts: [ref("plan", "Plan v1"), ref("claims-j-1", "Claims v1")] },
      { id: "job-row-2", artifacts: [ref("claims-j-1", "Claims v2"), ref("shot")] },
      { id: "job-row-2b", artifacts: "not a list" },
    ]);
    const { artifactsByRef } = await listCanvasJobs("org-1", "u-2", "init-1");
    expect(artifactsByRef["feat-1"].map((a) => a.title)).toEqual(["Plan v1", "Claims v2", "shot"]);
    // Only the settled turns' job rows are read.
    const [, conversations, rowIds] = mockQueryRaw.mock.calls[0];
    expect(conversations).toEqual(["conv-1"]);
    expect(rowIds).toEqual(["job-row-2", "job-row-1"]);
  });
});
