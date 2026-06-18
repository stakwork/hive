import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST as promptEvalResult } from "@/app/api/webhook/prompt-eval/result/route";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/factories";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";
import { db } from "@/lib/db";
import * as pusherLib from "@/lib/pusher";

// Mock Pusher to avoid real network calls
vi.mock("@/lib/pusher", async (importOriginal) => {
  const actual = await importOriginal<typeof pusherLib>();
  return {
    ...actual,
    pusherServer: {
      trigger: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("POST /api/webhook/prompt-eval/result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function createPromptEvalRun(workspaceId: string, promptVersionId = 42) {
    return db.stakworkRun.create({
      data: {
        type: "PROMPT_EVAL",
        workspaceId,
        promptVersionId,
        evalSetId: "eval-set-abc",
        status: "IN_PROGRESS",
        webhookUrl: "https://example.com/webhook",
      },
    });
  }

  test("returns 400 when run_id query param is missing", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/webhook/prompt-eval/result",
      { pass: 8, fail: 2, total: 10 },
    );

    const response = await promptEvalResult(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("run_id");
  });

  test("returns 404 when run is not found", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/webhook/prompt-eval/result?run_id=nonexistent-run-id",
      { pass: 8, fail: 2, total: 10 },
    );

    const response = await promptEvalResult(request);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("not found");
  });

  test("returns 400 when run type is not PROMPT_EVAL", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    // Create a non-PROMPT_EVAL run
    const run = await db.stakworkRun.create({
      data: {
        type: "TASK_GENERATION",
        workspaceId: workspace.id,
        status: "IN_PROGRESS",
        webhookUrl: "https://example.com/webhook",
      },
    });

    const request = createPostRequest(
      `http://localhost:3000/api/webhook/prompt-eval/result?run_id=${run.id}`,
      { pass: 8, fail: 2, total: 10 },
    );

    const response = await promptEvalResult(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("PROMPT_EVAL");
  });

  test("returns 400 when body fields are not numbers", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const run = await createPromptEvalRun(workspace.id);

    const request = createPostRequest(
      `http://localhost:3000/api/webhook/prompt-eval/result?run_id=${run.id}`,
      { pass: "eight", fail: 2, total: 10 },
    );

    const response = await promptEvalResult(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("pass, fail, and total");
  });

  test("updates StakworkRun result and status correctly", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const run = await createPromptEvalRun(workspace.id);

    const request = createPostRequest(
      `http://localhost:3000/api/webhook/prompt-eval/result?run_id=${run.id}`,
      { pass: 8, fail: 2, total: 10 },
    );

    const response = await promptEvalResult(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    // Verify DB was updated
    const updated = await db.stakworkRun.findUnique({ where: { id: run.id } });
    expect(updated?.status).toBe("COMPLETED");
    expect(updated?.result).toBe(JSON.stringify({ pass: 8, fail: 2, total: 10 }));
  });

  test("triggers Pusher PROMPT_EVAL_RESULT event with correct payload", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const run = await createPromptEvalRun(workspace.id, 55);

    const request = createPostRequest(
      `http://localhost:3000/api/webhook/prompt-eval/result?run_id=${run.id}`,
      { pass: 7, fail: 3, total: 10 },
    );

    const response = await promptEvalResult(request);
    expect(response.status).toBe(200);

    const { pusherServer } = await import("@/lib/pusher");
    expect(pusherServer.trigger).toHaveBeenCalledWith(
      `workspace-${workspace.slug}`,
      "prompt-eval-result",
      {
        runId: run.id,
        promptVersionId: 55,
        result: { pass: 7, fail: 3, total: 10 },
      },
    );
  });
});
