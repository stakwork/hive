import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/create-customer/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";

// Mock stakwork service factory to capture calls
const mockCreateCustomer = vi.fn(async () => ({
  data: { token: "stak-token" },
}));
const mockCreateSecret = vi.fn(async () => ({ data: {} }));

vi.mock("@/lib/service-factory", () => ({
  stakworkService: () => ({
    createCustomer: mockCreateCustomer,
    createSecret: mockCreateSecret,
  }),
}));

// Test data factories and helpers
const createTestUserData = () => ({
  email: `user-${generateUniqueId()}@example.com`,
  name: "User 1",
});

const createTestWorkspaceData = (ownerId: string) => ({
  name: "w1",
  slug: generateUniqueSlug("w1"),
  ownerId,
});

const createTestSwarmData = (workspaceId: string, swarmApiKey: string) => ({
  workspaceId,
  name: "s1-name",
  status: "ACTIVE" as const,
  swarmId: generateUniqueId("s1"),
  swarmUrl: "https://s1-name.sphinx.chat/api",
  swarmSecretAlias: "{{SWARM_123456_API_KEY}}",
  swarmApiKey,
  services: [],
});

// Test assertion helpers
const expectSuccessfulCustomerCreation = (res: Response) => {
  expect(res?.status).toBe(201);
  expect(mockCreateCustomer).toHaveBeenCalledOnce();
  expect(mockCreateSecret).toHaveBeenCalledOnce();
};

const expectMockCreateSecretCallArgs = (expectedAlias: string | any, expectedKey: string, expectedToken: string) => {
  const args = mockCreateSecret.mock.calls[0] as unknown as [string, string, string];
  if (typeof expectedAlias === "string") {
    expect(args[0]).toBe(expectedAlias);
  } else {
    expect(args[0]).toEqual(expectedAlias);
  }
  expect(args[1]).toBe(expectedKey);
  expect(args[2]).toBe(expectedToken);
};

const expectErrorResponse = async (res: Response, expectedStatus: number, expectedError: object) => {
  expect(res?.status).toBe(expectedStatus);
  const json = await res.json();
  expect(json).toEqual(expectedError);
};

// Setup helper for creating test workspace with optional swarm
const setupTestData = async (
  options: {
    includeSwarm?: boolean;
    swarmOverrides?: Partial<ReturnType<typeof createTestSwarmData>>;
  } = {},
) => {
  const { includeSwarm = true, swarmOverrides = {} } = options;
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_plain_key_123";

  const testData = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: createTestUserData() });
    const workspace = await tx.workspace.create({ data: createTestWorkspaceData(user.id) });

    if (includeSwarm) {
      const encryptedApiKey = JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY));
      await tx.swarm.create({
        data: {
          ...createTestSwarmData(workspace.id, encryptedApiKey),
          ...swarmOverrides,
        },
      });
    }

    return { user, workspace };
  });

  return { testData, PLAINTEXT_SWARM_API_KEY };
};

describe("POST /api/stakwork/create-customer", () => {
  let workspaceId: string;
  let PLAINTEXT_SWARM_API_KEY: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { testData, PLAINTEXT_SWARM_API_KEY: plainTextKey } = await setupTestData();
    workspaceId = testData.workspace.id;
    PLAINTEXT_SWARM_API_KEY = plainTextKey;

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testData.user));
  });

  it("creates secret with plaintext value (not encrypted JSON)", async () => {
    const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

    const res = await POST(req);

    expectSuccessfulCustomerCreation(res);
    expectMockCreateSecretCallArgs("SWARM_123456_API_KEY", PLAINTEXT_SWARM_API_KEY, "stak-token");
  });

  it("double-encrypted rows are decrypted back to plaintext before sending", async () => {
    const enc = EncryptionService.getInstance();

    // Make swarm row contain double-encrypted content to simulate legacy bug
    const first = enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY);
    const doubleCipher = enc.encryptField("swarmApiKey", JSON.stringify(first));
    await db.swarm.updateMany({
      where: { workspaceId },
      data: { swarmApiKey: JSON.stringify(doubleCipher) },
    });

    const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

    mockCreateSecret.mockClear();
    const res = await POST(req);
    expect(res?.status).toBe(201);

    expectMockCreateSecretCallArgs(expect.any(String), PLAINTEXT_SWARM_API_KEY, "stak-token");
  });

  describe("authentication failures", () => {
    it("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(401);

      const json = await res.json();
      expect(json).toEqual({ error: "Unauthorized" });
      expect(mockCreateCustomer).not.toHaveBeenCalled();
    });

    it("returns error when workspaceId is missing from request body", async () => {
      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", {});

      const res = await POST(req);

      // The endpoint will try to create customer with undefined workspaceId
      // which should result in an error from stakworkService
      expect(mockCreateCustomer).toHaveBeenCalledWith(undefined);
    });
  });

  describe("database validation errors", () => {
    it("handles workspace not found gracefully", async () => {
      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: "stak-token-new" },
      });

      const nonExistentWorkspaceId = generateUniqueId("nonexistent");
      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", {
        workspaceId: nonExistentWorkspaceId,
      });

      const res = await POST(req);

      // Should still succeed with 201 but not update any workspace
      expect(res?.status).toBe(201);
      const json = await res.json();
      expect(json).toEqual({ success: true });

      // Verify no workspace was updated
      const workspace = await db.workspace.findFirst({
        where: { id: nonExistentWorkspaceId },
      });
      expect(workspace).toBeNull();
    });

    it("handles swarm not found by skipping secret creation", async () => {
      // Create workspace without swarm using helper
      const { testData: userData } = await setupTestData({ includeSwarm: false });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(userData.user));
      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: "stak-token-no-swarm" },
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", {
        workspaceId: userData.workspace.id,
      });

      const res = await POST(req);
      expect(res?.status).toBe(201);

      // Verify createSecret was not called (no swarm exists)
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });
  });

  describe("API error handling", () => {
    it("returns 500 when Stakwork API returns invalid response (no token)", async () => {
      mockCreateCustomer.mockResolvedValueOnce({
        data: { message: "Customer created but no token" },
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      await expectErrorResponse(res, 500, { error: "Invalid response from Stakwork API" });
    });

    it("returns 500 when Stakwork API returns response without data field", async () => {
      mockCreateCustomer.mockResolvedValueOnce({
        message: "Success",
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      await expectErrorResponse(res, 500, { error: "Invalid response from Stakwork API" });
    });

    it("handles createCustomer API error with ApiError structure", async () => {
      const apiError = {
        message: "Stakwork API unavailable",
        status: 503,
        service: "stakwork",
        details: { reason: "Service temporarily unavailable" },
      };

      mockCreateCustomer.mockRejectedValueOnce(apiError);

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      await expectErrorResponse(res, 503, {
        error: "Stakwork API unavailable",
        service: "stakwork",
        details: { reason: "Service temporarily unavailable" },
      });
    });

    it("handles createSecret API error gracefully", async () => {
      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: "stak-token-secret-fail" },
      });

      mockCreateSecret.mockRejectedValueOnce(new Error("Failed to create secret on Stakwork"));

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);

      // The endpoint doesn't explicitly handle createSecret errors,
      // so it will bubble up as a generic 500 error
      await expectErrorResponse(res, 500, { error: "Failed to create customer" });
    });

    it("handles generic errors during customer creation", async () => {
      mockCreateCustomer.mockRejectedValueOnce(new Error("Network timeout"));

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      await expectErrorResponse(res, 500, { error: "Failed to create customer" });
    });
  });

  describe("edge cases", () => {
    it("skips secret creation when swarmSecretAlias is empty", async () => {
      // Update swarm to have empty secret alias
      await db.swarm.updateMany({
        where: { workspaceId },
        data: { swarmSecretAlias: "" },
      });

      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: "stak-token-no-alias" },
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(201);

      // Verify createSecret was not called (empty secret alias)
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });

    it("skips secret creation when swarmApiKey is null", async () => {
      // Update swarm to have null API key
      await db.swarm.updateMany({
        where: { workspaceId },
        data: { swarmApiKey: null },
      });

      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: "stak-token-null-key" },
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(201);

      // Verify createSecret was not called (null API key)
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });

    it("correctly sanitizes swarmSecretAlias by removing template braces", async () => {
      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: "stak-token-sanitize" },
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(201);

      // Verify secret was created with sanitized alias (braces removed)
      const args = mockCreateSecret.mock.calls[0] as unknown as [string, string, string];
      expect(args[0]).toBe("SWARM_123456_API_KEY"); // {{...}} removed
    });

    it("encrypts and stores stakwork API key in workspace", async () => {
      const enc = EncryptionService.getInstance();
      const stakworkToken = "stakwork-api-key-12345";
      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: stakworkToken },
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(201);

      // Verify stakwork API key was encrypted and stored
      const workspace = await db.workspace.findFirst({
        where: { id: workspaceId },
      });

      expect(workspace?.stakworkApiKey).toBeDefined();

      // Verify the stored value is encrypted (should be JSON with data, iv, tag fields)
      const storedValue = JSON.parse(workspace!.stakworkApiKey!);
      expect(storedValue).toHaveProperty("data");
      expect(storedValue).toHaveProperty("iv");
      expect(storedValue).toHaveProperty("tag");

      // Verify decryption returns original token
      const decrypted = enc.decryptField("stakworkApiKey", storedValue);
      expect(decrypted).toBe(stakworkToken);
    });
  });
});
