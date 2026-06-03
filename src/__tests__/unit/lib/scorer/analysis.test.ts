/**
 * Unit tests for scorer analysis.ts — analyzeSingleSession
 *
 * Verifies:
 * - customPrompt bypasses resolvePrompt when provided
 * - Falls back to workspace/default prompt when customPrompt is absent
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must use vi.hoisted() so they are available inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockGenerateText,
  mockDb,
  mockAssembleFullSession,
  mockSessionToText,
  mockResolvePrompt,
  mockGetModel,
  mockGetApiKeyForProvider,
} = vi.hoisted(() => {
  return {
    mockGenerateText: vi.fn(),
    mockDb: {
      workspace: {
        findUniqueOrThrow: vi.fn(),
      },
      scorerInsight: {
        create: vi.fn(),
      },
    },
    mockAssembleFullSession: vi.fn(),
    mockSessionToText: vi.fn(),
    mockResolvePrompt: vi.fn(),
    mockGetModel: vi.fn(),
    mockGetApiKeyForProvider: vi.fn(),
  };
});

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/scorer/session", () => ({
  assembleFullSession: mockAssembleFullSession,
  sessionToText: mockSessionToText,
}));

vi.mock("@/lib/scorer/prompts", () => ({
  resolvePrompt: mockResolvePrompt,
}));

vi.mock("@/lib/ai/provider", () => ({
  getModel: mockGetModel,
  getApiKeyForProvider: mockGetApiKeyForProvider,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { analyzeSingleSession } from "@/lib/scorer/analysis";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyzeSingleSession", () => {
  const featureId = "feature-abc";
  const workspaceId = "workspace-xyz";
  const workspacePrompt = "workspace custom prompt {session}";
  const defaultPrompt = "default prompt {session}";
  const sessionText = "session transcript";
  const fakeModel = {};
  const validInsightsJson = JSON.stringify([
    {
      severity: "HIGH",
      pattern: "Test pattern",
      description: "Test description",
      featureIds: [featureId],
      suggestion: "Test suggestion",
    },
  ]);

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.workspace.findUniqueOrThrow.mockResolvedValue({
      scorerSinglePrompt: workspacePrompt,
    });
    mockAssembleFullSession.mockResolvedValue({});
    mockSessionToText.mockReturnValue(sessionText);
    mockResolvePrompt.mockReturnValue(defaultPrompt);
    mockGetApiKeyForProvider.mockReturnValue("fake-api-key");
    mockGetModel.mockReturnValue(fakeModel);
    mockGenerateText.mockResolvedValue({ text: validInsightsJson });
    mockDb.scorerInsight.create.mockResolvedValue({});
  });

  test("uses customPrompt directly when provided — resolvePrompt is NOT called", async () => {
    const customPrompt = "my one-off prompt {session}";

    await analyzeSingleSession(featureId, workspaceId, customPrompt);

    // resolvePrompt must not be called when a customPrompt is supplied
    expect(mockResolvePrompt).not.toHaveBeenCalled();

    // The generateText call should use the customPrompt (with session interpolated)
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: customPrompt.replace("{session}", sessionText),
      })
    );
  });

  test("falls back to resolvePrompt when customPrompt is absent", async () => {
    await analyzeSingleSession(featureId, workspaceId);

    // resolvePrompt must be called with the workspace's saved prompt
    expect(mockResolvePrompt).toHaveBeenCalledWith("single", workspacePrompt);

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: defaultPrompt.replace("{session}", sessionText),
      })
    );
  });

  test("falls back to resolvePrompt when customPrompt is undefined", async () => {
    await analyzeSingleSession(featureId, workspaceId, undefined);

    expect(mockResolvePrompt).toHaveBeenCalledWith("single", workspacePrompt);
  });

  test("returns insightCount equal to saved insight records", async () => {
    const result = await analyzeSingleSession(featureId, workspaceId);
    expect(result.insightCount).toBe(1);
    expect(result.error).toBeUndefined();
  });

  test("returns error when LLM returns non-JSON output", async () => {
    mockGenerateText.mockResolvedValue({ text: "not valid json" });

    const result = await analyzeSingleSession(featureId, workspaceId);
    expect(result.insightCount).toBe(0);
    expect(result.error).toBe("Failed to parse LLM output as JSON");
  });
});
