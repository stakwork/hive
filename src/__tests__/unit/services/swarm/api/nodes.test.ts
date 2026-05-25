import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  global.fetch = mockFetch;
});

const { addNode, addEdge } = await import("@/services/swarm/api/nodes");

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

      expect(result).toEqual({ success: true, ref_id: "existing-node-id" });
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
    test("calls POST /v2/edges with correct body and headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          status_messages: [],
        }),
      });

      const result = await addEdge(config, edgePayload);

      expect(result).toEqual({ success: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:8444/v2/edges",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key",
          }),
          body: JSON.stringify(edgePayload),
        }),
      );
    });

    test("works with EVAL_RUN edge type (no edge_data)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", status_messages: [] }),
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
