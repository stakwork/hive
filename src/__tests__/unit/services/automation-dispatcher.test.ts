/**
 * Unit tests for `dispatchDueAutomations` — a due automation opens a fresh
 * org-canvas conversation and launches ONE turn of strut's orchestrator on
 * it (Jamie's engine, docs/jamie-engine.md), as the automation's owner,
 * with their model pick and the automation's zone. A refused launch is
 * written into the conversation as the reply and counted as failed; the
 * conversation is recorded for auto-open either way.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockLaunch, mockModel, mockAppend } = vi.hoisted(() => ({
  mockDb: {
    automation: { findMany: vi.fn(), update: vi.fn() },
    sourceControlOrg: { findUnique: vi.fn() },
    workspace: { findMany: vi.fn() },
    sharedConversation: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  mockLaunch: vi.fn(),
  mockModel: vi.fn(),
  mockAppend: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/services/strut-orchestrator", () => ({ launchOrchestratorTurn: mockLaunch }));
vi.mock("@/lib/ai/resolve-model", () => ({ loadUserChatAgentModel: mockModel }));
vi.mock("@/services/canvas-turn-persistence", () => ({ appendTurnMessages: mockAppend }));

import { dispatchDueAutomations } from "@/services/automation-dispatcher";

const automation = {
  id: "auto-1",
  name: "Morning brief",
  prompt: "Summarize yesterday's merged PRs",
  sourceControlOrgId: "org-1",
  userId: "user-1",
  enabled: true,
  timeOfDay: "09:00",
  timezone: "Europe/London",
  nextRunAt: new Date(Date.now() - 60_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.automation.findMany.mockResolvedValue([automation]);
  mockDb.automation.update.mockResolvedValue({});
  mockDb.sourceControlOrg.findUnique.mockResolvedValue({ defaultWorkspaceId: "ws-1" });
  mockDb.workspace.findMany.mockResolvedValue([{ id: "ws-1", slug: "acme" }]);
  mockDb.sharedConversation.create.mockResolvedValue({ id: "conv-1" });
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      $queryRaw: vi.fn().mockResolvedValue([{ id: "auto-1", enabled: true, next_run_at: automation.nextRunAt }]),
      automation: { update: vi.fn().mockResolvedValue({}) },
    }),
  );
  mockLaunch.mockResolvedValue({ status: "started", runId: "orch-row-1", strutRunId: "1790000000001" });
  mockModel.mockResolvedValue("anthropic/claude-sonnet-5-5");
  mockAppend.mockResolvedValue(true);
});

describe("dispatchDueAutomations", () => {
  it("opens a conversation with the prompt and launches one orchestrator turn on it as the owner", async () => {
    const result = await dispatchDueAutomations();

    const created = mockDb.sharedConversation.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      sourceControlOrgId: "org-1",
      userId: "user-1",
      source: "org-canvas",
      title: "Morning brief",
    });
    expect(created.messages).toEqual([expect.objectContaining({ role: "user", content: automation.prompt })]);

    expect(mockLaunch).toHaveBeenCalledWith({
      userId: "user-1",
      orgId: "org-1",
      conversationId: "conv-1",
      message: automation.prompt,
      publicBaseUrl: expect.any(String),
      timeZone: "Europe/London",
      model: "anthropic/claude-sonnet-5-5",
    });
    // The reply lands through the strut-runs webhook, not here.
    expect(mockAppend).not.toHaveBeenCalled();
    expect(mockDb.automation.update).toHaveBeenCalledWith({
      where: { id: "auto-1" },
      data: { lastRunConversationId: "conv-1", lastRunSeenAt: null },
    });
    expect(result).toEqual({ fired: 1, failed: 0, errors: [] });
  });

  it("a refused launch is written into the conversation, still auto-opens, and counts as failed", async () => {
    mockLaunch.mockResolvedValue({ status: "error", error: "no orchestrator workflow" });

    const result = await dispatchDueAutomations();

    expect(mockAppend).toHaveBeenCalledTimes(1);
    const appended = mockAppend.mock.calls[0][0];
    expect(appended).toMatchObject({ conversationId: "conv-1", reason: "automation" });
    expect(appended.rows[0]).toMatchObject({ role: "assistant" });
    expect(appended.rows[0].content).toContain("no orchestrator workflow");
    expect(mockDb.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastRunConversationId: "conv-1", lastRunSeenAt: null } }),
    );
    expect(result.fired).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("no orchestrator workflow");
  });

  it("an automation another worker claimed launches nothing", async () => {
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: vi.fn().mockResolvedValue([]), automation: { update: vi.fn() } }),
    );
    const result = await dispatchDueAutomations();
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(result).toEqual({ fired: 0, failed: 0, errors: [] });
  });
});
