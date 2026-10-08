/**
 * Unit tests for `services/strut-jobs/artifact-events.ts` — an event about
 * an artifact a job reported becomes a turn on that job (strut
 * plans/job-artifact-events.md §3).
 *
 * Themes:
 *   - the index: which refs of a turn are indexable (inline, absolute URL —
 *     a pull request, a page; never a file in the job's directory), one
 *     upsert per (job, ref);
 *   - the door: the URL looked up within the SOURCE's workspace, case
 *     folded; one turn per job however many refs point at the URL, as the
 *     job's owner into the job's conversation, the event as the whole
 *     prompt; a busy job (a PENDING turn, or strut's refusal) stores the
 *     event on the ref's row; a job with no conversation, or a launch strut
 *     refuses, is dropped; a webhook forwards after the response;
 *   - at settle: the pending events are taken atomically and go as ONE
 *     turn, oldest first; a job busy again gets them back; a `job_busy:`
 *     turn gives its own event back unless a newer one has the slot.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const { mockDb, mockFirst, mockLive, mockLaunch, mockLogger, afterCallbacks } = vi.hoisted(() => ({
  mockDb: {
    strutJobArtifact: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  mockFirst: vi.fn(),
  mockLive: vi.fn(),
  mockLaunch: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  afterCallbacks: [] as Array<() => Promise<void>>,
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void afterCallbacks.push(fn),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));
vi.mock("@/services/strut-jobs", () => ({ firstJobTurn: mockFirst, jobHasLiveTurn: mockLive, launchJobTurn: mockLaunch }));

import {
  composeJobArtifactEvent,
  deliverArtifactEvent,
  forwardArtifactEvent,
  indexJobArtifacts,
  indexableArtifacts,
  launchPendingArtifactEvents,
  requeueArtifactEvent,
} from "@/services/strut-jobs/artifact-events";

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const PR = "https://github.com/acme/app/pull/12";
const LINE = `[artifact-event] pull_request ${PR} merged`;

const pr: ArtifactRef = { id: "pr", kind: "pull_request", title: "PR", source: { type: "inline", content: { url: PR, repo: "acme/app", number: 12, state: "open" } } };
const pod: ArtifactRef = { id: "pod", kind: "url", title: "Pod", source: { type: "inline", content: { url: "https://pod-1-3000.workspaces.test" } } };
const plan: ArtifactRef = { id: "plan", kind: "markdown", title: "Plan", source: { type: "graph", swarmId: "swarm-1", key: `/jobs/${JOB}/files/plan.md` } };
const diff: ArtifactRef = { id: "diff", kind: "code", title: "Diff", source: { type: "inline", content: { code: "+x" } } };
const relative: ArtifactRef = { id: "rel", kind: "url", title: "Rel", source: { type: "inline", content: { url: "/somewhere" } } };

const first = { id: "row-1", workspaceId: "ws-1", swarmId: "swarm-1", userId: "user-1", conversationId: "conv-1", input: { prompt: "p", title: "Dark mode plan" } };
const ref = (over: Record<string, unknown> = {}) => ({ id: "ref-1", jobId: JOB, kind: "pull_request", url: PR, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  mockFirst.mockResolvedValue(first);
  mockLive.mockResolvedValue(false);
  mockLaunch.mockResolvedValue({ status: "continued", jobId: JOB, title: "Dark mode plan", runId: "row-2", note: "" });
  mockDb.strutJobArtifact.findMany.mockResolvedValue([]);
  mockDb.strutJobArtifact.upsert.mockResolvedValue({});
  mockDb.strutJobArtifact.update.mockResolvedValue({});
  mockDb.strutJobArtifact.updateMany.mockResolvedValue({ count: 1 });
  mockDb.$queryRaw.mockResolvedValue([]);
});

describe("the index", () => {
  it("indexes the refs an external system can name: inline content with an absolute URL, whatever the kind", () => {
    expect(indexableArtifacts([plan, pr, pod, diff, relative])).toEqual([
      { artifactId: "pr", kind: "pull_request", url: PR },
      { artifactId: "pod", kind: "url", url: "https://pod-1-3000.workspaces.test" },
    ]);
  });

  it("one upsert per (job, ref), keyed on the launch's workspace; the same id again is the same ref, newer", async () => {
    expect(await indexJobArtifacts({ workspaceId: "ws-1", swarmId: "swarm-1" }, JOB, [plan, pr, pod])).toBe(2);
    expect(mockDb.strutJobArtifact.upsert).toHaveBeenCalledTimes(2);
    expect(mockDb.strutJobArtifact.upsert).toHaveBeenCalledWith({
      where: { jobId_artifactId: { jobId: JOB, artifactId: "pr" } },
      create: { workspaceId: "ws-1", swarmId: "swarm-1", jobId: JOB, artifactId: "pr", kind: "pull_request", url: PR },
      update: { workspaceId: "ws-1", swarmId: "swarm-1", kind: "pull_request", url: PR },
    });
  });

  it("a database failure throws — the handler retries", async () => {
    mockDb.strutJobArtifact.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(indexJobArtifacts({ workspaceId: "ws-1", swarmId: "swarm-1" }, JOB, [pr])).rejects.toThrow("db down");
  });
});

describe("deliverArtifactEvent — the door", () => {
  const source = { workspaceId: "ws-1", url: "https://github.com/Acme/App/pull/12", what: "merged", publicBaseUrl: "https://hive.example.com" };

  it("looks the URL up within the source's workspace, case folded; nothing reported → nothing launched", async () => {
    expect(await deliverArtifactEvent(source)).toEqual({ jobs: [] });
    expect(mockDb.strutJobArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws-1", url: { equals: "https://github.com/Acme/App/pull/12", mode: "insensitive" } } }),
    );
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("one turn per job, as the owner into the job's conversation, the event as the whole prompt — with the indexed URL and the ref's kind", async () => {
    mockDb.strutJobArtifact.findMany.mockResolvedValue([ref(), ref({ id: "ref-2", artifactId: "pr-again" }), ref({ id: "ref-3", jobId: "other-job" })]);
    mockFirst.mockImplementation(async (jobId: string) => ({ ...first, userId: jobId === JOB ? "user-1" : "user-2", conversationId: `conv-${jobId}` }));

    const out = await deliverArtifactEvent(source);
    expect(out).toEqual({ jobs: [{ jobId: JOB, outcome: "launched" }, { jobId: "other-job", outcome: "launched" }] });
    expect(mockLaunch).toHaveBeenCalledTimes(2);
    expect(mockLaunch).toHaveBeenNthCalledWith(
      1,
      { userId: "user-1", workspaceId: "ws-1", conversationId: `conv-${JOB}`, publicBaseUrl: "https://hive.example.com" },
      { jobId: JOB, title: "Dark mode plan", prompt: LINE, started: false, event: true },
    );
    expect(mockLaunch.mock.calls[1][0]).toMatchObject({ userId: "user-2" });
  });

  it("the details ride below the line", async () => {
    mockDb.strutJobArtifact.findMany.mockResolvedValue([ref()]);
    await deliverArtifactEvent({ ...source, what: "checks failed", details: ["head: a1b2c3d", "- lint — https://ci.test/1"] });
    expect(mockLaunch.mock.calls[0][1].prompt).toBe(`[artifact-event] pull_request ${PR} checks failed\nhead: a1b2c3d\n- lint — https://ci.test/1`);
  });

  it("a job with a turn in flight: the event is stored on the ref's row, nothing launched", async () => {
    mockDb.strutJobArtifact.findMany.mockResolvedValue([ref()]);
    mockLive.mockResolvedValue(true);
    expect(await deliverArtifactEvent(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "queued" }] });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockDb.strutJobArtifact.update).toHaveBeenCalledWith({
      where: { id: "ref-1" },
      data: { pendingEvent: LINE, pendingAt: expect.any(Date) },
    });
  });

  it("strut refusing the launch as busy stores it too; another refusal drops it; a job with no conversation is skipped", async () => {
    mockDb.strutJobArtifact.findMany.mockResolvedValue([ref()]);

    mockLaunch.mockResolvedValueOnce({ status: "busy", jobId: JOB, note: "" });
    expect(await deliverArtifactEvent(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "queued" }] });
    expect(mockDb.strutJobArtifact.update).toHaveBeenCalledTimes(1);

    mockLaunch.mockResolvedValueOnce({ status: "error", error: "no strut" });
    expect(await deliverArtifactEvent(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "skipped" }] });
    expect(mockDb.strutJobArtifact.update).toHaveBeenCalledTimes(1);

    mockFirst.mockResolvedValueOnce({ ...first, conversationId: null });
    expect(await deliverArtifactEvent(source)).toEqual({ jobs: [{ jobId: JOB, outcome: "skipped" }] });
    expect(mockLaunch).toHaveBeenCalledTimes(2);
  });

  it("forwardArtifactEvent delivers after the response and never throws", async () => {
    mockDb.strutJobArtifact.findMany.mockRejectedValueOnce(new Error("db down"));
    forwardArtifactEvent(source);
    expect(afterCallbacks).toHaveLength(1);
    expect(mockDb.strutJobArtifact.findMany).not.toHaveBeenCalled();
    await afterCallbacks[0]();
    expect(mockDb.strutJobArtifact.findMany).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith("Artifact event delivery failed (non-fatal)", "JOB_ARTIFACT_EVENT", expect.objectContaining({ error: "db down" }));
  });
});

describe("at settle", () => {
  it("the pending events are taken atomically and go as one turn, oldest first, each once", async () => {
    mockDb.$queryRaw.mockResolvedValue([
      { id: "ref-2", pending_event: "[artifact-event] pull_request https://github.com/acme/app/pull/13 closed", pending_at: new Date("2026-10-08T10:02:00Z") },
      { id: "ref-1", pending_event: LINE, pending_at: new Date("2026-10-08T10:01:00Z") },
      { id: "ref-3", pending_event: LINE, pending_at: new Date("2026-10-08T10:03:00Z") },
    ]);
    expect(await launchPendingArtifactEvents(JOB, "https://hive.example.com")).toBe("launched");
    const sql = mockDb.$queryRaw.mock.calls[0][0] as { strings: string[] };
    expect(sql.strings.join("?")).toMatch(/UPDATE strut_job_artifacts[\s\S]*SET pending_event = NULL[\s\S]*WHERE job_id = \? AND pending_event IS NOT NULL[\s\S]*RETURNING/);
    expect(mockLaunch).toHaveBeenCalledWith(
      { userId: "user-1", workspaceId: "ws-1", conversationId: "conv-1", publicBaseUrl: "https://hive.example.com" },
      {
        jobId: JOB,
        title: "Dark mode plan",
        prompt: `${LINE}\n\n[artifact-event] pull_request https://github.com/acme/app/pull/13 closed`,
        started: false,
        event: true,
      },
    );
  });

  it("nothing pending → none; a job busy again gets the combined text back on the oldest slot", async () => {
    expect(await launchPendingArtifactEvents(JOB, "https://hive.example.com")).toBe("none");
    expect(mockLaunch).not.toHaveBeenCalled();

    mockDb.$queryRaw.mockResolvedValue([{ id: "ref-1", pending_event: LINE, pending_at: new Date() }]);
    mockLive.mockResolvedValue(true);
    expect(await launchPendingArtifactEvents(JOB, "https://hive.example.com")).toBe("queued");
    expect(mockDb.strutJobArtifact.update).toHaveBeenCalledWith({ where: { id: "ref-1" }, data: { pendingEvent: LINE, pendingAt: expect.any(Date) } });
  });

  it("a job_busy turn gives its event back to the ref's slot unless a newer one holds it; a person's prompt is not an event", async () => {
    expect(await requeueArtifactEvent(JOB, `${LINE}\nhead: abc`)).toBe(true);
    expect(mockDb.strutJobArtifact.updateMany).toHaveBeenCalledWith({
      where: { jobId: JOB, url: PR, pendingEvent: null },
      data: { pendingEvent: `${LINE}\nhead: abc`, pendingAt: expect.any(Date) },
    });
    mockDb.strutJobArtifact.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await requeueArtifactEvent(JOB, LINE)).toBe(false);
    expect(await requeueArtifactEvent(JOB, "Split step 2")).toBe(false);
    expect(mockDb.strutJobArtifact.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe("composeJobArtifactEvent — a card's action", () => {
  it("the event as a source's, from the job's own ref: its kind and the URL as indexed; null when the job never reported it", async () => {
    mockDb.strutJobArtifact.findFirst.mockResolvedValueOnce({ kind: "pull_request", url: PR });
    expect(await composeJobArtifactEvent(JOB, "https://github.com/Acme/App/pull/12", "checks failed", ["head: abc", "- lint"])).toBe(
      `[artifact-event] pull_request ${PR} checks failed\nhead: abc\n- lint`,
    );
    expect(mockDb.strutJobArtifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: JOB, url: { equals: "https://github.com/Acme/App/pull/12", mode: "insensitive" } } }),
    );
    mockDb.strutJobArtifact.findFirst.mockResolvedValueOnce(null);
    expect(await composeJobArtifactEvent(JOB, PR, "merged")).toBeNull();
  });
});
