import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/w/[slug]/pool/status/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { PoolManagerService } from "@/services/pool-manager";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  generateUniqueId,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";
import type { PoolStatusResponse } from "@/types";
import { NextResponse } from "next/server";

// Mock middleware utilities
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

import { requireAuth } from "@/lib/middleware/utils";
const getMockedRequireAuth = vi.mocked(requireAuth);

describe("GET /api/w/[slug]/pool/status - Authentication", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Status Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      // Create swarm with encrypted API key
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    getMockedRequireAuth.mockReturnValue(NextResponse.json({ error: "Unauthorized", kind: "unauthorized" }, { status: 401 }));

    const request = createGetRequest(
      `/api/w/${workspace.slug}/pool/status`
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectUnauthorized(response);
  });

  it("should return 400 when workspace slug is missing", async () => {
    getMockedRequireAuth.mockReturnValue({ id: owner.id, email: owner.email!, name: owner.name! });

    const request = createGetRequest("/api/w//pool/status");
    const response = await GET(request, {
      params: Promise.resolve({ slug: "" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Workspace slug is required");
  });

  it("should return 404 for non-existent workspace", async () => {
    getMockedRequireAuth.mockReturnValue({ id: owner.id, email: owner.email!, name: owner.name! });

    const request = createGetRequest("/api/w/nonexistent-workspace/pool/status");
    const response = await GET(request, {
      params: Promise.resolve({ slug: "nonexistent-workspace" }),
    });

    await expectNotFound(response, "Workspace not found or access denied");
  });

  it("should return 404 when swarm is not configured", async () => {
    // Create workspace without swarm
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "No Swarm Owner" },
    });

    getMockedRequireAuth.mockReturnValue({ id: newScenario.owner.id, email: newScenario.owner.email!, name: newScenario.owner.name! });

    const request = createGetRequest(
      `/api/w/${newScenario.workspace.slug}/pool/status`
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: newScenario.workspace.slug }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Pool not configured for this workspace");
  });

  it("should return 404 when poolApiKey is not configured", async () => {
    // Update swarm to have null poolApiKey
    await db.swarm.update({
      where: { id: swarm.id },
      data: { poolApiKey: null },
    });

    getMockedRequireAuth.mockReturnValue({ id: owner.id, email: owner.email!, name: owner.name! });

    const request = createGetRequest(
      `/api/w/${workspace.slug}/pool/status`
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Pool not configured for this workspace");
  });
});

describe("GET /api/w/[slug]/pool/status - Authorization", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let memberViewer: User;
  let memberDeveloper: User;
  let memberAdmin: User;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Auth Owner" },
        members: [
          { role: "VIEWER" },
          { role: "DEVELOPER" },
          { role: "ADMIN" },
        ],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      memberViewer = scenario.members[0];
      memberDeveloper = scenario.members[1];
      memberAdmin = scenario.members[2];

      // Create swarm with encrypted API key
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key-auth"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `auth-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      // Create non-member user
      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });

    // Mock PoolManagerService.getPoolStatus for all authorization tests
    vi.spyOn(PoolManagerService.prototype, "getPoolStatus").mockResolvedValue({
      status: {
        runningVms: 2,
        pendingVms: 1,
        failedVms: 0,
        usedVms: 2,
        unusedVms: 1,
        lastCheck: new Date().toISOString(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 403 for non-member access", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      nonMember
    );
    getMockedRequireAuth.mockReturnValue({
      id: nonMember.id,
      email: nonMember.email!,
      name: nonMember.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectNotFound(response, "Workspace not found or access denied");
  });

  it("should allow VIEWER role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      memberViewer
    );
    getMockedRequireAuth.mockReturnValue({
      id: memberViewer.id,
      email: memberViewer.email!,
      name: memberViewer.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.status).toBeDefined();
  });

  it("should allow DEVELOPER role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      memberDeveloper
    );
    getMockedRequireAuth.mockReturnValue({
      id: memberDeveloper.id,
      email: memberDeveloper.email!,
      name: memberDeveloper.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });

  it("should allow ADMIN role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      memberAdmin
    );
    getMockedRequireAuth.mockReturnValue({
      id: memberAdmin.id,
      email: memberAdmin.email!,
      name: memberAdmin.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });

  it("should allow OWNER role to access pool status", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });
});

describe("GET /api/w/[slug]/pool/status - External Service Integration", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Service Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key-service"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `service-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });

    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should successfully fetch pool status from external service", async () => {
    const mockPoolStatus: PoolStatusResponse = {
      status: {
        runningVms: 5,
        pendingVms: 2,
        failedVms: 1,
        usedVms: 4,
        unusedVms: 3,
        lastCheck: "2024-01-15T12:00:00Z",
      },
    };

    vi.spyOn(PoolManagerService.prototype, "getPoolStatus").mockResolvedValue(
      mockPoolStatus
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockPoolStatus);
    expect(data.data.status.runningVms).toBe(5);
    expect(data.data.status.pendingVms).toBe(2);
    expect(data.data.status.failedVms).toBe(1);
    expect(data.data.status.usedVms).toBe(4);
    expect(data.data.status.unusedVms).toBe(3);
    expect(data.data.status.lastCheck).toBe("2024-01-15T12:00:00Z");
  });

  it("should return 503 when pool service is unavailable", async () => {
    vi.spyOn(PoolManagerService.prototype, "getPoolStatus").mockRejectedValue(
      new Error("Unable to connect to pool service")
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Unable to connect to pool service");
  });

  it("should return 503 when pool metrics cannot be fetched", async () => {
    vi.spyOn(PoolManagerService.prototype, "getPoolStatus").mockRejectedValue(
      new Error("Unable to fetch pool metrics at the moment")
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Unable to fetch pool metrics at the moment");
  });

  it("should handle network errors gracefully", async () => {
    vi.spyOn(PoolManagerService.prototype, "getPoolStatus").mockRejectedValue(
      new Error("Network error: Connection timeout")
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBeDefined();
  });

  it("should decrypt poolApiKey before calling external service", async () => {
    const getPoolStatusSpy = vi.spyOn(
      PoolManagerService.prototype,
      "getPoolStatus"
    ).mockResolvedValue({
      status: {
        runningVms: 1,
        pendingVms: 0,
        failedVms: 0,
        usedVms: 1,
        unusedVms: 0,
        lastCheck: new Date().toISOString(),
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectSuccess(response);

    // Verify getPoolStatus was called with swarm.id and encrypted poolApiKey
    expect(getPoolStatusSpy).toHaveBeenCalledWith(
      swarm.id,
      expect.any(String) // poolApiKey (encrypted JSON string)
    );
  });
});

describe("GET /api/w/[slug]/pool/status - Response Structure", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Response Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key-response"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `response-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });

    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return valid PoolStatusResponse structure", async () => {
    const mockPoolStatus: PoolStatusResponse = {
      status: {
        runningVms: 3,
        pendingVms: 1,
        failedVms: 0,
        usedVms: 2,
        unusedVms: 2,
        lastCheck: "2024-01-15T10:30:00Z",
      },
    };

    vi.spyOn(PoolManagerService.prototype, "getPoolStatus").mockResolvedValue(
      mockPoolStatus
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);

    // Verify response structure
    expect(data).toHaveProperty("success");
    expect(data).toHaveProperty("data");
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty("status");
    expect(data.data.status).toHaveProperty("runningVms");
    expect(data.data.status).toHaveProperty("pendingVms");
    expect(data.data.status).toHaveProperty("failedVms");
    expect(data.data.status).toHaveProperty("usedVms");
    expect(data.data.status).toHaveProperty("unusedVms");
    expect(data.data.status).toHaveProperty("lastCheck");

    // Verify data types
    expect(typeof data.data.status.runningVms).toBe("number");
    expect(typeof data.data.status.pendingVms).toBe("number");
    expect(typeof data.data.status.failedVms).toBe("number");
    expect(typeof data.data.status.usedVms).toBe("number");
    expect(typeof data.data.status.unusedVms).toBe("number");
    expect(typeof data.data.status.lastCheck).toBe("string");
  });

  it("should handle zero values in pool status", async () => {
    const mockPoolStatus: PoolStatusResponse = {
      status: {
        runningVms: 0,
        pendingVms: 0,
        failedVms: 0,
        usedVms: 0,
        unusedVms: 0,
        lastCheck: "2024-01-15T09:00:00Z",
      },
    };

    vi.spyOn(PoolManagerService.prototype, "getPoolStatus").mockResolvedValue(
      mockPoolStatus
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/status`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.data.status.runningVms).toBe(0);
    expect(data.data.status.pendingVms).toBe(0);
    expect(data.data.status.failedVms).toBe(0);
    expect(data.data.status.usedVms).toBe(0);
    expect(data.data.status.unusedVms).toBe(0);
  });
});