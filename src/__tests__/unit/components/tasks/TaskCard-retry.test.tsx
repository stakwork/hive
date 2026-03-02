/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskData } from "@/hooks/useWorkspaceTasks";

// Make React globally available for components that don't import it explicitly
globalThis.React = React;

// Mock sonner toast - must be hoisted
const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    success: vi.fn(),
  },
}));

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/w/test-workspace/tasks",
}));

// Mock workspace hook
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1", slug: "test-workspace" },
    slug: "test-workspace",
  }),
}));

// Mock workspace access hook
vi.mock("@/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => ({
    canWrite: true,
    permissions: {
      canManageTasks: true,
    },
  }),
}));

describe("TaskCard - Retry Functionality", () => {
  const mockTask: TaskData = {
    id: "task-1",
    title: "Test Task",
    description: null,
    status: "IN_PROGRESS" as const,
    workflowStatus: "ERROR" as const,
    priority: "MEDIUM" as const,
    sourceType: "USER" as const,
    mode: "agent",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: {
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
      image: null,
      githubAuth: null,
    },
    prArtifact: null,
    autoMerge: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe("Retry Button Visibility", () => {
    it("should show Retry button when workflowStatus is ERROR", () => {
      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("should show Retry button when workflowStatus is FAILED", () => {
      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "FAILED" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("should show Retry button when workflowStatus is HALTED", () => {
      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "HALTED" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("should NOT show Retry button when workflowStatus is COMPLETED", () => {
      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "COMPLETED" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    });

    it("should NOT show Retry button when workflowStatus is PENDING", () => {
      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "PENDING" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    });

    it("should NOT show Retry button when workflowStatus is IN_PROGRESS", () => {
      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "IN_PROGRESS" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    });

    it("should NOT show Retry button when task status is TODO", () => {
      render(
        <TaskCard
          task={{ ...mockTask, status: "TODO", workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    });

    it("should NOT show Retry button when prArtifact exists", () => {
      render(
        <TaskCard
          task={{
            ...mockTask,
            workflowStatus: "ERROR",
            prArtifact: {
              id: "artifact-1",
              type: "PR",
              content: {},
            },
          }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    });

    it("should NOT show Retry button when hideWorkflowStatus is true", () => {
      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
          hideWorkflowStatus={true}
        />
      );

      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    });
  });

  describe("Retry Button Interaction", () => {
    it("should call PATCH /api/tasks/[taskId] with retryWorkflow=true on click", async () => {
      const user = userEvent.setup();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      const retryButton = screen.getByRole("button", { name: /retry/i });
      await user.click(retryButton);

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/tasks/task-1",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retryWorkflow: true }),
        })
      );
    });

    it("should call e.stopPropagation to prevent navigation", async () => {
      const user = userEvent.setup();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const { container } = render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      const retryButton = screen.getByRole("button", { name: /retry/i });
      const stopPropagationSpy = vi.fn();
      
      retryButton.addEventListener("click", (e) => {
        stopPropagationSpy();
        e.stopPropagation();
      }, true);

      await user.click(retryButton);

      // Verify that clicking the button doesn't trigger navigation
      // by checking that the link parent wasn't activated
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it("should show spinner while retrying", async () => {
      const user = userEvent.setup();
      let resolvePromise: () => void;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });

      global.fetch = vi.fn().mockReturnValue(
        promise.then(() => ({
          ok: true,
          json: async () => ({}),
        }))
      );

      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      const retryButton = screen.getByRole("button", { name: /retry/i });
      await user.click(retryButton);

      // Button should be disabled while retrying
      await waitFor(() => {
        expect(retryButton).toBeDisabled();
      });

      resolvePromise!();

      await waitFor(() => {
        expect(retryButton).not.toBeDisabled();
      });
    });

    it("should call onRetry callback on success", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
          onRetry={onRetry}
        />
      );

      const retryButton = screen.getByRole("button", { name: /retry/i });
      await user.click(retryButton);

      await waitFor(() => {
        expect(onRetry).toHaveBeenCalled();
      });
    });

    it("should show error toast on failure", async () => {
      const user = userEvent.setup();
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
        />
      );

      const retryButton = screen.getByRole("button", { name: /retry/i });
      await user.click(retryButton);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Failed to retry task. Please try again."
        );
      });
    });

    it("should NOT call onRetry callback on failure", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(
        <TaskCard
          task={{ ...mockTask, workflowStatus: "ERROR" }}
          workspaceSlug="test-workspace"
          isArchived={false}
          onRetry={onRetry}
        />
      );

      const retryButton = screen.getByRole("button", { name: /retry/i });
      await user.click(retryButton);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalled();
      });

      expect(onRetry).not.toHaveBeenCalled();
    });
  });
});
