import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCommitMessage } from "@/lib/ai/commit-msg";

// Mock the AI provider and generateObject
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai/provider", () => ({
  getApiKeyForProvider: vi.fn(() => "test-api-key"),
  getModel: vi.fn(() => "mock-model"),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
    },
    artifact: {
      findFirst: vi.fn(),
    },
  },
}));

describe("generateCommitMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes branchPrefix instruction in prompt when branchPrefix is provided", async () => {
    const { db } = await import("@/lib/db");
    const { generateObject } = await import("ai");

    vi.mocked(db.task.findUnique).mockResolvedValue({
      workspace: { slug: "test-workspace" },
    } as any);

    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);

    vi.mocked(db.chatMessage.findMany).mockResolvedValue([
      { role: "USER", message: "Build a dashboard filter UI", timestamp: new Date() },
      { role: "ASSISTANT", message: "I'll create the filter component", timestamp: new Date() },
    ] as any);

    vi.mocked(generateObject).mockResolvedValue({
      object: {
        commit_message: "feat: add dashboard filter UI",
        branch_name: "prototype/dashboard-filter-ui",
      },
    } as any);

    await generateCommitMessage("task-123", "http://localhost:3000", undefined, "prototype");

    const callArgs = vi.mocked(generateObject).mock.calls[0][0];
    expect(callArgs.prompt).toContain("Prefix the branch name with 'prototype/'");
    expect(callArgs.prompt).toContain("e.g. prototype/dashboard-filter-ui");
  });

  it("does NOT include branchPrefix instruction when branchPrefix is omitted", async () => {
    const { db } = await import("@/lib/db");
    const { generateObject } = await import("ai");

    vi.mocked(db.task.findUnique).mockResolvedValue({
      workspace: { slug: "test-workspace" },
    } as any);

    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);

    vi.mocked(db.chatMessage.findMany).mockResolvedValue([
      { role: "USER", message: "Fix the auth bug", timestamp: new Date() },
      { role: "ASSISTANT", message: "I'll fix the authentication issue", timestamp: new Date() },
    ] as any);

    vi.mocked(generateObject).mockResolvedValue({
      object: {
        commit_message: "fix: resolve auth bug",
        branch_name: "fix/auth-bug",
      },
    } as any);

    await generateCommitMessage("task-456", "http://localhost:3000");

    const callArgs = vi.mocked(generateObject).mock.calls[0][0];
    expect(callArgs.prompt).not.toContain("Prefix the branch name with");
  });

  it("returns commit_message and branch_name from AI response", async () => {
    const { db } = await import("@/lib/db");
    const { generateObject } = await import("ai");

    vi.mocked(db.task.findUnique).mockResolvedValue({
      workspace: { slug: "test-workspace" },
    } as any);

    vi.mocked(db.artifact.findFirst).mockResolvedValue(null);

    vi.mocked(db.chatMessage.findMany).mockResolvedValue([
      { role: "USER", message: "Add login form", timestamp: new Date() },
    ] as any);

    vi.mocked(generateObject).mockResolvedValue({
      object: {
        commit_message: "feat: add login form",
        branch_name: "prototype/login-form",
      },
    } as any);

    const result = await generateCommitMessage("task-789", undefined, undefined, "prototype");

    expect(result.branch_name).toBe("prototype/login-form");
    expect(result.commit_message).toContain("feat: add login form");
  });
});
