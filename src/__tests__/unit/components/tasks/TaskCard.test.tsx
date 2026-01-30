import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { TaskCard } from "@/components/tasks/TaskCard";
import type { TaskData } from "@/hooks/useWorkspaceTasks";

// Mock dependencies
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h4: ({ children, ...props }: any) => <h4 {...props}>{children}</h4>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const createMockTask = (overrides: Partial<TaskData> = {}): TaskData => ({
  id: "task-123",
  title: "Test Task",
  description: "Test task description",
  status: "IN_PROGRESS",
  priority: "MEDIUM",
  workflowStatus: "IN_PROGRESS",
  sourceType: "USER",
  mode: "live",
  createdAt: new Date("2024-01-01").toISOString(),
  updatedAt: new Date("2024-01-01").toISOString(),
  hasActionArtifact: false,
  prArtifact: null,
  createdBy: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    image: null,
    githubAuth: null,
  },
  ...overrides,
});

describe("TaskCard - Archive with Undo Toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("should show toast with undo action when archiving a task", async () => {
    const mockTask = createMockTask();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<TaskCard task={mockTask} workspaceSlug="test-workspace" isArchived={false} />);

    // Hover over the card to show the archive button
    const card = screen.getByTestId("task-card");
    fireEvent.mouseEnter(card);

    // Wait for the archive button to appear
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    const archiveButton = screen.getByRole("button");
    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Task archived", {
        description: "Test Task",
        duration: 5000,
        action: expect.objectContaining({
          label: "Undo",
          onClick: expect.any(Function),
        }),
      });
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
  });

  it("should NOT show toast when unarchiving a task", async () => {
    const mockTask = createMockTask();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<TaskCard task={mockTask} workspaceSlug="test-workspace" isArchived={true} />);

    // Hover over the card to show the unarchive button
    const card = screen.getByTestId("task-card");
    fireEvent.mouseEnter(card);

    // Wait for the unarchive button to appear
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    const unarchiveButton = screen.getByRole("button");
    fireEvent.click(unarchiveButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Toast should NOT be called when unarchiving
    expect(toast.success).not.toHaveBeenCalled();

    expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
  });

  it("should call unarchive API when undo action is triggered", async () => {
    const mockTask = createMockTask();
    let capturedUndoAction: any;

    // Mock toast.success to capture the action callback
    (toast.success as any).mockImplementation((message: string, options: any) => {
      capturedUndoAction = options.action.onClick;
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<TaskCard task={mockTask} workspaceSlug="test-workspace" isArchived={false} />);

    // Hover and click archive
    const card = screen.getByTestId("task-card");
    fireEvent.mouseEnter(card);

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    const archiveButton = screen.getByRole("button");
    fireEvent.click(archiveButton);

    // Wait for toast to be called
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });

    // Clear the fetch mock to verify undo call
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    // Trigger the undo action
    await capturedUndoAction();

    // Verify undo API call
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
    });
  });

  it("should show error toast if archive fails", async () => {
    const mockTask = createMockTask();
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<TaskCard task={mockTask} workspaceSlug="test-workspace" isArchived={false} />);

    // Hover and click archive
    const card = screen.getByTestId("task-card");
    fireEvent.mouseEnter(card);

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    const archiveButton = screen.getByRole("button");
    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to archive task");
    });

    // Success toast should not be called
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("should show error toast if undo action fails", async () => {
    const mockTask = createMockTask();
    let capturedUndoAction: any;

    // Mock toast.success to capture the action callback
    (toast.success as any).mockImplementation((message: string, options: any) => {
      capturedUndoAction = options.action.onClick;
    });

    // First call succeeds (archive), second call fails (undo)
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    render(<TaskCard task={mockTask} workspaceSlug="test-workspace" isArchived={false} />);

    // Hover and click archive
    const card = screen.getByTestId("task-card");
    fireEvent.mouseEnter(card);

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    const archiveButton = screen.getByRole("button");
    fireEvent.click(archiveButton);

    // Wait for archive to complete
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });

    // Clear mocks to isolate undo error
    vi.clearAllMocks();

    // Trigger the undo action (which will fail)
    await capturedUndoAction();

    // Verify error toast was shown for undo failure
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to undo archive");
    });
  });

  it("should not show archive button for TODO tasks", () => {
    const mockTask = createMockTask({ status: "TODO" });

    render(<TaskCard task={mockTask} workspaceSlug="test-workspace" isArchived={false} />);

    // Hover over the card
    const card = screen.getByTestId("task-card");
    fireEvent.mouseEnter(card);

    // Archive button should not appear for TODO tasks
    const buttons = screen.queryAllByRole("button");
    expect(buttons).toHaveLength(0);
  });

  it("should display task title in toast description", async () => {
    const mockTask = createMockTask({ title: "Custom Task Title" });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<TaskCard task={mockTask} workspaceSlug="test-workspace" isArchived={false} />);

    const card = screen.getByTestId("task-card");
    fireEvent.mouseEnter(card);

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    const archiveButton = screen.getByRole("button");
    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Task archived", {
        description: "Custom Task Title",
        duration: 5000,
        action: expect.objectContaining({
          label: "Undo",
        }),
      });
    });
  });
});
