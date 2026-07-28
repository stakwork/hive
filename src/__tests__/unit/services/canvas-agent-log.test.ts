import { describe, test, expect, vi, beforeEach } from "vitest";

const { put } = vi.hoisted(() => ({ put: vi.fn() }));

vi.mock("@vercel/blob", () => ({ put }));

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: { findUnique: vi.fn() },
    agentLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import {
  transcriptFromStoredMessages,
  writeCanvasAgentLog,
  CANVAS_AGENT_NAME,
} from "@/services/canvas-agent-log";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

const findUnique = db.sharedConversation.findUnique as ReturnType<typeof vi.fn>;
const findFirst = db.agentLog.findFirst as ReturnType<typeof vi.fn>;
const create = db.agentLog.create as ReturnType<typeof vi.fn>;
const update = db.agentLog.update as ReturnType<typeof vi.fn>;

const CONVERSATION: StoredMessage[] = [
  { id: "t1-u", role: "user", content: "Why is CI failing?" },
  {
    id: "t1-a0",
    role: "assistant",
    content: "Let me look.",
    timestamp: "2026-07-28T10:00:00.000Z",
    usage: {
      inputTokens: 3411,
      outputTokens: 102,
      cacheReadTokens: 0,
      cacheWriteTokens: 3408,
    },
  },
  {
    id: "t1-a1",
    role: "assistant",
    content: "",
    timestamp: "2026-07-28T10:00:00.000Z",
    toolCalls: [
      {
        id: "tc1",
        toolName: "repo_agent",
        input: { prompt: "check CI" },
        output: { answer: "a flaky test" },
        status: "output-available",
      },
      {
        id: "tc2",
        toolName: "learn_concept",
        input: { id: "c1" },
        output: { concept: "CI" },
        status: "output-available",
      },
    ],
  },
  {
    id: "t1-a2",
    role: "assistant",
    content: "A flaky test is failing.",
    timestamp: "2026-07-28T10:00:05.000Z",
    usage: {
      inputTokens: 3594,
      outputTokens: 59,
      cacheReadTokens: 3408,
      cacheWriteTokens: 179,
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue({ url: "https://blob.example/canvas.json" });
});

describe("transcriptFromStoredMessages", () => {
  test("turns stored toolCalls into tool-call content parts the parser counts", () => {
    const transcript = transcriptFromStoredMessages(CONVERSATION);
    const toolRow = transcript[2];

    expect(Array.isArray(toolRow.content)).toBe(true);
    const parts = toolRow.content as Array<{ type: string; toolName?: string }>;
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.type)).toEqual(["tool-call", "tool-call"]);
    expect(parts.map((p) => p.toolName)).toEqual(["repo_agent", "learn_concept"]);
  });

  test("preserves per-message timestamps and usage", () => {
    const transcript = transcriptFromStoredMessages(CONVERSATION);
    expect(transcript[1].timestamp).toBe("2026-07-28T10:00:00.000Z");
    expect(transcript[3].timestamp).toBe("2026-07-28T10:00:05.000Z");
    expect(transcript[1].usage).toEqual({
      inputTokens: 3411,
      outputTokens: 102,
      cacheReadTokens: 0,
      cacheWriteTokens: 3408,
    });
  });

  test("round-trips through parseAgentLogStats into real stats", () => {
    const blob = JSON.stringify({
      sessionId: "conv-1",
      messages: transcriptFromStoredMessages(CONVERSATION),
    });

    const { stats } = parseAgentLogStats(blob);

    expect(stats.totalMessages).toBe(4);
    expect(stats.totalToolCalls).toBe(2);
    expect(stats.toolFrequency).toEqual({ repo_agent: 1, learn_concept: 1 });
    // Per-message usage accumulates into the session totals the UI shows.
    expect(stats.actualInputTokens).toBe(7005);
    expect(stats.actualOutputTokens).toBe(161);
    expect(stats.actualCacheReadTokens).toBe(3408);
    expect(stats.actualCacheWriteTokens).toBe(3587);
    expect(stats.estimatedTokens).toBeGreaterThan(0);
  });
});

describe("writeCanvasAgentLog", () => {
  const args = {
    workspaceId: "ws-1",
    conversationId: "conv-1",
    model: "claude-sonnet-5",
    provider: "anthropic",
    startedAt: new Date("2026-07-28T10:00:00.000Z"),
    completedAt: new Date("2026-07-28T10:00:06.000Z"),
  };

  test("creates a row with the transcript, stats and timing on first turn", async () => {
    findUnique.mockResolvedValue({ messages: CONVERSATION });
    findFirst.mockResolvedValue(null);

    await writeCanvasAgentLog(args);

    expect(put).toHaveBeenCalledTimes(1);
    const [blobPath, blobBody] = put.mock.calls[0];
    expect(blobPath).toBe(`agent-logs/ws-1/conv-1/${CANVAS_AGENT_NAME}.json`);

    // The blob is the real transcript, not an empty array.
    const parsed = JSON.parse(blobBody as string);
    expect(parsed.sessionId).toBe("conv-1");
    expect(parsed.messages).toHaveLength(4);
    expect(parsed.config).toMatchObject({
      model: "claude-sonnet-5",
      provider: "anthropic",
      source: "canvas_chat",
    });

    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const row = create.mock.calls[0][0].data;
    expect(row).toMatchObject({
      agent: CANVAS_AGENT_NAME,
      workspaceId: "ws-1",
      sessionId: "conv-1",
      provider: "anthropic",
      source: "canvas_chat",
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      blobUrl: "https://blob.example/canvas.json",
    });
    expect(row.stats).toMatchObject({
      totalToolCalls: 2,
      actualInputTokens: 7005,
      actualCacheReadTokens: 3408,
    });
  });

  test("updates the existing row on later turns instead of adding another", async () => {
    findUnique.mockResolvedValue({ messages: CONVERSATION });
    findFirst.mockResolvedValue({ id: "log-1" });

    await writeCanvasAgentLog(args);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: "log-1" } });
    // startedAt belongs to the run, so it is not rewritten each turn.
    expect(update.mock.calls[0][0].data.startedAt).toBeUndefined();
    expect(update.mock.calls[0][0].data.completedAt).toBe(args.completedAt);
  });

  test("keys the lookup on agent + workspace + conversation", async () => {
    findUnique.mockResolvedValue({ messages: CONVERSATION });
    findFirst.mockResolvedValue(null);

    await writeCanvasAgentLog(args);

    expect(findFirst.mock.calls[0][0].where).toEqual({
      agent: CANVAS_AGENT_NAME,
      workspaceId: "ws-1",
      sessionId: "conv-1",
    });
  });

  test("writes nothing for a conversation with no messages", async () => {
    findUnique.mockResolvedValue({ messages: [] });

    await writeCanvasAgentLog(args);

    expect(put).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("swallows a blob failure so the finished stream is unaffected", async () => {
    findUnique.mockResolvedValue({ messages: CONVERSATION });
    put.mockRejectedValue(new Error("blob down"));

    await expect(writeCanvasAgentLog(args)).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
