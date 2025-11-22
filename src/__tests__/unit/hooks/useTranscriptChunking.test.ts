import { renderHook, act } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { useTranscriptChunking } from "@/hooks/useTranscriptChunking";

describe("useTranscriptChunking", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Keyword Detection - Basic Cases", () => {
    test("detects lowercase 'hive' keyword", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's use hive for this project", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("detects uppercase 'HIVE' keyword", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "We need to configure HIVE settings", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("detects mixed case 'Hive' keyword", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "The Hive platform is ready", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });
  });

  describe("Keyword Detection - Punctuation Handling", () => {
    test("detects 'hive' followed by period", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's deploy to hive. It will work great", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("detects 'hive' followed by exclamation mark", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "This is perfect for hive! Let's proceed", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("detects 'hive' followed by comma", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Using hive, we can improve our workflow significantly", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("detects 'hive' followed by question mark", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Should we use hive? I think it's the right choice", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });
  });

  describe("Keyword Detection - Edge Cases", () => {
    test("does NOT detect 'beehive' (partial match)", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "The beehive is active and buzzing with activity", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":false'),
        })
      );
    });

    test("does NOT detect 'hivelike' (partial match)", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "This is a hivelike structure for our project", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":false'),
        })
      );
    });

    test("sets containsKeyword to false when keyword not present", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "This is a regular transcript without the keyword", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":false'),
        })
      );
    });

    test("detects multiple occurrences of keyword", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's use hive and configure hive properly for the project", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("handles empty transcript gracefully", async () => {
      renderHook(() =>
        useTranscriptChunking({
          transcript: "",
          enabled: true,
          workspaceSlug: "test-workspace",
          minWords: 5,
          pauseDurationMs: 1000,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("detects keyword at start of transcript", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "hive is the platform we need for this", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("detects keyword at end of transcript", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's deploy this feature to hive", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });
  });

  describe("Payload Structure Verification", () => {
    test("includes all required fields in payload", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's use hive for this feature implementation", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalled();
      const callArgs = fetchMock.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);

      expect(payload).toHaveProperty("chunk");
      expect(payload).toHaveProperty("wordCount");
      expect(payload).toHaveProperty("workspaceSlug");
      expect(payload).toHaveProperty("containsKeyword");
      expect(payload.chunk).toBe("Let's use hive for this feature implementation");
      expect(payload.wordCount).toBe(7);
      expect(payload.workspaceSlug).toBe("test-workspace");
      expect(payload.containsKeyword).toBe(true);
    });

    test("payload structure with no keyword", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "This is a regular transcript without special keywords", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalled();
      const callArgs = fetchMock.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);

      expect(payload.containsKeyword).toBe(false);
    });
  });

  describe("Integration with Chunking Logic", () => {
    test("keyword detection works with pause-based chunking", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's use hive for this", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("keyword detection works with max words chunking", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            maxWords: 10,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      const longTranscript = "Let's use hive platform for implementing this new feature today with our team members";
      act(() => {
        rerender({ transcript: longTranscript, enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transcript/chunk",
        expect.objectContaining({
          body: expect.stringContaining('"containsKeyword":true'),
        })
      );
    });

    test("does not send chunk when disabled", async () => {
      renderHook(() =>
        useTranscriptChunking({
          transcript: "Let's use hive for this project",
          enabled: false,
          workspaceSlug: "test-workspace",
          minWords: 5,
          pauseDurationMs: 1000,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("resets tracking when enabled changes", async () => {
      const { rerender } = renderHook(
        ({ enabled }) =>
          useTranscriptChunking({
            transcript: "Let's use hive for this feature",
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { enabled: false },
        }
      );

      act(() => {
        rerender({ enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("handles fetch errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: "test-workspace",
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's use hive for this project", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error sending transcript chunk:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test("does not send when workspaceSlug is missing", async () => {
      const { rerender } = renderHook(
        ({ transcript, enabled }) =>
          useTranscriptChunking({
            transcript,
            enabled,
            workspaceSlug: undefined,
            minWords: 5,
            pauseDurationMs: 1000,
          }),
        {
          initialProps: { transcript: "", enabled: true },
        }
      );

      act(() => {
        rerender({ transcript: "Let's use hive for this project", enabled: true });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
