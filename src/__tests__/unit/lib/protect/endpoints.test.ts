import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  listProtectEndpoints,
  parseCallersTarget,
  parseProtectEndpoint,
  systemFromFile,
} from "@/lib/protect/endpoints";
import * as nodes from "@/services/swarm/api/nodes";

vi.mock("@/services/swarm/api/nodes", () => ({
  getGraphCallers: vi.fn(),
  listNodesByType: vi.fn(),
}));

const CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "key" };

function target(index: number, name = `/api/items/${index}`, callers: nodes.JarvisCallerSystem[] = []) {
  return {
    ref_id: `ref-${index}`,
    name,
    verb: "get",
    file: "stakwork/staklink/src/routes.ts",
    system: "stakwork/staklink",
    callers,
  };
}

function endpointNode(index: number, name = `/api/items/${index}`) {
  return {
    ref_id: `ref-${index}`,
    node_type: "Endpoint",
    properties: { name, verb: "get", file: "stakwork/staklink/src/routes.ts" },
  };
}

describe("systemFromFile", () => {
  it("takes the first two path segments", () => {
    expect(systemFromFile("stakwork/hive/src/app.ts")).toBe("stakwork/hive");
    expect(systemFromFile("solo")).toBe("solo");
    expect(systemFromFile("")).toBe("unknown");
  });
});

describe("parseCallersTarget", () => {
  it("maps a callers target and normalises the verb", () => {
    expect(
      parseCallersTarget(target(1, "/errors", [{ system: "stakwork/hive", call_sites: 18 }])),
    ).toEqual({
      refId: "ref-1",
      name: "/errors",
      verb: "GET",
      file: "stakwork/staklink/src/routes.ts",
      system: "stakwork/staklink",
      callers: [{ system: "stakwork/hive", callSites: 18 }],
    });
  });

  it("derives the system from file when jarvis omits it and drops nodes without ref_id", () => {
    expect(parseCallersTarget({ ...target(1), system: "" })?.system).toBe("stakwork/staklink");
    expect(parseCallersTarget({ ...target(1), ref_id: "" })).toBeNull();
  });
});

describe("parseProtectEndpoint", () => {
  it("maps node properties with no callers", () => {
    expect(parseProtectEndpoint(endpointNode(1))).toEqual({
      refId: "ref-1",
      name: "/api/items/1",
      verb: "GET",
      file: "stakwork/staklink/src/routes.ts",
      system: "stakwork/staklink",
      callers: [],
    });
  });
});

describe("listProtectEndpoints", () => {
  beforeEach(() => {
    vi.mocked(nodes.getGraphCallers).mockReset();
    vi.mocked(nodes.listNodesByType).mockReset();
  });

  it("reads /v2/graph/callers and sorts endpoints by name", async () => {
    vi.mocked(nodes.getGraphCallers).mockResolvedValueOnce({
      ok: true,
      targets: [target(1, "/b"), target(2, "/a", [{ system: "stakwork/hive", call_sites: 9 }])],
      systems: [{ caller: "stakwork/hive", callee: "stakwork/staklink", call_sites: 9 }],
    });

    const result = await listProtectEndpoints(CONFIG);

    expect(result).toMatchObject({ ok: true, callersUnavailable: false });
    expect(result.endpoints.map((endpoint) => endpoint.name)).toEqual(["/a", "/b"]);
    expect(result.endpoints[0].callers).toEqual([{ system: "stakwork/hive", callSites: 9 }]);
    expect(result.systems).toEqual([
      { caller: "stakwork/hive", callee: "stakwork/staklink", callSites: 9 },
    ]);
    expect(nodes.getGraphCallers).toHaveBeenCalledWith(CONFIG, { targetType: "Endpoint" });
    expect(nodes.listNodesByType).not.toHaveBeenCalled();
  });

  it("falls back to paging GET /v2/nodes when the callers route is missing", async () => {
    vi.mocked(nodes.getGraphCallers).mockResolvedValueOnce({
      ok: false,
      targets: [],
      systems: [],
      status: 404,
      endpointMissing: true,
    });
    const fullPage = Array.from({ length: 500 }, (_, i) => endpointNode(i, `/p${i}`));
    vi.mocked(nodes.listNodesByType)
      .mockResolvedValueOnce({ ok: true, nodes: fullPage })
      .mockResolvedValueOnce({ ok: true, nodes: [endpointNode(900, "/b"), endpointNode(901, "/a")] });

    const result = await listProtectEndpoints(CONFIG);

    expect(result).toMatchObject({ ok: true, callersUnavailable: true, systems: [] });
    expect(result.endpoints).toHaveLength(502);
    expect(result.endpoints.slice(0, 2).map((endpoint) => endpoint.name)).toEqual(["/a", "/b"]);
    expect(nodes.listNodesByType).toHaveBeenCalledTimes(2);
    expect(nodes.listNodesByType).toHaveBeenNthCalledWith(1, CONFIG, "Endpoint", 500, {
      startingAfter: undefined,
      fields: ["name", "verb", "file"],
    });
    expect(nodes.listNodesByType).toHaveBeenNthCalledWith(2, CONFIG, "Endpoint", 500, {
      startingAfter: "ref-499",
      fields: ["name", "verb", "file"],
    });
  });

  it("surfaces a non-404 callers failure without falling back", async () => {
    vi.mocked(nodes.getGraphCallers).mockResolvedValueOnce({
      ok: false,
      targets: [],
      systems: [],
      status: 502,
      error: "bad gateway",
    });

    expect(await listProtectEndpoints(CONFIG)).toEqual({
      ok: false,
      endpoints: [],
      systems: [],
      error: "bad gateway",
      status: 502,
    });
    expect(nodes.listNodesByType).not.toHaveBeenCalled();
  });

  it("surfaces a fallback failure", async () => {
    vi.mocked(nodes.getGraphCallers).mockResolvedValueOnce({
      ok: false,
      targets: [],
      systems: [],
      status: 404,
      endpointMissing: true,
    });
    vi.mocked(nodes.listNodesByType).mockResolvedValueOnce({
      ok: false,
      nodes: [],
      status: 500,
      error: "boom",
    });

    expect(await listProtectEndpoints(CONFIG)).toMatchObject({ ok: false, error: "boom" });
  });
});
