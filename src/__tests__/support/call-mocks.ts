/**
 * Centralized mock setup helpers for call-related tests.
 *
 * This file provides reusable mock configuration functions that encapsulate
 * the global.fetch vi.mock() patterns used for call API testing.
 *
 * Usage:
 * ```typescript
 * import { callMockSetup, resetCallMocks } from '@/__tests__/support/call-mocks';
 *
 * beforeEach(() => {
 *   resetCallMocks();
 *   callMockSetup.mockGetCallsSuccess([mockData.call()]);
 * });
 * ```
 */
import { vi } from "vitest";
import type { CallRecording, JarvisNode, JarvisSearchResponse } from "@/types/calls";

/**
 * Mock setup helpers for call-related API endpoints
 */
export const callMockSetup = {
  /**
   * Configures global.fetch to return successful call data from GET /api/workspaces/[slug]/calls
   *
   * @param calls - Array of CallRecording objects to return
   * @param hasMore - Whether pagination has more results (default: false)
   * @example
   * callMockSetup.mockGetCallsSuccess([mockData.call(), mockData.call({ ref_id: 'call-2' })]);
   */
  mockGetCallsSuccess(calls: CallRecording[], hasMore = false) {
    const nodes: JarvisNode[] = calls.map((call) => ({
      ref_id: call.ref_id,
      node_type: "Episode",
      date_added_to_graph: call.date_added_to_graph,
      properties: {
        episode_title: call.episode_title,
        media_url: call.media_url || "",
        source_link: call.source_link || "",
        description: call.description,
      },
    }));

    // Add extra node if hasMore=true to simulate pagination
    if (hasMore && calls.length > 0) {
      nodes.push({
        ref_id: `${calls[calls.length - 1].ref_id}-extra`,
        node_type: "Episode",
        date_added_to_graph: calls[calls.length - 1].date_added_to_graph + 1,
        properties: {
          episode_title: "Extra call for pagination",
          media_url: "https://example.com/extra.mp4",
          source_link: "https://example.com/extra.mp4",
        },
      });
    }

    const mockResponse: JarvisSearchResponse = {
      nodes,
      edges: [],
    };

    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
  },

  /**
   * Configures global.fetch to return error response from GET /api/workspaces/[slug]/calls
   *
   * @param statusCode - HTTP status code (default: 500)
   * @param statusText - Error message (default: "Internal Server Error")
   * @example
   * callMockSetup.mockGetCallsError(404, "Swarm not found");
   */
  mockGetCallsError(statusCode = 500, statusText = "Internal Server Error") {
    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: false,
      status: statusCode,
      statusText,
    });
  },

  /**
   * Configures global.fetch to return successful Jarvis API response with custom nodes
   *
   * @param nodes - Array of JarvisNode objects to return from Jarvis API
   * @example
   * callMockSetup.mockJarvisApiSuccess([mockData.jarvisNode()]);
   */
  mockJarvisApiSuccess(nodes: JarvisNode[]) {
    const mockResponse: JarvisSearchResponse = {
      nodes,
      edges: [],
    };

    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
  },

  /**
   * Configures global.fetch to return error from Jarvis API
   *
   * @param statusCode - HTTP status code (default: 500)
   * @param statusText - Error message (default: "Jarvis API Error")
   * @example
   * callMockSetup.mockJarvisApiError(503, "Service Unavailable");
   */
  mockJarvisApiError(statusCode = 500, statusText = "Jarvis API Error") {
    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: false,
      status: statusCode,
      statusText,
    });
  },

  /**
   * Configures global.fetch to return successful call link generation response
   *
   * @param callUrl - Generated call URL to return
   * @example
   * callMockSetup.mockGenerateCallLinkSuccess("https://meet.example.com/abc-123");
   */
  mockGenerateCallLinkSuccess(callUrl: string) {
    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: callUrl }),
    });
  },

  /**
   * Configures global.fetch to return error from call link generation
   *
   * @param error - Error message (default: "Failed to generate call link")
   * @example
   * callMockSetup.mockGenerateCallLinkError("Swarm not configured");
   */
  mockGenerateCallLinkError(error = "Failed to generate call link") {
    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error }),
    });
  },

  /**
   * Configures global.fetch to return empty call list (no recordings)
   *
   * @example
   * callMockSetup.mockEmptyCallList();
   */
  mockEmptyCallList() {
    const mockResponse: JarvisSearchResponse = {
      nodes: [],
      edges: [],
    };

    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
  },

  /**
   * Configures global.fetch to return paginated call data
   *
   * @param page - Page number (0-indexed)
   * @param limit - Items per page
   * @param totalItems - Total number of items available
   * @param callFactory - Function to generate call data for a given index
   * @example
   * callMockSetup.mockPaginatedCalls(0, 10, 25, (i) => mockData.call({ ref_id: `call-${i}` }));
   */
  mockPaginatedCalls(page: number, limit: number, totalItems: number, callFactory: (index: number) => CallRecording) {
    const skip = page * limit;
    const itemsToReturn = Math.min(limit, totalItems - skip);
    const hasMore = skip + itemsToReturn < totalItems;

    const calls: CallRecording[] = [];
    for (let i = 0; i < itemsToReturn; i++) {
      calls.push(callFactory(skip + i));
    }

    this.mockGetCallsSuccess(calls, hasMore);
  },
};

/**
 * Resets all call-related mocks to default state
 *
 * Should be called in beforeEach() to ensure clean test state
 *
 * @example
 * beforeEach(() => {
 *   resetCallMocks();
 * });
 */
export function resetCallMocks() {
  vi.clearAllMocks();
  global.fetch = vi.fn();
}

/**
 * Creates a batch of mock call recordings for testing
 *
 * @param count - Number of call recordings to generate
 * @param startDate - Starting timestamp (default: current time)
 * @returns Array of CallRecording objects with sequential data
 * @example
 * const calls = createMockCallBatch(5);
 * callMockSetup.mockGetCallsSuccess(calls);
 */
export function createMockCallBatch(count: number, startDate = Date.now() / 1000): CallRecording[] {
  return Array.from({ length: count }, (_, i) => ({
    ref_id: `call-${i + 1}`,
    episode_title: `Meeting recording ${new Date((startDate + i * 3600) * 1000).toISOString()}`,
    date_added_to_graph: startDate + i * 3600,
    description: `Test meeting ${i + 1}`,
    source_link: `https://example.com/recording-${i + 1}.mp4`,
    media_url: `https://example.com/recording-${i + 1}.mp4`,
    image_url: `https://example.com/thumbnail-${i + 1}.jpg`,
  }));
}
