import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
} from "@/__tests__/support/factories";
import {
  addMiddlewareHeaders,
  createAuthenticatedGetRequest,
  createAuthenticatedPutRequest,
} from "@/__tests__/support/helpers/request-builders";
import { saveOrUpdateSwarm } from "@/services/swarm/db";

vi.mock("@/services/swarm/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/swarm/db")>();
  return {
    ...actual,
    saveOrUpdateSwarm: vi.fn((...args: Parameters<typeof actual.saveOrUpdateSwarm>) =>
      actual.saveOrUpdateSwarm(...args)
    ),
  };
});

const mockSaveOrUpdateSwarm = vi.mocked(saveOrUpdateSwarm);

function authUser(user: { id: string; email: string | null; name: string | null }) {
  return { id: user.id, email: user.email || "", name: user.name || "" };
}

describe("GET /api/admin/workspaces/[id]/swarm-password", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let workspaceWithSwarm: Awaited<ReturnType<typeof createTestWorkspace>>;
  let workspaceWithSwarmNoPassword: Awaited<ReturnType<typeof createTestWorkspace>>;

  const TEST_PASSWORD = "test-swarm-password-123";

  beforeEach(async () => {
    // Create test users
    superAdminUser = await createTestUser({
      email: "superadmin@test.com",
      role: "SUPER_ADMIN",
    });
    regularUser = await createTestUser({
      email: "regular@test.com",
    });

    // Create workspace with no swarm
    workspace = await createTestWorkspace({
      name: "No Swarm Workspace",
      ownerId: regularUser.id,
    });

    // Create workspace with swarm and password
    workspaceWithSwarm = await createTestWorkspace({
      name: "Swarm Workspace",
      ownerId: regularUser.id,
    });
    await createTestSwarm({
      workspaceId: workspaceWithSwarm.id,
      swarmPassword: TEST_PASSWORD,
    });

    // Create workspace with swarm but no password
    workspaceWithSwarmNoPassword = await createTestWorkspace({
      name: "Swarm No Password Workspace",
      ownerId: regularUser.id,
    });
    await createTestSwarm({
      workspaceId: workspaceWithSwarmNoPassword.id,
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = new Request(
      `http://localhost/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`
    );
    const { GET } = await import(
      "@/app/api/admin/workspaces/[id]/swarm-password/route"
    );
    const response = await GET(request as any, {
      params: Promise.resolve({ id: workspaceWithSwarm.id }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 403 for non-super-admin users", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      regularUser
    );
    const { GET } = await import(
      "@/app/api/admin/workspaces/[id]/swarm-password/route"
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: workspaceWithSwarm.id }),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
  });

  it("returns 404 for workspace with no swarm", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspace.id}/swarm-password`,
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/workspaces/[id]/swarm-password/route"
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: workspace.id }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm password not found");
  });

  it("returns 404 for workspace with swarm but no password", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspaceWithSwarmNoPassword.id}/swarm-password`,
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/workspaces/[id]/swarm-password/route"
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: workspaceWithSwarmNoPassword.id }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm password not found");
  });

  it("returns decrypted password for valid super admin request", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      superAdminUser
    );
    const { GET } = await import(
      "@/app/api/admin/workspaces/[id]/swarm-password/route"
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: workspaceWithSwarm.id }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.password).toBe(TEST_PASSWORD);
  });
});

describe("PUT /api/admin/workspaces/[id]/swarm-password", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let workspaceWithSwarm: Awaited<ReturnType<typeof createTestWorkspace>>;

  const NEW_PASSWORD = "replacement-swarm-password-456";

  beforeEach(async () => {
    mockSaveOrUpdateSwarm.mockClear();

    superAdminUser = await createTestUser({
      email: "superadmin-put@test.com",
      role: "SUPER_ADMIN",
    });
    regularUser = await createTestUser({
      email: "regular-put@test.com",
    });

    workspace = await createTestWorkspace({
      name: "No Swarm Workspace PUT",
      ownerId: regularUser.id,
    });

    workspaceWithSwarm = await createTestWorkspace({
      name: "Swarm Workspace PUT",
      ownerId: regularUser.id,
    });
    await createTestSwarm({
      workspaceId: workspaceWithSwarm.id,
      swarmPassword: "original-swarm-password",
    });
  });

  async function putSwarmPassword(
    workspaceId: string,
    request: Request | NextRequest
  ) {
    const { PUT } = await import(
      "@/app/api/admin/workspaces/[id]/swarm-password/route"
    );
    return PUT(request as NextRequest, {
      params: Promise.resolve({ id: workspaceId }),
    });
  }

  it("returns 401 for unauthenticated requests", async () => {
    const request = new Request(
      `http://localhost/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swarmPassword: NEW_PASSWORD }),
      }
    );
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(401);
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
  });

  it("returns 403 for non-super-admin users", async () => {
    const request = createAuthenticatedPutRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      authUser(regularUser),
      { swarmPassword: NEW_PASSWORD }
    );
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON body", async () => {
    const baseRequest = new NextRequest(
      `http://localhost/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }
    );
    const request = addMiddlewareHeaders(baseRequest, authUser(superAdminUser));
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(400);
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
  });

  it("returns 400 for absent JSON body", async () => {
    const baseRequest = new NextRequest(
      `http://localhost/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      }
    );
    const request = addMiddlewareHeaders(baseRequest, authUser(superAdminUser));
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(400);
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
  });

  it("returns 400 for non-string swarmPassword", async () => {
    const request = createAuthenticatedPutRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      authUser(superAdminUser),
      { swarmPassword: 123 }
    );
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(400);
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
  });

  it("returns 400 for empty swarmPassword", async () => {
    const request = createAuthenticatedPutRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      authUser(superAdminUser),
      { swarmPassword: "" }
    );
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(400);
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
  });

  it("returns 400 for whitespace-only swarmPassword", async () => {
    const request = createAuthenticatedPutRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      authUser(superAdminUser),
      { swarmPassword: "   \n\t" }
    );
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(400);
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
  });

  it("returns 404 when no swarm row exists and does not create one", async () => {
    const request = createAuthenticatedPutRequest(
      `/api/admin/workspaces/${workspace.id}/swarm-password`,
      authUser(superAdminUser),
      { swarmPassword: NEW_PASSWORD }
    );
    const response = await putSwarmPassword(workspace.id, request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm not found");
    expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();

    const created = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });
    expect(created).toBeNull();
  });

  it("returns 200 and saves the password via saveOrUpdateSwarm", async () => {
    const request = createAuthenticatedPutRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      authUser(superAdminUser),
      { swarmPassword: NEW_PASSWORD }
    );
    const response = await putSwarmPassword(workspaceWithSwarm.id, request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data).not.toHaveProperty("password");
    expect(data).not.toHaveProperty("swarmPassword");
    expect(mockSaveOrUpdateSwarm).toHaveBeenCalledTimes(1);
    expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith({
      workspaceId: workspaceWithSwarm.id,
      swarmPassword: NEW_PASSWORD,
    });

    const { GET } = await import(
      "@/app/api/admin/workspaces/[id]/swarm-password/route"
    );
    const getRequest = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspaceWithSwarm.id}/swarm-password`,
      superAdminUser
    );
    const getResponse = await GET(getRequest, {
      params: Promise.resolve({ id: workspaceWithSwarm.id }),
    });
    expect(getResponse.status).toBe(200);
    const getData = await getResponse.json();
    expect(getData.password).toBe(NEW_PASSWORD);
  });
});
