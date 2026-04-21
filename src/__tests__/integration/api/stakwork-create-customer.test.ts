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

// Setup helper for creating test workspace
const setupTestData = async () => {
  const testData = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: createTestUserData() });
    const workspace = await tx.workspace.create({ data: createTestWorkspaceData(user.id) });
    return { user, workspace };
  });

  return { testData };
};

describe("POST /api/stakwork/create-customer", () => {
  let workspaceId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { testData } = await setupTestData();
    workspaceId = testData.workspace.id;

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testData.user));
  });

  it("does not call createSecret", async () => {
    const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

    const res = await POST(req);

    expect(res?.status).toBe(201);
    expect(mockCreateCustomer).toHaveBeenCalledOnce();
    expect(mockCreateSecret).not.toHaveBeenCalled();
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

    it("returns 400 when workspaceId is missing from request body", async () => {
      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", {});

      const res = await POST(req);

      // IDOR hardening: reject requests missing workspaceId instead of
      // letting them pass through to Stakwork.
      expect(res?.status).toBe(400);
      expect(mockCreateCustomer).not.toHaveBeenCalled();
    });
  });

  describe("database validation errors", () => {
    it("returns 404 when workspace does not exist", async () => {
      const nonExistentWorkspaceId = generateUniqueId("nonexistent");
      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", {
        workspaceId: nonExistentWorkspaceId,
      });

      const res = await POST(req);

      // IDOR hardening: callers without admin access to the workspace
      // must get a unified "not found or access denied" response — and
      // createCustomer must never be invoked on their behalf.
      expect(res?.status).toBe(404);
      const json = await res.json();
      expect(json).toEqual({ error: "Workspace not found or access denied" });

      // Verify no workspace was created or updated
      const workspace = await db.workspace.findFirst({
        where: { id: nonExistentWorkspaceId },
      });
      expect(workspace).toBeNull();

      // Neither Stakwork API should have been touched
      expect(mockCreateCustomer).not.toHaveBeenCalled();
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });

    it("handles invalid Stakwork response gracefully", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateCustomer.mockResolvedValueOnce({ data: null as any });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ error: "Invalid response from Stakwork API" });
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
      expect(res?.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        error: "Stakwork API unavailable",
        service: "stakwork",
        details: { reason: "Service temporarily unavailable" },
      });
    });

    it("handles generic errors during customer creation", async () => {
      mockCreateCustomer.mockRejectedValueOnce(
        new Error("Network timeout")
      );

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ error: "Failed to create customer" });
    });
  });

  describe("IDOR hardening", () => {
    it("returns 404 when caller is not a member of the target workspace", async () => {
      // Attacker: signed-in as a different user with no membership
      const attacker = await db.user.create({
        data: createTestUserData(),
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(attacker));

      const req = createPostRequest(
        "http://localhost:3000/api/stakwork/create-customer",
        { workspaceId },
      );

      const res = await POST(req);

      expect(res?.status).toBe(404);
      const json = await res.json();
      expect(json).toEqual({ error: "Workspace not found or access denied" });

      // Neither Stakwork API was touched and stakworkApiKey was not written.
      expect(mockCreateCustomer).not.toHaveBeenCalled();
      expect(mockCreateSecret).not.toHaveBeenCalled();

      const workspace = await db.workspace.findFirst({ where: { id: workspaceId } });
      expect(workspace?.stakworkApiKey).toBeNull();
    });

    it("returns 404 when caller is a DEVELOPER member (not admin)", async () => {
      // Viewer/developer membership does not satisfy canAdmin.
      const developer = await db.user.create({ data: createTestUserData() });
      await db.workspaceMember.create({
        data: {
          workspaceId,
          userId: developer.id,
          role: "DEVELOPER",
        },
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(developer));

      const req = createPostRequest(
        "http://localhost:3000/api/stakwork/create-customer",
        { workspaceId },
      );

      const res = await POST(req);

      expect(res?.status).toBe(404);
      expect(mockCreateCustomer).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("skips workspace update when swarmApiKey is null but still returns 201", async () => {
      mockCreateCustomer.mockResolvedValueOnce({
        data: { token: "stak-token-null-key" },
      });

      const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

      const res = await POST(req);
      expect(res?.status).toBe(201);

      // createSecret should NOT be called
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });
  });
});
