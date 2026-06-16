import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockDbTask } = vi.hoisted(() => ({
  mockDbTask: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: { task: mockDbTask },
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { mcpUpdateTask } from "@/lib/mcp/mcpTools";

const AUTH = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "ws",
};

const BASE_UPDATED = {
  id: "task-1",
  title: "Updated Title",
  description: null,
  status: "TODO",
  priority: "MEDIUM",
  featureId: "feature-1",
  dependsOnTaskIds: [],
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

describe("mcpUpdateTask — dependsOnTaskIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTask.findUnique.mockResolvedValue({ workspaceId: "ws-1" });
    mockDbTask.update.mockResolvedValue(BASE_UPDATED);
    // Default: all dependency IDs resolve within the workspace.
    mockDbTask.count.mockResolvedValue(2);
  });

  it("sets dependsOnTaskIds to the provided array", async () => {
    mockDbTask.update.mockResolvedValue({
      ...BASE_UPDATED,
      dependsOnTaskIds: ["id-a", "id-b"],
    });

    const result = await mcpUpdateTask(AUTH, "task-1", {
      dependsOnTaskIds: ["id-a", "id-b"],
    });

    expect(result.isError).toBeFalsy();
    expect(mockDbTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dependsOnTaskIds: ["id-a", "id-b"] }),
      }),
    );
  });

  it("clears dependsOnTaskIds when passed an empty array (skips count check)", async () => {
    mockDbTask.update.mockResolvedValue({
      ...BASE_UPDATED,
      dependsOnTaskIds: [],
    });

    const result = await mcpUpdateTask(AUTH, "task-1", {
      dependsOnTaskIds: [],
    });

    expect(result.isError).toBeFalsy();
    expect(mockDbTask.count).not.toHaveBeenCalled();
    expect(mockDbTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dependsOnTaskIds: [] }),
      }),
    );
  });

  it("includes dependsOnTaskIds in the returned payload", async () => {
    mockDbTask.count.mockResolvedValue(1);
    mockDbTask.update.mockResolvedValue({
      ...BASE_UPDATED,
      dependsOnTaskIds: ["id-a"],
    });

    const result = await mcpUpdateTask(AUTH, "task-1", {
      dependsOnTaskIds: ["id-a"],
    });

    expect(result.isError).toBeFalsy();
    const content = result.content?.[0];
    expect(content?.type).toBe("text");
    const parsed = JSON.parse((content as { type: "text"; text: string }).text);
    expect(parsed.dependsOnTaskIds).toEqual(["id-a"]);
  });

  it("rejects dependency IDs that do not belong to this workspace (IDOR guard)", async () => {
    mockDbTask.count.mockResolvedValue(1); // only 1 of 2 found in workspace

    const result = await mcpUpdateTask(AUTH, "task-1", {
      dependsOnTaskIds: ["id-a", "id-foreign"],
    });

    expect(result.isError).toBe(true);
    const content = result.content?.[0];
    expect((content as { type: "text"; text: string }).text).toContain(
      "do not belong to this workspace",
    );
    expect(mockDbTask.update).not.toHaveBeenCalled();
  });

  it("workspace scope check uses auth.workspaceId (not task's workspaceId)", async () => {
    mockDbTask.count.mockResolvedValue(1);
    mockDbTask.update.mockResolvedValue({
      ...BASE_UPDATED,
      dependsOnTaskIds: ["id-a"],
    });

    await mcpUpdateTask(AUTH, "task-1", { dependsOnTaskIds: ["id-a"] });

    expect(mockDbTask.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: AUTH.workspaceId }),
      }),
    );
  });
});

describe("mcpUpdateTask — early-exit guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTask.findUnique.mockResolvedValue({ workspaceId: "ws-1" });
  });

  it("returns an error when no updatable fields are provided", async () => {
    const result = await mcpUpdateTask(AUTH, "task-1", {});

    expect(result.isError).toBe(true);
    const content = result.content?.[0];
    expect(content?.type).toBe("text");
    expect((content as { type: "text"; text: string }).text).toContain(
      "dependsOnTaskIds",
    );
    expect(mockDbTask.update).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit when only dependsOnTaskIds is provided", async () => {
    mockDbTask.count.mockResolvedValue(1);
    mockDbTask.update.mockResolvedValue({
      ...BASE_UPDATED,
      dependsOnTaskIds: ["id-x"],
    });

    const result = await mcpUpdateTask(AUTH, "task-1", {
      dependsOnTaskIds: ["id-x"],
    });

    expect(result.isError).toBeFalsy();
    expect(mockDbTask.update).toHaveBeenCalledTimes(1);
  });
});

describe("mcpUpdateTask — title / priority updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTask.findUnique.mockResolvedValue({ workspaceId: "ws-1" });
    mockDbTask.update.mockResolvedValue(BASE_UPDATED);
  });

  it("updates title successfully", async () => {
    const result = await mcpUpdateTask(AUTH, "task-1", { title: "New Title" });

    expect(result.isError).toBeFalsy();
    expect(mockDbTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "New Title" }),
      }),
    );
  });

  it("returns error for empty title", async () => {
    const result = await mcpUpdateTask(AUTH, "task-1", { title: "   " });

    expect(result.isError).toBe(true);
    expect(mockDbTask.update).not.toHaveBeenCalled();
  });

  it("returns error when task not found", async () => {
    mockDbTask.findUnique.mockResolvedValue(null);

    const result = await mcpUpdateTask(AUTH, "nonexistent", { title: "X" });

    expect(result.isError).toBe(true);
    expect(mockDbTask.update).not.toHaveBeenCalled();
  });
});
