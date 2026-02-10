import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { checkFrontendAvailable } from "@/lib/pods/utils";
import { JlistProcess } from "@/types/pod-repair";
import { createMockFrontendProcess } from "@/__tests__/support/helpers/pod-helpers";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("checkFrontendAvailable", () => {
  const mockPodId = "workspace-abc123";
  const mockPortMappings: number[] = [15552, 3000, 8080];

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when frontend process is not in jlist", () => {
    test("returns not available with error message", async () => {
      const jlist: JlistProcess[] = [
        { pid: 1234, name: "api", status: "online", port: "8080" },
      ];

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(false);
      expect(result.frontendUrl).toBeNull();
      expect(result.error).toBe("Frontend process not found in jlist");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns not available when jlist is empty", async () => {
      const jlist: JlistProcess[] = [];

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(false);
      expect(result.frontendUrl).toBeNull();
      expect(result.error).toBe("Frontend process not found in jlist");
    });
  });

  describe("when frontend process exists and is accessible", () => {
    test("returns available with frontend URL from port mappings", async () => {
      const frontendProcess = createMockFrontendProcess();
      const jlist: JlistProcess[] = [{ ...frontendProcess, pid: frontendProcess.pid }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(true);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
      expect(result.error).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        `https://${mockPodId}-3000.workspaces.sphinx.chat`,
        expect.objectContaining({
          method: "HEAD",
          signal: expect.any(AbortSignal),
        })
      );
    });

    test("returns available when frontend process port is found in mappings", async () => {
      const jlist: JlistProcess[] = [{ pid: 1234, name: "frontend", status: "online", port: "8080" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(true);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-8080.workspaces.sphinx.chat`);
    });
  });

  describe("fallback URL resolution", () => {
    test("falls back to port 3000 when process port not in mappings", async () => {
      const jlist: JlistProcess[] = [{ pid: 1234, name: "frontend", status: "online", port: "5000" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(true);
      // Falls back to discovered frontend port since 5000 not in mappings but 3000 is
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
    });

    test("uses discovered port when not in mappings but valid", async () => {
      const jlist: JlistProcess[] = [{ pid: 1234, name: "frontend", status: "online", port: "4000" }];
      const emptyMappings: number[] = [];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await checkFrontendAvailable(jlist, emptyMappings, mockPodId);

      expect(result.available).toBe(true);
      // Uses the discovered frontend port even if not in mappings
      expect(result.frontendUrl).toBe(`https://${mockPodId}-4000.workspaces.sphinx.chat`);
    });

    test("uses default fallback port 3000 when frontend has no port", async () => {
      const jlist: JlistProcess[] = [
        { pid: 1234, name: "frontend", status: "online" }, // No port
      ];
      const emptyMappings: number[] = [];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await checkFrontendAvailable(jlist, emptyMappings, mockPodId);

      expect(result.available).toBe(true);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
    });
  });

  describe("when frontend health check fails", () => {
    test("returns not available when fetch returns non-ok status", async () => {
      const jlist: JlistProcess[] = [{ pid: 1234, name: "frontend", status: "online", port: "3000" }];

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(false);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
      expect(result.error).toBeUndefined();
    });

    test("returns not available with error when fetch throws", async () => {
      const jlist: JlistProcess[] = [{ pid: 1234, name: "frontend", status: "online", port: "3000" }];

      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(false);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
      expect(result.error).toBe("Frontend URL not responding");
    });

    test("returns not available when fetch times out", async () => {
      const jlist: JlistProcess[] = [{ pid: 1234, name: "frontend", status: "online", port: "3000" }];

      mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(false);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
      expect(result.error).toBe("Frontend URL not responding");
    });
  });

  describe("edge cases", () => {
    test("handles frontend process with null pid", async () => {
      const jlist: JlistProcess[] = [{ pid: null, name: "frontend", status: "online", port: "3000" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(true);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
    });

    test("is case-sensitive for process name matching", async () => {
      const jlist: JlistProcess[] = [
        { pid: 1234, name: "Frontend", status: "online", port: "3000" },
        { pid: 5678, name: "FRONTEND", status: "online", port: "3000" },
      ];

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(false);
      expect(result.error).toBe("Frontend process not found in jlist");
    });

    test("handles multiple frontend processes - uses first match", async () => {
      const jlist: JlistProcess[] = [
        { pid: 1234, name: "frontend", status: "online", port: "3000" },
        { pid: 5678, name: "frontend", status: "online", port: "4000" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await checkFrontendAvailable(jlist, mockPortMappings, mockPodId);

      expect(result.available).toBe(true);
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
    });

    test("handles non-array portMappings gracefully", async () => {
      const jlist: JlistProcess[] = [{ pid: 1234, name: "frontend", status: "online", port: "3000" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      // Pass an object instead of array to test defensive check
      const result = await checkFrontendAvailable(
        jlist,
        { "3000": "https://old-format.example.com" } as unknown as number[],
        mockPodId
      );

      expect(result.available).toBe(true);
      // Falls back to using the discovered frontend port
      expect(result.frontendUrl).toBe(`https://${mockPodId}-3000.workspaces.sphinx.chat`);
    });
  });
});
