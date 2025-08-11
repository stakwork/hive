/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ActivityPage from "@/app/w/[slug]/activity/page";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useActivity } from "@/hooks/useActivity";

// Mock the hooks
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/hooks/useActivity", () => ({
  useActivity: vi.fn(),
}));

const mockUseWorkspace = useWorkspace as vi.MockedFunction<typeof useWorkspace>;
const mockUseActivity = useActivity as vi.MockedFunction<typeof useActivity>;

describe("ActivityPage Component Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default workspace mock
    mockUseWorkspace.mockReturnValue({
      slug: "test-workspace",
      workspace: { id: "workspace-1", name: "Test Workspace" }
    });
  });

  test("should render activity page header", () => {
    // Arrange
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByText("View recent activity and updates across your workspace.")).toBeInTheDocument();
  });

  test("should show loading state", () => {
    // Arrange
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: true,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(screen.getByText("Loading recent workspace activity...")).toBeInTheDocument();
    // Check for loading skeleton
    expect(screen.getAllByRole("row")).toHaveLength(4); // Header + 3 skeleton rows
  });

  test("should show error state", () => {
    // Arrange
    const mockRefetch = vi.fn();
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: "Failed to fetch activities",
      refetch: mockRefetch
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(screen.getByText("Error loading activity")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch activities")).toBeInTheDocument();
  });

  test("should show empty state when no activities", () => {
    // Arrange
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(screen.getByText("No activity data available")).toBeInTheDocument();
    expect(screen.getByText("Make sure your workspace has a configured swarm connection")).toBeInTheDocument();
  });

  test("should render activities list", () => {
    // Arrange
    const mockActivities = [
      {
        id: "activity-1",
        type: "episode",
        summary: "Test Episode 1",
        user: "System",
        timestamp: new Date("2023-01-01T10:00:00.000Z"),
        status: "active",
        metadata: {}
      },
      {
        id: "activity-2",
        type: "episode",
        summary: "Test Episode 2",
        user: "System", 
        timestamp: new Date("2023-01-02T10:00:00.000Z"),
        status: "active",
        metadata: {}
      }
    ];

    mockUseActivity.mockReturnValue({
      activities: mockActivities,
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(screen.getByText("Test Episode 1")).toBeInTheDocument();
    expect(screen.getByText("Test Episode 2")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // Header + 2 activity rows
  });

  test("should show relative timestamps", () => {
    // Arrange
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const mockActivities = [
      {
        id: "activity-1",
        type: "episode",
        summary: "Recent Episode",
        user: "System",
        timestamp: oneHourAgo,
        status: "active",
        metadata: {}
      }
    ];

    mockUseActivity.mockReturnValue({
      activities: mockActivities,
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(screen.getByText("Recent Episode")).toBeInTheDocument();
    // Should show "about 1 hour ago" or similar
    expect(screen.getByText(/hour ago/)).toBeInTheDocument();
  });

  test("should handle refresh button click", async () => {
    // Arrange
    const mockRefetch = vi.fn();
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: null,
      refetch: mockRefetch
    });

    // Act
    render(<ActivityPage />);
    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshButton);

    // Assert
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  test("should disable refresh button when loading", () => {
    // Arrange
    const mockRefetch = vi.fn();
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: true,
      error: null,
      refetch: mockRefetch
    });

    // Act
    render(<ActivityPage />);

    // Assert
    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    expect(refreshButton).toBeDisabled();
  });

  test("should show spinning icon when loading", () => {
    // Arrange
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: true,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    const refreshIcon = screen.getByRole("button", { name: /refresh/i }).querySelector("svg");
    expect(refreshIcon).toHaveClass("animate-spin");
  });

  test("should call useActivity with correct workspace slug", () => {
    // Arrange
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(mockUseActivity).toHaveBeenCalledWith("test-workspace");
  });

  test("should handle empty workspace slug", () => {
    // Arrange
    mockUseWorkspace.mockReturnValue({
      slug: null,
      workspace: null
    });

    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(mockUseActivity).toHaveBeenCalledWith("");
  });

  test("should show correct table headers", () => {
    // Arrange
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    render(<ActivityPage />);

    // Assert
    expect(screen.getByRole("columnheader", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
    // Should not show Status or User columns
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "User" })).not.toBeInTheDocument();
  });

  test("should show table caption based on state", () => {
    // Arrange - Loading state
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: true,
      error: null,
      refetch: vi.fn()
    });

    // Act
    const { rerender } = render(<ActivityPage />);

    // Assert - Loading caption
    expect(screen.getByText("Loading recent workspace activity...")).toBeInTheDocument();

    // Arrange - Empty state
    mockUseActivity.mockReturnValue({
      activities: [],
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    rerender(<ActivityPage />);

    // Assert - Empty caption
    expect(screen.getByText("No recent activity found")).toBeInTheDocument();

    // Arrange - With data
    const mockActivities = [
      {
        id: "activity-1",
        type: "episode",
        summary: "Test Episode",
        user: "System",
        timestamp: new Date(),
        status: "active",
        metadata: {}
      }
    ];

    mockUseActivity.mockReturnValue({
      activities: mockActivities,
      loading: false,
      error: null,
      refetch: vi.fn()
    });

    // Act
    rerender(<ActivityPage />);

    // Assert - Data caption
    expect(screen.getByText("Recent workspace activity")).toBeInTheDocument();
  });
});