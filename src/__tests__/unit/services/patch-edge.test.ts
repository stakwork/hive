import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import the real implementation (no mock for nodes.ts in this file)
import { patchEdge } from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";

const CONFIG: JarvisConnectionConfig = {
  jarvisUrl: "https://swarm.sphinx.chat:8444",
  apiKey: "key-abc",
};

describe("patchEdge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("calls PATCH /v2/edges/:ref_id with correct URL, method, and body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "success" }), { status: 200 }),
    );

    const result = await patchEdge(CONFIG, "edge-ref-123", { is_deleted: true });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://swarm.sphinx.chat:8444/v2/edges/edge-ref-123");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ is_deleted: true });
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("key-abc");
  });

  test("strips trailing slash from jarvisUrl before building path", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const configWithSlash: JarvisConnectionConfig = {
      ...CONFIG,
      jarvisUrl: "https://swarm.sphinx.chat:8444/",
    };
    await patchEdge(configWithSlash, "edge-1", { is_deleted: true });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://swarm.sphinx.chat:8444/v2/edges/edge-1");
  });

  test("URL-encodes special characters in edgeRefId", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await patchEdge(CONFIG, "edge ref/123", { is_deleted: true });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://swarm.sphinx.chat:8444/v2/edges/edge%20ref%2F123");
  });

  test("returns { success: true } on 2xx response", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await patchEdge(CONFIG, "edge-ok", { is_deleted: true });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("returns { success: false, error } on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Not found", { status: 404 }),
    );

    const result = await patchEdge(CONFIG, "edge-999", { is_deleted: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  test("returns { success: false, error } on 500 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Server error", { status: 500 }),
    );

    const result = await patchEdge(CONFIG, "edge-err", { is_deleted: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  test("returns { success: false, error } on fetch exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await patchEdge(CONFIG, "edge-throw", { is_deleted: true });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network failure");
  });

  test("sends arbitrary data payload as JSON body", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await patchEdge(CONFIG, "edge-x", { is_deleted: true, custom_field: "hello" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      is_deleted: true,
      custom_field: "hello",
    });
  });
});
