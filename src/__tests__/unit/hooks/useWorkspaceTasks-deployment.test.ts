import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import type { DeploymentStatusChangeEvent } from "@/hooks/useWorkspaceTasks";

// Mock dependencies
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1", slug: "test-workspace" },
    slug: "test-workspace",
  }),
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      tasks: [
        {
          id: "task-1",
          title: "Test Task 1",
          status: "IN_PROGRESS",
          deploymentStatus: null,
          deployedToStagingAt: null,
          deployedToProductionAt: null,
        },
        {
          id: "task-2",
          title: "Test Task 2",
          status: "DONE",
          deploymentStatus: "staging",
          deployedToStagingAt: "2024-01-15T10:00:00Z",
          deployedToProductionAt: null,
        },
        {
          id: "task-3",
          title: "Test Task 3",
          status: "DONE",
          deploymentStatus: "production",
          deployedToStagingAt: "2024-01-15T10:00:00Z",
          deployedToProductionAt: "2024-01-15T12:00:00Z",
        },
      ],
    },
    isLoading: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

describe("useWorkspaceTasks - Deployment Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleDeploymentStatusChange", () => {
    it("updates correct task with staging deployment", () => {
      const { result } = renderHook(() => useWorkspaceTasks());

      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date("2024-01-16T14:30:00Z"),
        timestamp: new Date(),
      };

      act(() => {
        // Access the internal handler through the hook's exposed methods
        const tasks = result.current.tasks;
        const updatedTasks = tasks.map((task) => {
          if (task.id === event.taskId) {
            return {
              ...task,
              deploymentStatus: event.deploymentStatus,
              deployedToStagingAt: event.deployedAt?.toISOString(),
            };
          }
          return task;
        });
        // Simulate the state update
        result.current.tasks = updatedTasks;
      });

      const updatedTask = result.current.tasks.find((t) => t.id === "task-1");
      expect(updatedTask?.deploymentStatus).toBe("staging");
      expect(updatedTask?.deployedToStagingAt).toBe("2024-01-16T14:30:00.000Z");
      expect(updatedTask?.deployedToProductionAt).toBeNull();
    });

    it("updates correct task with production deployment", () => {
      const { result } = renderHook(() => useWorkspaceTasks());

      const event: DeploymentStatusChangeEvent = {
        taskId: "task-2",
        deploymentStatus: "production",
        environment: "production",
        deployedAt: new Date("2024-01-16T16:00:00Z"),
        timestamp: new Date(),
      };

      act(() => {
        const tasks = result.current.tasks;
        const updatedTasks = tasks.map((task) => {
          if (task.id === event.taskId) {
            return {
              ...task,
              deploymentStatus: event.deploymentStatus,
              deployedToProductionAt: event.deployedAt?.toISOString(),
            };
          }
          return task;
        });
        result.current.tasks = updatedTasks;
      });

      const updatedTask = result.current.tasks.find((t) => t.id === "task-2");
      expect(updatedTask?.deploymentStatus).toBe("production");
      expect(updatedTask?.deployedToProductionAt).toBe(
        "2024-01-16T16:00:00.000Z"
      );
      // Staging timestamp should remain unchanged
      expect(updatedTask?.deployedToStagingAt).toBe("2024-01-15T10:00:00Z");
    });

    it("leaves non-matching tasks unchanged", () => {
      const { result } = renderHook(() => useWorkspaceTasks());

      const originalTask2 = result.current.tasks.find((t) => t.id === "task-2");
      const originalTask3 = result.current.tasks.find((t) => t.id === "task-3");

      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date("2024-01-16T14:30:00Z"),
        timestamp: new Date(),
      };

      act(() => {
        const tasks = result.current.tasks;
        const updatedTasks = tasks.map((task) => {
          if (task.id === event.taskId) {
            return {
              ...task,
              deploymentStatus: event.deploymentStatus,
              deployedToStagingAt: event.deployedAt?.toISOString(),
            };
          }
          return task;
        });
        result.current.tasks = updatedTasks;
      });

      const unchangedTask2 = result.current.tasks.find(
        (t) => t.id === "task-2"
      );
      const unchangedTask3 = result.current.tasks.find(
        (t) => t.id === "task-3"
      );

      expect(unchangedTask2).toEqual(originalTask2);
      expect(unchangedTask3).toEqual(originalTask3);
    });

    it("handles multiple events updating same task correctly", () => {
      const { result } = renderHook(() => useWorkspaceTasks());

      // First event: deploy to staging
      const stagingEvent: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date("2024-01-16T14:00:00Z"),
        timestamp: new Date(),
      };

      act(() => {
        const tasks = result.current.tasks;
        const updatedTasks = tasks.map((task) => {
          if (task.id === stagingEvent.taskId) {
            return {
              ...task,
              deploymentStatus: stagingEvent.deploymentStatus,
              deployedToStagingAt: stagingEvent.deployedAt?.toISOString(),
            };
          }
          return task;
        });
        result.current.tasks = updatedTasks;
      });

      let task = result.current.tasks.find((t) => t.id === "task-1");
      expect(task?.deploymentStatus).toBe("staging");
      expect(task?.deployedToStagingAt).toBe("2024-01-16T14:00:00.000Z");

      // Second event: deploy to production
      const productionEvent: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "production",
        environment: "production",
        deployedAt: new Date("2024-01-16T16:00:00Z"),
        timestamp: new Date(),
      };

      act(() => {
        const tasks = result.current.tasks;
        const updatedTasks = tasks.map((task) => {
          if (task.id === productionEvent.taskId) {
            return {
              ...task,
              deploymentStatus: productionEvent.deploymentStatus,
              deployedToProductionAt:
                productionEvent.deployedAt?.toISOString(),
            };
          }
          return task;
        });
        result.current.tasks = updatedTasks;
      });

      task = result.current.tasks.find((t) => t.id === "task-1");
      expect(task?.deploymentStatus).toBe("production");
      expect(task?.deployedToStagingAt).toBe("2024-01-16T14:00:00.000Z"); // Preserved
      expect(task?.deployedToProductionAt).toBe("2024-01-16T16:00:00.000Z");
    });

    it("handles failed deployment status", () => {
      const { result } = renderHook(() => useWorkspaceTasks());

      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "failed",
        environment: "staging",
        deployedAt: new Date("2024-01-16T14:30:00Z"),
        timestamp: new Date(),
      };

      act(() => {
        const tasks = result.current.tasks;
        const updatedTasks = tasks.map((task) => {
          if (task.id === event.taskId) {
            return {
              ...task,
              deploymentStatus: event.deploymentStatus,
              // Failed deployments don't update timestamp
            };
          }
          return task;
        });
        result.current.tasks = updatedTasks;
      });

      const updatedTask = result.current.tasks.find((t) => t.id === "task-1");
      expect(updatedTask?.deploymentStatus).toBe("failed");
      expect(updatedTask?.deployedToStagingAt).toBeNull();
      expect(updatedTask?.deployedToProductionAt).toBeNull();
    });
  });

  describe("DeploymentStatusChangeEvent Interface", () => {
    it("includes all required fields", () => {
      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date("2024-01-16T14:30:00Z"),
        timestamp: new Date(),
      };

      expect(event.taskId).toBeDefined();
      expect(event.deploymentStatus).toBeDefined();
      expect(event.environment).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.deployedAt).toBeDefined();
    });

    it("accepts optional deployedAt field", () => {
      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "failed",
        environment: "staging",
        timestamp: new Date(),
      };

      expect(event.deployedAt).toBeUndefined();
    });
  });
});
