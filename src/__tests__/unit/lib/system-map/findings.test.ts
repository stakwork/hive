import { describe, expect, it, vi, beforeEach } from "vitest";
import { listFindings, loadFindingRelated, parseFinding } from "@/lib/system-map/findings";
import * as nodes from "@/services/swarm/api/nodes";

vi.mock("@/services/swarm/api/nodes", () => ({ listNodesByType: vi.fn(), getNodeEdges: vi.fn() }));

const CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "key" };

function finding(refId: string, properties: Record<string, unknown>, dateAdded?: number) {
  return { ref_id: refId, node_type: "Finding", properties, date_added_to_graph: dateAdded };
}

describe("parseFinding", () => {
  it("reads the fix tracking written on the node", () => {
    const parsed = parseFinding(
      finding("f9", {
        title: "t",
        fix_state: "launched",
        fix_conversation_id: "c1",
        fix_kind: "code_issue",
        fix_started_by: "u1",
      }),
    );
    expect(parsed?.fix).toMatchObject({ state: "launched", conversationId: "c1", kind: "code_issue", startedBy: "u1" });
  });

  it("reads the common fields under their usual names and keeps every property", () => {
    expect(
      parseFinding(
        finding(
          "f1",
          { name: "XSS in search", severity: "HIGH", cwe: "CWE-79", file_path: "src/a.ts", line: 12 },
          1700000000.5,
        ),
      ),
    ).toEqual({
      refId: "f1",
      title: "XSS in search",
      severity: "high",
      status: null,
      cweId: "CWE-79",
      file: "src/a.ts",
      line: 12,
      fix: null,
      description: null,
      dateAdded: 1700000000.5,
      properties: { name: "XSS in search", severity: "HIGH", cwe: "CWE-79", file_path: "src/a.ts", line: 12 },
    });
  });

  it("falls back to the ref_id for a title", () => {
    expect(parseFinding(finding("f2", {}))?.title).toBe("f2");
  });
});

describe("listFindings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads Finding nodes by type in the infosec namespace and sorts them most severe, then newest, first", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [
        finding("low", { title: "c", severity: "low" }),
        finding("none", { title: "d" }),
        finding("high-old", { title: "b", severity: "high" }, 1),
        finding("high-new", { title: "a", severity: "high" }, 2),
        finding("crit", { title: "e", severity: "critical" }),
      ],
    });

    const result = await listFindings(CONFIG);

    expect(nodes.listNodesByType).toHaveBeenCalledWith(CONFIG, "Finding", 500, {
      startingAfter: undefined,
      namespace: "infosec",
    });
    expect(result.ok && result.findings.map((f) => f.refId)).toEqual(["crit", "high-new", "high-old", "low", "none"]);
    expect(result.ok && result.truncated).toBe(false);
  });

  it("pages with starting_after while pages come back full", async () => {
    const page = (start: number) =>
      Array.from({ length: 500 }, (_, i) => finding(`f${start + i}`, { title: `t${start + i}` }));
    vi.mocked(nodes.listNodesByType)
      .mockResolvedValueOnce({ ok: true, nodes: page(0) })
      .mockResolvedValueOnce({ ok: true, nodes: page(500).slice(0, 10) });

    const result = await listFindings(CONFIG);

    expect(nodes.listNodesByType).toHaveBeenLastCalledWith(CONFIG, "Finding", 500, {
      startingAfter: "f499",
      namespace: "infosec",
    });
    expect(result.ok && result.findings).toHaveLength(510);
  });

  it("reports a failed read", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({ ok: false, nodes: [], error: "401 Unauthorized" });

    expect(await listFindings(CONFIG)).toEqual({ ok: false, error: "401 Unauthorized" });
  });
});

describe("loadFindingRelated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the finding's edges through jarvis' expand and keeps one row per neighbour edge", async () => {
    vi.mocked(nodes.getNodeEdges).mockResolvedValue({
      ok: true,
      nodes: [
        { ref_id: "f-1", node_type: "Finding", properties: { title: "XSS" } },
        { ref_id: "fn-1", node_type: "Function", properties: { name: "search", file: "src/a.ts" } },
        { ref_id: "cwe-1", node_type: "CWE", properties: { cwe_id: "CWE-79" } },
      ],
      edges: [
        { source: "f-1", target: "fn-1", edge_type: "AFFECTS" },
        { source: "f-1", target: "fn-1", edge_type: "AFFECTS" },
        { source: "cwe-1", target: "f-1", edge_type: "INSTANCE_OF" },
        { source: "fn-1", target: "cwe-1", edge_type: "UNRELATED" },
      ],
    });

    const result = await loadFindingRelated(CONFIG, "f-1");

    expect(nodes.getNodeEdges).toHaveBeenCalledWith(CONFIG, "f-1", { limit: 500 });
    expect(result).toEqual({
      ok: true,
      truncated: false,
      related: [
        {
          refId: "cwe-1",
          nodeType: "CWE",
          edgeType: "INSTANCE_OF",
          direction: "in",
          name: "CWE-79",
          file: null,
          properties: { cwe_id: "CWE-79" },
        },
        {
          refId: "fn-1",
          nodeType: "Function",
          edgeType: "AFFECTS",
          direction: "out",
          name: "search",
          file: "src/a.ts",
          properties: { name: "search", file: "src/a.ts" },
        },
      ],
    });
  });

  it("reports a failed read", async () => {
    vi.mocked(nodes.getNodeEdges).mockResolvedValue({ ok: false, nodes: [], edges: [], error: "502 Bad Gateway" });

    expect(await loadFindingRelated(CONFIG, "f-1")).toEqual({ ok: false, error: "502 Bad Gateway" });
  });
});
