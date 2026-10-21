/**
 * Unit tests for POST /api/strut-runs/webhook — the ONE callback endpoint
 * for strut workflow runs.
 *
 * Coverage:
 *   - Auth: missing id / token, unknown row, wrong token, rate limit before
 *     any lookup (constant-time compare against the row's hash).
 *   - Malformed payloads (event, status, runId, a foreign workflow, a run id
 *     that does not match the row) → 400.
 *   - A settled row: replay → 200 (the handler re-runs idempotently); a
 *     handler failure on replay → 500.
 *   - A pending row: the completion is handed to `completeStrutRun` with
 *     the output / error / duration; a retry outcome → 500.
 *   - A callback that beats the dispatch's run-id write records the id.
 *   - The delivery target is never read from the payload.
 *   - A job the orchestrator started inside strut (strut CALLBACKS.md §4):
 *     its `run.end` under an `orchestrator_turn` row mints a `job_turn` row
 *     routed from that row and settles it; a replay finds the row and takes
 *     the settled path; the same payload under any other kind is a 400.
 *     A `run.end` carrying `job` is a job turn whatever its workflow: a
 *     `builder` job's is adopted the same way and its row records `builder`
 *     (re-recording a PENDING row of that run minted under `job`); one
 *     without `job` is never adopted, whatever its workflow.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { mockFindUnique, mockFindMany, mockUpdate, mockUpdateMany, mockUpsert, mockWorkspaceFindUnique, mockRateLimit, mockComplete } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUpsert: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
  mockRateLimit: vi.fn(),
  mockComplete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    strutRun: {
      findUnique: mockFindUnique,
      findFirst: async () => null,
      findMany: mockFindMany,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      upsert: mockUpsert,
    },
    workspace: { findUnique: mockWorkspaceFindUnique },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit, getClientIp: () => "1.2.3.4" }));
vi.mock("@/lib/encryption", () => ({ timingSafeEqual: (a: string, b: string) => a === b }));
vi.mock("@/services/strut-runs", () => ({
  completeStrutRun: mockComplete,
  hashStrutRunToken: (t: string) => crypto.createHash("sha256").update(t).digest("hex"),
}));

import { POST } from "@/app/api/strut-runs/webhook/route";

const TOKEN = "raw-token";
const HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

const row = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  tokenHash: HASH,
  status: "PENDING",
  workflow: "swarm-systemmap-schema-sync",
  strutRunId: "1790000000000",
  kind: "system_map",
  workspaceId: "ws-1",
  swarmId: "swarm-1",
  userId: "user-1",
  conversationId: "conv-1",
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  event: "run.end",
  workflow: "swarm-systemmap-schema-sync",
  runId: "1790000000000",
  status: "success",
  output: { ok: true },
  durationMs: 4200,
  ...over,
});

function post(payload: unknown, query = `id=row-1&token=${TOKEN}`) {
  return POST(
    new NextRequest(`https://hive.example.com/api/strut-runs/webhook?${query}`, {
      method: "POST",
      headers: { host: "hive.example.com", "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

describe("POST /api/strut-runs/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ allowed: true });
    mockFindUnique.mockResolvedValue(row());
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindMany.mockResolvedValue([]);
    mockWorkspaceFindUnique.mockResolvedValue({ slug: "acme" });
    mockComplete.mockResolvedValue("claimed");
  });

  test("rejects missing id / token, an unknown row, and a wrong token", async () => {
    expect((await post(body(), `token=${TOKEN}`)).status).toBe(400);
    expect((await post(body(), "id=row-1")).status).toBe(401);
    mockFindUnique.mockResolvedValueOnce(null);
    expect((await post(body())).status).toBe(404);
    expect((await post(body(), "id=row-1&token=wrong")).status).toBe(401);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test("rate limited before any lookup", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const res = await post(body());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test("malformed payloads, a foreign workflow and a foreign run id are 400s", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(body({ event: "turn.end" }))).status).toBe(400);
    expect((await post(body({ status: "done" }))).status).toBe(400);
    expect((await post(body({ runId: undefined }))).status).toBe(400);
    expect((await post(body({ workflow: "other" }))).status).toBe(400);
    expect((await post(body({ runId: "1790000000001" }))).status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test("a pending row is settled through completeStrutRun with the parsed completion", async () => {
    const res = await post(body({ conversationId: "attacker-conv", proposalId: "attacker-prop" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "claimed" });
    expect(mockComplete).toHaveBeenCalledWith(
      row(),
      {
        status: "success",
        output: { ok: true },
        error: null,
        durationMs: 4200,
      },
      // The callback's host, for a handler that wakes the canvas agent.
      { publicBaseUrl: expect.stringMatching(/^https?:\/\//) },
    );
    // Nothing about where to deliver comes from the payload.
    expect(JSON.stringify(mockComplete.mock.calls[0])).not.toContain("attacker");
  });

  test("an error completion carries the message, no output; a cancelled one neither", async () => {
    await post(body({ status: "error", output: undefined, error: { message: "clone failed" } }));
    expect(mockComplete.mock.calls[0][1]).toEqual({ status: "error", output: undefined, error: "clone failed", durationMs: 4200 });
    await post(body({ status: "cancelled", output: { leaked: true }, durationMs: "soon" }));
    expect(mockComplete.mock.calls[1][1]).toEqual({ status: "cancelled", output: undefined, error: null, durationMs: null });
  });

  test("an oversized error message is capped, never stored whole", async () => {
    await post(body({ status: "error", error: { message: "x".repeat(10_000) } }));
    const stored = mockComplete.mock.calls[0][1].error as string;
    expect(stored.length).toBeLessThan(4_100);
    expect(stored.endsWith("…")).toBe(true);
  });

  test("a retry outcome answers 500 so strut re-delivers", async () => {
    mockComplete.mockResolvedValue("retry");
    expect((await post(body())).status).toBe(500);
  });

  test("a callback that beats the dispatch's run-id write records the id", async () => {
    mockFindUnique.mockResolvedValue(row({ strutRunId: null }));
    expect((await post(body())).status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: "row-1", strutRunId: null }, data: { strutRunId: "1790000000000" } });
  });

  test("a replay of a settled row is a 200 and re-runs the idempotent handler; 500 if that fails", async () => {
    mockFindUnique.mockResolvedValue(row({ status: "SUCCESS" }));
    mockComplete.mockResolvedValue("replayed");
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, note: "already settled" });
    expect(mockComplete).toHaveBeenCalledWith(row({ status: "SUCCESS" }), { status: "success" }, expect.objectContaining({ publicBaseUrl: expect.any(String) }));

    mockComplete.mockResolvedValue("retry");
    expect((await post(body())).status).toBe(500);
  });

  describe("a job the orchestrator started inside strut (CALLBACKS.md §4)", () => {
    const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
    const orchestrator = (over: Record<string, unknown> = {}) =>
      row({ kind: "orchestrator_turn", workflow: "orchestrator", status: "SUCCESS", strutRunId: "1790000000000", liveUpdates: true, ...over });
    const jobEnd = (over: Record<string, unknown> = {}) =>
      body({ workflow: "job", job: JOB, runId: "1790000000777", output: { text: "Shipped.", artifacts: [] }, ...over });
    const adopted = (over: Record<string, unknown> = {}) => ({
      id: "job-row-9",
      tokenHash: "f".repeat(64),
      status: "PENDING",
      workflow: "job",
      strutRunId: "1790000000777",
      kind: "job_turn",
      workspaceId: "ws-1",
      swarmId: "swarm-1",
      userId: "user-1",
      conversationId: "conv-1",
      ...over,
    });

    beforeEach(() => {
      mockFindUnique.mockResolvedValue(orchestrator());
      mockUpsert.mockResolvedValue(adopted());
    });

    test("mints a job_turn row routed from the orchestrator row — never from the payload — and settles it", async () => {
      const res = await post(jobEnd({ conversationId: "attacker-conv", workspaceId: "attacker-ws", swarmId: "attacker-swarm", userId: "attacker" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, outcome: "claimed" });

      expect(mockWorkspaceFindUnique).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { slug: true } });
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const call = mockUpsert.mock.calls[0][0];
      expect(call.where).toEqual({ swarmId_workflow_strutRunId: { swarmId: "swarm-1", workflow: "job", strutRunId: "1790000000777" } });
      expect(call.update).toEqual({});
      expect(call.create).toEqual({
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        workspaceId: "ws-1",
        swarmId: "swarm-1",
        userId: "user-1",
        kind: "job_turn",
        workflow: "job",
        strutRunId: "1790000000777",
        status: "PENDING",
        input: { prompt: "", title: JOB, workspace: "acme", via: "orchestrator", parentRunId: "row-1" },
        conversationId: "conv-1",
        jobId: JOB,
        // The turn's jobs inherited its jobCallback: their live updates reach hive.
        liveUpdates: true,
      });
      // Its own token, not the orchestrator row's.
      expect(call.create.tokenHash).not.toBe(HASH);
      expect(JSON.stringify(call)).not.toContain("attacker");

      // Settled as the adopted row, with the job's completion.
      expect(mockComplete).toHaveBeenCalledWith(
        adopted(),
        { status: "success", output: { text: "Shipped.", artifacts: [] }, error: null, durationMs: 4200 },
        { publicBaseUrl: expect.stringMatching(/^https?:\/\//) },
      );
      // The orchestrator row's own run id is untouched.
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    test("a title on the payload names the job; a failed job settles as an error", async () => {
      await post(jobEnd({ title: "  Dark mode  ", status: "error", output: undefined, error: { message: "tests failed" } }));
      expect(mockUpsert.mock.calls[0][0].create.input).toMatchObject({ title: "Dark mode" });
      expect(mockComplete.mock.calls[0][1]).toEqual({ status: "error", output: undefined, error: "tests failed", durationMs: 4200 });
    });

    test("a replay finds the row it minted and takes the settled path", async () => {
      mockUpsert.mockResolvedValue(adopted({ status: "SUCCESS" }));
      mockComplete.mockResolvedValue("replayed");
      const res = await post(jobEnd());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, note: "already settled" });
      expect(mockComplete).toHaveBeenCalledWith(adopted({ status: "SUCCESS" }), { status: "success" }, expect.anything());
    });

    test("a handler failure on the adopted row is a 500 so strut re-posts", async () => {
      mockComplete.mockResolvedValue("retry");
      expect((await post(jobEnd())).status).toBe(500);
    });

    test("without a job id, or with one not in strut's format, nothing is minted", async () => {
      expect((await post(jobEnd({ job: undefined }))).status).toBe(400);
      expect((await post(jobEnd({ job: "../etc" }))).status).toBe(400);
      expect((await post(jobEnd({ job: "x".repeat(200) }))).status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockComplete).not.toHaveBeenCalled();
    });

    test("the orchestrator row's own run.end still goes the usual way; a foreign workflow is still a 400", async () => {
      mockFindUnique.mockResolvedValue(orchestrator({ status: "PENDING" }));
      expect((await post(body({ workflow: "orchestrator" }))).status).toBe(200);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockComplete).toHaveBeenCalledWith(orchestrator({ status: "PENDING" }), expect.objectContaining({ status: "success" }), expect.anything());
      expect((await post(body({ workflow: "other" }))).status).toBe(400);
    });

    test("a builder job's run.end is a job turn too: adopted the same way, its row recording builder", async () => {
      mockUpsert.mockResolvedValue(adopted({ workflow: "builder" }));
      const res = await post(jobEnd({ workflow: "builder", title: "Digest workflow" }));
      expect(res.status).toBe(200);

      // Looked up by the run, whatever workflow a row of it was minted under.
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { swarmId: "swarm-1", kind: "job_turn", jobId: JOB, strutRunId: "1790000000777" } }),
      );
      const call = mockUpsert.mock.calls[0][0];
      expect(call.where).toEqual({ swarmId_workflow_strutRunId: { swarmId: "swarm-1", workflow: "builder", strutRunId: "1790000000777" } });
      expect(call.create).toMatchObject({
        kind: "job_turn",
        workflow: "builder",
        jobId: JOB,
        conversationId: "conv-1",
        input: { prompt: "", title: "Digest workflow", workspace: "acme", via: "orchestrator", parentRunId: "row-1" },
      });
      expect(mockComplete).toHaveBeenCalledWith(
        adopted({ workflow: "builder" }),
        { status: "success", output: { text: "Shipped.", artifacts: [] }, error: null, durationMs: 4200 },
        expect.anything(),
      );
    });

    test("a PENDING row of that run minted under job (the turn's guess) is re-recorded under the run.end's workflow and settled", async () => {
      mockFindMany.mockResolvedValue([adopted()]);
      mockUpdate.mockResolvedValue(adopted({ workflow: "builder" }));
      expect((await post(jobEnd({ workflow: "builder" }))).status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "job-row-9" }, data: { workflow: "builder" } }));
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockComplete).toHaveBeenCalledWith(adopted({ workflow: "builder" }), expect.objectContaining({ status: "success" }), expect.anything());
    });

    test("a job run.end whose workflow is missing or not a name is a 400; nothing is minted", async () => {
      expect((await post(jobEnd({ workflow: undefined }))).status).toBe(400);
      expect((await post(jobEnd({ workflow: 42 }))).status).toBe(400);
      expect((await post(jobEnd({ workflow: "../builder" }))).status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockComplete).not.toHaveBeenCalled();
    });

    test("a run.end without job is never adopted, whatever its workflow", async () => {
      expect((await post(jobEnd({ job: undefined, workflow: "builder" }))).status).toBe(400);
      expect((await post(jobEnd({ job: null, workflow: "builder" }))).status).toBe(400);
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockComplete).not.toHaveBeenCalled();
    });

    test("a job run.end under a job_turn row with another run id, or under any other kind, is a 400", async () => {
      mockFindUnique.mockResolvedValue(row({ kind: "job_turn", workflow: "job", strutRunId: "1790000000000" }));
      expect((await post(jobEnd())).status).toBe(400);
      mockFindUnique.mockResolvedValue(row()); // system_map
      expect((await post(jobEnd())).status).toBe(400);
      mockFindUnique.mockResolvedValue(row({ kind: "job_turn", workflow: "orchestrator" })); // a row that lies about its workflow
      expect((await post(jobEnd())).status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockComplete).not.toHaveBeenCalled();
    });
  });
});
