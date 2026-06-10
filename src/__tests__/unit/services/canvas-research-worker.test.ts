/**
 * Unit tests for runResearchSubAgent.
 *
 * Coverage:
 *   - Advisory lock not acquired → returns immediately without touching runCanvasAgent.
 *   - Content already written (idempotency) → short-circuits before runCanvasAgent.
 *   - Research row not found → returns immediately.
 *   - Auth guard mismatch (orgId or userId) → returns without running agent.
 *   - Happy path stub: lock acquired, fresh row, valid conversation → calls runCanvasAgent.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    research: { findFirst: vi.fn() },
    sharedConversation: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/ai/runCanvasAgent", () => ({
  runCanvasAgent: vi.fn(),
}));

vi.mock("@/services/canvas-research-fanout", () => ({
  fanOutResearchToCanvas: vi.fn(async () => {}),
}));

import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { fanOutResearchToCanvas } from "@/services/canvas-research-fanout";
import { runResearchSubAgent } from "@/services/canvas-research-worker";
import type { ResearchSubAgentArgs } from "@/services/canvas-research-worker";

const BASE_ARGS: ResearchSubAgentArgs = {
  researchId: "res-1",
  slug: "test-research",
  topic: "How X works",
  title: "X Deep Dive",
  summary: "A comprehensive look at X.",
  prompt: "Search for X and write a detailed doc.",
  conversationId: "conv-1",
  orgId: "org-1",
  userId: "user-1",
  workspaceSlugs: ["ws-1"],
};

const VALID_CONVERSATION = {
  userId: "user-1",
  sourceControlOrgId: "org-1",
};

describe("runResearchSubAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: advisory lock acquired
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ locked: true }]);
    // Default: research row exists but has no content yet
    (db.research.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: null,
    });
    // Default: valid conversation
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      VALID_CONVERSATION,
    );
    // Default: runCanvasAgent returns a completed result with content written
    (runCanvasAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: {
        text: Promise.resolve("done"),
        steps: Promise.resolve([]),
      },
    });
  });

  test("advisory lock not acquired → skips without calling runCanvasAgent", async () => {
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ locked: false }]);
    await runResearchSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutResearchToCanvas).not.toHaveBeenCalled();
  });

  test("content already written (idempotency) → skips without calling runCanvasAgent", async () => {
    (db.research.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "# Already written\n\nSome markdown.",
    });
    await runResearchSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutResearchToCanvas).not.toHaveBeenCalled();
  });

  test("research row not found → skips without calling runCanvasAgent", async () => {
    (db.research.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await runResearchSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutResearchToCanvas).not.toHaveBeenCalled();
  });

  test("auth guard: orgId mismatch → skips without calling runCanvasAgent", async () => {
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      sourceControlOrgId: "other-org", // mismatch
    });
    await runResearchSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutResearchToCanvas).not.toHaveBeenCalled();
  });

  test("auth guard: userId mismatch → skips without calling runCanvasAgent", async () => {
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "other-user", // mismatch
      sourceControlOrgId: "org-1",
    });
    await runResearchSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutResearchToCanvas).not.toHaveBeenCalled();
  });

  test("conversation not found → skips without calling runCanvasAgent", async () => {
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await runResearchSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutResearchToCanvas).not.toHaveBeenCalled();
  });

  test("happy path: calls runCanvasAgent with readonly + keepWriteToolNames", async () => {
    // After the agent run, the row now has content → "ready"
    (db.research.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ content: null }) // first call: idempotency check
      .mockResolvedValueOnce({ content: "# Written\n\nMarkdown." }); // second call: status check

    await runResearchSubAgent(BASE_ARGS);

    expect(runCanvasAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BASE_ARGS.userId,
        orgId: BASE_ARGS.orgId,
        workspaceSlugs: BASE_ARGS.workspaceSlugs,
        readonly: true,
        keepWriteToolNames: ["update_research"],
        silentPusher: true,
        currentCanvasConversationId: BASE_ARGS.conversationId,
      }),
    );
  });

  test("happy path: fans out 'ready' when content was written", async () => {
    (db.research.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ content: null })
      .mockResolvedValueOnce({ content: "# Done" });

    await runResearchSubAgent(BASE_ARGS);

    expect(fanOutResearchToCanvas).toHaveBeenCalledWith(
      BASE_ARGS.conversationId,
      expect.objectContaining({
        researchId: BASE_ARGS.researchId,
        slug: BASE_ARGS.slug,
        status: "ready",
      }),
    );
  });

  test("fans out 'failed' when content was not written after agent run", async () => {
    (db.research.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ content: null }) // idempotency check
      .mockResolvedValueOnce({ content: null }); // status check → still null → "failed"

    await runResearchSubAgent(BASE_ARGS);

    expect(fanOutResearchToCanvas).toHaveBeenCalledWith(
      BASE_ARGS.conversationId,
      expect.objectContaining({ status: "failed" }),
    );
  });

  test("non-fatal: runCanvasAgent throws → still fans out 'failed'", async () => {
    (runCanvasAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM error"),
    );
    await runResearchSubAgent(BASE_ARGS);
    expect(fanOutResearchToCanvas).toHaveBeenCalledWith(
      BASE_ARGS.conversationId,
      expect.objectContaining({ status: "failed" }),
    );
  });
});
