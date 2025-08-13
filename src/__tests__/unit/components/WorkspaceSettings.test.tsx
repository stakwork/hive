import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { useToast } from "@/components/ui/use-toast";

// Mock dependencies
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

const mockUseRouter = useRouter as vi.MockedFunction<typeof useRouter>;
const mockUseWorkspace = useWorkspace as vi.MockedFunction<typeof useWorkspace>;
const mockUseWorkspaceAccess = useWorkspaceAccess as vi.MockedFunction<typeof useWorkspaceAccess>;
const mockUseToast = useToast as vi.MockedFunction<typeof useToast>;
const mockFetch = global.fetch as vi.MockedFunction<typeof fetch>;

describe("WorkspaceSettings Component", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();
  const mockRefreshCurrentWorkspace = vi.fn();

  const defaultWorkspace = {
    id: "workspace1",
    name: "Test Workspace",
    slug: "test-workspace", 
    description: "Test description",
    userRole: "OWNER" as const,
    ownerId: "user1",
    createdAt: "2023-01-01T00:00:00.000Z",
    updatedAt: "2023-01-01T00:00:00.000Z",
    hasKey: true,
    owner: { id: "user1", name: "User", email: "user@example.com" },
    isCodeGraphSetup: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockUseRouter.mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    });

    mockUseToast.mockReturnValue({
      toast: mockToast,
    });

    mockUseWorkspace.mockReturnValue({
      workspace: defaultWorkspace,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
      slug: "test-workspace",
      id: "workspace1",
      role: "OWNER",
      workspaces: [],
      loading: false,
      error: null,
      hasAccess: true,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      isOwner: true,
      isAdmin: false,
      isPM: false,
      isDeveloper: false,
      isStakeholder: false,
      isViewer: false,
      getWorkspaceById: vi.fn(),
      getWorkspaceBySlug: vi.fn(),
      isCurrentWorkspace: vi.fn(),
    });

    mockUseWorkspaceAccess.mockReturnValue({
      canAdmin: true,
      canRead: true,
      canWrite: true,
      hasAccess: true,
      userRole: "OWNER",
      workspace: defaultWorkspace,
    });
  });

  test("should render component when user has admin access", () => {
    render(<WorkspaceSettings />);

    expect(screen.getByText("Workspace Details")).toBeInTheDocument();
    expect(screen.getByText("Update your workspace name, URL, and description")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test Workspace")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test-workspace")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test description")).toBeInTheDocument();
  });

  test("should not render when user lacks admin access", () => {
    mockUseWorkspaceAccess.mockReturnValue({
      canAdmin: false,
      canRead: true,
      canWrite: true,
      hasAccess: true,
      userRole: "DEVELOPER",
      workspace: defaultWorkspace,
    });

    const { container } = render(<WorkspaceSettings />);
    expect(container.firstChild).toBeNull();
  });

  test("should not render when no workspace is available", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: null,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
      slug: "",
      id: "",
      role: null,
      workspaces: [],
      loading: false,
      error: null,
      hasAccess: false,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      isOwner: false,
      isAdmin: false,
      isPM: false,
      isDeveloper: false,
      isStakeholder: false,
      isViewer: false,
      getWorkspaceById: vi.fn(),
      getWorkspaceBySlug: vi.fn(),
      isCurrentWorkspace: vi.fn(),
    });

    const { container } = render(<WorkspaceSettings />);
    expect(container.firstChild).toBeNull();
  });

  test("should disable submit button when form is not dirty", () => {
    render(<WorkspaceSettings />);
    
    const submitButton = screen.getByRole("button", { name: /update workspace/i });
    expect(submitButton).toBeDisabled();
  });

  test("should enable submit button when form is dirty", async () => {
    render(<WorkspaceSettings />);
    
    const nameInput = screen.getByDisplayValue("Test Workspace");
    fireEvent.change(nameInput, { target: { value: "Updated Workspace" } });

    await waitFor(() => {
      const submitButton = screen.getByRole("button", { name: /update workspace/i });
      expect(submitButton).not.toBeDisabled();
    });
  });

  test("should successfully submit form with valid data", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        workspace: {
          ...defaultWorkspace,
          name: "Updated Workspace",
        },
        slugChanged: null,
      }),
    };

    mockFetch.mockResolvedValueOnce(mockResponse as any);

    render(<WorkspaceSettings />);
    
    const nameInput = screen.getByDisplayValue("Test Workspace");
    const submitButton = screen.getByRole("button", { name: /update workspace/i });

    fireEvent.change(nameInput, { target: { value: "Updated Workspace" } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/test-workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Workspace",
          slug: "test-workspace",
          description: "Test description",
        }),
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: "Success",
        description: "Workspace updated successfully",
      });

      expect(mockRefreshCurrentWorkspace).toHaveBeenCalled();
    });
  });

  test("should handle slug change and redirect", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        workspace: {
          ...defaultWorkspace,
          slug: "new-slug",
        },
        slugChanged: "new-slug",
      }),
    };

    mockFetch.mockResolvedValueOnce(mockResponse as any);

    // Mock window.location.pathname
    Object.defineProperty(global, "window", {
      value: {
        location: { pathname: "/w/test-workspace/settings" }
      },
      writable: true,
    });

    render(<WorkspaceSettings />);
    
    const slugInput = screen.getByDisplayValue("test-workspace");
    const submitButton = screen.getByRole("button", { name: /update workspace/i });

    fireEvent.change(slugInput, { target: { value: "new-slug" } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/w/new-slug/settings");
    });
  });

  test("should handle form submission errors", async () => {
    const mockResponse = {
      ok: false,
      json: async () => ({
        error: "Validation failed",
      }),
    };

    mockFetch.mockResolvedValueOnce(mockResponse as any);

    render(<WorkspaceSettings />);
    
    const nameInput = screen.getByDisplayValue("Test Workspace");
    const submitButton = screen.getByRole("button", { name: /update workspace/i });

    fireEvent.change(nameInput, { target: { value: "Updated Workspace" } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Error", 
        description: "Validation failed",
      });
    });
  });

  test("should handle network errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(<WorkspaceSettings />);
    
    const nameInput = screen.getByDisplayValue("Test Workspace");
    const submitButton = screen.getByRole("button", { name: /update workspace/i });

    fireEvent.change(nameInput, { target: { value: "Updated Workspace" } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Error",
        description: "Network error",
      });
    });
  });

  test("should show loading state during submission", async () => {
    let resolvePromise: (value: any) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    mockFetch.mockReturnValueOnce(promise as any);

    render(<WorkspaceSettings />);
    
    const nameInput = screen.getByDisplayValue("Test Workspace");
    const submitButton = screen.getByRole("button", { name: /update workspace/i });

    fireEvent.change(nameInput, { target: { value: "Updated Workspace" } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    fireEvent.click(submitButton);

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText("Updating...")).toBeInTheDocument();
    });

    // Resolve the promise
    resolvePromise!({
      ok: true,
      json: async () => ({
        workspace: { ...defaultWorkspace, name: "Updated Workspace" },
        slugChanged: null,
      }),
    });

    // Should return to normal state
    await waitFor(() => {
      expect(screen.getByText("Update Workspace")).toBeInTheDocument();
    });
  });

  test("should validate required fields", async () => {
    render(<WorkspaceSettings />);
    
    const nameInput = screen.getByDisplayValue("Test Workspace");
    const submitButton = screen.getByRole("button", { name: /update workspace/i });

    // Clear the name field
    fireEvent.change(nameInput, { target: { value: "" } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    fireEvent.click(submitButton);

    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText("Workspace name is required")).toBeInTheDocument();
    });
  });

  test("should handle workspace with no description", () => {
    const workspaceWithoutDescription = {
      ...defaultWorkspace,
      description: null,
    };

    mockUseWorkspace.mockReturnValue({
      workspace: workspaceWithoutDescription,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
      slug: "test-workspace",
      id: "workspace1",
      role: "OWNER",
      workspaces: [],
      loading: false,
      error: null,
      hasAccess: true,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      isOwner: true,
      isAdmin: false,
      isPM: false,
      isDeveloper: false,
      isStakeholder: false,
      isViewer: false,
      getWorkspaceById: vi.fn(),
      getWorkspaceBySlug: vi.fn(),
      isCurrentWorkspace: vi.fn(),
    });

    render(<WorkspaceSettings />);
    
    const descriptionTextarea = screen.getByPlaceholderText("What is this workspace about?");
    expect(descriptionTextarea).toHaveValue("");
  });
});