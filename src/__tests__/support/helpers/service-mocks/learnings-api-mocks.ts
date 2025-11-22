import { vi } from "vitest";

/**
 * Creates a successful fetch spy for GET /api/learnings endpoint
 * Returns mock data with prompts and hints
 */
export function mockSuccessfulGetLearnings() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ prompts: [], hints: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

/**
 * Creates a successful fetch spy for POST /api/learnings endpoint
 * Returns a success response
 */
export function mockSuccessfulPostLearnings() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

/**
 * Creates a fetch spy that returns a custom response
 * @param data - The response data to return
 * @param status - HTTP status code (default: 200)
 */
export function mockCustomLearningsResponse(data: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

/**
 * Creates a fetch spy that simulates a network error
 * @param errorMessage - The error message to throw
 */
export function mockLearningsNetworkError(errorMessage = "Network error: Connection timeout") {
  return vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(errorMessage));
}
