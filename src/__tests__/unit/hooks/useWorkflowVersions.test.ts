/**
 * Unit tests for useWorkflowVersions hook
 * Tests fetching, loading states, and error handling
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useWorkflowVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockVersionsResponse = (count: number) => {
    const versions = Array.from({ length: count }, (_, i) => ({
      workflow_version_id: `wfv-${i + 1}`,
      workflow_id: 123,
      workflow_json: JSON.stringify({ nodes: [], edges: [] }),
      workflow_name: `Test Workflow v${count - i}`,
      date_added_to_graph: new Date(Date.now() - i * 86400000).toISOString(),
      published_at: i === 0 ? new Date().toISOString() : null,
      ref_id: `version-${i + 1}`,
      node_type: "Workflow_version" as const,
    }));

    return {
      success: true,
      data: { versions },
    };
  };

  test("should not fetch when workspaceSlug is null", async () => {
    const { result } = renderHook(() => useWorkflowVersions(null, 123));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.versions).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("should not fetch when workflowId is null", async () => {
    const { result } = renderHook(() => useWorkflowVersions("test-workspace", null));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.versions).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("should not fetch when both parameters are null", async () => {
    const { result } = renderHook(() => useWorkflowVersions(null, null));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.versions).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("should fetch versions when both parameters provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockVersionsResponse(3),
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.versions).toEqual([]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versions).toHaveLength(3);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/test-workspace/workflows/123/versions"
    );
  });

  test("should return empty array when no versions exist", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { versions: [] } }),
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  test("should handle fetch errors", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versions).toEqual([]);
    expect(result.current.error).toBe("Network error");
  });

  test("should handle API error responses", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versions).toEqual([]);
    expect(result.current.error).toContain("Failed to fetch workflow versions");
  });

  test("should handle invalid response format", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ invalid: "response" }),
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versions).toEqual([]);
    expect(result.current.error).toBeDefined();
  });

  test("should filter out invalid workflow versions", async () => {
    const mixedResponse = {
      success: true,
      data: {
        versions: [
          {
            workflow_version_id: "wfv-1",
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [] }),
            date_added_to_graph: new Date().toISOString(),
            ref_id: "version-1",
            node_type: "Workflow_version",
          },
          {
            // Missing workflow_version_id
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [] }),
            date_added_to_graph: new Date().toISOString(),
            ref_id: "version-2",
            node_type: "Workflow_version",
          },
          {
            workflow_version_id: "wfv-3",
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [] }),
            date_added_to_graph: new Date().toISOString(),
            ref_id: "version-3",
            node_type: "Workflow_version",
          },
        ],
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mixedResponse,
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should only include valid versions
    expect(result.current.versions).toHaveLength(2);
    expect(result.current.versions[0].workflow_version_id).toBe("wfv-1");
    expect(result.current.versions[1].workflow_version_id).toBe("wfv-3");
  });

  test("should support refetch functionality", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockVersionsResponse(2),
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Call refetch
    result.current.refetch();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  test("should refetch when workspaceSlug changes", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockVersionsResponse(2),
    });

    const { result, rerender } = renderHook(
      ({ slug, id }) => useWorkflowVersions(slug, id),
      {
        initialProps: { slug: "workspace-1", id: 123 },
      }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/workspaces/workspace-1/workflows/123/versions"
    );

    // Change workspace slug
    rerender({ slug: "workspace-2", id: 123 });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/workspaces/workspace-2/workflows/123/versions"
    );
  });

  test("should refetch when workflowId changes", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockVersionsResponse(2),
    });

    const { result, rerender } = renderHook(
      ({ slug, id }) => useWorkflowVersions(slug, id),
      {
        initialProps: { slug: "test-workspace", id: 123 },
      }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/workspaces/test-workspace/workflows/123/versions"
    );

    // Change workflow ID
    rerender({ slug: "test-workspace", id: 456 });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/workspaces/test-workspace/workflows/456/versions"
    );
  });

  test("should stop fetching when parameters become null", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockVersionsResponse(2),
    });

    const { result, rerender } = renderHook(
      ({ slug, id }) => useWorkflowVersions(slug, id),
      {
        initialProps: { slug: "test-workspace", id: 123 },
      }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Set workflowId to null
    rerender({ slug: "test-workspace", id: null });

    await waitFor(() => {
      expect(result.current.versions).toEqual([]);
    });

    // Should not make additional fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("should handle versions with all optional properties", async () => {
    const fullVersionResponse = {
      success: true,
      data: {
        versions: [
          {
            workflow_version_id: "wfv-1",
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [], edges: [] }),
            workflow_name: "Complete Workflow",
            date_added_to_graph: new Date().toISOString(),
            published_at: new Date().toISOString(),
            ref_id: "version-1",
            node_type: "Workflow_version" as const,
          },
        ],
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => fullVersionResponse,
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versions).toHaveLength(1);
    expect(result.current.versions[0]).toHaveProperty("workflow_name");
    expect(result.current.versions[0]).toHaveProperty("published_at");
  });

  test("should handle versions with null published_at", async () => {
    const draftVersionResponse = {
      success: true,
      data: {
        versions: [
          {
            workflow_version_id: "wfv-1",
            workflow_id: 123,
            workflow_json: JSON.stringify({ nodes: [], edges: [] }),
            date_added_to_graph: new Date().toISOString(),
            published_at: null,
            ref_id: "version-1",
            node_type: "Workflow_version" as const,
          },
        ],
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => draftVersionResponse,
    });

    const { result } = renderHook(() => useWorkflowVersions("test-workspace", 123));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versions).toHaveLength(1);
    expect(result.current.versions[0].published_at).toBeNull();
  });
});
