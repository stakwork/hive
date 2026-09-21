import { describe, expect, it, vi, beforeEach } from "vitest";
import { listProtectEndpoints, parseProtectEndpoint } from "@/lib/protect/endpoints";
import * as nodes from "@/services/swarm/api/nodes";

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: vi.fn(),
}));

const CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "key" };

function endpointNode(index: number, name = `/api/items/${index}`) {
  return {
    ref_id: `ref-${index}`,
    node_type: "Endpoint",
    properties: { name, verb: "get", file: "src/routes.ts" },
  };
}

describe("parseProtectEndpoint", () => {
  it("maps node properties and uppercases the verb", () => {
    expect(parseProtectEndpoint(endpointNode(1))).toEqual({
      refId: "ref-1",
      name: "/api/items/1",
      verb: "GET",
      file: "src/routes.ts",
    });
  });

  it("tolerates missing properties and drops nodes without a ref_id", () => {
    expect(parseProtectEndpoint({ ref_id: "ref-1", node_type: "Endpoint" })).toEqual({
      refId: "ref-1",
      name: "",
      verb: "",
      file: "",
    });
    expect(parseProtectEndpoint({ ref_id: "", node_type: "Endpoint" })).toBeNull();
  });
});

describe("listProtectEndpoints", () => {
  beforeEach(() => {
    vi.mocked(nodes.searchNodesByAttributes).mockReset();
  });

  it("searches Endpoint nodes by type with properties and sorts by name", async () => {
    vi.mocked(nodes.searchNodesByAttributes).mockResolvedValueOnce({
      ok: true,
      nodes: [endpointNode(1, "/b"), endpointNode(2, "/a")],
    });

    const result = await listProtectEndpoints(CONFIG);

    expect(result).toMatchObject({ ok: true, truncated: false });
    expect(result.endpoints.map((endpoint) => endpoint.name)).toEqual(["/a", "/b"]);
    expect(nodes.searchNodesByAttributes).toHaveBeenCalledWith(CONFIG, {
      nodeTypes: ["Endpoint"],
      filters: [],
      includeProperties: true,
      limit: 5000,
    });
  });

  it("flags truncation when the limit is reached", async () => {
    vi.mocked(nodes.searchNodesByAttributes).mockResolvedValueOnce({
      ok: true,
      nodes: Array.from({ length: 5000 }, (_, i) => endpointNode(i)),
    });

    expect(await listProtectEndpoints(CONFIG)).toMatchObject({ ok: true, truncated: true });
  });

  it("surfaces a Jarvis failure instead of an empty list", async () => {
    vi.mocked(nodes.searchNodesByAttributes).mockResolvedValueOnce({
      ok: false,
      nodes: [],
      status: 502,
      error: "bad gateway",
    });

    expect(await listProtectEndpoints(CONFIG)).toEqual({
      ok: false,
      endpoints: [],
      error: "bad gateway",
      status: 502,
    });
  });
});
