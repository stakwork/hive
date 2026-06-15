// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceVisibilitySettings } from "@/components/settings/WorkspaceVisibilitySettings";

// --- useWorkspace mock (overridden per test) ---
const mockRefreshCurrentWorkspace = vi.fn();
let mockWorkspaceState = {
  slug: "my-workspace",
  workspace: { isPublicViewable: false, name: "My Workspace", slug: "my-workspace", description: null } as {
    isPublicViewable: boolean;
    name: string;
    slug: string;
    description: string | null;
  },
  refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockWorkspaceState,
}));

// --- sonner toast mock ---
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("WorkspaceVisibilitySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceState = {
      slug: "my-workspace",
      workspace: { isPublicViewable: false, name: "My Workspace", slug: "my-workspace", description: null },
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
    };
  });

  describe("initial render from context", () => {
    it("renders toggle as OFF when workspace.isPublicViewable is false", () => {
      mockWorkspaceState.workspace.isPublicViewable = false;
      render(<WorkspaceVisibilitySettings />);

      const toggle = screen.getByTestId("public-viewable-toggle");
      expect(toggle).toBeInTheDocument();
      expect(toggle).not.toBeChecked();
      expect(screen.getByText("Only workspace members can access this workspace.")).toBeInTheDocument();
    });

    it("renders toggle as ON when workspace.isPublicViewable is true", () => {
      mockWorkspaceState.workspace.isPublicViewable = true;
      render(<WorkspaceVisibilitySettings />);

      const toggle = screen.getByTestId("public-viewable-toggle");
      expect(toggle).toBeInTheDocument();
      expect(toggle).toBeChecked();
      expect(screen.getByText("This workspace is visible to anyone with the link.")).toBeInTheDocument();
    });
  });

  describe("handleToggle — successful API response", () => {
    it("sets enabled to true and does NOT reset after a successful toggle ON", async () => {
      mockWorkspaceState.workspace.isPublicViewable = false;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workspace: { isPublicViewable: true } }),
      });
      mockRefreshCurrentWorkspace.mockResolvedValueOnce(undefined);

      render(<WorkspaceVisibilitySettings />);
      const toggle = screen.getByTestId("public-viewable-toggle");
      expect(toggle).not.toBeChecked();

      await userEvent.click(toggle);

      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      // Confirm it stays ON after refreshCurrentWorkspace resolves
      expect(toggle).toBeChecked();
      expect(mockRefreshCurrentWorkspace).toHaveBeenCalledTimes(1);
    });

    it("sets enabled to false and does NOT reset after a successful toggle OFF", async () => {
      mockWorkspaceState.workspace.isPublicViewable = true;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workspace: { isPublicViewable: false } }),
      });
      mockRefreshCurrentWorkspace.mockResolvedValueOnce(undefined);

      render(<WorkspaceVisibilitySettings />);
      const toggle = screen.getByTestId("public-viewable-toggle");
      expect(toggle).toBeChecked();

      await userEvent.click(toggle);

      await waitFor(() => {
        expect(toggle).not.toBeChecked();
      });

      expect(toggle).not.toBeChecked();
      expect(mockRefreshCurrentWorkspace).toHaveBeenCalledTimes(1);
    });

    it("sends the correct payload to the API", async () => {
      mockWorkspaceState.workspace.isPublicViewable = false;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      render(<WorkspaceVisibilitySettings />);
      await userEvent.click(screen.getByTestId("public-viewable-toggle"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces/my-workspace",
          expect.objectContaining({
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "My Workspace",
              slug: "my-workspace",
              description: undefined,
              isPublicViewable: true,
            }),
          })
        );
      });
    });
  });

  describe("handleToggle — API error", () => {
    it("does not change enabled state on API failure", async () => {
      const { toast } = await import("sonner");
      mockWorkspaceState.workspace.isPublicViewable = false;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Unauthorized" }),
      });

      render(<WorkspaceVisibilitySettings />);
      const toggle = screen.getByTestId("public-viewable-toggle");

      await userEvent.click(toggle);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Failed to update visibility", expect.any(Object));
      });

      // Toggle should remain OFF since API failed
      expect(toggle).not.toBeChecked();
    });
  });
});
