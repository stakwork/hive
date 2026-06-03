import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockCreateTicket, mockDbFeature } = vi.hoisted(() => ({
  mockCreateTicket: vi.fn(),
  mockDbFeature: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: { feature: mockDbFeature },
}));

vi.mock("@/services/roadmap/tickets", () => ({
  createTicket: mockCreateTicket,
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { mcpCreateWorkflowTask } from "@/lib/mcp/mcpTools";

const AUTH = {
  userId: "user-1",
  workspaceId: "ws-1",
  role: "DEVELOPER" as const,
  workspaceOwnerId: "owner-1",
};

const BASE_TASK = {
  id: "task-1",
  title: "Test Workflow",
  status: "TODO",
  priority: "MEDIUM",
  featureId: "feature-1",
  phaseId: null,
};

describe("mcpCreateWorkflowTask — workflowTaskType threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFeature.findUnique.mockResolvedValue({ workspaceId: "ws-1" });
    mockCreateTicket.mockResolvedValue(BASE_TASK);
  });

  it("passes workflowTaskType=SKILL to createTicket when provided with workflowId", async () => {
    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "Skill Task" },
      { workflowId: 10, workflowName: "my-skill", workflowTaskType: "SKILL" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "user-1",
      expect.objectContaining({ workflowTaskType: "SKILL", workflowId: 10 }),
    );
  });

  it("passes workflowTaskType=PROMPT to createTicket for new-workflow task", async () => {
    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "Prompt Task" },
      { workflowTaskType: "PROMPT" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "user-1",
      expect.objectContaining({ workflowTaskType: "PROMPT", isNewWorkflow: true }),
    );
  });

  it("passes workflowTaskType=undefined to createTicket when not specified", async () => {
    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "Untyped Task" },
      { workflowId: 99 },
    );

    const call = mockCreateTicket.mock.calls[0][2];
    expect(call.workflowTaskType).toBeUndefined();
  });

  it("passes workflowTaskType=WORKFLOW to createTicket", async () => {
    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "Sub-Workflow Task" },
      { workflowId: 55, workflowTaskType: "WORKFLOW" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "user-1",
      expect.objectContaining({ workflowTaskType: "WORKFLOW" }),
    );
  });

  it("passes workflowTaskType=SCRIPT to createTicket", async () => {
    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "Script Task" },
      { workflowId: 33, workflowTaskType: "SCRIPT" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "user-1",
      expect.objectContaining({ workflowTaskType: "SCRIPT" }),
    );
  });

  it("returns error when feature not found", async () => {
    mockDbFeature.findUnique.mockResolvedValue(null);

    const result = await mcpCreateWorkflowTask(
      AUTH,
      "nonexistent",
      { title: "Task" },
      { workflowTaskType: "SKILL" },
    );

    expect(result.isError).toBe(true);
    expect(mockCreateTicket).not.toHaveBeenCalled();
  });
});
