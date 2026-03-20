import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestTask } from "@/__tests__/support/factories/task.factory";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {tasks: {
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
    it("should pass autoMerge: false to database by default", async () => {
      const mockTask = {
        id: "task-1",
        title: "Test task",
        auto_merge: false,
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.tasks.findUnique).mockResolvedValue(null);
      vi.mocked(db.tasks.create).mockResolvedValue(mockTask as any);

      const task = await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Test task",
      });

      expect(db.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            auto_merge: false,
          }),
        })
      );
      expect(task.auto_merge).toBe(false);
    });

    it("should pass autoMerge: true when explicitly set", async () => {
      const mockTask = {
        id: "task-2",
        title: "Test task with autoMerge",
        auto_merge: true,
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.tasks.findUnique).mockResolvedValue(null);
      vi.mocked(db.tasks.create).mockResolvedValue(mockTask as any);

      await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Test task with autoMerge",
        autoMerge: true,
      });

      expect(db.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            auto_merge: true,
          }),
        })
      );
    });

    it("should pass autoMerge: false when explicitly set", async () => {
      const mockTask = {
        id: "task-3",
        title: "Test task without autoMerge",
        auto_merge: false,
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.tasks.findUnique).mockResolvedValue(null);
      vi.mocked(db.tasks.create).mockResolvedValue(mockTask as any);

      await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Test task without autoMerge",
        autoMerge: false,
      });

      expect(db.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            auto_merge: false,
          }),
        })
      );
    });

    it("should support task dependencies with autoMerge", async () => {
      const mockTask = {
        id: "task-4",
        title: "Dependent task",
        auto_merge: true,
        depends_on_task_ids: ["task-1"],
        workspaceId: "ws-1",
        createdById: "user-1",
      };

      vi.mocked(db.tasks.findUnique).mockResolvedValue(null);
      vi.mocked(db.tasks.create).mockResolvedValue(mockTask as any);

      await createTestTask({
        workspaceId: "ws-1",
        createdById: "user-1",
        title: "Dependent task",
        autoMerge: true,
        dependsOnTaskIds: ["task-1"],
      });

      expect(db.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            auto_merge: true,
            depends_on_task_ids: ["task-1"],
          }),
        })
      );
    });
  });
});
