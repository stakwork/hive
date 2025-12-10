import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import CapacityPage from "@/app/w/[slug]/capacity/page";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePoolStatus } from "@/hooks/usePoolStatus";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/usePoolStatus");

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe("Capacity Page - Repository Check", () => {
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
          poolState: null,
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      vi.mocked(usePoolStatus).mockReturnValue({
        poolStatus: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(<CapacityPage />);

      expect(screen.getByText("Connect repository to view capacity")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect repository/i })).toBeInTheDocument();
    });

    test("should show ConnectRepository when workspace is null", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: null,
        slug: "test-workspace",
        id: null,
      } as any);

      vi.mocked(usePoolStatus).mockReturnValue({
        poolStatus: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(<CapacityPage />);

      expect(screen.getByText("Connect repository to view capacity")).toBeInTheDocument();
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
          poolState: "COMPLETE",
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      vi.mocked(usePoolStatus).mockReturnValue({
        poolStatus: { activeVMs: 0, pendingVMs: 0, availableVMs: 5 },
        loading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(<CapacityPage />);

      expect(screen.queryByText("Connect repository to view capacity")).not.toBeInTheDocument();
    });

    test("should show 'No Active Pool' when repositories exist but poolState is not COMPLETE", () => {
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
          poolState: "STARTED", // Not COMPLETE
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      vi.mocked(usePoolStatus).mockReturnValue({
        poolStatus: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(<CapacityPage />);

      expect(screen.queryByText("Connect repository to view capacity")).not.toBeInTheDocument();
      expect(screen.getByText("No Active Pool")).toBeInTheDocument();
      expect(screen.getByText(/Resource pool is not configured or not active yet/i)).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace with undefined repositories as empty array", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: {
          id: "ws-1",
          name: "Test Workspace",
          slug: "test-workspace",
          repositories: undefined as any,
          poolState: null,
        } as any,
        slug: "test-workspace",
        id: "ws-1",
      } as any);

      vi.mocked(usePoolStatus).mockReturnValue({
        poolStatus: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      // Should not throw error, should handle gracefully
      expect(() => render(<CapacityPage />)).not.toThrow();
    });
  });
});
