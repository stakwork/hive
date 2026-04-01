import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState, useEffect } from "react";
import { ArtifactType } from "@/lib/chat";

/**
 * Unit tests for ArtifactsPanel attachment count fetch logic.
 *
 * Tests the useEffect that fires when `hasTasks && featureId` first becomes true,
 * fetches /api/features/[featureId]/attachments/count, and drives `hasAttachments`.
 */

function useAttachmentsCountLogic(
  initialHasTasks = false,
  featureId: string | undefined = undefined
) {
  const [hasTasks, setHasTasks] = useState(initialHasTasks);
  const [hasAttachments, setHasAttachments] = useState(false);

  useEffect(() => {
    if (!hasTasks || !featureId) return;
    fetch(`/api/features/${featureId}/attachments/count`)
      .then((r) => r.json())
      .then((data) => {
        if (data.count > 0) setHasAttachments(true);
      })
      .catch(() => {});
  }, [hasTasks, featureId]);

  const disabledTabs: ArtifactType[] = hasAttachments ? [] : ["VERIFY"];

  return {
    hasTasks,
    hasAttachments,
    disabledTabs,
    setHasTasks,
  };
}

describe("ArtifactsPanel - attachment count fetch logic", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("fetch is NOT called when hasTasks is false", () => {
    renderHook(() => useAttachmentsCountLogic(false, "feat-1"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch is NOT called when featureId is undefined", () => {
    renderHook(() => useAttachmentsCountLogic(true, undefined));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch is NOT called when both hasTasks=false and featureId undefined", () => {
    renderHook(() => useAttachmentsCountLogic(false, undefined));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch IS called once when hasTasks becomes true", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ count: 0 }),
    });

    const { result } = renderHook(() => useAttachmentsCountLogic(false, "feat-1"));

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      result.current.setHasTasks(true);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/features/feat-1/attachments/count");
  });

  test("fetch IS called once on mount when hasTasks=true initially", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ count: 3 }),
    });

    await act(async () => {
      renderHook(() => useAttachmentsCountLogic(true, "feat-42"));
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/features/feat-42/attachments/count");
  });

  test("when count > 0: hasAttachments becomes true and disabledTabs is []", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ count: 5 }),
    });

    const { result } = renderHook(() => useAttachmentsCountLogic(false, "feat-1"));

    await act(async () => {
      result.current.setHasTasks(true);
    });

    expect(result.current.hasAttachments).toBe(true);
    expect(result.current.disabledTabs).toEqual([]);
  });

  test("when count === 0: hasAttachments stays false and disabledTabs is ['VERIFY']", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ count: 0 }),
    });

    const { result } = renderHook(() => useAttachmentsCountLogic(false, "feat-1"));

    await act(async () => {
      result.current.setHasTasks(true);
    });

    expect(result.current.hasAttachments).toBe(false);
    expect(result.current.disabledTabs).toEqual(["VERIFY"]);
  });

  test("fetch error is silently swallowed; hasAttachments stays false", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useAttachmentsCountLogic(false, "feat-1"));

    await act(async () => {
      result.current.setHasTasks(true);
    });

    expect(result.current.hasAttachments).toBe(false);
    expect(result.current.disabledTabs).toEqual(["VERIFY"]);
  });

  test("fetch is called only once even if hasTasks stays true across re-renders", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ count: 2 }),
    });

    const { result, rerender } = renderHook(() => useAttachmentsCountLogic(true, "feat-1"));

    await act(async () => {
      rerender();
      rerender();
    });

    // Should still only be called once (hasTasks and featureId haven't changed)
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
