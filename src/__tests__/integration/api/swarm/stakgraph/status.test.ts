import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/swarm/stakgraph/status/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  generateUniqueId,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";
import type { WebhookPayload } from "@/types/stakgraph";

/**
 * BUG FOUND: Route code at line 26 has incorrect field mapping
 * 
 * Issue: The route uses `where.swarmId = swarmId` but should use `where.id = swarmId`
 * 
 * In the Prisma schema:
 * - `id` is the primary key (cuid)
 * - `swarmId` is an optional field that stores the 3rd party swarm_id
 * 
 * The query parameter `swarmId` is meant to pass the primary key `id`, not the `swarmId` field.
 * This causes all swarm lookups by swarmId query parameter to fail with 404.
 * 
 * Fix needed in /src/app/api/swarm/stakgraph/status/route.ts line 26:
 * - Change: `if (swarmId) where.swarmId = swarmId;`
 * - To: `if (swarmId) where.id = swarmId;`
 * 
 * Tests below are currently skipped pending this fix.
 */

// Mock swarmApiRequest to avoid external API calls
vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequest: vi.fn(),
}));

// Mock getServerSession for session-based authentication
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { getServerSession } from "next-auth/next";

const mockSwarmApiRequest = swarmApiRequest as ReturnType<typeof vi.fn>;
const mockGetServerSession = getServerSession as ReturnType<typeof vi.fn>;

describe("GET /api/swarm/stakgraph/status - Authentication", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  const PLAINTEXT_API_KEY = "test-swarm-api-key-auth";

  beforeEach(async () => {
    vi.clearAllMocks();

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Status Auth Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    // Create swarm with encrypted API key
    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField(
      "swarmApiKey",
      PLAINTEXT_API_KEY
    );

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `auth-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should authenticate successfully with valid Bearer token", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-123",
        status: "InProgress",
        progress: 50,
      },
    });

    const request = new Request(
      `http://localhost:3000/api/swarm/stakgraph/status?id=req-123&swarmId=${swarm.id}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${PLAINTEXT_API_KEY}`,
        },
      }
    ) as any;

    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.apiResult.ok).toBe(true);
    expect(data.apiResult.data.request_id).toBe("req-123");
  });

  it("should fall back to session-based authentication when no Bearer token", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name },
    });

    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-456",
        status: "Complete",
        progress: 100,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-456&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.apiResult.ok).toBe(true);
    expect(mockGetServerSession).toHaveBeenCalled();
  });

  it("should return 401 when Bearer token is invalid", async () => {
    const request = new Request(
      `http://localhost:3000/api/swarm/stakgraph/status?id=req-789&swarmId=${swarm.id}`,
      {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-token",
        },
      }
    ) as any;

    const response = await GET(request);

    await expectUnauthorized(response);
  });

  it("should return 401 when no Bearer token and no valid session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-999&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    await expectUnauthorized(response);
  });
});

describe("GET /api/swarm/stakgraph/status - Input Validation", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  const PLAINTEXT_API_KEY = "test-swarm-api-key-validation";

  beforeEach(async () => {
    vi.clearAllMocks();

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Validation Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField(
      "swarmApiKey",
      PLAINTEXT_API_KEY
    );

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `validation-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    mockGetServerSession.mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 400 when id parameter is missing", async () => {
    const request = createGetRequest(
      `/api/swarm/stakgraph/status?swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Missing required fields: id");
  });

  it("should return 400 when swarm has no name", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { name: "" },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-123&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Swarm not configured");
  });

  it("should return 400 when swarm has no API key", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { swarmApiKey: null },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-456&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Swarm not configured");
  });
});

describe("GET /api/swarm/stakgraph/status - Swarm Resolution", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  const PLAINTEXT_API_KEY = "test-swarm-api-key-resolution";

  beforeEach(async () => {
    vi.clearAllMocks();

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Resolution Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField(
      "swarmApiKey",
      PLAINTEXT_API_KEY
    );

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `resolution-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    mockGetServerSession.mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 404 when swarm not found by swarmId", async () => {
    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-123&swarmId=nonexistent-swarm-id`
    );

    const response = await GET(request);

    await expectNotFound(response);
    const data = await response.json();
    expect(data.message).toBe("Swarm not found");
  });

  it("should return 404 when swarm not found by workspaceId", async () => {
    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-456&workspaceId=nonexistent-workspace-id`
    );

    const response = await GET(request);

    await expectNotFound(response);
  });

  it("should successfully resolve swarm by swarmId", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-789",
        status: "InProgress",
        progress: 75,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-789&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.apiResult.ok).toBe(true);
    expect(mockSwarmApiRequest).toHaveBeenCalled();
  });

  it("should successfully resolve swarm by workspaceId", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-abc",
        status: "Complete",
        progress: 100,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-abc&workspaceId=${workspace.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.apiResult.ok).toBe(true);
    expect(mockSwarmApiRequest).toHaveBeenCalled();
  });
});

describe("GET /api/swarm/stakgraph/status - External Service Integration", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  const PLAINTEXT_API_KEY = "test-swarm-api-key-service";

  beforeEach(async () => {
    vi.clearAllMocks();

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Service Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField(
      "swarmApiKey",
      PLAINTEXT_API_KEY
    );

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `service-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    mockGetServerSession.mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should successfully proxy status request to stakgraph service", async () => {
    const mockStatusData: WebhookPayload = {
      request_id: "req-success-123",
      status: "InProgress",
      progress: 60,
      result: { nodes: 150, edges: 320 },
      started_at: "2024-01-15T10:00:00Z",
    };

    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: mockStatusData,
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-success-123&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.apiResult.ok).toBe(true);
    expect(data.apiResult.data).toEqual(mockStatusData);
    expect(data.apiResult.data.request_id).toBe("req-success-123");
    expect(data.apiResult.data.status).toBe("InProgress");
    expect(data.apiResult.data.progress).toBe(60);
    expect(data.apiResult.data.result?.nodes).toBe(150);
    expect(data.apiResult.data.result?.edges).toBe(320);
  });

  it("should handle Complete status from stakgraph service", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-complete-456",
        status: "Complete",
        progress: 100,
        result: { nodes: 250, edges: 540 },
        completed_at: "2024-01-15T11:00:00Z",
        duration_ms: 60000,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-complete-456&workspaceId=${workspace.id}`
    );

    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.apiResult.data.status).toBe("Complete");
    expect(data.apiResult.data.progress).toBe(100);
    expect(data.apiResult.data.completed_at).toBeDefined();
  });

  it("should handle Failed status from stakgraph service", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-failed-789",
        status: "Failed",
        progress: 45,
        error: "Repository access denied",
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-failed-789&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.apiResult.data.status).toBe("Failed");
    expect(data.apiResult.data.error).toBe("Repository access denied");
  });

  it("should return 500 when stakgraph service is unavailable", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-error-123&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(500);
  });

  it("should return 404 when stakgraph service returns 404", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: false,
      status: 404,
      data: { error: "Request not found" },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=nonexistent-request&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(404);
  });

  it("should handle network errors gracefully", async () => {
    mockSwarmApiRequest.mockRejectedValue(
      new Error("Network error: Connection timeout")
    );

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-network-error&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Failed to get status");
  });

  it("should verify API key is decrypted before external call", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-decrypt-test",
        status: "InProgress",
        progress: 30,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-decrypt-test&swarmId=${swarm.id}`
    );

    await GET(request);

    // Verify swarmApiRequest was called with correct parameters
    expect(mockSwarmApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/status/req-decrypt-test",
        method: "GET",
      })
    );

    // Verify database still has encrypted key
    const swarmFromDb = await db.swarm.findUnique({
      where: { id: swarm.id },
    });
    expect(swarmFromDb?.swarmApiKey).toBeTruthy();
    expect(swarmFromDb!.swarmApiKey).not.toContain(PLAINTEXT_API_KEY);
  });
});

describe("GET /api/swarm/stakgraph/status - Response Structure", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  const PLAINTEXT_API_KEY = "test-swarm-api-key-response";

  beforeEach(async () => {
    vi.clearAllMocks();

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Response Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField(
      "swarmApiKey",
      PLAINTEXT_API_KEY
    );

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `response-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    mockGetServerSession.mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return valid WebhookPayload structure", async () => {
    const mockPayload: WebhookPayload = {
      request_id: "req-struct-123",
      status: "InProgress",
      progress: 50,
      result: { nodes: 100, edges: 200 },
      started_at: "2024-01-15T10:30:00Z",
    };

    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: mockPayload,
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-struct-123&swarmId=${swarm.id}`
    );

    const response = await GET(request);
    const data = await expectSuccess(response);

    // Verify response structure
    expect(data).toHaveProperty("apiResult");
    expect(data.apiResult).toHaveProperty("ok");
    expect(data.apiResult).toHaveProperty("data");
    expect(data.apiResult).toHaveProperty("status");

    // Verify payload structure
    expect(data.apiResult.data).toHaveProperty("request_id");
    expect(data.apiResult.data).toHaveProperty("status");
    expect(data.apiResult.data).toHaveProperty("progress");
    expect(data.apiResult.data).toHaveProperty("result");
    expect(data.apiResult.data.result).toHaveProperty("nodes");
    expect(data.apiResult.data.result).toHaveProperty("edges");

    // Verify data types
    expect(typeof data.apiResult.data.request_id).toBe("string");
    expect(typeof data.apiResult.data.status).toBe("string");
    expect(typeof data.apiResult.data.progress).toBe("number");
    expect(typeof data.apiResult.data.result.nodes).toBe("number");
    expect(typeof data.apiResult.data.result.edges).toBe("number");
  });

  it("should handle minimal WebhookPayload with only required fields", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-minimal",
        status: "InProgress",
        progress: 25,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-minimal&swarmId=${swarm.id}`
    );

    const response = await GET(request);
    const data = await expectSuccess(response);

    expect(data.apiResult.data.request_id).toBe("req-minimal");
    expect(data.apiResult.data.status).toBe("InProgress");
    expect(data.apiResult.data.progress).toBe(25);
  });

  it("should passthrough HTTP status code from stakgraph service", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 202,
      data: {
        request_id: "req-status-code",
        status: "InProgress",
        progress: 10,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-status-code&swarmId=${swarm.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(202);
  });

  it("should handle zero progress value", async () => {
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        request_id: "req-zero-progress",
        status: "InProgress",
        progress: 0,
      },
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-zero-progress&swarmId=${swarm.id}`
    );

    const response = await GET(request);
    const data = await expectSuccess(response);

    expect(data.apiResult.data.progress).toBe(0);
  });

  it("should handle complete payload with all optional fields", async () => {
    const completePayload: WebhookPayload = {
      request_id: "req-complete-payload",
      status: "Complete",
      progress: 100,
      result: { nodes: 300, edges: 650 },
      error: null,
      started_at: "2024-01-15T10:00:00Z",
      completed_at: "2024-01-15T11:00:00Z",
      duration_ms: 3600000,
    };

    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: completePayload,
    });

    const request = createGetRequest(
      `/api/swarm/stakgraph/status?id=req-complete-payload&swarmId=${swarm.id}`
    );

    const response = await GET(request);
    const data = await expectSuccess(response);

    expect(data.apiResult.data).toEqual(completePayload);
    expect(data.apiResult.data.started_at).toBe("2024-01-15T10:00:00Z");
    expect(data.apiResult.data.completed_at).toBe("2024-01-15T11:00:00Z");
    expect(data.apiResult.data.duration_ms).toBe(3600000);
  });
});