import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockCreateTicket, mockDbFeature, mockDbWorkspace, mockDbRepository } =
  vi.hoisted(() => ({
    mockCreateTicket: vi.fn(),
    mockDbFeature: { findUnique: vi.fn() },
    mockDbWorkspace: { findUnique: vi.fn() },
    mockDbRepository: { findFirst: vi.fn() },
  }));

vi.mock("@/lib/db", () => ({
  db: {
    feature: mockDbFeature,
    workspace: mockDbWorkspace,
    repository: mockDbRepository,
  },
}));

vi.mock("@/services/roadmap/tickets", () => ({
  createTicket: mockCreateTicket,
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { mcpCreateFeatureTask } from "@/lib/mcp/mcpTools";

const AUTH = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "ws",
};

const BASE_TASK = {
  id: "task-1",
  title: "Test Coding Task",
  status: "TODO",
  priority: "MEDIUM",
  featureId: "feature-1",
  phaseId: null,
  repository: { id: "repo-1" },
};

describe("mcpCreateFeatureTask — creator attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Feature owned by its creator, distinct from the workspace owner.
    mockDbFeature.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      createdById: "feature-creator-1",
    });
    mockDbRepository.findFirst.mockResolvedValue({ id: "repo-1" });
    mockCreateTicket.mockResolvedValue(BASE_TASK);
    mockDbWorkspace.findUnique.mockResolvedValue({
      ownerId: "owner-1",
      owner: { id: "owner-1", name: "Tom Smith", sphinxAlias: null },
      members: [
        { user: { id: "evan-1", name: "Evan Feenstra", sphinxAlias: "Evanfeenstra" } },
      ],
    });
  });

  it("defaults to the FEATURE CREATOR (not the workspace owner) when no creator hint is given", async () => {
    await mcpCreateFeatureTask(
      AUTH,
      "feature-1",
      { title: "No hint" },
      { repositoryId: "repo-1" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "feature-creator-1",
      expect.anything(),
    );
  });

  it("uses an explicit creator hint when it matches a workspace member (by alias)", async () => {
    await mcpCreateFeatureTask(
      AUTH,
      "feature-1",
      { title: "With hint" },
      { repositoryId: "repo-1" },
      "evanfeenstra",
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

    await mcpCreateFeatureTask(
      AUTH,
      "feature-1",
      { title: "Orphan feature" },
      { repositoryId: "repo-1" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "owner-1",
      expect.anything(),
    );
  });

  it("returns error when feature not found (no attribution attempted)", async () => {
    mockDbFeature.findUnique.mockResolvedValue(null);

    const result = await mcpCreateFeatureTask(
      AUTH,
      "nonexistent",
      { title: "Task" },
      { repositoryId: "repo-1" },
    );

    expect(result.isError).toBe(true);
    expect(mockCreateTicket).not.toHaveBeenCalled();
  });
});

describe("mcpCreateFeatureTask — dependsOnTaskIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFeature.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      createdById: "feature-creator-1",
    });
    mockDbRepository.findFirst.mockResolvedValue({ id: "repo-1" });
    mockDbWorkspace.findUnique.mockResolvedValue({
      ownerId: "owner-1",
      owner: { id: "owner-1", name: "Tom Smith", sphinxAlias: null },
      members: [],
    });
  });

  it("forwards non-empty dependsOnTaskIds to createTicket", async () => {
    mockCreateTicket.mockResolvedValue({ ...BASE_TASK, dependsOnTaskIds: ["task-a"] });

    const result = await mcpCreateFeatureTask(
      AUTH,
      "feature-1",
      { title: "Dependent task", dependsOnTaskIds: ["task-a"] },
      { repositoryId: "repo-1" },
    );

    expect(result.isError).toBeFalsy();
    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "feature-creator-1",
      expect.objectContaining({ dependsOnTaskIds: ["task-a"] }),
    );
  });

  it("forwards empty dependsOnTaskIds array to createTicket", async () => {
    mockCreateTicket.mockResolvedValue({ ...BASE_TASK, dependsOnTaskIds: [] });

    await mcpCreateFeatureTask(
      AUTH,
      "feature-1",
      { title: "No deps", dependsOnTaskIds: [] },
      { repositoryId: "repo-1" },
    );

    expect(mockCreateTicket).toHaveBeenCalledWith(
      "feature-1",
      "feature-creator-1",
      expect.objectContaining({ dependsOnTaskIds: [] }),
    );
  });

  it("passes undefined dependsOnTaskIds when not provided", async () => {
    mockCreateTicket.mockResolvedValue(BASE_TASK);

    await mcpCreateFeatureTask(
      AUTH,
      "feature-1",
      { title: "No deps field" },
      { repositoryId: "repo-1" },
    );

    const call = mockCreateTicket.mock.calls[0][2];
    expect(call.dependsOnTaskIds).toBeUndefined();
  });
});
