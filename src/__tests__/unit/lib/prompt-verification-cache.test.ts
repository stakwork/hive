import { describe, test, expect, vi, beforeEach } from "vitest";

// We import the cache module AFTER we set up the fetch mock so the module-level
// state is predictable. We also import the private clear helper so each test
// starts with an empty cache.
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Dynamic import after mock is set up
import {
  verifyPromptName,
  _clearVerificationCache,
} from "@/lib/prompts/prompt-verification-cache";

function makeOkResponse(prompts: Array<{ name: string; id: string; published_version_id: string | null }>) {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        data: { prompts },
      }),
  } as Response);
}

function makeErrorResponse(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: "server error" }),
  } as Response);
}

describe("verifyPromptName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearVerificationCache();
  });

  test("first call for a name fires one fetch", async () => {
    mockFetch.mockReturnValueOnce(
      makeOkResponse([{ name: "MY_PROMPT", id: "prompt-123", published_version_id: "v1" }]),
    );

    const result = await verifyPromptName("MY_PROMPT");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workflow/prompts?search=MY_PROMPT&exact=true",
    );
    expect(result).toEqual({ id: "prompt-123", publishedVersionId: "v1" });
  });

  test("second call for the same name returns the cached promise (no second fetch)", async () => {
    mockFetch.mockReturnValueOnce(
      makeOkResponse([{ name: "MY_PROMPT", id: "prompt-123", published_version_id: "v1" }]),
    );

    const p1 = verifyPromptName("MY_PROMPT");
    const p2 = verifyPromptName("MY_PROMPT");

    // Both promises are the same object (cache deduplication)
    expect(p1).toBe(p2);

    await p1;
    await p2;

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("network error resolves to null (no throw)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await verifyPromptName("BROKEN_PROMPT");

    expect(result).toBeNull();
  });

  test("non-ok HTTP response resolves to null", async () => {
    mockFetch.mockReturnValueOnce(makeErrorResponse(500));

    const result = await verifyPromptName("BAD_SERVER_PROMPT");

    expect(result).toBeNull();
  });

  test("name not in API response resolves to null", async () => {
    // API returns a different prompt name
    mockFetch.mockReturnValueOnce(
      makeOkResponse([{ name: "OTHER_PROMPT", id: "other-id", published_version_id: null }]),
    );

    const result = await verifyPromptName("NOT_IN_RESPONSE");

    expect(result).toBeNull();
  });

  test("different names each fire their own fetch", async () => {
    mockFetch
      .mockReturnValueOnce(
        makeOkResponse([{ name: "ALPHA_PROMPT", id: "a1", published_version_id: null }]),
      )
      .mockReturnValueOnce(
        makeOkResponse([{ name: "BETA_PROMPT", id: "b2", published_version_id: "bv1" }]),
      );

    const [r1, r2] = await Promise.all([
      verifyPromptName("ALPHA_PROMPT"),
      verifyPromptName("BETA_PROMPT"),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(r1).toEqual({ id: "a1", publishedVersionId: null });
    expect(r2).toEqual({ id: "b2", publishedVersionId: "bv1" });
  });

  test("published_version_id null is preserved correctly", async () => {
    mockFetch.mockReturnValueOnce(
      makeOkResponse([{ name: "UNPUBLISHED_PROMPT", id: "up-1", published_version_id: null }]),
    );

    const result = await verifyPromptName("UNPUBLISHED_PROMPT");

    expect(result).toEqual({ id: "up-1", publishedVersionId: null });
  });
});
