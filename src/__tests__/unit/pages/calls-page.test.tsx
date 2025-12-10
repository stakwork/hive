import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import CallsPage from "@/app/w/[slug]/calls/page";
import { useWorkspace } from "@/hooks/useWorkspace";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({
    isRecording: false,
    isSupported: true,
    transcriptBuffer: [],
    currentTranscript: "",
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    getRecentTranscript: vi.fn(),
  }),
}));

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("Calls Page - Repository Check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockReset();
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

      render(<CallsPage />);

      expect(screen.getByText("Connect repository to view call recordings")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect repository/i })).toBeInTheDocument();
    });

    test("should show ConnectRepository when workspace is null", () => {
      vi.mocked(useWorkspace).mockReturnValue({
        workspace: null,
        slug: "test-workspace",
        id: null,
      } as any);

      render(<CallsPage />);

      expect(screen.getByText("Connect repository to view call recordings")).toBeInTheDocument();
    });

    test("should NOT show ConnectRepository when workspace has repositories", async () => {
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

      // Mock successful fetch for calls
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ calls: [], hasMore: false }),
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(screen.queryByText("Connect repository to view call recordings")).not.toBeInTheDocument();
      });
    });
  });

  describe("Action Buttons Visibility", () => {
    test("should NOT show action buttons when workspace has no repositories", () => {
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

      render(<CallsPage />);

      expect(screen.queryByRole("button", { name: /start call/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
    });

    test("should show action buttons when workspace has repositories", async () => {
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

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ calls: [], hasMore: false }),
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /start call/i })).toBeInTheDocument();
      });
    });
  });

  describe("Fetch Calls Behavior", () => {
    test("should not fetch calls when workspace has no repositories", async () => {
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

      render(<CallsPage />);

      await waitFor(() => {
        expect(global.fetch).not.toHaveBeenCalled();
      });
    });

    test("should fetch calls when workspace has repositories", async () => {
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

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ calls: [], hasMore: false }),
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/workspaces/test-workspace/calls")
        );
      });
    });
  });
});
