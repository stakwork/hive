/**
 * Unit tests for POST /api/code-change/webhook — the terminal-result
 * receiver for async code-change runs.
 *
 * Themes:
 *   - the URL-borne JWT must verify against the PER-CLAIM secret (the
 *     swarm sends no headers, so the token is the entire auth surface);
 *   - the payload binds to the dispatch receipt: a `request_id` that
 *     doesn't match the stored claim is dropped;
 *   - `completed` routes into the shared completion path, `failed` marks
 *     the claim without deleting it.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockComplete, mockMarkFailed } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
  mockMarkFailed: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { task: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      // The "encrypted" column value IS the secret in these tests.
      decryptField: vi.fn((_f: string, v: string) => String(v)),
    }),
  },
}));
vi.mock("@/lib/proposals/codeChangeCompletion", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/proposals/codeChangeCompletion")>();
  return {
    ...actual, // real parseCreatePrClaim
    completeClaimFromResult: mockComplete,
    markClaimRunFailed: mockMarkFailed,
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/code-change/webhook/route";
import { createCodeChangeWebhookToken } from "@/lib/auth/agent-jwt";
import { db } from "@/lib/db";

const TASK_ID = "task-claim-1";
const SECRET = "a".repeat(64);
const REQUEST_ID = "req-uuid-1";

const CLAIM = {
  requestId: REQUEST_ID,
  repositoryUrl: "https://github.com/acme/widgets",
  userId: "user-1",
  workspaceSlug: "ws",
  prBranch: "swarm/swarm-change-abcd1234",
  approvedPaths: ["src/a.ts"],
  conversationId: "conv-1",
  proposalId: "prop-1",
};

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    deleted: false,
    codeChangeWebhookSecret: SECRET,
    codeChangeClaim: CLAIM,
    ...overrides,
  };
}

async function post(
  token: string | null,
  body: unknown,
): Promise<Response> {
  const url = new URL("http://localhost:3000/api/code-change/webhook");
  if (token) url.searchParams.set("token", token);
  return POST(
    new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.task.findUnique).mockResolvedValue(taskRow() as never);
  mockComplete.mockResolvedValue({
    outcome: "landed",
    prUrl: "https://github.com/acme/widgets/pull/7",
    prNumber: 7,
  });
  mockMarkFailed.mockResolvedValue(undefined);
});

describe("code-change webhook — auth", () => {
  it("400s without a token", async () => {
    const res = await post(null, { request_id: REQUEST_ID, status: "completed" });
    expect(res.status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("400s on a malformed token", async () => {
    const res = await post("not-a-jwt", {
      request_id: REQUEST_ID,
      status: "completed",
    });
    expect(res.status).toBe(400);
  });

  it("404s when the claim task is gone (already resolved and deleted)", async () => {
    vi.mocked(db.task.findUnique).mockResolvedValue(null as never);
    const token = await createCodeChangeWebhookToken(TASK_ID, SECRET);
    const res = await post(token, { request_id: REQUEST_ID, status: "completed" });
    expect(res.status).toBe(404);
  });

  it("401s when the token was signed with a different secret", async () => {
    const token = await createCodeChangeWebhookToken(TASK_ID, "b".repeat(64));
    const res = await post(token, { request_id: REQUEST_ID, status: "completed" });
    expect(res.status).toBe(401);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("code-change webhook — payload binding", () => {
  it("drops a delivery whose request_id doesn't match the dispatch receipt", async () => {
    const token = await createCodeChangeWebhookToken(TASK_ID, SECRET);
    const res = await post(token, {
      request_id: "some-other-request",
      status: "completed",
      result: { pr: { ok: true } },
    });
    expect(res.status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("409s when the task has no parseable dispatch receipt", async () => {
    vi.mocked(db.task.findUnique).mockResolvedValue(
      taskRow({ codeChangeClaim: { half: "written" } }) as never,
    );
    const token = await createCodeChangeWebhookToken(TASK_ID, SECRET);
    const res = await post(token, { request_id: REQUEST_ID, status: "completed" });
    expect(res.status).toBe(409);
  });
});

describe("code-change webhook — status routing", () => {
  it("routes completed deliveries into the shared completion path", async () => {
    const token = await createCodeChangeWebhookToken(TASK_ID, SECRET);
    const rawResult = { pr: { ok: true, url: "x" }, tool_use: ["create_pr"] };
    const res = await post(token, {
      request_id: REQUEST_ID,
      status: "completed",
      result: rawResult,
    });
    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledWith({
      taskId: TASK_ID,
      claim: expect.objectContaining({
        requestId: REQUEST_ID,
        prBranch: CLAIM.prBranch,
        conversationId: CLAIM.conversationId,
        proposalId: CLAIM.proposalId,
      }),
      rawResult,
    });
  });

  it("marks the claim failed (kept, not deleted) on status failed", async () => {
    const token = await createCodeChangeWebhookToken(TASK_ID, SECRET);
    const res = await post(token, {
      request_id: REQUEST_ID,
      status: "failed",
      error: "container restarted",
      retryable: true,
    });
    expect(res.status).toBe(200);
    expect(mockMarkFailed).toHaveBeenCalledWith({
      taskId: TASK_ID,
      claim: expect.objectContaining({ requestId: REQUEST_ID }),
      retryable: true,
    });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("400s on an unknown status", async () => {
    const token = await createCodeChangeWebhookToken(TASK_ID, SECRET);
    const res = await post(token, { request_id: REQUEST_ID, status: "banana" });
    expect(res.status).toBe(400);
  });

  it("500s (so the swarm retries) when completion throws", async () => {
    mockComplete.mockRejectedValue(new Error("db down"));
    const token = await createCodeChangeWebhookToken(TASK_ID, SECRET);
    const res = await post(token, {
      request_id: REQUEST_ID,
      status: "completed",
      result: {},
    });
    expect(res.status).toBe(500);
  });
});
