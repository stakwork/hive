import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  issueFind: vi.fn(),
  issueUpdateMany: vi.fn(),
  eventFind: vi.fn(),
  repoFindMany: vi.fn(),
  convCreate: vi.fn(),
  artifactFind: vi.fn(),
  runFindMany: vi.fn(),
  launch: vi.fn(),
  blob: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    errorIssue: { findUnique: m.issueFind, updateMany: m.issueUpdateMany },
    errorEvent: { findFirst: m.eventFind },
    repository: { findMany: m.repoFindMany },
    sharedConversation: { create: m.convCreate },
    strutJobArtifact: { findFirst: m.artifactFind },
    strutRun: { findMany: m.runFindMany },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/strut-jobs", () => ({ launchJobTurn: m.launch }));
vi.mock("@/services/error-issues", () => ({ fetchRedactedBlobContent: m.blob }));

import { buildErrorFixPrompt, dispatchErrorFix, refreshErrorFix } from "@/services/error-fix";

const baseIssue = {
  id: "iss-1",
  workspaceId: "ws-1",
  repositoryId: "repo-1",
  repoKey: "acme/app",
  title: "Boom",
  exceptionType: "TypeError",
  occurrenceCount: 7,
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-01-02T00:00:00Z"),
  environment: "production",
  release: "1.2.3",
  metadata: { url: "/x" },
  fixStatus: null,
  fixJobId: null,
  fixPrUrl: null,
  fixDispatchedAt: null,
  workspace: { slug: "acme", sourceControlOrgId: "org-1" },
  repository: { repositoryUrl: "https://github.com/acme/app", branch: "main" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.issueFind.mockResolvedValue(baseIssue);
  m.issueUpdateMany.mockResolvedValue({ count: 1 });
  m.eventFind.mockResolvedValue({ message: "x is undefined", environment: null, release: null, commitSha: "abc", blobUrl: "https://blob" });
  m.blob.mockResolvedValue(JSON.stringify({ stackTrace: "TypeError: x\n  at f (a.ts:1)" }));
  m.convCreate.mockResolvedValue({ id: "conv-1" });
  m.launch.mockResolvedValue({ status: "started", jobId: "j", title: "t", runId: "r", note: "" });
});

describe("buildErrorFixPrompt", () => {
  it("includes error details, repo and PR instruction", () => {
    const p = buildErrorFixPrompt({
      workspaceSlug: "acme",
      issue: baseIssue,
      event: { message: "boom msg", environment: null, release: null, commitSha: "abc" },
      stackTrace: "STACK",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
    });
    for (const s of ["@acme", "pull request", "https://github.com/acme/app", "boom msg", "STACK", "**Occurrences:** 7", "2026-01-01", "abc", "/x"]) {
      expect(p).toContain(s);
    }
  });
});

describe("dispatchErrorFix", () => {
  const args = { issueId: "iss-1", userId: "u1", publicBaseUrl: "https://hive.test" };

  it("claims, launches and marks IN_PROGRESS", async () => {
    const res = await dispatchErrorFix(args);
    expect(res.status).toBe("dispatched");
    expect(m.issueUpdateMany.mock.calls[0][0].where).toEqual({
      id: "iss-1",
      OR: [{ fixStatus: null }, { fixStatus: "FAILED" }],
    });
    const launch = m.launch.mock.calls[0];
    expect(launch[0]).toMatchObject({ userId: "u1", workspaceId: "ws-1", conversationId: "conv-1" });
    expect(launch[1].started).toBe(true);
    expect(launch[1].prompt).toContain("TypeError: x");
    expect(m.issueUpdateMany.mock.calls[1][0].data).toEqual({ fixStatus: "IN_PROGRESS" });
  });

  it("returns existing without launching when a fix is live", async () => {
    m.issueFind.mockResolvedValue({ ...baseIssue, fixStatus: "IN_PROGRESS", fixJobId: "j1" });
    const res = await dispatchErrorFix(args);
    expect(res.status).toBe("exists");
    expect(m.launch).not.toHaveBeenCalled();
  });

  it("returns existing when it loses the claim race", async () => {
    m.issueUpdateMany.mockResolvedValueOnce({ count: 0 });
    m.issueFind.mockResolvedValueOnce(baseIssue).mockResolvedValueOnce({ fixStatus: "DISPATCHING", fixJobId: "j2", fixPrUrl: null, fixDispatchedAt: null });
    const res = await dispatchErrorFix(args);
    expect(res).toMatchObject({ status: "exists", fix: { fixJobId: "j2" } });
    expect(m.launch).not.toHaveBeenCalled();
  });

  it("allows retry after FAILED", async () => {
    m.issueFind.mockResolvedValue({ ...baseIssue, fixStatus: "FAILED", fixJobId: "old" });
    expect((await dispatchErrorFix(args)).status).toBe("dispatched");
  });

  it("releases the claim as FAILED when the launch errors", async () => {
    m.launch.mockResolvedValue({ status: "error", error: "no strut" });
    const res = await dispatchErrorFix(args);
    expect(res).toMatchObject({ status: "error", error: "no strut" });
    expect(m.issueUpdateMany.mock.calls[1][0].data).toEqual({ fixStatus: "FAILED" });
  });

  it("releases the claim when launch throws", async () => {
    m.launch.mockRejectedValue(new Error("x"));
    const res = await dispatchErrorFix(args);
    expect(res.status).toBe("error");
    expect(m.issueUpdateMany.mock.calls[1][0].data).toEqual({ fixStatus: "FAILED" });
  });

  it("errors without claiming when no repository resolves", async () => {
    m.issueFind.mockResolvedValue({ ...baseIssue, repository: null });
    m.repoFindMany.mockResolvedValue([{ repositoryUrl: "https://github.com/other/thing", branch: "main" }]);
    const res = await dispatchErrorFix(args);
    expect(res).toMatchObject({ status: "error", code: "NO_REPOSITORY" });
    expect(m.issueUpdateMany).not.toHaveBeenCalled();
  });

  it("resolves the repository from the workspace by repoKey", async () => {
    m.issueFind.mockResolvedValue({ ...baseIssue, repository: null });
    m.repoFindMany.mockResolvedValue([{ repositoryUrl: "https://github.com/acme/app", branch: "dev" }]);
    expect((await dispatchErrorFix(args)).status).toBe("dispatched");
    expect(m.launch.mock.calls[0][1].prompt).toContain("`dev`");
  });

  it("not_found for a missing issue", async () => {
    m.issueFind.mockResolvedValue(null);
    expect((await dispatchErrorFix(args)).status).toBe("not_found");
  });
});

describe("refreshErrorFix", () => {
  const live = { fixStatus: "IN_PROGRESS", fixJobId: "j1", fixPrUrl: null, fixDispatchedAt: null };

  it("marks PR_OPENED when the job reported a pull request", async () => {
    m.issueFind.mockResolvedValue(live);
    m.artifactFind.mockResolvedValue({ url: "https://github.com/acme/app/pull/3" });
    const res = await refreshErrorFix("iss-1");
    expect(res).toMatchObject({ fixStatus: "PR_OPENED", fixPrUrl: "https://github.com/acme/app/pull/3" });
    expect(m.issueUpdateMany).toHaveBeenCalled();
  });

  it("marks FAILED when all turns ended without a PR", async () => {
    m.issueFind.mockResolvedValue(live);
    m.artifactFind.mockResolvedValue(null);
    m.runFindMany.mockResolvedValue([{ status: "ERROR" }]);
    expect((await refreshErrorFix("iss-1"))?.fixStatus).toBe("FAILED");
  });

  it("stays in progress while a turn is pending", async () => {
    m.issueFind.mockResolvedValue(live);
    m.artifactFind.mockResolvedValue(null);
    m.runFindMany.mockResolvedValue([{ status: "PENDING" }]);
    expect((await refreshErrorFix("iss-1"))?.fixStatus).toBe("IN_PROGRESS");
    expect(m.issueUpdateMany).not.toHaveBeenCalled();
  });

  it("does nothing for a never-dispatched issue", async () => {
    m.issueFind.mockResolvedValue({ fixStatus: null, fixJobId: null, fixPrUrl: null, fixDispatchedAt: null });
    expect((await refreshErrorFix("iss-1"))?.fixStatus).toBeNull();
    expect(m.artifactFind).not.toHaveBeenCalled();
  });
});
