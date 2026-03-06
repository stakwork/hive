/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskData } from "@/hooks/useWorkspaceTasks";

// Make React globally available for components that use the classic JSX transform
globalThis.React = React;

// Mock framer-motion: render children immediately without animations
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...rest }: any) => React.createElement("div", rest, children),
    h4: ({ children, ...rest }: any) => React.createElement("h4", rest, children),
  },
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

// Mock sub-components using React.createElement (no JSX in hoisted factory scope)
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge", () => ({
  WorkflowStatusBadge: ({ status }: any) =>
    React.createElement("span", { "data-testid": "workflow-status" }, status),
}));
vi.mock("@/components/tasks/PRStatusBadge", () => ({
  PRStatusBadge: () => React.createElement("span", { "data-testid": "pr-status-badge" }),
}));
vi.mock("@/components/tasks/DeploymentStatusBadge", () => ({
  DeploymentStatusBadge: () =>
    React.createElement("span", { "data-testid": "deployment-status-badge" }),
}));

// Mock date util
vi.mock("@/lib/date-utils", () => ({
  formatRelativeOrDate: () => "just now",
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeTask(overrides: Partial<TaskData> = {}): TaskData {
  return {
    id: "task-1",
    title: "Test Task",
    status: "TODO",
    workflowStatus: "PENDING",
    priority: "MEDIUM",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    featureId: null,
    mode: null,
    sourceType: null,
    prArtifact: null,
    deploymentStatus: null,
    deployedToStagingAt: null,
    deployedToProductionAt: null,
    autoMerge: false,
    assignee: null,
    podActive: false,
    waitingForInput: false,
    ...overrides,
  } as unknown as TaskData;
}

describe("TaskCard", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  describe("Archive button visibility", () => {
    it("shows archive button on hover for TODO tasks", () => {
      const task = makeTask({ status: "TODO" });
      render(<TaskCard task={task} workspaceSlug="test-ws" />);

      fireEvent.mouseEnter(screen.getByTestId("task-card"));

      expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
    });

    it("shows archive button on hover for IN_PROGRESS tasks", () => {
      const task = makeTask({ status: "IN_PROGRESS" });
      render(<TaskCard task={task} workspaceSlug="test-ws" />);

      fireEvent.mouseEnter(screen.getByTestId("task-card"));

      expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
    });

    it("shows archive button on hover for DONE tasks", () => {
      const task = makeTask({ status: "DONE" });
      render(<TaskCard task={task} workspaceSlug="test-ws" />);

      fireEvent.mouseEnter(screen.getByTestId("task-card"));

      expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
    });

    it("does not show archive button when not hovered", () => {
      const task = makeTask({ status: "TODO" });
      render(<TaskCard task={task} workspaceSlug="test-ws" />);

      expect(screen.queryByRole("button", { name: /archive/i })).not.toBeInTheDocument();
    });
  });

  describe("Archive action for TODO tasks", () => {
    it("calls PATCH with { archived: true } when archive button is clicked on a TODO task", async () => {
      const task = makeTask({ status: "TODO" });
      render(<TaskCard task={task} workspaceSlug="test-ws" isArchived={false} />);

      fireEvent.mouseEnter(screen.getByTestId("task-card"));

      fireEvent.click(screen.getByRole("button", { name: /archive/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/tasks/task-1",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ archived: true }),
          })
        );
      });
    });

    it("shows success toast after archiving a TODO task", async () => {
      const { toast } = await import("sonner");
      const task = makeTask({ status: "TODO" });
      render(<TaskCard task={task} workspaceSlug="test-ws" isArchived={false} />);

      fireEvent.mouseEnter(screen.getByTestId("task-card"));
      fireEvent.click(screen.getByRole("button", { name: /archive/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          "Task archived",
          expect.objectContaining({ description: "Test Task" })
        );
      });
    });
  });
});
