import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestNodesFetch } from "@/hooks/useTestNodesFetch";

// Mock dependencies
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/stores/useDataStore", () => ({
  useDataStore: vi.fn(),
}));

vi.mock("@/stores/useGraphStore", () => ({
  useGraphStore: vi.fn(),
}));

// Import mocked modules
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDataStore } from "@/stores/useDataStore";
import { useGraphStore } from "@/stores/useGraphStore";

describe("useTestNodesFetch", () => {
  const mockAddNewNode = vi.fn();
  const mockWorkspaceId = "workspace-123";

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();

    // Default mocks
    vi.mocked(useWorkspace).mockReturnValue({
      id: mockWorkspaceId,
      workspace: null,
      slug: "test-workspace",
      role: null,
      workspaces: [],
      waitingForInputCount: 0,
      notificationsLoading: false,
      loading: false,
      error: null,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      refreshCurrentWorkspace: vi.fn(),
      refreshTaskNotifications: vi.fn(),
      updateWorkspace: vi.fn(),
      hasAccess: vi.fn(),
    } as any);

    vi.mocked(useDataStore).mockImplementation((selector: any) => {
      if (typeof selector === "function") {
        return selector({ addNewNode: mockAddNewNode });
      }
      return mockAddNewNode;
    });
  });

  describe("initialization", () => {
    it("should not fetch when workspace is not loaded", () => {
      vi.mocked(useWorkspace).mockReturnValue({ id: undefined } as any);
      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should not fetch when all test layers are hidden", () => {
      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: false,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("fetching nodes when visibility changes from false to true", () => {
    it("should fetch unit test nodes when unitTests becomes visible", async () => {
      const mockNodes = [
        { ref_id: "node1", node_type: "unittest", label: "Test 1" },
        { ref_id: "node2", node_type: "unittest", label: "Test 2" },
      ];
      const mockEdges = [
        { ref_id: "edge1", source: "node1", target: "node2", edge_type: "connects" },
      ];

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/swarm/jarvis/nodes")
        );
      });

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain("id=workspace-123");
      expect(fetchUrl).toContain("endpoint=graph%2Fsearch");
      expect(fetchUrl).toContain('node_type=%5B%22unittest%22%5D');

      await waitFor(() => {
        expect(mockAddNewNode).toHaveBeenCalledWith({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              ref_id: "node1",
              x: 0,
              y: 0,
              z: 0,
              edge_count: 0,
            }),
          ]),
          edges: mockEdges,
        });
      });
    });

    it("should fetch integration test nodes when integrationTests becomes visible", async () => {
      const mockNodes = [
        { ref_id: "int1", node_type: "integrationtest", label: "Integration Test 1" },
      ];
      const mockEdges = [];

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: false,
            integrationTests: true,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain('node_type=%5B%22integrationtest%22%5D');
    });

    it("should fetch e2e test nodes when e2eTests becomes visible", async () => {
      const mockNodes = [
        { ref_id: "e2e1", node_type: "e2etest", label: "E2E Test 1" },
      ];
      const mockEdges = [];

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: false,
            integrationTests: false,
            e2eTests: true,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain('node_type=%5B%22e2etest%22%5D');
    });

    it("should fetch multiple test node types when multiple layers are visible", async () => {
      const mockNodes = [
        { ref_id: "node1", node_type: "unittest", label: "Test 1" },
      ];
      const mockEdges = [];

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: true,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      const fetchCalls = (global.fetch as any).mock.calls;
      expect(fetchCalls[0][0]).toContain('unittest');
      expect(fetchCalls[1][0]).toContain('integrationtest');
    });
  });

  describe("preventing duplicate fetches", () => {
    it("should not refetch nodes that have already been fetched", async () => {
      const mockNodes = [
        { ref_id: "node1", node_type: "unittest", label: "Test 1" },
      ];
      const mockEdges = [];

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      const { rerender } = renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      // Rerender the hook (simulating visibility staying true)
      rerender();

      // Should not fetch again
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should track fetched node types independently", async () => {
      const mockNodes = [{ ref_id: "node1", node_type: "unittest", label: "Test 1" }];
      const mockEdges = [];

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      // First render with unitTests visible
      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      const { rerender } = renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      // Change to show integrationTests (unitTests still visible)
      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: true,
            e2eTests: false,
          },
        });
      });

      rerender();

      // Should fetch integrationTests but not unitTests again
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      const fetchCalls = (global.fetch as any).mock.calls;
      expect(fetchCalls[0][0]).toContain('unittest');
      expect(fetchCalls[1][0]).toContain('integrationtest');
    });
  });

  describe("node data mapping", () => {
    it("should map nodes with default position values", async () => {
      const mockNodes = [
        { ref_id: "node1", node_type: "unittest", label: "Test 1" },
        { ref_id: "node2", node_type: "unittest", label: "Test 2", x: 10, y: 20 },
      ];
      const mockEdges = [];

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(mockAddNewNode).toHaveBeenCalledWith({
          nodes: [
            expect.objectContaining({
              ref_id: "node1",
              x: 0,
              y: 0,
              z: 0,
              edge_count: 0,
            }),
            expect.objectContaining({
              ref_id: "node2",
              x: 10,
              y: 20,
              z: 0,
              edge_count: 0,
            }),
          ],
          edges: mockEdges,
        });
      });
    });
  });

  describe("error handling", () => {
    it("should handle fetch errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"));

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("[useTestNodesFetch] Error fetching"),
          expect.any(Error)
        );
      });

      expect(mockAddNewNode).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should handle unsuccessful API responses gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      expect(mockAddNewNode).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should handle API returning unsuccessful result", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          data: null,
        }),
      } as Response);

      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      expect(mockAddNewNode).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("visibility changes from true to false", () => {
    it("should not fetch when visibility changes from true to false", async () => {
      const mockNodes = [{ ref_id: "node1", node_type: "unittest", label: "Test 1" }];
      const mockEdges = [];

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: mockNodes, edges: mockEdges },
        }),
      } as Response);

      // Start with unitTests visible
      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: true,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      const { rerender } = renderHook(() => useTestNodesFetch());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      vi.clearAllMocks();

      // Change to hide unitTests
      vi.mocked(useGraphStore).mockImplementation((selector: any) => {
        return selector({
          testLayerVisibility: {
            unitTests: false,
            integrationTests: false,
            e2eTests: false,
          },
        });
      });

      rerender();

      // Should not fetch again
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
