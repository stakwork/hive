/**
 * Unit tests for POST /api/strut-jobs/events — where a strut job tells hive
 * what changed as it happens (strut plans/live-artifacts.md).
 *
 * Coverage:
 *   - Auth like the run webhook: missing id / token, unknown row, wrong
 *     token, rate limit before any lookup; a row that is not a job turn.
 *   - The event must be a `job.update` about the row's OWN job.
 *   - A good event is forwarded to the job's conversation over Pusher with
 *     the row's swarm; a link outside the job is dropped; an oversize
 *     `detail` is dropped; no conversation → nothing forwarded, still 200.
 *   - `verify / done` publishes the claims card's next version as the job's
 *     owner; a failure there is not the caller's (200).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { mockFindUnique, mockRateLimit, mockNotify, mockFirst, mockPublish } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockRateLimit: vi.fn(),
  mockNotify: vi.fn(),
  mockFirst: vi.fn(),
  mockPublish: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: { findUnique: mockFindUnique } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit, getClientIp: () => "1.2.3.4" }));
vi.mock("@/lib/encryption", () => ({ timingSafeEqual: (a: string, b: string) => a === b }));
vi.mock("@/lib/pusher", () => ({ notifyCanvasJobUpdate: mockNotify }));
vi.mock("@/services/strut-jobs", () => ({ firstJobTurn: mockFirst }));
vi.mock("@/services/strut-jobs/claims", () => ({ publishVerifiedVersion: mockPublish }));
vi.mock("@/services/strut-runs", () => ({
  hashStrutRunToken: (t: string) => crypto.createHash("sha256").update(t).digest("hex"),
}));

import { POST } from "@/app/api/strut-jobs/events/route";
import { JOB_TURN_KIND } from "@/lib/strut-jobs";

const TOKEN = "raw-token";
const HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");
const JOB = "j-123";

const row = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  tokenHash: HASH,
  kind: JOB_TURN_KIND,
  jobId: JOB,
  swarmId: "swarm-1",
  conversationId: "conv-1",
  ...over,
});

const update = (over: Record<string, unknown> = {}) => ({
  event: "job.update",
  job: JOB,
  at: "2026-10-15T18:04:11.201Z",
  runId: "1790000000000",
  kind: "walkthrough",
  url: `/jobs/${JOB}/files/walkthroughs/004/walkthrough.json`,
  state: "recording",
  title: "Switch billing",
  detail: { frames: 3 },
  ...over,
});

function post(payload: unknown, query = `id=row-1&token=${TOKEN}`) {
  return POST(
    new NextRequest(`https://hive.example.com/api/strut-jobs/events?${query}`, {
      method: "POST",
      headers: { host: "hive.example.com", "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

describe("POST /api/strut-jobs/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ allowed: true });
    mockFindUnique.mockResolvedValue(row());
    mockFirst.mockResolvedValue({ id: "row-0", userId: "u-1" });
    mockPublish.mockResolvedValue(null);
  });

  test("refuses a missing id or token, an unknown row, a wrong token — and rate-limits before any lookup", async () => {
    expect((await post(update(), `token=${TOKEN}`)).status).toBe(400);
    expect((await post(update(), "id=row-1")).status).toBe(401);
    mockFindUnique.mockResolvedValueOnce(null);
    expect((await post(update())).status).toBe(404);
    expect((await post(update(), "id=row-1&token=nope")).status).toBe(401);
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 9 });
    mockFindUnique.mockClear();
    const limited = await post(update());
    expect(limited.status).toBe(429);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("an update must be a job.update about the row's own job, on a job turn", async () => {
    expect((await post(update({ event: "run.end" }))).status).toBe(400);
    expect((await post(update({ kind: undefined }))).status).toBe(400);
    expect((await post("{ not json")).status).toBe(400);
    const other = await post(update({ job: "j-other" }));
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: "Job mismatch" });
    mockFindUnique.mockResolvedValueOnce(row({ kind: "system_map" }));
    expect((await post(update())).status).toBe(400);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("forwards the update to the job's conversation with the row's swarm", async () => {
    const res = await post(update());
    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith("conv-1", {
      jobId: JOB,
      swarmId: "swarm-1",
      at: "2026-10-15T18:04:11.201Z",
      kind: "walkthrough",
      runId: "1790000000000",
      url: `/jobs/${JOB}/files/walkthroughs/004/walkthrough.json`,
      state: "recording",
      title: "Switch billing",
      detail: { frames: 3 },
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  test("keeps a pod's address; drops a link into another job, a non-http link and an oversize detail", async () => {
    await post(update({ kind: "pod", url: "https://pod-7.example.com", state: "held", id: "pod-7", detail: undefined }));
    expect(mockNotify.mock.calls[0][1]).toMatchObject({ kind: "pod", url: "https://pod-7.example.com", id: "pod-7" });
    await post(update({ url: "/jobs/j-other/files/shots/001.png" }));
    expect(mockNotify.mock.calls[1][1].url).toBeUndefined();
    await post(update({ url: "javascript:alert(1)" }));
    expect(mockNotify.mock.calls[2][1].url).toBeUndefined();
    await post(update({ detail: { blob: "x".repeat(5_000) } }));
    expect(mockNotify.mock.calls[3][1].detail).toBeUndefined();
  });

  test("a row with no conversation forwards nothing and still answers 200", async () => {
    mockFindUnique.mockResolvedValueOnce(row({ conversationId: null }));
    expect((await post(update())).status).toBe(200);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("verify / done publishes the claims card's next version as the job's owner; a failure there is not the caller's", async () => {
    const done = update({ kind: "verify", state: "done", url: undefined, title: undefined, detail: { evidence: 2, slots: 0, claims: [] } });
    expect((await post(done)).status).toBe(200);
    expect(mockFirst).toHaveBeenCalledWith(JOB);
    expect(mockPublish).toHaveBeenCalledWith({ id: "row-0", userId: "u-1" }, JOB, "1790000000000");
    mockPublish.mockRejectedValueOnce(new Error("swarm down"));
    expect((await post(done)).status).toBe(200);
  });
});
