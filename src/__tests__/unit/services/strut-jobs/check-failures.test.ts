/**
 * Unit tests for `services/strut-jobs/check-failures.ts` — the first fix
 * is hive's (strut plans/job-artifact-events.md §5): a completed check on
 * a job's pull request, or the settle of a turn that reported one, has
 * hive read the live state as the job's owner and send the `checks
 * failed` event the card's Fix would — once every check has run, once per
 * ref, through the door.
 *
 * Themes:
 *   - nothing to read without a ref whose automatic event is still to
 *     send, or for a URL that is not a GitHub pull request;
 *   - the read is the owner's, for the repository's owner; checks still
 *     running, none failed, a pull request merged or closed, no token or a
 *     refused read all leave the slot untaken;
 *   - all in and one failed: the slot taken atomically BEFORE the launch,
 *     then the event (head commit, each failing check with its link) as
 *     the job's next turn; a slot another delivery took sends nothing;
 *   - a busy job queues it and keeps the slot; a launch refused outright
 *     gives the slot back; one read and one turn per job;
 *   - the webhook forwards after the response and never throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockDb, mockFirst, mockTokens, mockStatus, mockStart, mockOctokit, mockLogger, afterCallbacks } = vi.hoisted(() => ({
  mockDb: { strutJobArtifact: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
  mockFirst: vi.fn(),
  mockTokens: vi.fn(),
  mockStatus: vi.fn(),
  mockStart: vi.fn(),
  mockOctokit: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  afterCallbacks: [] as Array<() => Promise<void>>,
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void afterCallbacks.push(fn),
}));
vi.mock("@octokit/rest", () => ({ Octokit: mockOctokit }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));
vi.mock("@/lib/githubApp", () => ({ getUserAppTokens: mockTokens }));
vi.mock("@/lib/github/pullRequestStatus", () => ({ getPullRequestStatus: mockStatus }));
vi.mock("@/services/strut-jobs", () => ({ firstJobTurn: mockFirst }));
vi.mock("@/services/strut-jobs/artifact-events", () => ({ startEventTurn: mockStart, capEventText: (s: string) => s }));

import { deliverCheckFailure, forwardCheckFailure } from "@/services/strut-jobs/check-failures";

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const PR = "https://github.com/acme/app/pull/12";
const BASE = "https://hive.example.com";
const source = { workspaceId: "ws-1", url: "https://github.com/Acme/App/pull/12", publicBaseUrl: BASE };
const first = { id: "row-1", workspaceId: "ws-1", swarmId: "swarm-1", userId: "user-1", conversationId: "conv-1", input: { prompt: "p", title: "Dark mode plan" } };
const ref = (over: Record<string, unknown> = {}) => ({ id: "ref-1", jobId: JOB, kind: "pull_request", url: PR, ...over });

const failed = {
  state: "open",
  title: "Dark mode",
  headSha: "a1b2c3d",
  headBranch: "dark-mode",
  baseBranch: "main",
  checks: [
    { name: "build", status: "success" },
    { name: "lint", status: "failure", url: "https://github.com/acme/app/actions/runs/1" },
    { name: "e2e", status: "failure" },
  ],
};
const EVENT = `[artifact-event] pull_request ${PR} checks failed\nhead: a1b2c3d\n- lint — https://github.com/acme/app/actions/runs/1\n- e2e`;

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  mockDb.strutJobArtifact.findMany.mockResolvedValue([]);
  mockDb.strutJobArtifact.updateMany.mockResolvedValue({ count: 1 });
  mockDb.strutJobArtifact.update.mockResolvedValue({});
  mockFirst.mockResolvedValue(first);
  mockTokens.mockResolvedValue({ accessToken: "gh-token" });
  mockStatus.mockResolvedValue(failed);
  mockStart.mockResolvedValue("launched");
  mockOctokit.mockImplementation(function (this: { auth: string }, opts: { auth: string }) {
    this.auth = opts.auth;
  });
});

describe("deliverCheckFailure — what there is to read", () => {
  it("looks the URL up within the workspace, case folded, among the refs whose automatic event is still to send; none → no read", async () => {
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [] });
    expect(mockDb.strutJobArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1", url: { equals: "https://github.com/Acme/App/pull/12", mode: "insensitive" }, autoEventAt: null },
      }),
    );
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it("a URL that is not a pull request on github.com is not looked up at all", async () => {
    expect(await deliverCheckFailure({ ...source, url: "https://pod-1-3000.workspaces.test" })).toEqual({ jobs: [] });
    expect(mockDb.strutJobArtifact.findMany).not.toHaveBeenCalled();
  });

  it("reads as the job's owner, with the owner's token for the repository's owner", async () => {
    mockDb.strutJobArtifact.findMany.mockResolvedValue([ref()]);
    await deliverCheckFailure(source);
    expect(mockFirst).toHaveBeenCalledWith(JOB);
    expect(mockTokens).toHaveBeenCalledWith("user-1", "acme");
    expect(mockOctokit).toHaveBeenCalledWith({ auth: "gh-token" });
    expect(mockStatus).toHaveBeenCalledWith(expect.objectContaining({ auth: "gh-token" }), { owner: "acme", repo: "app", number: 12 });
  });
});

describe("deliverCheckFailure — when nothing is sent, the slot stays", () => {
  beforeEach(() => mockDb.strutJobArtifact.findMany.mockResolvedValue([ref()]));

  it("a check still running → running", async () => {
    mockStatus.mockResolvedValue({ ...failed, checks: [...failed.checks, { name: "deploy", status: "pending" }] });
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "running" }] });
  });

  it("every check passed or skipped → clean", async () => {
    mockStatus.mockResolvedValue({ ...failed, checks: [{ name: "build", status: "success" }, { name: "docs", status: "skipped" }] });
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "clean" }] });
  });

  it("a pull request merged or closed → over, whatever its checks", async () => {
    mockStatus.mockResolvedValueOnce({ ...failed, state: "merged" });
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "over" }] });
    mockStatus.mockResolvedValueOnce({ ...failed, state: "closed" });
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "over" }] });
  });

  it("no token for the repository's owner, or GitHub refusing the read → unread, logged", async () => {
    mockTokens.mockResolvedValueOnce(null);
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "unread" }] });
    expect(mockStatus).not.toHaveBeenCalled();

    mockStatus.mockRejectedValueOnce(new Error("Not Found"));
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "unread" }] });
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
  });

  it("a job with no first turn → skipped", async () => {
    mockFirst.mockResolvedValueOnce(null);
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "skipped" }] });
    expect(mockTokens).not.toHaveBeenCalled();
  });

  afterEach(() => {
    expect(mockDb.strutJobArtifact.updateMany).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe("deliverCheckFailure — every check in and one failed", () => {
  beforeEach(() => mockDb.strutJobArtifact.findMany.mockResolvedValue([ref()]));

  it("takes the slot before the launch, then sends the event the card's Fix would — the head commit and each failing check with its link — through the door, on the ref's slot", async () => {
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "launched" }] });
    expect(mockDb.strutJobArtifact.updateMany).toHaveBeenCalledWith({ where: { id: "ref-1", autoEventAt: null }, data: { autoEventAt: expect.any(Date) } });
    expect(mockStart).toHaveBeenCalledWith(JOB, EVENT, "ref-1", BASE);
    expect(mockDb.strutJobArtifact.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mockStart.mock.invocationCallOrder[0]);
    expect(mockDb.strutJobArtifact.update).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("Check failure considered", "JOB_CHECK_FAILURE", expect.objectContaining({ jobs: [{ jobId: JOB, outcome: "launched" }] }));
  });

  it("the event carries the ref's kind and the URL as indexed, not the source's spelling", async () => {
    mockDb.strutJobArtifact.findMany.mockResolvedValue([ref({ kind: "pull_request", url: PR })]);
    await deliverCheckFailure({ ...source, url: "https://github.com/ACME/APP/pull/12" });
    expect(mockStart.mock.calls[0][1].startsWith(`[artifact-event] pull_request ${PR} checks failed`)).toBe(true);
  });

  it("a slot another delivery took first sends nothing — the completed events of a workflow's last checks make one turn", async () => {
    mockDb.strutJobArtifact.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "taken" }] });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("a busy job queues it and the slot stays taken; a launch refused outright gives the slot back", async () => {
    mockStart.mockResolvedValueOnce("queued");
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "queued" }] });
    expect(mockDb.strutJobArtifact.update).not.toHaveBeenCalled();

    mockStart.mockResolvedValueOnce("skipped");
    expect(await deliverCheckFailure(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "skipped" }] });
    expect(mockDb.strutJobArtifact.update).toHaveBeenCalledWith({ where: { id: "ref-1" }, data: { autoEventAt: null } });
  });

  it("one read and one turn per job, however many refs of the job point at the pull request; another job reads with its own owner's token", async () => {
    mockDb.strutJobArtifact.findMany.mockResolvedValue([ref(), ref({ id: "ref-2" }), ref({ id: "ref-3", jobId: "other-job" })]);
    mockFirst.mockImplementation(async (jobId: string) => ({ ...first, userId: jobId === JOB ? "user-1" : "user-2" }));
    const out = await deliverCheckFailure(source);
    expect(out.jobs).toEqual([
      { jobId: JOB, outcome: "launched" },
      { jobId: "other-job", outcome: "launched" },
    ]);
    expect(mockStatus).toHaveBeenCalledTimes(2);
    expect(mockTokens).toHaveBeenNthCalledWith(1, "user-1", "acme");
    expect(mockTokens).toHaveBeenNthCalledWith(2, "user-2", "acme");
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockStart).toHaveBeenNthCalledWith(1, JOB, EVENT, "ref-1", BASE);
    expect(mockStart).toHaveBeenNthCalledWith(2, "other-job", EVENT, "ref-3", BASE);
  });
});

describe("forwardCheckFailure", () => {
  it("delivers after the response and never throws", async () => {
    mockDb.strutJobArtifact.findMany.mockRejectedValueOnce(new Error("db down"));
    forwardCheckFailure(source);
    expect(afterCallbacks).toHaveLength(1);
    expect(mockDb.strutJobArtifact.findMany).not.toHaveBeenCalled();
    await afterCallbacks[0]();
    expect(mockDb.strutJobArtifact.findMany).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith("Check failure delivery failed (non-fatal)", "JOB_CHECK_FAILURE", expect.objectContaining({ error: "db down" }));
  });
});
