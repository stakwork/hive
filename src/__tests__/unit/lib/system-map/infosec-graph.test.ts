import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { expandInfosecNode, findInfosecNode, InfosecGraphError, searchInfosecNodes } from "@/lib/system-map/infosec-graph";

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("infosec graph client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.stubEnv("INFOSEC_GRAPH_URL", "");
    vi.stubEnv("INFOSEC_GRAPH_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("looks a node up on the public infosec API without a token by default", async () => {
    fetchMock.mockResolvedValue(reply(200, { exists: true, ref_id: "ref-1" }));

    expect(await findInfosecNode("CWE", "CWE-1435")).toBe("ref-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://infosec.sphinx.chat/api/v2/nodes/check?node_type=CWE&key=CWE-1435");
    expect(init.headers).toEqual({});
  });

  it("searches node titles of one type", async () => {
    fetchMock.mockResolvedValue(reply(200, { nodes: [{ ref_id: "r1", node_type: "CWE", title: "Cross-Site Request Forgery (CSRF)" }] }));

    expect(await searchInfosecNodes("CWE", "csrf")).toEqual([
      { ref_id: "r1", node_type: "CWE", title: "Cross-Site Request Forgery (CSRF)" },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://infosec.sphinx.chat/api/v2/nodes/search?q=csrf&type=CWE&limit=20");
  });

  it("returns null for a node that does not exist", async () => {
    fetchMock.mockResolvedValue(reply(200, { exists: false, ref_id: null }));

    expect(await findInfosecNode("CWE", "CWE-0")).toBeNull();
  });

  it("sends the token and honours the URL override", async () => {
    vi.stubEnv("INFOSEC_GRAPH_URL", "https://infosec.example/api/");
    vi.stubEnv("INFOSEC_GRAPH_API_KEY", "secret");
    fetchMock.mockResolvedValue(reply(200, { nodes: [{ ref_id: "a", node_type: "CWE" }], edges: [] }));

    const result = await expandInfosecNode("ref-1", ["MEMBER_OF"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://infosec.example/api/v2/nodes/ref-1?expand=edges&limit=1000&edge_type=${encodeURIComponent('["MEMBER_OF"]')}`,
    );
    expect(init.headers).toEqual({ "x-api-token": "secret" });
    expect(result).toEqual({ nodes: [{ ref_id: "a", node_type: "CWE" }], edges: [] });
  });

  it("throws the status and the graph's message on a refused read", async () => {
    fetchMock.mockResolvedValue(reply(402, { error: { message: "Payment required" } }));

    const error = await findInfosecNode("CWE", "CWE-79").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InfosecGraphError);
    expect(error).toMatchObject({ message: "402 Payment required", status: 402 });
  });
});
