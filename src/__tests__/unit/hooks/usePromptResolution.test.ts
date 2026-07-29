import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { type MessageSegment } from "@/lib/prompts/detect-prompt-names";

// ─── Mock verifyPromptName ────────────────────────────────────────────────────

const mockVerifyPromptName = vi.fn();

vi.mock("@/lib/prompts/prompt-verification-cache", () => ({
  verifyPromptName: (name: string) => mockVerifyPromptName(name),
}));

import { usePromptResolution } from "@/hooks/usePromptResolution";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function promptSeg(name: string): MessageSegment {
  return { type: "prompt", name };
}

function versionSeg(label: string, number: number, promptName: string): MessageSegment {
  return { type: "version", label, number, promptName };
}

function textSeg(value: string): MessageSegment {
  return { type: "text", value };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("usePromptResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns empty map initially (before fetches resolve)", () => {
    // verifyPromptName never resolves in this tick
    mockVerifyPromptName.mockReturnValue(new Promise(() => {}));

    const segments: MessageSegment[] = [promptSeg("MY_PROMPT")];
    const { result } = renderHook(() => usePromptResolution(segments));

    expect(result.current.size).toBe(0);
  });

  test("segments with no prompt/version type fire no fetch", () => {
    const segments: MessageSegment[] = [textSeg("hello world"), textSeg("more text")];
    renderHook(() => usePromptResolution(segments));

    expect(mockVerifyPromptName).not.toHaveBeenCalled();
  });

  test("two unique prompt name segments → two parallel calls, both populated in map", async () => {
    mockVerifyPromptName.mockImplementation((name: string) => {
      if (name === "ALPHA_PROMPT")
        return Promise.resolve({ id: "a1", publishedVersionId: "av1" });
      if (name === "BETA_PROMPT")
        return Promise.resolve({ id: "b2", publishedVersionId: null });
      return Promise.resolve(null);
    });

    const segments: MessageSegment[] = [
      promptSeg("ALPHA_PROMPT"),
      textSeg(" and "),
      promptSeg("BETA_PROMPT"),
    ];

    const { result } = renderHook(() => usePromptResolution(segments));

    await waitFor(() => expect(result.current.size).toBe(2));

    expect(mockVerifyPromptName).toHaveBeenCalledTimes(2);
    expect(mockVerifyPromptName).toHaveBeenCalledWith("ALPHA_PROMPT");
    expect(mockVerifyPromptName).toHaveBeenCalledWith("BETA_PROMPT");

    expect(result.current.get("ALPHA_PROMPT")).toEqual({
      id: "a1",
      publishedVersionId: "av1",
    });
    expect(result.current.get("BETA_PROMPT")).toEqual({
      id: "b2",
      publishedVersionId: null,
    });
  });

  test("version segment's promptName is resolved, not the label", async () => {
    mockVerifyPromptName.mockImplementation((name: string) => {
      if (name === "MY_PROMPT")
        return Promise.resolve({ id: "p1", publishedVersionId: "pv1" });
      return Promise.resolve(null);
    });

    const segments: MessageSegment[] = [
      promptSeg("MY_PROMPT"),
      versionSeg("version 3", 3, "MY_PROMPT"),
    ];

    const { result } = renderHook(() => usePromptResolution(segments));

    await waitFor(() => expect(result.current.size).toBe(1));

    // Only one fetch — the version segment shares the same promptName
    expect(mockVerifyPromptName).toHaveBeenCalledTimes(1);
    expect(mockVerifyPromptName).toHaveBeenCalledWith("MY_PROMPT");
    expect(result.current.get("MY_PROMPT")).toEqual({
      id: "p1",
      publishedVersionId: "pv1",
    });
  });

  test("unverified prompt name (null result) is absent from the map", async () => {
    mockVerifyPromptName.mockResolvedValue(null);

    const segments: MessageSegment[] = [promptSeg("NOT_A_REAL_PROMPT")];
    const { result } = renderHook(() => usePromptResolution(segments));

    await waitFor(() =>
      // After the promise resolves the effect has run; the map should be empty
      expect(mockVerifyPromptName).toHaveBeenCalledTimes(1),
    );

    expect(result.current.size).toBe(0);
  });

  test("duplicate prompt/version segments for the same name only fire one fetch", async () => {
    mockVerifyPromptName.mockResolvedValue({ id: "dup1", publishedVersionId: null });

    const segments: MessageSegment[] = [
      promptSeg("DUP_PROMPT"),
      versionSeg("version 1", 1, "DUP_PROMPT"),
      versionSeg("version 2", 2, "DUP_PROMPT"),
    ];

    const { result } = renderHook(() => usePromptResolution(segments));

    await waitFor(() => expect(result.current.size).toBe(1));

    // Set deduplication ensures only one verifyPromptName call
    expect(mockVerifyPromptName).toHaveBeenCalledTimes(1);
    expect(mockVerifyPromptName).toHaveBeenCalledWith("DUP_PROMPT");
  });
});
