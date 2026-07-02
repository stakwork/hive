/**
 * Unit tests for runGraphWalkSubAgent.
 *
 * Coverage:
 *   - Advisory lock not acquired → returns immediately without touching runCanvasAgent.
 *   - Auth guard: conversation not found → aborts.
 *   - Auth guard: orgId mismatch → aborts.
 *   - Auth guard: userId mismatch → aborts.
 *   - Idempotency: fan-out row already exists → skips.
 *   - Happy path: lock acquired, valid conversation, no prior row → calls runCanvasAgent
 *     with readonly + keepWriteToolNames + extraStopConditions + graphWalkAnswerSink.
 *   - Happy path: answer written → fans out "ready".
 *   - No answer written → fans out "failed".
 *   - runCanvasAgent throws → still fans out "failed" (non-fatal).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: {
      findUnique: vi.fn(),
      upsert: vi.fn(async () => ({})),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/ai/runCanvasAgent", () => ({
  runCanvasAgent: vi.fn(),
}));

vi.mock("@/services/canvas-graph-walk-fanout", () => ({
  fanOutGraphWalkToCanvas: vi.fn(async () => {}),
}));

import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { fanOutGraphWalkToCanvas } from "@/services/canvas-graph-walk-fanout";
import {
  runGraphWalkSubAgent,
  type GraphWalkSubAgentArgs,
} from "@/services/canvas-graph-walk-worker";

const BASE_ARGS: GraphWalkSubAgentArgs = {
  graphWalkId: "walk-abc-123",
  title: "Find Files linked to AuthFeature",
  prompt: "Search for all File nodes connected to the AuthFeature HiveFeature node.",
  conversationId: "conv-1",
  orgId: "org-1",
  userId: "user-1",
  workspaceSlugs: ["ws-1"],
};

const VALID_CONVERSATION = {
  userId: "user-1",
  sourceControlOrgId: "org-1",
  messages: [], // no prior fan-out rows
};

// Helper: make a runCanvasAgent mock that populates the graphWalkAnswerSink
function mockAgentWithAnswer(answer: string) {
  (runCanvasAgent as ReturnType<typeof vi.fn>).mockImplementation(
    async (opts: { graphWalkAnswerSink?: { answer: string | null } }) => {
      if (opts.graphWalkAnswerSink) {
        opts.graphWalkAnswerSink.answer = answer;
      }
      return {
        result: {
          text: Promise.resolve("done"),
          steps: Promise.resolve([]),
        },
      };
    },
  );
}

function mockAgentWithNoAnswer() {
  (runCanvasAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
    result: {
      text: Promise.resolve("done"),
      steps: Promise.resolve([]),
    },
  });
}

describe("runGraphWalkSubAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: lock acquired
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ locked: true }]);
    // Default: valid conversation with no prior fan-out rows
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      VALID_CONVERSATION,
    );
    // Default: trace-conversation upsert succeeds
    (db.sharedConversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // Default: agent writes an answer
    mockAgentWithAnswer("The answer is 42.");
  });

  // ─── Advisory lock ─────────────────────────────────────────────────

  test("advisory lock not acquired → skips without calling runCanvasAgent", async () => {
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ locked: false }]);
    await runGraphWalkSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutGraphWalkToCanvas).not.toHaveBeenCalled();
  });

  // ─── Auth guard ────────────────────────────────────────────────────

  test("conversation not found → aborts without calling runCanvasAgent", async () => {
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await runGraphWalkSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutGraphWalkToCanvas).not.toHaveBeenCalled();
  });

  test("auth guard: orgId mismatch → aborts", async () => {
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      sourceControlOrgId: "other-org",
      messages: [],
    });
    await runGraphWalkSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutGraphWalkToCanvas).not.toHaveBeenCalled();
  });

  test("auth guard: userId mismatch → aborts", async () => {
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "other-user",
      sourceControlOrgId: "org-1",
      messages: [],
    });
    await runGraphWalkSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutGraphWalkToCanvas).not.toHaveBeenCalled();
  });

  // ─── Idempotency ───────────────────────────────────────────────────

  test("idempotency: fan-out row already exists → skips without calling runCanvasAgent", async () => {
    (db.sharedConversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      sourceControlOrgId: "org-1",
      messages: [
        {
          id: `graph-walk-${BASE_ARGS.graphWalkId}`,
          role: "assistant",
          content: "Already answered",
          source: { kind: "graph_walk", graphWalkId: BASE_ARGS.graphWalkId },
        },
      ],
    });
    await runGraphWalkSubAgent(BASE_ARGS);
    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(fanOutGraphWalkToCanvas).not.toHaveBeenCalled();
  });

  // ─── Happy path ────────────────────────────────────────────────────

  test("happy path: calls runCanvasAgent with correct readonly options", async () => {
    await runGraphWalkSubAgent(BASE_ARGS);

    expect(runCanvasAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BASE_ARGS.userId,
        orgId: BASE_ARGS.orgId,
        workspaceSlugs: BASE_ARGS.workspaceSlugs,
        readonly: true,
        keepWriteToolNames: ["finalize_graph_walk"],
        silentPusher: true,
        currentCanvasConversationId: BASE_ARGS.conversationId,
        capabilities: ["graph_walker"],
      }),
    );
  });

  test("happy path: passes graphWalkAnswerSink to runCanvasAgent", async () => {
    await runGraphWalkSubAgent(BASE_ARGS);

    const callArgs = (runCanvasAgent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.graphWalkAnswerSink).toBeDefined();
    expect(callArgs.graphWalkAnswerSink).toHaveProperty("answer");
  });

  test("happy path: passes extraStopConditions to runCanvasAgent", async () => {
    await runGraphWalkSubAgent(BASE_ARGS);

    const callArgs = (runCanvasAgent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.extraStopConditions).toBeDefined();
  });

  test("happy path: passes prepareStep budget hook to runCanvasAgent", async () => {
    await runGraphWalkSubAgent(BASE_ARGS);

    const callArgs = (runCanvasAgent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof callArgs.prepareStep).toBe("function");
  });

  test("happy path: fans out 'ready' when agent writes an answer", async () => {
    mockAgentWithAnswer("Found 3 File nodes.");
    await runGraphWalkSubAgent(BASE_ARGS);

    expect(fanOutGraphWalkToCanvas).toHaveBeenCalledWith(
      BASE_ARGS.conversationId,
      expect.objectContaining({
        graphWalkId: BASE_ARGS.graphWalkId,
        title: BASE_ARGS.title,
        answer: "Found 3 File nodes.",
        status: "ready",
      }),
    );
  });

  // ─── Trace persistence ─────────────────────────────────────────────

  test("persists the tool-call trace to a standalone graph-walk conversation", async () => {
    await runGraphWalkSubAgent(BASE_ARGS);

    expect(db.sharedConversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: `gw-conv-${BASE_ARGS.graphWalkId}` },
        create: expect.objectContaining({
          id: `gw-conv-${BASE_ARGS.graphWalkId}`,
          source: "graph-walk",
          sourceControlOrgId: BASE_ARGS.orgId,
          userId: BASE_ARGS.userId,
          title: BASE_ARGS.title,
        }),
      }),
    );
  });

  test("passes detailConversationId backlink to fan-out on success", async () => {
    await runGraphWalkSubAgent(BASE_ARGS);

    expect(fanOutGraphWalkToCanvas).toHaveBeenCalledWith(
      BASE_ARGS.conversationId,
      expect.objectContaining({
        detailConversationId: `gw-conv-${BASE_ARGS.graphWalkId}`,
      }),
    );
  });

  test("trace persist failure is non-fatal → still fans out without backlink", async () => {
    (db.sharedConversation.upsert as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    );
    await runGraphWalkSubAgent(BASE_ARGS);

    const payload = (fanOutGraphWalkToCanvas as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(payload.status).toBe("ready");
    expect(payload.detailConversationId).toBeUndefined();
  });

  // ─── Failure paths ─────────────────────────────────────────────────

  test("no answer written → fans out 'failed'", async () => {
    mockAgentWithNoAnswer();
    await runGraphWalkSubAgent(BASE_ARGS);

    expect(fanOutGraphWalkToCanvas).toHaveBeenCalledWith(
      BASE_ARGS.conversationId,
      expect.objectContaining({
        graphWalkId: BASE_ARGS.graphWalkId,
        status: "failed",
      }),
    );
  });

  test("non-fatal: runCanvasAgent throws → still fans out 'failed'", async () => {
    (runCanvasAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM error"));
    await runGraphWalkSubAgent(BASE_ARGS);

    expect(fanOutGraphWalkToCanvas).toHaveBeenCalledWith(
      BASE_ARGS.conversationId,
      expect.objectContaining({ status: "failed" }),
    );
  });

  test("non-fatal: does not throw even when runCanvasAgent throws", async () => {
    (runCanvasAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    await expect(runGraphWalkSubAgent(BASE_ARGS)).resolves.toBeUndefined();
  });
});
