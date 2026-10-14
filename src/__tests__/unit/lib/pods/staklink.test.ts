import { describe, it, expect, vi, beforeEach } from "vitest";
import { staklinkFetch, fetchJlist } from "@/lib/pods/staklink";

describe("staklinkFetch", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("builds the control-port URL with path/query and Bearer auth", async () => {
    fetchSpy.mockResolvedValue(new Response("ok"));
    await staklinkFetch({ podId: "pod-1", password: "pw" }, "/logs?lines=5");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://pod-1-15552.workspaces.sphinx.chat/logs?lines=5");
    expect(init.headers.Authorization).toBe("Bearer pw");
    expect(init.signal).toBeDefined();
  });

  it("omits Authorization without a password", async () => {
    fetchSpy.mockResolvedValue(new Response("ok"));
    await staklinkFetch({ podId: "pod-1", password: null }, "/jlist");
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("fetchJlist returns null on failure and parsed list on success", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("x", { status: 500 }));
    expect(await fetchJlist("pod-1", "pw")).toBeNull();
    fetchSpy.mockRejectedValueOnce(new Error("boom"));
    expect(await fetchJlist("pod-1", "pw")).toBeNull();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([{ name: "a", status: "online" }])));
    expect(await fetchJlist("pod-1", "pw")).toEqual([{ name: "a", status: "online" }]);
  });
});
