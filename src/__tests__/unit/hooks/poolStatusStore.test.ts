import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchPoolStatusDeduped,
  registerResumeCallback,
  isDocumentVisible,
} from "@/hooks/poolStatusStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(status = { running: 1, total: 2 }) {
  return {
    ok: true,
    json: async () => ({ success: true, data: { status } }),
  };
}

function makeErrorResponse(message = "oops") {
  return {
    ok: false,
    json: async () => ({ error: message }),
  };
}

// ---------------------------------------------------------------------------
// Reset module state between tests by re-importing (vitest module isolation)
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// fetchPoolStatusDeduped
// ---------------------------------------------------------------------------

describe("fetchPoolStatusDeduped", () => {
  it("returns null and issues no request when slug is empty", async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    const result = await fetchPoolStatusDeduped("");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null and issues no request when slug is undefined", async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    const result = await fetchPoolStatusDeduped(undefined);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches pool status for a valid slug", async () => {
    const mockStatus = { running: 2, total: 5 };
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse(mockStatus));

    // Re-import to get fresh module state (no stale in-flight map entries)
    const { fetchPoolStatusDeduped: fresh } = await import(
      "@/hooks/poolStatusStore"
    );

    const result = await fresh("my-slug");
    expect(result).toEqual(mockStatus);
    expect(global.fetch).toHaveBeenCalledWith("/api/w/my-slug/pool/status");
  });

  it("deduplicates concurrent calls for the same slug to a single fetch", async () => {
    const mockStatus = { running: 1, total: 3 };
    let resolveFirst!: (v: unknown) => void;
    const blocker = new Promise((res) => {
      resolveFirst = res;
    });

    global.fetch = vi.fn().mockReturnValue(
      blocker.then(() => makeOkResponse(mockStatus))
    );

    const { fetchPoolStatusDeduped: fresh } = await import(
      "@/hooks/poolStatusStore"
    );

    // Fire two concurrent calls before the first resolves
    const p1 = fresh("dedupe-slug");
    const p2 = fresh("dedupe-slug");

    resolveFirst(undefined);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(mockStatus);
    expect(r2).toEqual(mockStatus);
  });

  it("removes the in-flight entry after resolution so a subsequent call re-fetches", async () => {
    const mockStatus = { running: 0, total: 1 };
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse(mockStatus));

    const { fetchPoolStatusDeduped: fresh } = await import(
      "@/hooks/poolStatusStore"
    );

    await fresh("slug-reuse");
    await fresh("slug-reuse");

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse("server error"));

    const { fetchPoolStatusDeduped: fresh } = await import(
      "@/hooks/poolStatusStore"
    );

    // Attach a no-op rejection handler before the expect call to prevent
    // vitest from treating the shared in-flight promise as an unhandled rejection
    const p = fresh("err-slug");
    p.catch(() => {});
    await expect(p).rejects.toThrow("server error");
  });

  it("throws when success is false", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: "bad data" }),
    });

    const { fetchPoolStatusDeduped: fresh } = await import(
      "@/hooks/poolStatusStore"
    );

    const p = fresh("err-slug2");
    p.catch(() => {});
    await expect(p).rejects.toThrow("bad data");
  });
});

// ---------------------------------------------------------------------------
// isDocumentVisible
// ---------------------------------------------------------------------------

describe("isDocumentVisible", () => {
  it("returns true when visibilityState is visible", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    expect(isDocumentVisible()).toBe(true);
  });

  it("returns false when visibilityState is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    expect(isDocumentVisible()).toBe(false);

    // Restore
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });
});

// ---------------------------------------------------------------------------
// registerResumeCallback / shared visibility manager
// ---------------------------------------------------------------------------

describe("registerResumeCallback", () => {
  it("calls the callback when document transitions to visible", () => {
    const cb = vi.fn();
    const unregister = registerResumeCallback(cb);

    // Simulate hidden → visible transition
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(cb).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("does not call the callback when document becomes hidden", () => {
    const cb = vi.fn();
    const unregister = registerResumeCallback(cb);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(cb).not.toHaveBeenCalled();
    unregister();

    // Restore
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("fires all registered callbacks on visible transition", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const u1 = registerResumeCallback(cb1);
    const u2 = registerResumeCallback(cb2);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);

    u1();
    u2();
  });

  it("stops calling callback after unregistration", () => {
    const cb = vi.fn();
    const unregister = registerResumeCallback(cb);
    unregister();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(cb).not.toHaveBeenCalled();
  });
});
