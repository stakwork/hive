/**
 * Unit tests for useRecentWorkflows hook
 * Tests fetching, loading states, and error handling
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRecentWorkflows } from "@/hooks/useRecentWorkflows";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockWorkflowsResponse = (workflows = [{ id: 1001, name: "Mock Workflow A" }]) => ({
  success: true,
  data: { workflows },
});

describe("useRecentWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("starts with isLoading true and empty workflows", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useRecentWorkflows());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.workflows).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  test("fetches from /api/workflow/recent on mount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockWorkflowsResponse(),
    });

    renderHook(() => useRecentWorkflows());

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workflow/recent");
    });
  });

  test("returns populated workflows on success", async () => {
    const workflows = [
      { id: 1001, name: "Mock Workflow A" },
      { id: 1002, name: "Mock Workflow B" },
      { id: 1003, name: "Mock Workflow C" },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockWorkflowsResponse(workflows),
    });

    const { result } = renderHook(() => useRecentWorkflows());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.workflows).toEqual(workflows);
    expect(result.current.error).toBeNull();
  });

  test("transitions isLoading from true to false on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockWorkflowsResponse(),
    });

    const { result } = renderHook(() => useRecentWorkflows());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  test("sets error and empty workflows on HTTP error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
    });

    const { result } = renderHook(() => useRecentWorkflows());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toMatch(/Failed to fetch recent workflows/);
    expect(result.current.workflows).toEqual([]);
  });

  test("sets error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const { result } = renderHook(() => useRecentWorkflows());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Network timeout");
    expect(result.current.workflows).toEqual([]);
  });

  test("sets error when success is false in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, error: "Unauthorized" }),
    });

    const { result } = renderHook(() => useRecentWorkflows());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Unauthorized");
    expect(result.current.workflows).toEqual([]);
  });

  test("handles empty workflows array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockWorkflowsResponse([]),
    });

    const { result } = renderHook(() => useRecentWorkflows());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.workflows).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  test("only fetches once on mount", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockWorkflowsResponse(),
    });

    const { result } = renderHook(() => useRecentWorkflows());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
