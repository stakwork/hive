import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockCreateTicket, mockDbFeature, mockDbWorkspace } = vi.hoisted(() => ({
  mockCreateTicket: vi.fn(),
  mockDbFeature: { findUnique: vi.fn() },
  mockDbWorkspace: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: { feature: mockDbFeature, workspace: mockDbWorkspace },
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
    // Feature is owned by its creator, distinct from the workspace owner.
    mockDbFeature.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      createdById: "feature-creator-1",
    });
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
      "feature-creator-1",
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
      "feature-creator-1",
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

describe("mcpCreateWorkflowTask — creator attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFeature.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      createdById: "feature-creator-1",
    });
    mockCreateTicket.mockResolvedValue(BASE_TASK);
    // Workspace lookup used by findWorkspaceUser (hint match) and the
    // owner last-resort fallback.
    mockDbWorkspace.findUnique.mockResolvedValue({
      ownerId: "owner-1",
      owner: { id: "owner-1", name: "Tom Smith", sphinxAlias: null },
      members: [
        { user: { id: "evan-1", name: "Evan Feenstra", sphinxAlias: "Evanfeenstra" } },
      ],
    });
  });

  it("defaults to the FEATURE CREATOR (not the workspace owner) when no creator hint is given", async () => {
    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "No hint" },
      { workflowTaskType: "SKILL" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "feature-creator-1",
      expect.anything(),
    );
  });

  it("uses an explicit creator hint when it matches a workspace member", async () => {
    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "With hint" },
      { workflowTaskType: "SKILL" },
      "Evan Feenstra",
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "evan-1",
      expect.anything(),
    );
  });

  it("falls back to the workspace owner only when there is no hint AND no feature creator", async () => {
    mockDbFeature.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      createdById: null,
    });

    await mcpCreateWorkflowTask(
      AUTH,
      "feature-1",
      { title: "Orphan feature" },
      { workflowTaskType: "SKILL" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "owner-1",
      expect.anything(),
    );
  });
});
