import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  global.fetch = mockFetch;
});

const { addNode, addEdge, addEdgeBulk, addEdgeByRefBulk, addNodeBulk, updateNode, deleteNode, deleteEdge, deleteSingleNode, findEdgeByEndpoints, listIncomingEdges, isMutedEdge, getReferencedNodeCentrality, searchNodesByAttributes } = await import("@/services/swarm/api/nodes");

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
      expect(result.error).toContain("Edge creation failed");
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

    test("returns success:true with Warning status when no error messages (dups skipped)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Warning",
          status_messages: ["Edge already exists"],
        }),
      });

      const result = await addEdgeBulk(config, edgeList);

      // Jarvis returns "Warning" for benign notices like skipped duplicate
      // edges on re-runs. Success must key off the absence of real errors, not
      // status === "success", or the mirror cursor freezes on the second pass.
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
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

      expect(result.success).toBe(false); // real errors present → not success
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

    test("fails on status 'Error' even when no message starts with 'error'", async () => {
      // node_service.py error bodies set status "Error" with free-form
      // status_messages; these must not slip through the error-prefix filter.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Error",
          status_messages: ["Source node not found: Workspace wk-123"],
        }),
      });

      const result = await addEdgeBulk(config, edgeList);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Source node not found: Workspace wk-123");
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
        "https://test-swarm.sphinx.chat:8444/node?ref_id=eval-set-1",
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
      // Verify ref_id is in the URL (never "undefined")
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("?ref_id=eval-set-1");
      expect(calledUrl).not.toContain("undefined");
    });

    test("accept status: ref_id appears in query string and body (never 'undefined')", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const now = new Date().toISOString();
      const result = await updateNode(config, {
        ref_id: "fix-ref-abc123",
        node_type: "ProposedFix",
        node_data: { status: "accepted", resolved_by: "user-1", resolved_at: now },
      });

      expect(result).toEqual({ success: true });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe("https://test-swarm.sphinx.chat:8444/node?ref_id=fix-ref-abc123");
      expect(calledUrl).not.toContain("undefined");

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(sentBody.ref_id).toBe("fix-ref-abc123");
      expect(sentBody.node_data.status).toBe("accepted");
    });

    test("reject status: ref_id appears in query string and body (never 'undefined')", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success" }),
      });

      const now = new Date().toISOString();
      const result = await updateNode(config, {
        ref_id: "fix-ref-xyz789",
        node_type: "ProposedFix",
        node_data: { status: "rejected", resolved_by: "user-2", resolved_at: now },
      });

      expect(result).toEqual({ success: true });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe("https://test-swarm.sphinx.chat:8444/node?ref_id=fix-ref-xyz789");
      expect(calledUrl).not.toContain("undefined");

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(sentBody.ref_id).toBe("fix-ref-xyz789");
      expect(sentBody.node_data.status).toBe("rejected");
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
    test("returns failure without calling fetch when ref_id is missing", async () => {
      const result = await updateNode(config, {
        ref_id: "",
        node_type: "ProposedFix",
        node_data: { status: "accepted" },
      });

      expect(result).toEqual({ success: false, error: "ref_id is required to update a node" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns failure without calling fetch when ref_id is undefined", async () => {
      const result = await updateNode(config, {
        ref_id: undefined as unknown as string,
        node_type: "ProposedFix",
        node_data: { status: "rejected" },
      });

      expect(result).toEqual({ success: false, error: "ref_id is required to update a node" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

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

describe("deleteSingleNode", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  test("calls DELETE /v2/nodes/{refId}/single as admin and succeeds when Jarvis confirms", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "success", ref_id: "node-1", is_deleted: true, muted_edge_count: 3 }));

    const result = await deleteSingleNode(config, "node-1");

    expect(result).toEqual({ success: true, mutedEdgeCount: 3 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-swarm.sphinx.chat:8444/v2/nodes/node-1/single",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "x-api-token": "test-api-key", "X-Is-Admin": "true" }),
      }),
    );
  });

  test("does not count a 200 without is_deleted: true as success", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "success" }));
    expect(await deleteSingleNode(config, "node-1")).toMatchObject({ success: false, error: expect.stringContaining("did not confirm") });

    mockFetch.mockResolvedValueOnce(ok({ status: "success", ref_id: "other", is_deleted: true }));
    expect((await deleteSingleNode(config, "node-1")).success).toBe(false);
  });

  test.each([404, 409])("treats %i as not found", async (status) => {
    mockFetch.mockResolvedValueOnce({ ok: false, status, text: async () => "{}" });
    expect(await deleteSingleNode(config, "node-1")).toMatchObject({ success: false, notFound: true });
  });

  test("passes other failures through as errors", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    expect(await deleteSingleNode(config, "node-1")).toEqual({
      success: false,
      notFound: false,
      error: "Request failed with status 500",
    });
  });

  test("rejects an unsafe ref_id without calling Jarvis", async () => {
    expect((await deleteSingleNode(config, "bad id/../x")).success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

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

    test("reads Jarvis's 200 + Warning 'No edge found' body as notFound", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "Warning",
          status_messages: ["Warning: No edge found with ref_id: edge-gone"],
        }),
      });

      const result = await deleteEdge(config, "edge-gone");

      expect(result).toMatchObject({ success: false, notFound: true });
      expect(result.error).toContain("No edge found");
    });

    test("reads a 200 + Error body as a failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "Error", status_messages: ["ERROR: boom"] }),
      });

      const result = await deleteEdge(config, "edge-1");

      expect(result.success).toBe(false);
      expect(result.notFound).toBeUndefined();
      expect(result.error).toContain("boom");
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
// isMutedEdge / findEdgeByEndpoints / listIncomingEdges
// ---------------------------------------------------------------------------

describe("isMutedEdge", () => {
  test("is true for a muted or soft-deleted edge and false otherwise", () => {
    expect(isMutedEdge({ is_muted: true })).toBe(true);
    expect(isMutedEdge({ is_deleted: true })).toBe(true);
    expect(isMutedEdge({ is_muted: false })).toBe(false);
    expect(isMutedEdge({})).toBe(false);
    expect(isMutedEdge(undefined)).toBe(false);
  });
});

/** An expand=edges answer: the queried node, its neighbours and the edges among them. */
function expanded(nodes: Array<[string, string]>, edges: Array<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      nodes: nodes.map(([ref_id, name]) => ({ ref_id, node_type: "Concept", properties: { name } })),
      edges,
    }),
  };
}

describe("findEdgeByEndpoints", () => {
  test("reads the source side with the edge type filtered, and names both ends", async () => {
    mockFetch.mockResolvedValueOnce(
      expanded(
        [
          ["parent", "Coding"],
          ["child", "Security"],
        ],
        [{ ref_id: "e-1", source: "parent", target: "child", edge_type: "PARENT_OF", properties: {} }],
      ),
    );

    const result = await findEdgeByEndpoints(config, {
      source_ref_id: "parent",
      edge_type: "PARENT_OF",
      target_ref_id: "child",
    });

    expect(result).toEqual({
      success: true,
      status: "success",
      ref_id: "e-1",
      edge: { ref_id: "e-1", properties: {}, source_name: "Coding", target_name: "Security" },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v2/nodes/parent");
    expect(url.searchParams.get("expand")).toBe("edges");
    expect(url.searchParams.get("edge_type")).toBe('["PARENT_OF"]');
    expect(url.searchParams.get("limit")).toBe("500");
  });

  test("falls back to the target side when the source side doesn't list the edge", async () => {
    mockFetch
      .mockResolvedValueOnce(expanded([["parent", "Coding"]], []))
      .mockResolvedValueOnce(
        expanded(
          [["child", "Security"]],
          [{ ref_id: "e-2", source: "parent", target: "child", edge_type: "PARENT_OF", properties: {} }],
        ),
      );

    const result = await findEdgeByEndpoints(config, {
      source_ref_id: "parent",
      edge_type: "PARENT_OF",
      target_ref_id: "child",
    });

    expect(result.edge?.ref_id).toBe("e-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(new URL(mockFetch.mock.calls[1][0] as string).pathname).toBe("/v2/nodes/child");
  });

  test("treats a muted edge, the reverse direction and another type as absent", async () => {
    const edges = [
      { ref_id: "muted", source: "parent", target: "child", edge_type: "PARENT_OF", properties: { is_muted: true } },
      { ref_id: "reverse", source: "child", target: "parent", edge_type: "PARENT_OF", properties: {} },
      { ref_id: "other", source: "parent", target: "child", edge_type: "RELATED_TO", properties: {} },
    ];
    mockFetch.mockResolvedValueOnce(expanded([], edges)).mockResolvedValueOnce(expanded([], edges));

    const result = await findEdgeByEndpoints(config, {
      source_ref_id: "parent",
      edge_type: "PARENT_OF",
      target_ref_id: "child",
    });

    expect(result).toEqual({ success: true, status: "success" });
  });

  test("rejects an unsafe ref_id or edge type without calling Jarvis", async () => {
    const bad = await findEdgeByEndpoints(config, { source_ref_id: "a b", edge_type: "PARENT_OF", target_ref_id: "c" });
    expect(bad.success).toBe(false);
    expect(bad.message).toContain("Invalid ref_id");

    const badType = await findEdgeByEndpoints(config, {
      source_ref_id: "a",
      edge_type: 'X"]; DROP',
      target_ref_id: "c",
    });
    expect(badType.success).toBe(false);
    expect(badType.message).toContain("Invalid edge_type");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("surfaces a failed read", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "down" });

    const result = await findEdgeByEndpoints(config, { source_ref_id: "a", edge_type: "PARENT_OF", target_ref_id: "c" });

    expect(result.success).toBe(false);
    expect(result.status).toBe("503");
  });
});

describe("listIncomingEdges", () => {
  test("lists the live edges of the type pointing at the node, with their sources' names", async () => {
    mockFetch.mockResolvedValueOnce(
      expanded(
        [
          ["node", "Security"],
          ["p1", "Coding"],
          ["p2", "Ops"],
          ["kid", "SSRF"],
        ],
        [
          { ref_id: "e-1", source: "p1", target: "node", edge_type: "PARENT_OF", properties: {} },
          { ref_id: "e-2", source: "p2", target: "node", edge_type: "PARENT_OF", properties: { is_muted: true } },
          { ref_id: "e-3", source: "node", target: "kid", edge_type: "PARENT_OF", properties: {} },
          { ref_id: "e-4", source: "node", target: "node", edge_type: "PARENT_OF", properties: {} },
        ],
      ),
    );

    const result = await listIncomingEdges(config, { ref_id: "node", edge_type: "PARENT_OF" });

    expect(result).toEqual({
      success: true,
      status: "success",
      edges: [{ ref_id: "e-1", source_ref_id: "p1", source_name: "Coding", properties: {} }],
    });
  });

  test("returns no edges and the failure when the read fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));

    const result = await listIncomingEdges(config, { ref_id: "node", edge_type: "PARENT_OF" });

    expect(result).toMatchObject({ success: false, edges: [] });
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

  test("fails on status 'Error' even when no message starts with 'error'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "Error",
        status_messages: ["node_type HiveTask not in schema"],
      }),
    });

    const result = await addNodeBulk(config, nodes);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("node_type HiveTask not in schema");
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

// ---------------------------------------------------------------------------
// getReferencedNodeCentrality
// ---------------------------------------------------------------------------

describe("getReferencedNodeCentrality", () => {
  const issueRefId = "error-issue-ref-1";

  function makeNodeResponse(nodes: Array<unknown>, edges: Array<unknown>) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ nodes, edges }),
    };
  }

  test("maps properties.pagerank into the returned CentralityNode.pagerank", async () => {
    mockFetch.mockResolvedValueOnce(
      makeNodeResponse(
        [{ ref_id: "file-ref-1", node_type: "File", name: "core.ts", properties: { pagerank: 1.17 } }],
        [{ source: issueRefId, target: "file-ref-1", edge_type: "REFERENCES" }],
      ),
    );

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].pagerank).toBe(1.17);
    expect(result.nodes[0].ref_id).toBe("file-ref-1");
    expect(result.nodes[0].node_type).toBe("File");
  });

  test("returns pagerank=undefined when properties.pagerank is absent", async () => {
    mockFetch.mockResolvedValueOnce(
      makeNodeResponse(
        [{ ref_id: "file-ref-2", node_type: "File", name: "leaf.ts", properties: {} }],
        [{ source: issueRefId, target: "file-ref-2", edge_type: "REFERENCES" }],
      ),
    );

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].pagerank).toBeUndefined();
  });

  test("returns pagerank=undefined when properties.pagerank is non-numeric", async () => {
    mockFetch.mockResolvedValueOnce(
      makeNodeResponse(
        [{ ref_id: "file-ref-3", node_type: "Function", name: "doWork", properties: { pagerank: "high" } }],
        [{ source: issueRefId, target: "file-ref-3", edge_type: "REFERENCES" }],
      ),
    );

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(true);
    expect(result.nodes[0].pagerank).toBeUndefined();
  });

  test("returns pagerank=undefined when node has algo_page_rank but NO pagerank (old property never read)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeNodeResponse(
        [{ ref_id: "file-ref-4", node_type: "File", name: "old.ts", properties: { algo_page_rank: 0.99 } }],
        [{ source: issueRefId, target: "file-ref-4", edge_type: "REFERENCES" }],
      ),
    );

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    // algo_page_rank must NOT be read — pagerank should be undefined
    expect(result.nodes[0].pagerank).toBeUndefined();
  });

  test("returns ok:false when HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(false);
    expect(result.nodes).toHaveLength(0);
    expect(result.error).toContain("503");
  });

  test("returns ok:false and empty nodes when fetch throws (never throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(false);
    expect(result.nodes).toHaveLength(0);
  });

  test("deduplicates nodes when the same ref_id appears in multiple REFERENCES edges", async () => {
    mockFetch.mockResolvedValueOnce(
      makeNodeResponse(
        [{ ref_id: "file-dup", node_type: "File", name: "dup.ts", properties: { pagerank: 0.5 } }],
        [
          { source: issueRefId, target: "file-dup", edge_type: "REFERENCES" },
          { source: issueRefId, target: "file-dup", edge_type: "REFERENCES" },
        ],
      ),
    );

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].pagerank).toBe(0.5);
  });

  test("ignores edges that are not REFERENCES or not sourced from the issue node", async () => {
    mockFetch.mockResolvedValueOnce(
      makeNodeResponse(
        [
          { ref_id: "file-ok", node_type: "File", name: "good.ts", properties: { pagerank: 0.7 } },
          { ref_id: "file-other", node_type: "File", name: "other.ts", properties: { pagerank: 0.3 } },
        ],
        [
          { source: issueRefId, target: "file-ok", edge_type: "REFERENCES" },
          { source: "other-node", target: "file-other", edge_type: "REFERENCES" }, // wrong source
          { source: issueRefId, target: "file-other", edge_type: "RELATED_TO" }, // wrong edge_type
        ],
      ),
    );

    const result = await getReferencedNodeCentrality(config, issueRefId);

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].ref_id).toBe("file-ok");
  });
});

// ---------------------------------------------------------------------------
// searchNodesByAttributes
// ---------------------------------------------------------------------------

describe("searchNodesByAttributes", () => {
  const repoKey = "stakwork/senza-lnd";

  test("POSTs to /graph/search/attributes with correct body shape", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        nodes: [
          { ref_id: "file-ref-1", node_type: "File", properties: { file: "stakwork/senza-lnd/app/controllers/admin/blacklists_controller.rb" } },
        ],
      }),
    });

    const result = await searchNodesByAttributes(config, {
      nodeTypes: ["File", "Function"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
      includeProperties: true,
      limit: 1000,
    });

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].ref_id).toBe("file-ref-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-swarm.sphinx.chat:8444/graph/search/attributes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-token": "test-api-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          node_type: ["File", "Function"],
          search_filters: [{ attribute: "file", value: "stakwork/senza-lnd/", comparator: "contains" }],
          include_properties: true,
          limit: 1000,
          skip_cache: false,
        }),
      }),
    );
  });

  test("returns { ok: true, nodes: [] } when response has no nodes array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const result = await searchNodesByAttributes(config, {
      nodeTypes: ["File"],
      filters: [{ attribute: "file", value: "stakwork/empty-repo/", comparator: "contains" }],
      includeProperties: true,
    });

    expect(result.ok).toBe(true);
    expect(result.nodes).toEqual([]);
  });

  test("returns { ok: false, endpointMissing: true } on 404 (endpoint absent on this backend)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "404 page not found",
    });

    const result = await searchNodesByAttributes(config, {
      nodeTypes: ["File", "Function"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
      includeProperties: true,
    });

    expect(result.ok).toBe(false);
    expect(result.endpointMissing).toBe(true);
    expect(result.nodes).toEqual([]);
    expect(result.error).toBeDefined();
  });

  test("returns { ok: false } on 500 (not endpointMissing)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal server error",
    });

    const result = await searchNodesByAttributes(config, {
      nodeTypes: ["File", "Function"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
      includeProperties: true,
    });

    expect(result.ok).toBe(false);
    expect(result.endpointMissing).toBeFalsy();
    expect(result.error).toContain("500");
  });

  test("returns { ok: false } when fetch throws (never throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await searchNodesByAttributes(config, {
      nodeTypes: ["File", "Function"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
      includeProperties: true,
    });

    expect(result.ok).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.error).toBe("Network timeout");
  });

  test("defaults include_properties to false and limit to 1000 when not specified", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ nodes: [] }),
    });

    await searchNodesByAttributes(config, {
      nodeTypes: ["File"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.include_properties).toBe(false);
    expect(sentBody.limit).toBe(1000);
  });

  test("sends skip_cache: true in POST body when skipCache: true is passed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ nodes: [] }),
    });

    await searchNodesByAttributes(config, {
      nodeTypes: ["File"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
      skipCache: true,
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.skip_cache).toBe(true);
  });

  test("sends skip_cache: false in POST body when skipCache is omitted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ nodes: [] }),
    });

    await searchNodesByAttributes(config, {
      nodeTypes: ["File"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.skip_cache).toBe(false);
  });

  test("sends skip_cache: false in POST body when skipCache is explicitly false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ nodes: [] }),
    });

    await searchNodesByAttributes(config, {
      nodeTypes: ["File"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
      skipCache: false,
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.skip_cache).toBe(false);
  });

  test("returns all nodes in response — does not truncate to 1000", async () => {
    const manyNodes = Array.from({ length: 50 }, (_, i) => ({
      ref_id: `file-ref-${i}`,
      node_type: "File",
      properties: { file: `stakwork/senza-lnd/app/file${i}.rb` },
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ nodes: manyNodes }),
    });

    const result = await searchNodesByAttributes(config, {
      nodeTypes: ["File", "Function"],
      filters: [{ attribute: "file", value: `${repoKey}/`, comparator: "contains" }],
      includeProperties: true,
      limit: 1000,
    });

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(50);
  });
});
