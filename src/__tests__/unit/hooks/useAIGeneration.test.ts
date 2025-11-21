import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAIGeneration } from "@/hooks/useAIGeneration";

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

global.fetch = vi.fn();

// Test helper to render the hook with default props
const renderAIGenerationHook = () => {
  return renderHook(() =>
    useAIGeneration({
      featureId: "feature-123",
      workspaceId: "workspace-123",
      type: "ARCHITECTURE",
    }),
  );
};

describe("useAIGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with null content", () => {
    const { result } = renderAIGenerationHook();

    expect(result.current.content).toBeNull();
    expect(result.current.source).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("should set content with source", async () => {
    const { result } = renderAIGenerationHook();

    await waitFor(() => {
      result.current.setContent("Generated content", "quick");
    });

    await waitFor(() => {
      expect(result.current.content).toBe("Generated content");
      expect(result.current.source).toBe("quick");
    });
  });

  it("should accept quick generation without API call", async () => {
    const { result } = renderAIGenerationHook();

    act(() => {
      result.current.setContent("Quick content", "quick");
    });

    await act(async () => {
      await result.current.accept();
    });

    expect(result.current.content).toBeNull();
    expect(result.current.source).toBeNull();
  });

  it("should accept deep generation with API call", async () => {
    // Mock the regenerate call first to get a runId
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ run: { id: "run-123", status: "PENDING" } }),
    });

    const { result } = renderAIGenerationHook();

    // First, regenerate to create a run and get runId
    await waitFor(async () => {
      await result.current.regenerate();
    });

    // Clear previous mock calls history (not the mock implementations)
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // Mock the accept call
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, run: { id: "run-123", decision: "ACCEPTED" } }),
    });

    // Simulate content being set from webhook/polling with runId
    act(() => {
      result.current.setContent("Deep content", "deep", "run-123");
    });

    // Wait for state to update
    await waitFor(() => {
      expect(result.current.content).toBe("Deep content");
      expect(result.current.source).toBe("deep");
    });

    // Now accept it
    await act(async () => {
      await result.current.accept();
    });

    // Check that the decision endpoint was called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/decision"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("ACCEPTED"),
      }),
    );
  });

  it("should reject generation", async () => {
    // Mock the regenerate call first to get a runId
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ run: { id: "run-123", status: "PENDING" } }),
    });

    const { result } = renderAIGenerationHook();

    // First, regenerate to create a run and get runId
    await waitFor(async () => {
      await result.current.regenerate();
    });

    // Mock the reject call
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, run: { id: "run-123", decision: "REJECTED" } }),
    });

    // Simulate content being set from webhook/polling
    await waitFor(() => {
      result.current.setContent("Content to reject", "deep");
    });

    // Now reject it
    await waitFor(async () => {
      await result.current.reject("Not accurate");
    });

    await waitFor(() => {
      expect(result.current.content).toBeNull();
    });
  });

  it("should regenerate after failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ run: { id: "run-new", status: "PENDING" } }),
    });

    const { result } = renderAIGenerationHook();

    await waitFor(async () => {
      await result.current.regenerate();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/stakwork/ai/generate",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("should clear content", () => {
    const { result } = renderAIGenerationHook();

    result.current.setContent("Content to clear", "quick");
    result.current.clear();

    expect(result.current.content).toBeNull();
    expect(result.current.source).toBeNull();
  });
});
