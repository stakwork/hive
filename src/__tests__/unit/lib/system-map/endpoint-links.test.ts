import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ENDPOINT_PAGE_ROWS,
  endpointLinksQuery,
  listSystemMapEndpointLinks,
  parseEndpointLinkRows,
} from "@/lib/system-map/endpoint-links";
import * as query from "@/services/graph/query";

vi.mock("@/services/graph/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/graph/query")>()),
  runWorkspaceGraphQuery: vi.fn(),
}));

const COLUMNS = ["endpoint", "name", "verb", "file", "links"];
const META = { requestedLimit: ENDPOINT_PAGE_ROWS, limitRewritten: false };

function page(rows: unknown[][]) {
  return { ok: true as const, data: { columns: COLUMNS, rows }, meta: META };
}

describe("endpointLinksQuery", () => {
  it("is read-only and pages by ref_id", () => {
    expect(query.isWriteQuery(endpointLinksQuery(null))).toBe(false);
    expect(endpointLinksQuery(null)).not.toContain("e.ref_id >");
    expect(endpointLinksQuery("abc-123")).toContain("AND e.ref_id > 'abc-123'");
    expect(endpointLinksQuery(null)).not.toMatch(/\bLIMIT\b/);
  });

  it("refuses a cursor that could break out of the string", () => {
    expect(() => endpointLinksQuery("x' OR 1=1 //")).toThrow();
  });
});

describe("parseEndpointLinkRows", () => {
  it("unfolds each endpoint's link strings, matching columns by name", () => {
    const parsed = parseEndpointLinkRows({
      columns: ["links", "endpoint", "name", "verb", "file"],
      rows: [
        [["c1|CALLS|out", "c1|CALLS|out", "c2|EXPOSES|in"], "e1", "/api/tasks", '"get"', "hive/route.ts"],
        [["bad"], "e2", null, null, null],
      ],
    });

    expect(parsed.links).toEqual([
      { node: "c1", endpoint: "e1", edgeType: "CALLS", direction: "out" },
      { node: "c2", endpoint: "e1", edgeType: "EXPOSES", direction: "in" },
    ]);
    expect(parsed.endpoints).toEqual([
      { refId: "e1", name: "/api/tasks", verb: "GET", file: "hive/route.ts" },
      { refId: "e2", name: "e2", verb: "", file: "" },
    ]);
    expect(parsed.lastEndpoint).toBe("e2");
  });
});

describe("listSystemMapEndpointLinks", () => {
  beforeEach(() => vi.mocked(query.runWorkspaceGraphQuery).mockReset());

  it("pages until a short page, passing the last endpoint as the cursor", async () => {
    const full = Array.from({ length: ENDPOINT_PAGE_ROWS }, (_, i) => [
      `e${String(i).padStart(4, "0")}`,
      "/p",
      "GET",
      "",
      ["c1|CALLS|out"],
    ]);
    vi.mocked(query.runWorkspaceGraphQuery)
      .mockResolvedValueOnce(page(full))
      .mockResolvedValueOnce(page([["e9999", "/q", "POST", "", ["c2|EXPOSES|out"]]]));

    const result = await listSystemMapEndpointLinks({ slug: "acme", userId: "u1" });

    const calls = vi.mocked(query.runWorkspaceGraphQuery).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ slug: "acme", userId: "u1", limit: ENDPOINT_PAGE_ROWS });
    expect(calls[1][0].query).toContain("e.ref_id > 'e0999'");
    expect(result.ok && result.links).toHaveLength(ENDPOINT_PAGE_ROWS + 1);
    expect(result.ok && result.truncated).toBe(false);
  });

  it("reports stakgraph's own error, not just the generic message", async () => {
    vi.mocked(query.runWorkspaceGraphQuery).mockResolvedValue({
      ok: false,
      status: 400,
      message: "Query failed",
      details: { error: "limit exceeds maximum" },
    });

    expect(await listSystemMapEndpointLinks({ slug: "acme", userId: "u1" })).toEqual({
      ok: false,
      error: "Query failed: limit exceeds maximum",
    });
  });
});
