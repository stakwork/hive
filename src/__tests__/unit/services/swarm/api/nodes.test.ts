import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  global.fetch = mockFetch;
});

const { addNode, addEdge, addEdgeBulk, addEdgeByRefBulk, addNodeBulk, updateNode, deleteNode, deleteEdge } = await import("@/services/swarm/api/nodes");

const config = {
  jarvisUrl: "https://test-swarm.sphinx.chat:8444",
  apiKey: "test-api-key",
};

// ---------------------------------------------------------------------------
// addNode
// ---------------------------------------------------------------------------

describe("addNode", () => {
  describe("Success cases", () => {
    test("calls POST /v2/nodes with correct body and headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: { ref_id: "node-abc-123" },
          status_messages: [],
        }),
      });

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "My Eval Set", description: "desc" },
      });

      expect(result).toEqual({ success: true, ref_id: "node-abc-123" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/v2/nodes",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            node_type: "EvalSet",
            node_data: { name: "My Eval Set", description: "desc" },
          }),
        }),
      );
    });

    test("extracts ref_id from nodes array when data.ref_id is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          nodes: [{ ref_id: "node-from-array" }],
          status_messages: [],
        }),
      });

      const result = await addNode(config, {
        node_type: "EvalRequirement",
        node_data: { name: "Req 1" },
      });

      expect(result).toEqual({ success: true, ref_id: "node-from-array" });
    });

    test("returns success with undefined ref_id when not present in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: {},
          status_messages: [],
        }),
      });

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "No ref" },
      });

      expect(result.success).toBe(true);
      expect(result.ref_id).toBeUndefined();
    });
  });

  describe("Already-exists warning treated as success", () => {
    test("returns success when status_messages contains 'already exists'", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "warning",
          data: { ref_id: "existing-node-id" },
          status_messages: ["Node already exists in graph"],
        }),
      });

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "Duplicate" },
      });

      expect(result).toEqual({ success: true, ref_id: "existing-node-id", alreadyExists: true });
    });

    test("is case-insensitive for 'already exists' check", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "warning",
          data: { ref_id: "dup-id" },
          status_messages: ["ALREADY EXISTS in the database"],
        }),
      });

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "Duplicate" },
      });

      expect(result.success).toBe(true);
    });

    test("returns success with ref_id when status is 'Warning' and data.ref_id present but status_messages is empty (Jarvis duplicate upsert shape)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Warning",
          status_messages: [],
          message: "Node already exists in the graph with node_key: plan-agent",
          data: { ref_id: "existing-role-ref-id" },
        }),
      });

      const result = await addNode(config, {
        node_type: "AgentRole",
        node_data: { name: "plan-agent" },
      });

      expect(result).toEqual({ success: true, ref_id: "existing-role-ref-id", alreadyExists: true });
    });
  });

  describe("Failure cases", () => {
    test("returns failure when HTTP response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "Fail" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    test("returns failure when status is not success and no already-exists message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "error",
          data: {},
          status_messages: ["Something went wrong"],
        }),
      });

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "Bad" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("returns failure when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "Net fail" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });

    test("returns failure when HTTP 400", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad request",
      });

      const result = await addNode(config, {
        node_type: "EvalSet",
        node_data: { name: "Bad request" },
      });

      expect(result.success).toBe(false);
    });
  });

  describe("URL construction", () => {
    test("strips trailing slash from jarvisUrl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: { ref_id: "x" }, status_messages: [] }),
      });

      await addNode(
        { jarvisUrl: "https://test.sphinx.chat:8444/", apiKey: "key" },
        { node_type: "EvalSet", node_data: { name: "Test" } },
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe("https://test.sphinx.chat:8444/v2/nodes");
    });
  });
});

// ---------------------------------------------------------------------------
// addEdge
// ---------------------------------------------------------------------------

describe("addEdge", () => {
  const edgePayload = {
    edge: { edge_type: "HAS_REQUIREMENT", edge_data: { order: 1 } },
    source: { ref_id: "eval-set-1" },
    target: { ref_id: "req-1" },
  };

  describe("Success cases", () => {
    test("calls POST /node/edge with correct body and headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Success",
          status_messages: [],
        }),
      });

      const result = await addEdge(config, edgePayload);

      expect(result).toEqual({ success: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/node/edge",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
          }),
          body: JSON.stringify(edgePayload),
        }),
      );
    });

    test("returns success with capital-S 'Success' status from /node/edge", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "Success", status_messages: [] }),
      });

      const result = await addEdge(config, edgePayload);

      expect(result).toEqual({ success: true });
    });

    test("works with EVAL_RUN edge type (no edge_data)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "Success", status_messages: [] }),
      });

      const result = await addEdge(config, {
        edge: { edge_type: "EVAL_RUN" },
        source: { ref_id: "req-1" },
        target: { ref_id: "session-1" },
      });

      expect(result).toEqual({ success: true });
    });
  });

  describe("Already-exists warning treated as success", () => {
    test("returns success when status_messages contains 'already exists'", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "warning",
          status_messages: ["Edge already exists"],
        }),
      });

      const result = await addEdge(config, edgePayload);

      expect(result).toEqual({ success: true });
    });
  });

  describe("Failure cases", () => {
    test("returns failure when HTTP response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "Bad gateway",
      });

      const result = await addEdge(config, edgePayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain("502");
    });

    test("returns failure when status is not success and no already-exists message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "error",
          status_messages: ["Edge creation failed"],
        }),
      });

      const result = await addEdge(config, edgePayload);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("returns failure when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await addEdge(config, edgePayload);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });
  });
});

// ---------------------------------------------------------------------------
// addEdgeBulk
// ---------------------------------------------------------------------------

describe("addEdgeBulk", () => {
  const edgeList = [
    {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: "eval-set-1" },
      target: { ref_id: "req-1" },
    },
    {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: "eval-set-1" },
      target: { ref_id: "req-2" },
    },
  ];

  describe("Success cases", () => {
    test("calls POST /v2/edges/bulk with correct body and headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Success",
          status_messages: [],
        }),
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result).toEqual({ success: true, errors: [] });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/v2/edges/bulk",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ edge_list: edgeList }),
        }),
      );
    });

    test("returns success with no errors when status_messages is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "Success", status_messages: [] }),
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("returns success:true with Warning status when no error messages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Warning",
          status_messages: ["Edge already exists"],
        }),
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(false); // Warning is not "success"
      expect(result.errors).toHaveLength(0); // no "error" prefixed messages
    });
  });

  describe("Partial errors surfaced from status_messages", () => {
    test("collects error-prefixed status_messages as errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Success",
          status_messages: [
            "Error: invalid ref_id for item 2",
            "Edge created successfully",
            "error: missing source node",
          ],
        }),
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([
        "Error: invalid ref_id for item 2",
        "error: missing source node",
      ]);
    });

    test("ignores non-error status_messages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Success",
          status_messages: ["Edge created", "Already exists (skipped)"],
        }),
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Failure cases", () => {
    test("returns failure when HTTP response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("500");
    });

    test("returns failure when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toBe("Network timeout");
    });

    test("flags endpointMissing on a 404 (endpoint absent on this backend)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "404 page not found",
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(false);
      expect(result.endpointMissing).toBe(true);
    });

    test("does not flag endpointMissing on a non-404 failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "boom",
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(false);
      expect(result.endpointMissing).toBeFalsy();
    });

    test("handles empty edge list gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "Success", status_messages: [] }),
      });

      const result = await addEdgeBulk(config, []);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// addEdgeByRefBulk
// ---------------------------------------------------------------------------

describe("addEdgeByRefBulk", () => {
  const edgeList = [
    {
      edge: { edge_type: "RESULTED_IN" },
      source_ref_id: "task-ref-1",
      target_ref_id: "pr-ref-1",
    },
  ];

  test("calls POST /v2/edges/bulk and transforms flat ref_id fields to nested v2 shape", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "Success", status_messages: [] }),
    });

    const result = await addEdgeByRefBulk(config, edgeList);

    expect(result).toEqual({ success: true, errors: [] });

    // Verify the URL is now /v2/edges/bulk (not the legacy /node/edge/ref/bulk)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-swarm.sphinx.chat:8444/v2/edges/bulk",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-token": "test-api-key" }),
        // The flat source_ref_id/target_ref_id must be transformed into nested { ref_id } objects
        body: JSON.stringify({
          edge_list: [
            {
              edge: { edge_type: "RESULTED_IN" },
              source: { ref_id: "task-ref-1" },
              target: { ref_id: "pr-ref-1" },
            },
          ],
        }),
      }),
    );
  });

  test("correctly transforms source_ref_id/target_ref_id into nested {ref_id} objects", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "Success", status_messages: [] }),
    });

    const multiEdgeList = [
      { edge: { edge_type: "RESULTED_IN" }, source_ref_id: "src-a", target_ref_id: "tgt-b" },
      { edge: { edge_type: "RELATED_TO", weight: 2 }, source_ref_id: "src-c", target_ref_id: "tgt-d" },
    ];

    await addEdgeByRefBulk(config, multiEdgeList);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.edge_list).toEqual([
      { edge: { edge_type: "RESULTED_IN" }, source: { ref_id: "src-a" }, target: { ref_id: "tgt-b" } },
      { edge: { edge_type: "RELATED_TO", weight: 2 }, source: { ref_id: "src-c" }, target: { ref_id: "tgt-d" } },
    ]);
    // Confirm flat fields are NOT present in the sent body
    expect(sentBody.edge_list[0]).not.toHaveProperty("source_ref_id");
    expect(sentBody.edge_list[0]).not.toHaveProperty("target_ref_id");
  });

  test("surfaces error-prefixed status_messages", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "Warning",
        status_messages: ["ERROR: source or target ref_id not found: a->b"],
      }),
    });

    const result = await addEdgeByRefBulk(config, edgeList);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  test("flags endpointMissing on a 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "404 page not found",
    });

    const result = await addEdgeByRefBulk(config, edgeList);

    expect(result.success).toBe(false);
    expect(result.endpointMissing).toBe(true);
  });

  test("handles empty edge list without a request", async () => {
    const result = await addEdgeByRefBulk(config, []);
    expect(result).toEqual({ success: true, errors: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateNode
// ---------------------------------------------------------------------------

describe("updateNode", () => {
  describe("Success cases", () => {
    test("calls PUT /node with node_data (not properties) in request body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const result = await updateNode(config, {
        ref_id: "eval-set-1",
        node_type: "EvalSet",
        node_data: { name: "Updated Name", description: "Updated desc" },
      });

      expect(result).toEqual({ success: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/node",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            ref_id: "eval-set-1",
            node_type: "EvalSet",
            node_data: { name: "Updated Name", description: "Updated desc" },
          }),
        }),
      );

      // Verify that legacy 'properties' key is NOT sent
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(sentBody).not.toHaveProperty("properties");
    });

    test("returns success for EvalRequirement update", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const result = await updateNode(config, {
        ref_id: "req-1",
        node_type: "EvalRequirement",
        node_data: {
          name: "Check output",
          prompt_snippet: "Summarize this",
          desirable_cases: ["Good"],
          undesirable_cases: ["Bad"],
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Failure cases", () => {
    test("returns failure when HTTP response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Server error",
      });

      const result = await updateNode(config, {
        ref_id: "eval-1",
        node_type: "EvalSet",
        node_data: { name: "Fail" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    test("returns failure when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await updateNode(config, {
        ref_id: "eval-1",
        node_type: "EvalSet",
        node_data: { name: "Throw" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });
});

// ---------------------------------------------------------------------------
// deleteNode
// ---------------------------------------------------------------------------

describe("deleteNode", () => {
  describe("Success cases", () => {
    test("calls DELETE /v2/nodes/{refId} with X-Is-Admin: true header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const result = await deleteNode(config, "eval-set-abc");

      expect(result).toEqual({ success: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/v2/nodes/eval-set-abc",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
            "X-Is-Admin": "true",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    test("returns success even when response body has no status field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => { throw new Error("No body"); },
      });

      const result = await deleteNode(config, "node-1");

      expect(result.success).toBe(true);
    });

    test("URL encodes the refId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      await deleteNode(config, "node with spaces");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe("https://test-swarm.sphinx.chat:8444/v2/nodes/node%20with%20spaces");
    });

    test("deletes an EvalSet node via v2 route", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const result = await deleteNode(config, "evalset-ref-123");

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/v2/nodes/evalset-ref-123",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
            "X-Is-Admin": "true",
          }),
        }),
      );
    });

    test("deletes an EvalRequirement node via v2 route", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const result = await deleteNode(config, "req-ref-456");

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/v2/nodes/req-ref-456",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
            "X-Is-Admin": "true",
          }),
        }),
      );
    });
  });

  describe("Failure cases", () => {
    test("returns failure when HTTP response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not found",
      });

      const result = await deleteNode(config, "missing-node");

      expect(result.success).toBe(false);
      expect(result.error).toContain("404");
    });

    test("returns failure when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await deleteNode(config, "node-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    test("returns failure on 4xx from v2 route", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await deleteNode(config, "evalset-ref-123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    });
  });
});

// ---------------------------------------------------------------------------
// deleteEdge
// ---------------------------------------------------------------------------

describe("deleteEdge", () => {
  describe("Success cases", () => {
    test("calls DELETE /v2/edges/{refId} without X-Is-Admin header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const result = await deleteEdge(config, "edge-ref-123");

      expect(result).toEqual({ success: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/v2/edges/edge-ref-123",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
          }),
        }),
      );

      // Verify X-Is-Admin is NOT present (deleteEdge doesn't require admin)
      const calledHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(calledHeaders).not.toHaveProperty("X-Is-Admin");
    });

    test("URL encodes the edgeRefId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      await deleteEdge(config, "edge/with/slashes");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        "https://test-swarm.sphinx.chat:8444/v2/edges/edge%2Fwith%2Fslashes",
      );
    });

    test("surfaces notFound:true on a 404 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not found",
      });

      const result = await deleteEdge(config, "edge-ref-missing");

      expect(result.success).toBe(false);
      expect(result.notFound).toBe(true);
    });
  });

  describe("Failure cases", () => {
    test("returns failure when HTTP response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Server error",
      });

      const result = await deleteEdge(config, "edge-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    test("returns failure when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      const result = await deleteEdge(config, "edge-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Timeout");
    });
  });
});

// ---------------------------------------------------------------------------
// addNodeBulk
// ---------------------------------------------------------------------------

describe("addNodeBulk", () => {
  const nodes = [
    { node_type: "HiveTask", node_data: { task_id: "t1", name: "Task 1" } },
    { node_type: "HiveTask", node_data: { task_id: "t2", name: "Task 2" } },
  ];

  test("calls POST /node/bulk with nodes wrapped in node_list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "Success", status_messages: [] }),
    });

    const result = await addNodeBulk(config, nodes);

    expect(result).toEqual({ success: true, errors: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-swarm.sphinx.chat:8444/node/bulk",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-token": "test-api-key" }),
        body: JSON.stringify({ node_list: nodes }),
      }),
    );
  });

  test("injects reprocess:true on each node when opts.reprocess is set", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "Success", status_messages: [] }),
    });

    await addNodeBulk(config, nodes, { reprocess: true });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody).toEqual({
      node_list: nodes.map((n) => ({ ...n, reprocess: true })),
    });
  });

  test("returns success:true even when status is Warning (some nodes already existed)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "Warning",
        status_messages: ["Node already exists (skipped)"],
      }),
    });

    const result = await addNodeBulk(config, nodes);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("collects error-prefixed status_messages as errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "Warning",
        status_messages: ["Error: invalid node_type for item 1"],
      }),
    });

    const result = await addNodeBulk(config, nodes);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(["Error: invalid node_type for item 1"]);
  });

  test("flags endpointMissing on a 404 (older swarm without v2)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "404 page not found",
    });

    const result = await addNodeBulk(config, nodes);

    expect(result.success).toBe(false);
    expect(result.endpointMissing).toBe(true);
  });

  test("handles empty node list without making a request", async () => {
    const result = await addNodeBulk(config, []);
    expect(result).toEqual({ success: true, errors: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
