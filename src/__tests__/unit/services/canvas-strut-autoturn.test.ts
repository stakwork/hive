/**
 * Unit tests for canvas-strut-autoturn.ts
 *
 * Coverage: the gate every wake of an org conversation runs behind —
 * master kill switch, per-message claim, an owner + org scoped
 * conversation, idempotency, and the loop breaker. There is no per-user
 * opt-in: an owner who never opted in is woken all the same.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { mockConversationFindUnique, mockClaim, mockRelease } = vi.hoisted(() => ({
  mockConversationFindUnique: vi.fn(),
  mockClaim: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { sharedConversation: { findUnique: mockConversationFindUnique } } }));
vi.mock("@/services/canvas-agent-autoturn", () => ({
  claimAutoTurn: mockClaim,
  releaseAutoTurnClaim: mockRelease,
}));

import {
  runGatedAutoTurn,
  MAX_CONSECUTIVE_STRUT_DISPATCHES,
  type AutoTurnGate,
} from "@/services/canvas-strut-autoturn";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

const userRow = (id: string): StoredMessage => ({ id, role: "user", content: "go" }) as unknown as StoredMessage;

function conversation(over: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    sourceControlOrgId: "org-1",
    messages: [userRow("u1")],
    settings: { extraWorkspaceSlugs: ["other"] },
    workspace: { slug: "home" },
    ...over,
  };
}

describe("runGatedAutoTurn", () => {
  const gate = (over: Partial<AutoTurnGate> = {}): AutoTurnGate => ({
    tag: "t",
    conversationId: "conv-1",
    wakeId: "job-row-1",
    about: {},
    alreadyHandled: () => false,
    trailingLaunches: () => 0,
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue(true);
    mockRelease.mockResolvedValue(undefined);
    mockConversationFindUnique.mockResolvedValue(conversation());
  });
  afterEach(() => vi.unstubAllEnvs());

  test("runs as the conversation's owner, with no opt-in to check, and releases the claim", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await runGatedAutoTurn(gate(), run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({ userId: "user-1", orgId: "org-1", workspaceSlug: "home" });
    expect(mockClaim).toHaveBeenCalledWith("conv-1", "job-row-1");
    expect(mockRelease).toHaveBeenCalledWith("conv-1", "job-row-1");
    // The owner's row is not read: an opt-in is no longer a gate.
    expect(mockConversationFindUnique.mock.calls[0][0].select).not.toHaveProperty("user");
  });

  test("a conversation that is gone, or not owner + org scoped (a workspace chat), is never woken", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    mockConversationFindUnique.mockResolvedValueOnce(null);
    await runGatedAutoTurn(gate(), run);
    mockConversationFindUnique.mockResolvedValueOnce(conversation({ sourceControlOrgId: null }));
    await runGatedAutoTurn(gate(), run);
    expect(run).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  test("the other gates hold: the kill switch, a lost claim, an already-handled wake, the loop breaker", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    vi.stubEnv("CANVAS_AUTONOMOUS_TURNS_ENABLED", "false");
    await runGatedAutoTurn(gate(), run);
    expect(mockClaim).not.toHaveBeenCalled();
    vi.unstubAllEnvs();

    mockClaim.mockResolvedValueOnce(false);
    await runGatedAutoTurn(gate(), run);
    expect(mockRelease).not.toHaveBeenCalled();

    await runGatedAutoTurn(gate({ alreadyHandled: () => true }), run);
    await runGatedAutoTurn(gate({ trailingLaunches: () => MAX_CONSECUTIVE_STRUT_DISPATCHES }), run);
    expect(run).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  test("a turn that throws is logged, never thrown, and the claim is released", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(runGatedAutoTurn(gate(), run)).resolves.toBeUndefined();
    expect(mockRelease).toHaveBeenCalledWith("conv-1", "job-row-1");
  });
});
