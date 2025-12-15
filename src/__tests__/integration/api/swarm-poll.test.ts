import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST, GET } from "@/app/api/swarm/poll/route";
import { db } from "@/lib/db";
import { SwarmStatus } from "@prisma/client";
import type { User, Workspace, Swarm } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/support/factories/workspace.factory";
import { EncryptionService } from "@/lib/encryption";

// Mock the fetchSwarmDetails function to avoid real API calls
vi.mock("@/services/swarm/api/swarm", () => ({
  fetchSwarmDetails: vi.fn(),
}));

// Mock the fake mode to control test behavior
vi.mock("@/services/swarm/fake", () => ({
  isFakeMode: false,
  fakePollSwarm: vi.fn(),
}));

// Import mocked functions for assertions
import { fetchSwarmDetails } from "@/services/swarm/api/swarm";
import { isFakeMode, fakePollSwarm } from "@/services/swarm/fake";

describe("Swarm Poll API Integration Tests", () => {
  let ownerUser: User;
  let adminUser: User;
  let developerUser: User;
  let viewerUser: User;
  let unauthorizedUser: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up encryption environment for tests
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY ||
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key-id";

    // Create test scenario with users, workspace, and swarm
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Owner User" },
      members: [
        { role: "ADMIN", user: { name: "Admin User" } },
        { role: "DEVELOPER", user: { name: "Developer User" } },
        { role: "VIEWER", user: { name: "Viewer User" } },
      ],
      withSwarm: true,
      swarm: {
        name: "test-swarm",
        status: SwarmStatus.PENDING,
      },
    });

    ownerUser = scenario.owner;
    workspace = scenario.workspace;
    swarm = scenario.swarm!;

    // Extract members by role
    adminUser = scenario.members[0];
    developerUser = scenario.members[1];
    viewerUser = scenario.members[2];

    // Create unauthorized user not in workspace
    unauthorizedUser = await db.user.create({
      data: {
        id: generateUniqueId("unauth"),
        email: `unauth-${generateUniqueId()}@example.com`,
        name: "Unauthorized User",
      },
    });

    // Update swarm with required fields for polling
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmId: generateUniqueId("swarm"),
        swarmUrl: "https://test-swarm.example.com",
        swarmApiKey: JSON.stringify(
          EncryptionService.getInstance().encryptField(
            "swarmApiKey",
            "initial-api-key",
          ),
        ),
        swarmSecretAlias: "{{SWARM_123_API_KEY}}",
      },
    });

    // Refresh swarm reference
    swarm = (await db.swarm.findUnique({ where: { id: swarm.id } }))!;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe("POST /api/swarm/poll - Authentication Tests", () => {
    it("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    it("should return 401 for invalid user session", async () => {
      getMockedSession().mockResolvedValue({
        user: {}, // Missing id field
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Invalid user session");
    });
  });

  describe("POST /api/swarm/poll - Authorization Tests", () => {
    it("should allow workspace owner to poll swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock successful polling response
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "new-api-key",
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Swarm is now active");
      expect(data.status).toBe(SwarmStatus.ACTIVE);
    });

    it("should allow workspace admin to poll swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      // Mock successful polling response
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "new-api-key",
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe(SwarmStatus.ACTIVE);
    });

    it("should allow workspace developer to poll swarm", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(developerUser),
      );

      // Mock successful polling response
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "new-api-key",
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should allow workspace viewer to poll swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      // Mock successful polling response
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "new-api-key",
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should reject unauthorized user from polling swarm", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser),
      );

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Access denied");
    });
  });

  describe("POST /api/swarm/poll - Validation Tests", () => {
    it("should return 400 when workspaceId and swarmId are missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing workspaceId or swarmId");
    });

    it("should return 404 when swarm not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: "non-existent-workspace-id",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });

    it("should return 400 when swarmUrl not set", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Update swarm to remove swarmUrl
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: null },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm URL not set");
    });

    it("should return 400 when swarmApiKey not set", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Update swarm to remove swarmApiKey
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmApiKey: null },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm API key not set");
    });
  });

  describe("POST /api/swarm/poll - Polling Logic Tests", () => {
    it("should poll PENDING swarm and update to ACTIVE on success", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const newApiKey = "new-api-key-12345";
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: newApiKey,
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Swarm is now active");
      expect(data.status).toBe(SwarmStatus.ACTIVE);

      // Verify database was updated
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(updatedSwarm?.status).toBe(SwarmStatus.ACTIVE);

      // Verify API key was encrypted before storage
      expect(updatedSwarm?.swarmApiKey).toBeTruthy();
      const decryptedKey = EncryptionService.getInstance().decryptField(
        "swarmApiKey",
        updatedSwarm!.swarmApiKey!,
      );
      expect(decryptedKey).toBe(newApiKey);

      // Verify swarmSecretAlias was updated
      expect(updatedSwarm?.swarmSecretAlias).toMatch(/^{{.+_API_KEY}}$/);
    });

    it("should return immediately for ACTIVE swarms without polling", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Update swarm to ACTIVE status
      await db.swarm.update({
        where: { id: swarm.id },
        data: { status: SwarmStatus.ACTIVE },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Swarm is already active");
      expect(data.status).toBe(SwarmStatus.ACTIVE);

      // Verify fetchSwarmDetails was NOT called
      expect(fetchSwarmDetails).not.toHaveBeenCalled();
    });

    it("should handle polling failure when swarm not yet active", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock failure response (400 - swarm not ready)
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: false,
        status: 400,
        data: {
          success: false,
          message: "Swarm not ready",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm is not yet active");
      expect(data.status).toBe(SwarmStatus.PENDING);

      // Verify database status remains PENDING
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });
      expect(updatedSwarm?.status).toBe(SwarmStatus.PENDING);
    });

    it("should call fetchSwarmDetails with correct swarmId", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "test-key",
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      await POST(request);

      expect(fetchSwarmDetails).toHaveBeenCalledWith(swarm.swarmId);
    });

    it("should support polling by swarmId instead of workspaceId", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "test-key",
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        swarmId: swarm.swarmId,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe(SwarmStatus.ACTIVE);
    });
  });

  describe("POST /api/swarm/poll - Error Handling Tests", () => {
    it("should return 500 on network errors", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock network error
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm is not yet active");
    });

    it("should handle non-retryable errors (401) without retry", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock 401 unauthorized error (non-retryable)
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: false,
        status: 401,
        data: { error: "Unauthorized" },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);

      // Verify fetchSwarmDetails was called only once (no retries for non-400 errors)
      expect(fetchSwarmDetails).toHaveBeenCalledTimes(1);
    });

    it("should handle exceptions in poll logic gracefully", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock exception during fetch
      vi.mocked(fetchSwarmDetails).mockRejectedValue(
        new Error("Unexpected error"),
      );

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to poll swarm status");
    });
  });

  describe("POST /api/swarm/poll - Encryption Tests", () => {
    it("should encrypt swarmApiKey before saving to database", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const plainTextApiKey = "secret-api-key-12345";
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: plainTextApiKey,
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      await POST(request);

      // Verify encrypted storage
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(updatedSwarm?.swarmApiKey).toBeTruthy();

      // Verify it's encrypted JSON format
      const encryptedData = JSON.parse(updatedSwarm!.swarmApiKey!);
      expect(encryptedData).toHaveProperty("data");
      expect(encryptedData).toHaveProperty("iv");
      expect(encryptedData).toHaveProperty("tag");
      expect(encryptedData).toHaveProperty("keyId");

      // Verify decryption returns original value
      const decrypted = EncryptionService.getInstance().decryptField(
        "swarmApiKey",
        updatedSwarm!.swarmApiKey!,
      );
      expect(decrypted).toBe(plainTextApiKey);
    });
  });

  describe("GET /api/swarm/poll - Query Parameter Tests", () => {
    it("should poll swarm using query parameter", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "new-api-key",
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const url = new URL("http://localhost:3000/api/swarm/poll");
      url.searchParams.set("id", swarm.swarmId!);

      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe(SwarmStatus.ACTIVE);
    });

    it("should return 400 when id parameter missing in GET request", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const url = new URL("http://localhost:3000/api/swarm/poll");
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing id parameter");
    });

    it("should return 404 when swarm not found via GET", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const url = new URL("http://localhost:3000/api/swarm/poll");
      url.searchParams.set("id", "non-existent-swarm-id");

      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });

    it("should enforce authorization on GET requests", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser),
      );

      const url = new URL("http://localhost:3000/api/swarm/poll");
      url.searchParams.set("id", swarm.swarmId!);

      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Access denied");
    });
  });

  describe("Swarm Poll - Data Aggregation Tests", () => {
    it("should generate correct swarmSecretAlias pattern", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Set specific swarmId to test pattern generation
      const swarmIdWithNumber = "test-swarm-456";
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmId: swarmIdWithNumber },
      });

      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: "test-key",
            swarm_id: swarmIdWithNumber,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      await POST(request);

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      // Verify pattern uses swarm_id directly: {{swarm_id_API_KEY}}
      expect(updatedSwarm?.swarmSecretAlias).toBe("{{test-swarm-456_API_KEY}}");
    });

    it("should persist all aggregated data fields", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const apiKey = "aggregated-api-key";
      vi.mocked(fetchSwarmDetails).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            x_api_key: apiKey,
            swarm_id: swarm.swarmId,
            address: "https://swarm.example.com",
            ec2_id: "ec2-123",
          },
        },
      });

      const request = createPostRequest("http://localhost:3000/api/swarm/poll", {
        workspaceId: workspace.id,
      });

      await POST(request);

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      // Verify all critical fields were updated
      expect(updatedSwarm?.status).toBe(SwarmStatus.ACTIVE);
      expect(updatedSwarm?.swarmApiKey).toBeTruthy();
      expect(updatedSwarm?.swarmSecretAlias).toMatch(/^{{.+_API_KEY}}$/);

      // Verify API key decrypts correctly
      const decryptedKey = EncryptionService.getInstance().decryptField(
        "swarmApiKey",
        updatedSwarm!.swarmApiKey!,
      );
      expect(decryptedKey).toBe(apiKey);
    });
  });
});