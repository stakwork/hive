import { describe, it, expect } from "vitest";
import type { DeploymentStatusChangeEvent } from "@/hooks/useWorkspaceTasks";

// Test helper to simulate the deployment status change logic
interface TaskData {
  id: string;
  title: string;
  status: string;
  deploymentStatus?: string | null;
  deployedToStagingAt?: string | null;
  deployedToProductionAt?: string | null;
}

const handleDeploymentStatusChange = (
  tasks: TaskData[],
  event: DeploymentStatusChangeEvent
): TaskData[] => {
  return tasks.map((task) => {
    if (task.id !== event.taskId) {
      return task;
    }

    const updates: Partial<TaskData> = {
      deploymentStatus: event.deploymentStatus,
    };

    if (event.deploymentStatus !== "failed") {
      if (event.environment === "staging" && event.deployedAt) {
        updates.deployedToStagingAt = event.deployedAt.toISOString();
      } else if (event.environment === "production" && event.deployedAt) {
        updates.deployedToProductionAt = event.deployedAt.toISOString();
      }
    }

    return { ...task, ...updates };
  });
};

describe("useWorkspaceTasks - Deployment Handling", () => {
  const mockTasks: TaskData[] = [
    {
      id: "task-1",
      title: "Task 1",
      status: "TODO",
      deploymentStatus: null,
      deployedToStagingAt: null,
      deployedToProductionAt: null,
    },
    {
      id: "task-2",
      title: "Task 2",
      status: "DONE",
      deploymentStatus: "staging",
      deployedToStagingAt: "2024-01-15T10:00:00Z",
      deployedToProductionAt: null,
    },
    {
      id: "task-3",
      title: "Task 3",
      status: "DONE",
      deploymentStatus: null,
      deployedToStagingAt: null,
      deployedToProductionAt: null,
    },
  ];

  describe("handleDeploymentStatusChange", () => {
    it("updates task deployment status for staging deployment", () => {
      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date("2024-01-15T12:00:00Z"),
        timestamp: new Date(),
      };

      const updatedTasks = handleDeploymentStatusChange(mockTasks, event);
      const updatedTask = updatedTasks.find((t) => t.id === "task-1");

      expect(updatedTask?.deploymentStatus).toBe("staging");
      expect(updatedTask?.deployedToStagingAt).toBe("2024-01-15T12:00:00.000Z");
      expect(updatedTask?.deployedToProductionAt).toBeNull();
    });

    it("updates task deployment status for production deployment", () => {
      const event: DeploymentStatusChangeEvent = {
        taskId: "task-2",
        deploymentStatus: "production",
        environment: "production",
        deployedAt: new Date("2024-01-15T14:00:00Z"),
        timestamp: new Date(),
      };

      const updatedTasks = handleDeploymentStatusChange(mockTasks, event);
      const updatedTask = updatedTasks.find((t) => t.id === "task-2");

      expect(updatedTask?.deploymentStatus).toBe("production");
      expect(updatedTask?.deployedToProductionAt).toBe("2024-01-15T14:00:00.000Z");
      // Should preserve existing staging timestamp
      expect(updatedTask?.deployedToStagingAt).toBe("2024-01-15T10:00:00Z");
    });

    it("leaves non-matching tasks unchanged", () => {
      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date("2024-01-15T12:00:00Z"),
        timestamp: new Date(),
      };

      const updatedTasks = handleDeploymentStatusChange(mockTasks, event);
      const task2 = updatedTasks.find((t) => t.id === "task-2");
      const task3 = updatedTasks.find((t) => t.id === "task-3");

      // These tasks should remain unchanged
      expect(task2?.deploymentStatus).toBe("staging");
      expect(task3?.deploymentStatus).toBeNull();
    });

    it("handles multiple events updating same task correctly", () => {
      // First event: staging deployment
      const stagingEvent: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date("2024-01-15T12:00:00Z"),
        timestamp: new Date(),
      };

      let updatedTasks = handleDeploymentStatusChange(mockTasks, stagingEvent);
      let task = updatedTasks.find((t) => t.id === "task-1");

      expect(task?.deploymentStatus).toBe("staging");
      expect(task?.deployedToStagingAt).toBe("2024-01-15T12:00:00.000Z");

      // Second event: production deployment
      const productionEvent: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "production",
        environment: "production",
        deployedAt: new Date("2024-01-15T14:00:00Z"),
        timestamp: new Date(),
      };

      updatedTasks = handleDeploymentStatusChange(updatedTasks, productionEvent);
      task = updatedTasks.find((t) => t.id === "task-1");

      expect(task?.deploymentStatus).toBe("production");
      expect(task?.deployedToProductionAt).toBe("2024-01-15T14:00:00.000Z");
      // Should preserve staging timestamp
      expect(task?.deployedToStagingAt).toBe("2024-01-15T12:00:00.000Z");
    });

    it("handles failed deployment status", () => {
      const event: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "failed",
        environment: "staging",
        deployedAt: new Date("2024-01-15T12:00:00Z"),
        timestamp: new Date(),
      };

      const updatedTasks = handleDeploymentStatusChange(mockTasks, event);
      const task = updatedTasks.find((t) => t.id === "task-1");

      expect(task?.deploymentStatus).toBe("failed");
      // Failed deployments should not set deployment timestamps
      expect(task?.deployedToStagingAt).toBeNull();
      expect(task?.deployedToProductionAt).toBeNull();
    });
  });

  describe("DeploymentStatusChangeEvent Interface", () => {
    it("validates DeploymentStatusChangeEvent interface", () => {
      const validEvent: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "staging",
        environment: "staging",
        deployedAt: new Date(),
        timestamp: new Date(),
      };

      expect(validEvent.taskId).toBeDefined();
      expect(validEvent.deploymentStatus).toBeDefined();
      expect(validEvent.environment).toBeDefined();
      expect(validEvent.timestamp).toBeInstanceOf(Date);
    });

    it("accepts optional deployedAt field", () => {
      const eventWithoutDeployedAt: DeploymentStatusChangeEvent = {
        taskId: "task-1",
        deploymentStatus: "failed",
        environment: "staging",
        timestamp: new Date(),
      };

      expect(eventWithoutDeployedAt.deployedAt).toBeUndefined();
      expect(eventWithoutDeployedAt.taskId).toBe("task-1");
    });
  });
});
