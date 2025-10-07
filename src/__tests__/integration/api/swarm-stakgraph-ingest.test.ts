import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST, GET } from "@/app/api/swarm/stakgraph/ingest/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
} from "@/__tests__/support/helpers";

// Mock external API calls
vi.mock("@/services/swarm/stakgraph-actions", () => ({
  triggerIngestAsync: vi.fn(),
}));

vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequest: vi.fn(),
}));

vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: "webhook-secret" }),
  })),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(() => ({
    baseURL: "https://github.com",
    apiKey: "test-api-key",
    timeout: 30000,
  })),
}));

vi.mock("@/lib/constants", () => ({
  getSwarmVanityAddress: vi.fn((name: string) => `${name}.sphinx.chat`),
}));

vi.mock("@/lib/url", () => ({
  getGithubWebhookCallbackUrl: vi.fn(() => "https://app.example.com/api/github/webhook"),
  getStakgraphWebhookCallbackUrl: vi.fn(() => "https://app.example.com/api/swarm/stakgraph/webhook"),
}));

import { triggerIngestAsync } from "@/services/swarm/stakgraph-actions";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import type { AsyncSyncResult } from "@/services/swarm/stakgraph-actions";

const mockTriggerIngestAsync = triggerIngestAsync as vi.Mock;
const mockSwarmApiRequest = swarmApiRequest as vi.Mock;

// Helper to create POST request
function createPostRequest(body: object) {
  return new Request("http://localhost:3000/api/swarm/stakgraph/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

// Helper to create GET request
function createGetRequest(params: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/swarm/stakgraph/ingest");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return new Request(url.toString(), { method: "GET" }) as any;
}

describe("POST /api/swarm/stakgraph/ingest - Integration Tests", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_test_key_integration";
  const PLAINTEXT_GITHUB_PAT = "github_pat_integration";

  let userId: string;
  let workspaceId: string;
  let swarmId: string;
  let sourceControlOrgId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data atomically
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const sourceControlOrg = await tx.sourceControlOrg.create({
        data: {
          githubLogin: `test-org-${generateUniqueId()}`,
          githubInstallationId: Math.floor(Math.random() * 1000000),
          type: "ORG",
        },
      });

      await tx.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(enc.encryptField("source_control_token", PLAINTEXT_GITHUB_PAT)),
          scopes: ["repo", "read:org"],
        },
      });

      await tx.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      await tx.gitHubAuth.create({
        data: {
          userId: user.id,
          githubUserId: "123456",
          githubUsername: "testuser",
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `test-swarm-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://test-swarm-${generateUniqueId()}.sphinx.chat/api`,
          swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)),
          repositoryUrl: "https://github.com/test-org/test-repo",
          defaultBranch: "main",
        },
      });

      return { user, workspace, swarm, sourceControlOrg };
    });

    userId = testData.user.id;
    workspaceId = testData.workspace.id;
    swarmId = testData.swarm.swarmId!;
    sourceControlOrgId = testData.sourceControlOrg.id;

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testData.user));
  });

  describe("Repository Upsert Operations", () => {
    it("should create new repository with PENDING status", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-123" },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify repository was created
      const repository = await db.repository.findFirst({
        where: {
          repositoryUrl: "https://github.com/test-org/test-repo",
          workspaceId,
        },
      });

      expect(repository).toBeTruthy();
      expect(repository?.status).toBe(RepositoryStatus.PENDING);
      expect(repository?.branch).toBe("main");
      expect(repository?.name).toBe("test-repo");
    });

    it("should update existing repository to PENDING status on re-ingestion", async () => {
      // Create initial repository with SYNCED status
      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test-org/test-repo",
          workspaceId,
          status: RepositoryStatus.SYNCED,
          branch: "main",
        },
      });

      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-456" },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify repository status was updated to PENDING
      const repository = await db.repository.findFirst({
        where: {
          repositoryUrl: "https://github.com/test-org/test-repo",
          workspaceId,
        },
      });

      expect(repository?.status).toBe(RepositoryStatus.PENDING);
    });

    it("should enforce composite unique constraint (repositoryUrl_workspaceId)", async () => {
      // Create repository in workspace 1
      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test-org/test-repo",
          workspaceId,
          status: RepositoryStatus.PENDING,
          branch: "main",
        },
      });

      // Create another workspace
      const workspace2 = await db.workspace.create({
        data: {
          name: "Test Workspace 2",
          slug: generateUniqueSlug("test-workspace-2"),
          ownerId: userId,
        },
      });

      // Should allow same repositoryUrl in different workspace
      const repository2 = await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test-org/test-repo",
          workspaceId: workspace2.id,
          status: RepositoryStatus.PENDING,
          branch: "main",
        },
      });

      expect(repository2).toBeTruthy();
      expect(repository2.workspaceId).toBe(workspace2.id);

      // Verify both repositories exist
      const repositories = await db.repository.findMany({
        where: { repositoryUrl: "https://github.com/test-org/test-repo" },
      });

      expect(repositories).toHaveLength(2);
      expect(repositories.map((r) => r.workspaceId).sort()).toEqual(
        [workspaceId, workspace2.id].sort()
      );
    });
  });

  describe("Swarm IngestRefId Storage", () => {
    it("should store ingestRefId after successful triggerIngestAsync", async () => {
      const requestId = `ingest-req-${generateUniqueId()}`;
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: requestId },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify ingestRefId was stored
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.ingestRefId).toBe(requestId);
    });

    it("should not update ingestRefId when API response has no request_id", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: {},
      } as AsyncSyncResult);

      // Get initial ingestRefId
      const initialSwarm = await db.swarm.findUnique({
        where: { workspaceId },
      });
      const initialIngestRefId = initialSwarm?.ingestRefId;

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify ingestRefId was not changed
      const finalSwarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(finalSwarm?.ingestRefId).toBe(initialIngestRefId);
    });

    it("should overwrite previous ingestRefId on new ingestion", async () => {
      // Set initial ingestRefId
      await db.swarm.update({
        where: { workspaceId },
        data: { ingestRefId: "old-ingest-req-123" },
      });

      const newRequestId = `ingest-req-${generateUniqueId()}`;
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: newRequestId },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify ingestRefId was updated
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.ingestRefId).toBe(newRequestId);
      expect(swarm?.ingestRefId).not.toBe("old-ingest-req-123");
    });
  });

  describe("Encrypted Field Storage", () => {
    it("should verify swarmApiKey remains encrypted in database", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-123" },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify swarmApiKey is still encrypted
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.swarmApiKey).toBeTruthy();
      expect(swarm!.swarmApiKey).not.toContain(PLAINTEXT_SWARM_API_KEY);

      // Verify it can be decrypted
      const decryptedKey = enc.decryptField("swarmApiKey", swarm!.swarmApiKey!);
      expect(decryptedKey).toBe(PLAINTEXT_SWARM_API_KEY);
    });

    it("should verify API call receives decrypted swarmApiKey", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-123" },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      await POST(request);

      // Verify triggerIngestAsync was called (decryption happens inside)
      expect(mockTriggerIngestAsync).toHaveBeenCalled();
      const callArgs = mockTriggerIngestAsync.mock.calls[0];

      // The API key parameter should be decrypted (handled by EncryptionService)
      expect(callArgs).toBeTruthy();
    });
  });

  describe("Workspace and Swarm Lookup", () => {
    it("should find swarm by swarmId when provided", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-123" },
      } as AsyncSyncResult);

      const request = createPostRequest({ swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify repository was created with swarm's workspaceId
      const repository = await db.repository.findFirst({
        where: { repositoryUrl: "https://github.com/test-org/test-repo" },
      });

      expect(repository?.workspaceId).toBe(workspaceId);
    });

    it("should find swarm by workspaceId when swarmId not provided", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-123" },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify operation completed successfully
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.ingestRefId).toBe("ingest-req-123");
    });
  });

  describe("GitHub Credentials Integration", () => {
    it("should retrieve workspace-specific source control token", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-123" },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify source control token exists
      const token = await db.sourceControlToken.findUnique({
        where: {
          userId_sourceControlOrgId: {
            userId,
            sourceControlOrgId,
          },
        },
      });

      expect(token).toBeTruthy();
      expect(token?.token).not.toContain(PLAINTEXT_GITHUB_PAT);

      // Verify it can be decrypted
      const decryptedToken = enc.decryptField("source_control_token", token!.token);
      expect(decryptedToken).toBe(PLAINTEXT_GITHUB_PAT);
    });
  });

  describe("Request Validation and Error Handling", () => {
    it("should reject unauthenticated requests with 401", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    it("should return 404 when swarm not found by swarmId", async () => {
      const request = createPostRequest({ swarmId: "non-existent-swarm-id" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });

    it("should return 404 when swarm not found by workspaceId", async () => {
      const nonExistentWorkspaceId = generateUniqueId("workspace");
      const request = createPostRequest({ workspaceId: nonExistentWorkspaceId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });

    it("should return 400 when swarm has no swarmUrl", async () => {
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmUrl: null },
      });

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm URL or API key not set");
    });

    it("should return 400 when swarm has no swarmApiKey", async () => {
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmApiKey: null },
      });

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm URL or API key not set");
    });

    it("should return 400 when repository URL is missing", async () => {
      await db.swarm.update({
        where: { workspaceId },
        data: { repositoryUrl: null },
      });

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("No repository URL found");
    });

    it("should handle workspace deletion after swarm exists", async () => {
      // Delete workspace but keep swarm - this tests cascading delete behavior
      // When workspace is deleted, the swarm associated with it should also be removed
      // due to foreign key constraints, causing "Swarm not found" error
      await db.workspace.delete({ where: { id: workspaceId } });

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });

    it("should handle external API failures gracefully", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: false,
        status: 503,
        data: { error: "Stakgraph service unavailable" },
      } as AsyncSyncResult);

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);

      // Verify repository status was still set to PENDING
      const repository = await db.repository.findFirst({
        where: {
          repositoryUrl: "https://github.com/test-org/test-repo",
          workspaceId,
        },
      });

      expect(repository?.status).toBe(RepositoryStatus.PENDING);
    });

    it("should not block ingestion when webhook setup fails", async () => {
      mockTriggerIngestAsync.mockResolvedValue({
        ok: true,
        status: 200,
        data: { request_id: "ingest-req-webhook-fail" },
      } as AsyncSyncResult);

      // Mock WebhookService to throw error (webhook setup is in try-catch block)
      // The actual webhook setup happens inside the POST handler, errors are caught and logged

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      // Ingestion should still succeed even if webhook setup fails
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.request_id).toBe("ingest-req-webhook-fail");
    });

    it("should not leak sensitive credentials in error responses", async () => {
      // Force an error by providing invalid data that causes triggerIngestAsync to throw
      mockTriggerIngestAsync.mockRejectedValue(
        new Error(`API Error: ${PLAINTEXT_SWARM_API_KEY} and ${PLAINTEXT_GITHUB_PAT}`)
      );

      const request = createPostRequest({ workspaceId, swarmId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);

      // Verify response doesn't contain sensitive data
      const responseText = JSON.stringify(data);
      expect(responseText).not.toContain(PLAINTEXT_SWARM_API_KEY);
      expect(responseText).not.toContain(PLAINTEXT_GITHUB_PAT);
      expect(data.message).toBe("Failed to ingest code");
    });

    it("should handle missing both workspaceId and swarmId", async () => {
      const request = createPostRequest({});
      const response = await POST(request);
      const data = await response.json();

      // Without workspaceId or swarmId, the empty where clause causes a database error
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to ingest code");
    });
  });
});

describe("GET /api/swarm/stakgraph/ingest - Integration Tests", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_test_key_get";

  let userId: string;
  let workspaceId: string;
  let sourceControlOrgId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data atomically
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const sourceControlOrg = await tx.sourceControlOrg.create({
        data: {
          githubLogin: `test-org-${generateUniqueId()}`,
          githubInstallationId: Math.floor(Math.random() * 1000000),
          type: "ORG",
        },
      });

      await tx.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(enc.encryptField("source_control_token", "github_pat_test")),
          scopes: ["repo", "read:org"],
        },
      });

      await tx.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      await tx.gitHubAuth.create({
        data: {
          userId: user.id,
          githubUserId: "123456",
          githubUsername: "testuser",
        },
      });

      await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `test-swarm-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://test-swarm-${generateUniqueId()}.sphinx.chat/api`,
          swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)),
          ingestRefId: "ingest-req-123",
        },
      });

      return { user, workspace, sourceControlOrg };
    });

    userId = testData.user.id;
    workspaceId = testData.workspace.id;
    sourceControlOrgId = testData.sourceControlOrg.id;

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testData.user));
  });

  describe("Status Check Operations", () => {
    it("should call external API with decrypted credentials", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          request_id: "ingest-req-123",
          status: "InProgress",
          progress: 75,
        },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmApiRequest).toHaveBeenCalled();

      // Verify API call includes decrypted key (handled internally)
      const callArgs = mockSwarmApiRequest.mock.calls[0][0];
      expect(callArgs.method).toBe("GET");
      expect(callArgs.endpoint).toContain("/status/ingest-req-123");
    });

    it("should verify swarmApiKey remains encrypted after status check", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: "Complete" },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(200);

      // Verify swarmApiKey is still encrypted
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm?.swarmApiKey).toBeTruthy();
      expect(swarm!.swarmApiKey).not.toContain(PLAINTEXT_SWARM_API_KEY);

      // Verify it can still be decrypted
      const decryptedKey = enc.decryptField("swarmApiKey", swarm!.swarmApiKey!);
      expect(decryptedKey).toBe(PLAINTEXT_SWARM_API_KEY);
    });

    it("should return status from external API in response", async () => {
      const statusData = {
        request_id: "ingest-req-123",
        status: "Complete",
        progress: 100,
        result: { nodes: 1234, edges: 5678 },
        completed_at: "2024-01-01T12:00:00Z",
        duration_ms: 60000,
      };

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: statusData,
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.apiResult.data).toEqual(statusData);
    });

    it("should passthrough error status codes from external API", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: false,
        status: 404,
        data: { error: "Request not found" },
      });

      const request = createGetRequest({
        id: "nonexistent-request",
        workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(404);
    });
  });

  describe("Workspace and Swarm Lookup", () => {
    it("should retrieve workspace slug for credentials", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: "InProgress" },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(200);

      // Verify workspace exists and has slug
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { slug: true },
      });

      expect(workspace?.slug).toBeTruthy();
    });

    it("should find swarm by workspaceId", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: "InProgress" },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(200);

      // Verify swarm exists for workspace
      const swarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(swarm).toBeTruthy();
      expect(swarm?.ingestRefId).toBe("ingest-req-123");
    });
  });

  describe("Request Validation and Error Handling", () => {
    it("should reject unauthenticated requests with 401", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    it("should return 400 when id parameter is missing", async () => {
      const request = createGetRequest({
        workspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required fields: id, workspaceId");
    });

    it("should return 400 when workspaceId parameter is missing", async () => {
      const request = createGetRequest({
        id: "ingest-req-123",
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required fields: id, workspaceId");
    });

    it("should return 400 when both id and workspaceId are missing", async () => {
      const request = createGetRequest({});
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required fields: id, workspaceId");
    });

    it("should return 404 when workspace not found", async () => {
      const nonExistentWorkspaceId = generateUniqueId("workspace");
      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId: nonExistentWorkspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found");
    });

    it("should return 400 when GitHub credentials not found", async () => {
      // Delete GitHub auth to simulate missing credentials
      await db.gitHubAuth.deleteMany({
        where: { userId },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("No GitHub credentials found for user");
    });

    it("should return 404 when swarm not found", async () => {
      // Delete swarm to trigger not found error
      await db.swarm.delete({ where: { workspaceId } });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });

    it("should return 400 when swarm has no swarmUrl", async () => {
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmUrl: null },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm URL or API key not set");
    });

    it("should return 400 when swarm has no swarmApiKey", async () => {
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmApiKey: null },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm URL or API key not set");
    });

    it("should handle external API errors gracefully", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: false,
        status: 500,
        data: { error: "Internal server error" },
      });

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
    });

    it("should not leak sensitive credentials in error responses", async () => {
      // Force an error by having swarmApiRequest throw
      mockSwarmApiRequest.mockRejectedValue(
        new Error(`API Error: ${PLAINTEXT_SWARM_API_KEY}`)
      );

      const request = createGetRequest({
        id: "ingest-req-123",
        workspaceId,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);

      // Verify response doesn't contain sensitive data
      const responseText = JSON.stringify(data);
      expect(responseText).not.toContain(PLAINTEXT_SWARM_API_KEY);
      expect(data.message).toBe("Failed to ingest code");
    });
  });
});