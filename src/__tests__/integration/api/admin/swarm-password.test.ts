import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
} from "@/__tests__/support/factories";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";

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
