import { vi } from "vitest";

/**
 * Creates a mock fetch response with success (ok: true)
 */
export const createSuccessFetchMock = (data: any) => ({
  ok: true,
  json: async () => data,
});

/**
 * Creates a mock fetch response with error (ok: false)
 */
export const createErrorFetchMock = (errorMessage?: string) => ({
  ok: false,
  json: async () => ({ error: errorMessage || "Unknown error" }),
});

/**
 * Setup mock fetch with a single successful response
 */
export const mockFetchSuccess = (mockFetch: ReturnType<typeof vi.fn>, data: any) => {
  mockFetch.mockResolvedValueOnce(createSuccessFetchMock(data));
};

/**
 * Setup mock fetch with a single error response
 */
export const mockFetchError = (mockFetch: ReturnType<typeof vi.fn>, errorMessage?: string) => {
  mockFetch.mockResolvedValueOnce(createErrorFetchMock(errorMessage));
};

/**
 * Setup mock fetch with multiple successful responses
 */
export const mockFetchSuccessMultiple = (mockFetch: ReturnType<typeof vi.fn>, data: any) => {
  mockFetch.mockResolvedValue(createSuccessFetchMock(data));
};

/**
 * Setup mock fetch with multiple error responses
 */
export const mockFetchErrorMultiple = (mockFetch: ReturnType<typeof vi.fn>, errorMessage?: string) => {
  mockFetch.mockResolvedValue(createErrorFetchMock(errorMessage));
};

/**
 * Setup mock fetch to reject with network error
 */
export const mockFetchNetworkError = (mockFetch: ReturnType<typeof vi.fn>, errorMessage: string) => {
  mockFetch.mockRejectedValueOnce(new Error(errorMessage));
};
