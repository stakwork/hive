import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// We need to control the preference state, so mock the module
const mockEnabled = { value: false };

vi.mock("@/hooks/useVoiceLearningPreference", () => ({
  useVoiceLearningPreference: () => ({
    enabled: mockEnabled.value,
    loading: false,
    nudgeIfNeeded: vi.fn(),
  }),
}));

// Import after mocks
import { useVoiceCorrectionCapture } from "@/hooks/useVoiceCorrectionCapture";

describe("useVoiceCorrectionCapture", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    mockEnabled.value = false;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("does NOT call fetch when enabled is false", () => {
    mockEnabled.value = false;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "task_chat" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "hello world",
        preVoiceText: "",
        finalText: "hello earth",
      });
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when rawTranscript is empty", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "task_chat" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "",
        preVoiceText: "",
        finalText: "hello earth",
      });
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when rawTranscript is only whitespace", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "task_chat" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "   ",
        preVoiceText: "",
        finalText: "hello earth",
      });
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when expected matches finalText (no correction)", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "task_chat" })
    );

    // rawTranscript alone === finalText (no preVoiceText)
    act(() => {
      result.current.capture({
        rawTranscript: "hello world",
        preVoiceText: "",
        finalText: "hello world",
      });
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when preVoiceText + rawTranscript === finalText", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "task_chat" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "world",
        preVoiceText: "hello",
        finalText: "hello world",
      });
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("DOES call fetch with correct payload when a genuine correction is detected", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "task_chat", workspaceId: "ws-123" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "ficks the log in",
        preVoiceText: "",
        finalText: "fix the login",
      });
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/voice-corrections",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawTranscript: "ficks the log in",
          preVoiceText: "",
          finalText: "fix the login",
          surface: "task_chat",
          workspaceId: "ws-123",
          orgGithubLogin: undefined,
        }),
      })
    );
  });

  it("DOES call fetch when preVoiceText + rawTranscript differs from finalText", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "sidebar" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "wurld",
        preVoiceText: "hello",
        finalText: "hello world",
      });
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/voice-corrections",
      expect.objectContaining({
        body: JSON.stringify({
          rawTranscript: "wurld",
          preVoiceText: "hello",
          finalText: "hello world",
          surface: "sidebar",
          workspaceId: undefined,
          orgGithubLogin: undefined,
        }),
      })
    );
  });

  it("strips empty workspaceId string — sends undefined in the fetch body", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "sidebar", workspaceId: "" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "ficks the log in",
        preVoiceText: "",
        finalText: "fix the login",
      });
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentBody = JSON.parse(call[1].body);
    // empty string is stripped to undefined, so it should not appear in the serialized body
    expect(sentBody.workspaceId).toBeUndefined();
  });

  it("passes orgGithubLogin through to the fetch body", () => {
    mockEnabled.value = true;
    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "sidebar", orgGithubLogin: "stakwork" })
    );

    act(() => {
      result.current.capture({
        rawTranscript: "ficks the log in",
        preVoiceText: "",
        finalText: "fix the login",
      });
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentBody = JSON.parse(call[1].body);
    expect(sentBody.orgGithubLogin).toBe("stakwork");
    expect(sentBody.workspaceId).toBeUndefined();
  });

  it("never throws even if fetch rejects", async () => {
    mockEnabled.value = true;
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useVoiceCorrectionCapture({ surface: "whiteboard" })
    );

    // Should not throw
    await act(async () => {
      result.current.capture({
        rawTranscript: "hello",
        preVoiceText: "",
        finalText: "world",
      });
    });
  });
});
