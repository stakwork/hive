/**
 * Test helpers for RepositoryAccessChecker component tests
 */
import { vi } from "vitest";

/**
 * Creates a successful mock fetch response with access granted
 */
export function mockSuccessResponse(hasPushAccess = true, hasAccess = true) {
  return {
    ok: true,
    json: async () => ({ hasAccess, hasPushAccess }),
  } as Response;
}

/**
 * Creates an error mock fetch response
 */
export function mockErrorResponse(errorMessage: string) {
  return {
    ok: true,
    json: async () => ({ error: errorMessage }),
  } as Response;
}

/**
 * Creates a failed HTTP response (non-ok status)
 */
export function mockFailedHttpResponse(status: number, errorMessage: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: errorMessage }),
  } as Response;
}

/**
 * Creates a malformed JSON response that throws when parsed
 */
export function mockMalformedJsonResponse() {
  return {
    ok: true,
    json: async () => {
      throw new Error("Invalid JSON");
    },
  } as unknown as Response;
}

/**
 * Creates a null response
 */
export function mockNullResponse() {
  return {
    ok: true,
    json: async () => null,
  } as Response;
}

/**
 * Creates an empty object response (missing expected fields)
 */
export function mockEmptyResponse() {
  return {
    ok: true,
    json: async () => ({}),
  } as Response;
}

/**
 * Verifies that fetch was called with the correct encoded URL
 */
export function expectFetchCalledWithUrl(
  mockFetch: ReturnType<typeof vi.fn>,
  repositoryUrl: string
) {
  expect(mockFetch).toHaveBeenCalledWith(
    `/api/github/app/check?repositoryUrl=${encodeURIComponent(repositoryUrl)}`
  );
}

/**
 * Verifies that the callback was called with expected access result
 */
export function expectAccessResult(
  mockCallback: ReturnType<typeof vi.fn>,
  hasAccess: boolean,
  error?: string
) {
  expect(mockCallback).toHaveBeenCalledWith(hasAccess, error);
}
