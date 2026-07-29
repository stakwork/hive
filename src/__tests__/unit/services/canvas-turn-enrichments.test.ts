/**
 * Unit tests for `emitConversationTitle`
 * (`src/services/canvas-turn-enrichments.ts`).
 *
 * The seeded title (`generateTitle`) is a raw slice of the first user
 * message. This enrichment replaces it once, after the first turn, on the
 * cheap model. Coverage:
 *   - fires on a brand-new conversation and writes the title
 *   - no-op on a continuing conversation (never re-titles)
 *   - a model failure leaves the seeded title untouched
 *   - routes through Bifrost on the caller's `agentName`
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: { sharedConversation: { update: vi.fn() } },
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn(() => "mock-model"),
  getApiKeyForProvider: vi.fn(() => "mock-key"),
}));

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(async () => undefined),
}));

vi.mock("@/lib/pusher", () => ({
  getWorkspaceChannelName: vi.fn(() => "chan"),
  pusherServer: { trigger: vi.fn() },
  PUSHER_EVENTS: { FOLLOW_UP_QUESTIONS: "follow-up", PROVENANCE_DATA: "provenance" },
}));

vi.mock("@/lib/ai/concepts", () => ({
  swarmFetch: vi.fn(async () => ({ ok: true, json: async () => ({ concepts: [] }) })),
}));

import type { ModelMessage } from "ai";
import { generateObject } from "ai";
import { db } from "@/lib/db";
import { getModel } from "@/lib/ai/provider";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { swarmFetch } from "@/lib/ai/concepts";
import { pusherServer } from "@/lib/pusher";
import {
  emitConversationTitle,
  runTurnEnrichments,
} from "@/services/canvas-turn-enrichments";

const genObject = generateObject as unknown as ReturnType<typeof vi.fn>;
const update = db.sharedConversation.update as ReturnType<typeof vi.fn>;
const model = getModel as ReturnType<typeof vi.fn>;
const bifrost = getBifrostForLLM as ReturnType<typeof vi.fn>;

const MESSAGES: ModelMessage[] = [
  {
    role: "user",
    content:
      "TypeError: Cannot read properties of undefined (reading 'slug')\n  at getWorkspace (workspace.ts:41:12)\n  at handler (route.ts:88:5)",
  },
  { role: "assistant", content: "That's a missing workspace guard in the route." },
];

function args(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv-1",
    isNewConversation: true,
    messages: MESSAGES,
    primarySlug: "acme",
    primaryWorkspaceId: "ws-1",
    primaryUserId: "user-1",
    agentName: "canvas-agent" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  genObject.mockResolvedValue({ object: { title: "Missing workspace guard in route" } });
  bifrost.mockResolvedValue(undefined);
});

describe("emitConversationTitle", () => {
  test("writes a model-written title on a brand-new conversation", async () => {
    await emitConversationTitle(args());

    expect(genObject).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { title: "Missing workspace guard in route" },
    });
  });

  test("uses the cheap model, not the turn's default", async () => {
    await emitConversationTitle(args());

    // 4th positional arg of `getModel` is the model type.
    expect(model.mock.calls[0][3]).toBe("haiku");
  });

  test("routes through Bifrost under the caller's agentName", async () => {
    await emitConversationTitle(args({ agentName: "chat-agent" }));

    expect(bifrost).toHaveBeenCalledWith(
      { workspaceId: "ws-1", workspaceSlug: "acme", userId: "user-1" },
      { agentName: "chat-agent" },
    );
  });

  test("no-op on a continuing conversation — never re-titles", async () => {
    await emitConversationTitle(args({ isNewConversation: false }));

    expect(genObject).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("no-op when there is no conversation row", async () => {
    await emitConversationTitle(args({ conversationId: null }));

    expect(genObject).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("a model failure leaves the seeded title untouched", async () => {
    genObject.mockRejectedValue(new Error("overloaded"));

    await expect(emitConversationTitle(args())).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  test("an empty title is not written", async () => {
    genObject.mockResolvedValue({ object: { title: "   " } });

    await emitConversationTitle(args());

    expect(update).not.toHaveBeenCalled();
  });

  test("a DB failure is swallowed", async () => {
    update.mockRejectedValue(new Error("db down"));

    await expect(emitConversationTitle(args())).resolves.toBeUndefined();
  });
});

/**
 * The route runs these inside `after()`, and the route tests mock
 * `next/server`'s `after` to drop the callback — so this suite is the only
 * coverage the gating has. Asserted through observable side effects rather
 * than by spying on same-module functions:
 *   title      → `db.sharedConversation.update`
 *   follow-ups → `pusherServer.trigger`
 *   provenance → `swarmFetch`
 */
describe("runTurnEnrichments", () => {
  const trigger = pusherServer.trigger as ReturnType<typeof vi.fn>;
  const swarm = swarmFetch as ReturnType<typeof vi.fn>;

  function turnArgs(overrides: Record<string, unknown> = {}) {
    return {
      skipEnrichments: false,
      conversationId: "conv-1",
      isNewConversation: true,
      messages: MESSAGES,
      conceptIds: ["concept-1"],
      primarySlug: "acme",
      primaryWorkspaceId: "ws-1",
      primaryUserId: "user-1",
      primarySwarmUrl: "https://swarm.test",
      primarySwarmApiKey: "swarm-key",
      agentName: "canvas-agent" as const,
      ...overrides,
    };
  }

  beforeEach(() => {
    genObject.mockResolvedValue({
      object: { title: "Missing workspace guard in route", questions: ["a", "b", "c"] },
    });
  });

  test("runs all three enrichments when nothing is skipped", async () => {
    await runTurnEnrichments(turnArgs());

    expect(update).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith("chan", "follow-up", expect.anything());
    expect(swarm).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the canvas sidebar — the surface titles matter most on —
   * sends `skipEnrichments: true`. Gating the title on that flag made the
   * feature dead on arrival while every direct unit test still passed.
   */
  test("still titles when skipEnrichments is set", async () => {
    await runTurnEnrichments(turnArgs({ skipEnrichments: true }));

    expect(update).toHaveBeenCalledTimes(1);
  });

  test("skips follow-ups and provenance when skipEnrichments is set", async () => {
    await runTurnEnrichments(turnArgs({ skipEnrichments: true }));

    expect(trigger).not.toHaveBeenCalled();
    expect(swarm).not.toHaveBeenCalled();
  });

  test("a title failure does not block the other enrichments", async () => {
    update.mockRejectedValue(new Error("db down"));

    await runTurnEnrichments(turnArgs());

    expect(trigger).toHaveBeenCalledWith("chan", "follow-up", expect.anything());
    expect(swarm).toHaveBeenCalledTimes(1);
  });

  test("no concepts learned means no provenance fetch", async () => {
    await runTurnEnrichments(turnArgs({ conceptIds: [] }));

    expect(swarm).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
