/**
 * Unit tests for Jarvis v2 write helpers (src/services/swarm/api/nodes.ts):
 *   - updateNodeV2
 *   - addEdgeV2
 *   - readNodeByRef
 *
 * Tests:
 *  1. updateNodeV2: success path
 *  2. updateNodeV2: HTTP 200 + { status:"fail" } → failure (not success)
 *  3. updateNodeV2: ref_id is URL-encoded in the path segment
 *  4. updateNodeV2: traversal-shaped ref_id (containing / or ..) → rejected before fetch
 *  5. updateNodeV2: no X-Is-Admin header ever sent
 *  6. updateNodeV2: body contains only node_data (no node_type etc.)
 *  7. addEdgeV2: success path (status="success")
 *  8. addEdgeV2: "Warning" status → success with alreadyExists=true
 *  9. addEdgeV2: { status:"fail" } → failure
 * 10. addEdgeV2: create_schema_if_missing is always false on the wire
 * 11. addEdgeV2: no X-Is-Admin header ever sent
 * 12. readNodeByRef: success path with properties
 * 13. readNodeByRef: 404 → success=false
 * 14. readNodeByRef: traversal ref_id rejected before fetch
 * 15. Helpers never throw — network errors return { success: false }
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateNodeV2,
  addEdgeV2,
  readNodeByRef,
} from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";

// ── Mock global fetch ─────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Fixtures ──────────────────────────────────────────────────────────────

const config: JarvisConnectionConfig = {
  jarvisUrl: "https://test-swarm.sphinx.chat:8444",
  apiKey: "test-api-key",
};

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ── updateNodeV2 ──────────────────────────────────────────────────────────

describe("updateNodeV2", () => {
  it("returns success when status is 'success'", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ status: "success" }),
    );

    const result = await updateNodeV2(config, "abc123", { name: "Test Node" });

    expect(result.success).toBe(true);
    expect(result.ref_id).toBe("abc123");
    expect(result.status).toBe("success");
  });

  it("treats HTTP 200 + { status:'fail' } as failure", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ status: "fail", message: "node_key collision" }),
    );

    const result = await updateNodeV2(config, "abc123", { name: "Bad Node" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("node_key collision");
  });

  it("URL-encodes the ref_id in the path segment", async () => {
    mockFetch.mockResolvedValue(makeResponse({ status: "success" }));

    const refId = "node:with:colons";
    await updateNodeV2(config, refId, { name: "x" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent(refId));
    expect(calledUrl).not.toContain("node:with:colons");
  });

  it("rejects a path-traversal ref_id containing '/' before fetching", async () => {
    const result = await updateNodeV2(config, "../../etc/passwd", { name: "evil" });

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a ref_id containing '..'", async () => {
    const result = await updateNodeV2(config, "abc/../def", { name: "evil" });

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never sends X-Is-Admin header", async () => {
    mockFetch.mockResolvedValue(makeResponse({ status: "success" }));

    await updateNodeV2(config, "abc123", { name: "x" });

    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-Is-Admin"]).toBeUndefined();
    expect(headers["x-is-admin"]).toBeUndefined();
  });

  it("body contains only node_data (no node_type, type_to_be_deleted, properties_to_be_deleted)", async () => {
    mockFetch.mockResolvedValue(makeResponse({ status: "success" }));

    await updateNodeV2(config, "abc123", { name: "Test" });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body).toHaveProperty("node_data");
    expect(body).not.toHaveProperty("node_type");
    expect(body).not.toHaveProperty("type_to_be_deleted");
    expect(body).not.toHaveProperty("properties_to_be_deleted");
  });

  it("returns failure on network error without throwing", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await updateNodeV2(config, "abc123", { name: "x" });

    expect(result.success).toBe(false);
    expect(typeof result.message).toBe("string");
  });

  it("accepts valid opaque-id ref_ids with mixed chars", async () => {
    mockFetch.mockResolvedValue(makeResponse({ status: "success" }));

    const result = await updateNodeV2(config, "abc123-XYZ_node.ref@org", { name: "x" });

    expect(result.success).toBe(true);
  });
});

// ── addEdgeV2 ─────────────────────────────────────────────────────────────

describe("addEdgeV2", () => {
  const basePayload = {
    edge: { edge_type: "IMPLEMENTS" },
    source: { ref_id: "src-ref-001" },
    target: { ref_id: "tgt-ref-001" },
  };

  it("returns success when status is 'success'", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        status: "success",
        edges: [{ ref_id: "edge-ref-001" }],
      }),
    );

    const result = await addEdgeV2(config, basePayload);

    expect(result.success).toBe(true);
    expect(result.ref_id).toBe("edge-ref-001");
    expect(result.alreadyExists).toBeFalsy();
  });

  it("treats 'Warning' status as success with alreadyExists=true", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        status: "Warning",
        message: "Edge already exists",
        edges: [{ ref_id: "edge-ref-dup" }],
      }),
    );

    const result = await addEdgeV2(config, basePayload);

    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(true);
    expect(result.ref_id).toBe("edge-ref-dup");
  });

  it("returns failure when status is 'fail'", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ status: "fail", message: "Edge type not found in schema" }),
    );

    const result = await addEdgeV2(config, basePayload);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Edge type not found");
  });

  it("hardcodes create_schema_if_missing: false on the wire", async () => {
    mockFetch.mockResolvedValue(makeResponse({ status: "success", edges: [] }));

    await addEdgeV2(config, basePayload);

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.create_schema_if_missing).toBe(false);
  });

  it("never sends X-Is-Admin header", async () => {
    mockFetch.mockResolvedValue(makeResponse({ status: "success", edges: [] }));

    await addEdgeV2(config, basePayload);

    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-Is-Admin"]).toBeUndefined();
    expect(headers["x-is-admin"]).toBeUndefined();
  });

  it("extracts ref_id from data.ref_id when edges array is absent", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ status: "success", data: { ref_id: "edge-from-data" } }),
    );

    const result = await addEdgeV2(config, basePayload);

    expect(result.success).toBe(true);
    expect(result.ref_id).toBe("edge-from-data");
  });

  it("returns failure on network error without throwing", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await addEdgeV2(config, basePayload);

    expect(result.success).toBe(false);
  });

  it("posts to /v2/edges endpoint", async () => {
    mockFetch.mockResolvedValue(makeResponse({ status: "success", edges: [] }));

    await addEdgeV2(config, basePayload);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/v2/edges");
  });
});

// ── readNodeByRef ─────────────────────────────────────────────────────────

describe("readNodeByRef", () => {
  it("returns success with properties when node is found", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        ref_id: "node-ref-001",
        node_type: "Concept",
        properties: { name: "My Concept", description: "A thing" },
      }),
    );

    const result = await readNodeByRef(config, "node-ref-001");

    expect(result.success).toBe(true);
    expect(result.ref_id).toBe("node-ref-001");
    expect(result.node_type).toBe("Concept");
    expect(result.properties).toEqual({ name: "My Concept", description: "A thing" });
  });

  it("returns success=false when node is not found (404)", async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: "Node not found" }, 404));

    const result = await readNodeByRef(config, "missing-ref");

    expect(result.success).toBe(false);
  });

  it("rejects a path-traversal ref_id before fetching", async () => {
    const result = await readNodeByRef(config, "../secret");

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a ref_id containing '/'", async () => {
    const result = await readNodeByRef(config, "abc/def");

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("URL-encodes the ref_id in the path segment", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        ref_id: "node:with:colons",
        node_type: "Concept",
        properties: {},
      }),
    );

    const refId = "node:with:colons";
    await readNodeByRef(config, refId);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent(refId));
  });

  it("handles node nested under 'node' key (Jarvis v2 format)", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        node: {
          ref_id: "nested-ref-001",
          node_type: "Function",
          properties: { name: "myFn" },
        },
      }),
    );

    const result = await readNodeByRef(config, "nested-ref-001");

    expect(result.success).toBe(true);
    expect(result.ref_id).toBe("nested-ref-001");
    expect(result.node_type).toBe("Function");
  });

  it("returns failure on network error without throwing", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await readNodeByRef(config, "abc123");

    expect(result.success).toBe(false);
  });

  it("never sends X-Is-Admin header", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ ref_id: "abc123", node_type: "Concept", properties: {} }),
    );

    await readNodeByRef(config, "abc123");

    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-Is-Admin"]).toBeUndefined();
    expect(headers["x-is-admin"]).toBeUndefined();
  });
});
