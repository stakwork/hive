import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import TasksPage from "@/app/w/[slug]/tasks/page";
import { useWorkspace } from "@/hooks/useWorkspace";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/useWorkspaceTasks", () => ({
  useWorkspaceTasks: () => ({
    tasks: [],
    loading: false,
  }),
}));

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock TasksList component
vi.mock("@/components/tasks", () => ({
  TasksList: () => <div data-testid="tasks-list">Tasks List</div>,
}));

describe("Tasks Page - Repository Check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ConnectRepository Display Logic", () => {
    test("should show ConnectRepository when workspace has no repositories", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: {
          id: "ws-1",
          name: "Test Workspace",
          slug: "test-workspace",
          repositories: [], // Empty repositories array
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      render(<TasksPage />);

      expect(screen.getByText("Connect repository to Start Managing Tasks")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect repository/i })).toBeInTheDocument();
      expect(screen.queryByTestId("tasks-list")).not.toBeInTheDocument();
    });

    test("should show ConnectRepository when workspace is null", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: null,
        slug: "test-workspace",
        id: null,
      } as any);

      render(<TasksPage />);

      expect(screen.getByText("Connect repository to Start Managing Tasks")).toBeInTheDocument();
    });

    test("should NOT show ConnectRepository when workspace has repositories", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: {
          id: "ws-1",
          name: "Test Workspace",
          slug: "test-workspace",
          repositories: [
            {
              id: "repo-1",
              name: "test-repo",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "PENDING",
              updatedAt: "2024-01-01T00:00:00.000Z",
            },
          ],
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      render(<TasksPage />);

      expect(screen.queryByText("Connect repository to Start Managing Tasks")).not.toBeInTheDocument();
      expect(screen.getByTestId("tasks-list")).toBeInTheDocument();
    });
  });

  describe("New Task Button Visibility", () => {
    test("should NOT show New Task button when workspace has no repositories", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: {
          id: "ws-1",
          name: "Test Workspace",
          slug: "test-workspace",
          repositories: [],
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      render(<TasksPage />);

      expect(screen.queryByRole("button", { name: /new task/i })).not.toBeInTheDocument();
    });

    test("should show New Task button when workspace has repositories", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: {
          id: "ws-1",
          name: "Test Workspace",
          slug: "test-workspace",
          repositories: [
            {
              id: "repo-1",
              name: "test-repo",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
              updatedAt: "2024-01-01T00:00:00.000Z",
            },
          ],
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      render(<TasksPage />);

      expect(screen.getByRole("button", { name: /new task/i })).toBeInTheDocument();
    });
  });
});
