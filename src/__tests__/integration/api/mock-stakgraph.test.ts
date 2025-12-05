import { describe, it, expect, beforeEach } from "vitest";
import { stakgraphState } from "@/lib/mock/stakgraph-state";
import { POST as ingestAsyncPOST } from "@/app/api/mock/stakgraph/ingest_async/route";
import { POST as syncAsyncPOST } from "@/app/api/mock/stakgraph/sync_async/route";
import { POST as syncPOST } from "@/app/api/mock/stakgraph/sync/route";
import { GET as statusGET } from "@/app/api/mock/stakgraph/status/[requestId]/route";

/**
 * Integration tests for Mock Stakgraph Service
 * 
 * Tests the mock implementation of the Stakgraph service (port 7799)
 * which handles code repository ingestion and synchronization.
 */

// Helper to create POST request
function createPostRequest(body: object, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/mock/stakgraph", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": "Bearer test-token",
      ...headers,
    },
    body: JSON.stringify(body),
  }) as any;
}

// Helper to create GET request
function createGetRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/mock/stakgraph", {
    method: "GET",
    headers: {
      "authorization": "Bearer test-token",
      ...headers,
    },
  }) as any;
}

describe("Mock Stakgraph Service - Integration Tests", () => {
  beforeEach(() => {
    // Reset state before each test for isolation
    stakgraphState.reset();
  });

  describe("POST /api/mock/stakgraph/ingest_async", () => {
    it("should start ingestion and return request ID", async () => {
      const request = createPostRequest({
        repo_url: "https://github.com/test-org/test-repo",
        username: "testuser",
        pat: "github_pat_test",
        use_lsp: false,
        realtime: true,
      });

      const response = await ingestAsyncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("request_id");
      expect(data.request_id).toMatch(/^req-\d{6}$/);
      expect(data.status).toBe("pending");
      expect(data.message).toBe("Ingestion started");
    });

    it("should reject request without repo_url", async () => {
      const request = createPostRequest({
        username: "testuser",
        pat: "github_pat_test",
      });

      const response = await ingestAsyncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("repo_url is required");
    });

    it("should reject request without authentication credentials", async () => {
      const request = createPostRequest({
        repo_url: "https://github.com/test-org/test-repo",
      });

      const response = await ingestAsyncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("username and pat are required for authentication");
    });

    it("should reject request without authorization header", async () => {
      // Create request without authorization header directly
      const requestWithoutAuth = new Request("http://localhost:3000/api/mock/stakgraph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo_url: "https://github.com/test-org/test-repo",
          username: "testuser",
          pat: "github_pat_test",
        }),
      }) as any;

      const response = await ingestAsyncPOST(requestWithoutAuth);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Missing authorization");
    });

    it("should accept callback_url parameter", async () => {
      const request = createPostRequest({
        repo_url: "https://github.com/test-org/test-repo",
        username: "testuser",
        pat: "github_pat_test",
        callback_url: "https://app.example.com/api/webhook",
        use_lsp: true,
      });

      const response = await ingestAsyncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("request_id");

      // Verify state manager received callback URL
      const requestState = stakgraphState.getRequestStatus(data.request_id);
      expect(requestState?.callbackUrl).toBe("https://app.example.com/api/webhook");
      expect(requestState?.useLsp).toBe(true);
    });
  });

  describe("POST /api/mock/stakgraph/sync_async", () => {
    it("should start sync and return request ID", async () => {
      const request = createPostRequest({
        repo_url: "https://github.com/test-org/test-repo",
        username: "testuser",
        pat: "github_pat_test",
        use_lsp: false,
      });

      const response = await syncAsyncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("request_id");
      expect(data.request_id).toMatch(/^req-\d{6}$/);
      expect(data.status).toBe("pending");
      expect(data.message).toBe("Sync started");
    });

    it("should handle missing username with default", async () => {
      const request = createPostRequest({
        repo_url: "https://github.com/test-org/test-repo",
        pat: "github_pat_test",
      });

      const response = await syncAsyncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("request_id");

      // Verify default username was used
      const requestState = stakgraphState.getRequestStatus(data.request_id);
      expect(requestState?.username).toBe("mock-user");
    });
  });

  describe("POST /api/mock/stakgraph/sync", () => {
    it("should return completed status immediately", async () => {
      const request = createPostRequest({
        repo_url: "https://github.com/test-org/test-repo",
        username: "testuser",
        use_lsp: false,
      });

      const response = await syncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("completed");
      expect(data.message).toBe("Sync completed successfully");
      expect(data.repo_url).toBe("https://github.com/test-org/test-repo");
    });

    it("should reject request without repo_url", async () => {
      const request = createPostRequest({
        username: "testuser",
      });

      const response = await syncPOST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("repo_url is required");
    });
  });

  describe("GET /api/mock/stakgraph/status/[requestId]", () => {
    it("should return status for existing request", async () => {
      // Create a request first
      const requestId = stakgraphState.createIngestRequest(
        "https://github.com/test-org/test-repo",
        "testuser"
      );

      const request = createGetRequest();
      const response = await statusGET(request, {
        params: Promise.resolve({ requestId }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.request_id).toBe(requestId);
      expect(data.status).toBe("pending");
      expect(data.progress).toBe(0);
      expect(data.repo_url).toBe("https://github.com/test-org/test-repo");
      expect(data).toHaveProperty("created_at");
    });

    it("should auto-create request if not found (resilience)", async () => {
      const request = createGetRequest();
      const response = await statusGET(request, {
        params: Promise.resolve({ requestId: "req-999999" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.request_id).toBe("req-999999");
      expect(data.status).toBe("completed");
      expect(data.progress).toBe(100);
    });

    it("should reject request without authorization", async () => {
      const requestWithoutAuth = new Request(
        "http://localhost:3000/api/mock/stakgraph/status/req-000001",
        {
          method: "GET",
          headers: {},
        }
      ) as any;

      const response = await statusGET(requestWithoutAuth, {
        params: Promise.resolve({ requestId: "req-000001" }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Missing authorization");
    });

    it("should include completed_at timestamp when completed", async () => {
      // Create a completed request
      const requestId = stakgraphState.createIngestRequest(
        "https://github.com/test-org/test-repo",
        "testuser"
      );

      // Manually complete the request for testing
      const requestState = stakgraphState.getRequestStatus(requestId);
      if (requestState) {
        requestState.status = "COMPLETED";
        requestState.progress = 100;
        requestState.completedAt = Date.now();
      }

      const request = createGetRequest();
      const response = await statusGET(request, {
        params: Promise.resolve({ requestId }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("completed");
      expect(data.progress).toBe(100);
      expect(data).toHaveProperty("completed_at");
    });
  });

  describe("State Manager Integration", () => {
    it("should track multiple concurrent requests", async () => {
      const request1 = createPostRequest({
        repo_url: "https://github.com/org1/repo1",
        username: "user1",
        pat: "pat1",
      });

      const request2 = createPostRequest({
        repo_url: "https://github.com/org2/repo2",
        username: "user2",
        pat: "pat2",
      });

      const response1 = await ingestAsyncPOST(request1);
      const response2 = await ingestAsyncPOST(request2);

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.request_id).not.toBe(data2.request_id);
      expect(stakgraphState.getAllRequests()).toHaveLength(2);
    });

    it("should reset state correctly", () => {
      stakgraphState.createIngestRequest("https://github.com/org/repo", "user");
      expect(stakgraphState.getAllRequests()).toHaveLength(1);

      stakgraphState.reset();
      expect(stakgraphState.getAllRequests()).toHaveLength(0);
    });

    it("should auto-increment request IDs", () => {
      const id1 = stakgraphState.createIngestRequest("https://github.com/org/repo1", "user");
      const id2 = stakgraphState.createIngestRequest("https://github.com/org/repo2", "user");
      const id3 = stakgraphState.createIngestRequest("https://github.com/org/repo3", "user");

      expect(id1).toBe("req-000001");
      expect(id2).toBe("req-000002");
      expect(id3).toBe("req-000003");
    });
  });

  describe("Async Status Transitions", () => {
    it("should transition request status over time", async () => {
      const requestId = stakgraphState.createIngestRequest(
        "https://github.com/test-org/test-repo",
        "testuser"
      );

      // Initial status should be PENDING
      let requestState = stakgraphState.getRequestStatus(requestId);
      expect(requestState?.status).toBe("PENDING");
      expect(requestState?.progress).toBe(0);

      // Wait for first transition (1 second)
      await new Promise((resolve) => setTimeout(resolve, 1200));
      requestState = stakgraphState.getRequestStatus(requestId);
      expect(requestState?.status).toBe("PROCESSING");
      expect(requestState?.progress).toBeGreaterThan(0);

      // Don't wait for full completion to keep test fast
    });

    it("should complete ingestion after all delays", async () => {
      const requestId = stakgraphState.createIngestRequest(
        "https://github.com/test-org/test-repo",
        "testuser"
      );

      // Wait for completion (total ~7 seconds)
      await new Promise((resolve) => setTimeout(resolve, 7500));

      const requestState = stakgraphState.getRequestStatus(requestId);
      expect(requestState?.status).toBe("COMPLETED");
      expect(requestState?.progress).toBe(100);
      expect(requestState?.completedAt).toBeDefined();
    }, 10000); // 10 second timeout for this slow test
  });
});
