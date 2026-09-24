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
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { mockFindUnique, mockUpdateMany, mockRateLimit, mockComplete } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockRateLimit: vi.fn(),
  mockComplete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: { findUnique: mockFindUnique, updateMany: mockUpdateMany } } }));
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
  workflow: "code-change-propose",
  strutRunId: "1790000000000",
  kind: "code_change_propose",
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  event: "run.end",
  workflow: "code-change-propose",
  runId: "1790000000000",
  status: "success",
  output: { diff: "d", filesChanged: 1 },
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
    expect(mockComplete).toHaveBeenCalledWith(row(), {
      status: "success",
      output: { diff: "d", filesChanged: 1 },
      error: null,
      durationMs: 4200,
    });
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
    expect(mockComplete).toHaveBeenCalledWith(row({ status: "SUCCESS" }), { status: "success" });

    mockComplete.mockResolvedValue("retry");
    expect((await post(body())).status).toBe(500);
  });
});
