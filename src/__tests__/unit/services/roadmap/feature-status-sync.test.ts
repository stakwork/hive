import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { FeatureStatus, TaskStatus, WorkflowStatus } from "@prisma/client";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
    },
    feature: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/services/roadmap/features", () => ({
  updateFeature: vi.fn(),
}));

// Import after mocks
import { db } from "@/lib/db";
import { updateFeature } from "@/services/roadmap/features";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";

describe("updateFeatureStatusFromTasks", () => {
  const mockFeatureId = "feature-123";
  const mockOwnerId = "owner-456";
  const mockWorkspaceSlug = "test-workspace";

  const mockFeature = {
    id: mockFeatureId,
    status: FeatureStatus.BACKLOG,
    workspace: {
      ownerId: mockOwnerId,
      slug: mockWorkspaceSlug,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console logs during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("No Tasks Scenario", () => {
    test("returns early when feature has no tasks", async () => {
      vi.mocked(db.task.findMany).mockResolvedValue([]);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(db.task.findMany).toHaveBeenCalledWith({
        where: {
          featureId: mockFeatureId,
          deleted: false,
        },
        select: {
          status: true,
          workflowStatus: true,
        },
      });

      expect(db.feature.findUnique).not.toHaveBeenCalled();
      expect(updateFeature).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("No tasks found for feature")
      );
    });
  });

  describe("ERROR Priority - Highest", () => {
    test("sets feature to CANCELLED when task has WorkflowStatus.ERROR", async () => {
      const tasks = [
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.ERROR },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.CANCELLED }
      );
    });

    test("sets feature to CANCELLED when task has WorkflowStatus.FAILED", async () => {
      const tasks = [
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.FAILED },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.CANCELLED }
      );
    });

    test("ERROR takes precedence over BLOCKED status", async () => {
      const tasks = [
        { status: TaskStatus.BLOCKED, workflowStatus: WorkflowStatus.PENDING },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.ERROR },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.CANCELLED }
      );
    });

    test("ERROR takes precedence over IN_PROGRESS status", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.FAILED },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.CANCELLED }
      );
    });

    test("ERROR takes precedence over COMPLETED status", async () => {
      const tasks = [
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.ERROR },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.CANCELLED }
      );
    });
  });

  describe("BLOCKED Priority - Second Highest", () => {
    test("sets feature to IN_PROGRESS when task has TaskStatus.BLOCKED", async () => {
      const tasks = [
        { status: TaskStatus.BLOCKED, workflowStatus: WorkflowStatus.PENDING },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.IN_PROGRESS }
      );
    });

    test("sets feature to IN_PROGRESS when task has WorkflowStatus.HALTED", async () => {
      const tasks = [
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.HALTED },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.IN_PROGRESS }
      );
    });

    test("BLOCKED takes precedence over IN_PROGRESS when both present", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
        { status: TaskStatus.BLOCKED, workflowStatus: WorkflowStatus.PENDING },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.IN_PROGRESS }
      );
    });

    test("BLOCKED takes precedence over COMPLETED when both present", async () => {
      const tasks = [
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
        { status: TaskStatus.BLOCKED, workflowStatus: WorkflowStatus.PENDING },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.IN_PROGRESS }
      );
    });
  });

  describe("IN_PROGRESS Priority - Third Highest", () => {
    test("sets feature to IN_PROGRESS when task has TaskStatus.IN_PROGRESS", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.PENDING },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.IN_PROGRESS }
      );
    });

    test("sets feature to IN_PROGRESS when task has WorkflowStatus.IN_PROGRESS", async () => {
      const tasks = [
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.IN_PROGRESS },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.IN_PROGRESS }
      );
    });

    test("sets feature to IN_PROGRESS with mix of IN_PROGRESS and DONE tasks", async () => {
      const tasks = [
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.PENDING },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.IN_PROGRESS }
      );
    });
  });

  describe("COMPLETED Priority - Lowest", () => {
    test("sets feature to COMPLETED when all tasks are DONE and COMPLETED", async () => {
      const tasks = [
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.COMPLETED }
      );
    });

    test("sets feature to COMPLETED when all tasks are DONE with null workflowStatus", async () => {
      const tasks = [
        { status: TaskStatus.DONE, workflowStatus: null },
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.COMPLETED }
      );
    });

    test("does NOT set to COMPLETED when task is DONE but workflowStatus is PENDING", async () => {
      const tasks = [
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.PENDING },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("No status change needed")
      );
    });
  });

  describe("No Status Change Scenarios", () => {
    test("returns early when computed status matches current feature status", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
      ];

      const featureInProgress = {
        ...mockFeature,
        status: FeatureStatus.IN_PROGRESS,
      };

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(featureInProgress);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(db.feature.findUnique).toHaveBeenCalled();
      expect(updateFeature).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("already has status")
      );
    });

    test("returns early when no status can be computed from tasks", async () => {
      const tasks = [
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.PENDING },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(db.feature.findUnique).not.toHaveBeenCalled();
      expect(updateFeature).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("No status change needed")
      );
    });

    test("returns early when tasks are CANCELLED", async () => {
      const tasks = [
        { status: TaskStatus.CANCELLED, workflowStatus: WorkflowStatus.COMPLETED },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(db.feature.findUnique).not.toHaveBeenCalled();
      expect(updateFeature).not.toHaveBeenCalled();
    });
  });

  describe("Feature Not Found", () => {
    test("returns early when feature does not exist", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(null);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Feature")
      );
    });
  });

  describe("Error Handling", () => {
    test("logs and throws error when task query fails", async () => {
      const error = new Error("Database error");
      vi.mocked(db.task.findMany).mockRejectedValue(error);

      await expect(updateFeatureStatusFromTasks(mockFeatureId)).rejects.toThrow("Database error");

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Error updating feature"),
        error
      );
    });

    test("logs and throws error when feature query fails", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
      ];
      const error = new Error("Database error");

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockRejectedValue(error);

      await expect(updateFeatureStatusFromTasks(mockFeatureId)).rejects.toThrow("Database error");

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Error updating feature"),
        error
      );
    });

    test("logs and throws error when updateFeature fails", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
      ];
      const error = new Error("Update error");

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockRejectedValue(error);

      await expect(updateFeatureStatusFromTasks(mockFeatureId)).rejects.toThrow("Update error");

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Error updating feature"),
        error
      );
    });
  });

  describe("Complex Multi-Task Scenarios", () => {
    test("correctly prioritizes with all status types present", async () => {
      // ERROR should win even with all other statuses present
      const tasks = [
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
        { status: TaskStatus.BLOCKED, workflowStatus: WorkflowStatus.PENDING },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.ERROR },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.CANCELLED }
      );
    });

    test("handles multiple ERROR tasks", async () => {
      const tasks = [
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.ERROR },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.FAILED },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.ERROR },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.CANCELLED }
      );
    });

    test("handles large number of tasks efficiently", async () => {
      const tasks = Array(100).fill(null).map(() => ({
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      }));

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId,
        { status: FeatureStatus.COMPLETED }
      );
    });
  });

  describe("Workspace Owner as Updater", () => {
    test("uses workspace ownerId for system automated updates", async () => {
      const tasks = [
        { status: TaskStatus.IN_PROGRESS, workflowStatus: WorkflowStatus.IN_PROGRESS },
      ];

      vi.mocked(db.task.findMany).mockResolvedValue(tasks);
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);
      vi.mocked(updateFeature).mockResolvedValue({} as any);

      await updateFeatureStatusFromTasks(mockFeatureId);

      expect(updateFeature).toHaveBeenCalledWith(
        mockFeatureId,
        mockOwnerId, // Should use workspace owner ID
        { status: FeatureStatus.IN_PROGRESS }
      );
    });
  });
});
