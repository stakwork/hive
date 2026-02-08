import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestTask } from "@/__tests__/support/factories/task.factory";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe("Task Factory - Auto-Merge Support (Unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTestTask with autoMerge", () => {
    it("should pass autoMerge: true to database by default", async () => {
      const mockTask = {
        id: "task-1",
        title: "Test task",
        autoMerge: true,
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.task.findUnique).mockResolvedValue(null);
      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);

      const task = await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Test task",
      });

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            autoMerge: true,
          }),
        })
      );
      expect(task.autoMerge).toBe(true);
    });

    it("should pass autoMerge: true when explicitly set", async () => {
      const mockTask = {
        id: "task-2",
        title: "Test task with autoMerge",
        autoMerge: true,
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.task.findUnique).mockResolvedValue(null);
      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);

      await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Test task with autoMerge",
        autoMerge: true,
      });

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            autoMerge: true,
          }),
        })
      );
    });

    it("should pass autoMerge: false when explicitly set", async () => {
      const mockTask = {
        id: "task-3",
        title: "Test task without autoMerge",
        autoMerge: false,
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.task.findUnique).mockResolvedValue(null);
      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);

      await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Test task without autoMerge",
        autoMerge: false,
      });

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            autoMerge: false,
          }),
        })
      );
    });

    it("should support task dependencies with autoMerge", async () => {
      const mockTask = {
        id: "task-4",
        title: "Dependent task",
        autoMerge: true,
        dependsOnTaskIds: ["task-1"],
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.task.findUnique).mockResolvedValue(null);
      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);

      await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Dependent task",
        autoMerge: true,
        dependsOnTaskIds: ["task-1"],
      });

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            autoMerge: true,
            dependsOnTaskIds: ["task-1"],
          }),
        })
      );
    });
  });
});
