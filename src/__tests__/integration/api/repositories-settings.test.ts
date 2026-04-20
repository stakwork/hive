import { describe, test, expect, beforeEach, vi } from "vitest";
import { PATCH, GET } from "@/app/api/repositories/[id]/settings/route";
import { db } from "@/lib/db";
import {
  expectSuccess,
  createPatchRequest,
  createGetRequest,
  createAuthenticatedSession,
  getMockedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/factories/workspace.factory";
import { createTestRepository } from "@/__tests__/support/factories/repository.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";

vi.mock("@/services/pool-manager/sync", () => ({
  syncPoolManagerSettings: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn().mockResolvedValue("test-pool-key"),
}));

// Import after mocks so we get the mocked versions
const { syncPoolManagerSettings } = await import("@/services/pool-manager/sync");
const { getSwarmPoolApiKeyFor } = await import("@/services/swarm/secrets");

describe("Repository Settings API Integration Tests", () => {
  let userId: string;
  let workspaceId: string;
  let workspaceSlug: string;

  async function setup(repOpts?: { triggerPodRepair?: boolean }) {
    const user = await createTestUser({ name: "Test User" });
    const workspace = await createTestWorkspace({
      name: `Test Workspace ${generateUniqueId()}`,
      ownerId: user.id,
    });
    // Route checks workspace members filtered by userId — must exist or returns 403
    await createTestMembership({
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
    });
    const repository = await createTestRepository({
      workspaceId: workspace.id,
      ...repOpts,
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

    return { user, workspace, repository };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PATCH /api/repositories/[id]/settings", () => {
    test("triggerPodRepair false→true persists and calls syncPoolManagerSettings", async () => {
      const { repository, workspace } = await setup({ triggerPodRepair: false });

      await createTestSwarm({
        workspaceId: workspace.id,
        poolName: "test-pool",
      });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.triggerPodRepair).toBe(true);

      const updated = await db.repository.findUnique({ where: { id: repository.id } });
      expect(updated?.triggerPodRepair).toBe(true);

      expect(syncPoolManagerSettings).toHaveBeenCalledOnce();
    });

    test("triggerPodRepair true→false persists and calls syncPoolManagerSettings", async () => {
      const { repository, workspace } = await setup({ triggerPodRepair: true });

      await createTestSwarm({
        workspaceId: workspace.id,
        poolName: "test-pool",
      });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: false }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.triggerPodRepair).toBe(false);

      const updated2 = await db.repository.findUnique({ where: { id: repository.id } });
      expect(updated2?.triggerPodRepair).toBe(false);

      expect(syncPoolManagerSettings).toHaveBeenCalledOnce();
    });

    test("no triggerPodRepair in payload — sync is not called", async () => {
      const { repository } = await setup();

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { codeIngestionEnabled: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      await expectSuccess(response);

      expect(syncPoolManagerSettings).not.toHaveBeenCalled();
    });

    test("same value sent (true→true) — sync is not called", async () => {
      const { repository, workspace } = await setup({ triggerPodRepair: true });

      await createTestSwarm({
        workspaceId: workspace.id,
        poolName: "test-pool",
      });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      await expectSuccess(response);

      expect(syncPoolManagerSettings).not.toHaveBeenCalled();
    });

    test("no swarm found — sync skipped, response still 200", async () => {
      const { repository } = await setup({ triggerPodRepair: false });
      // No swarm created for this workspace

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.triggerPodRepair).toBe(true);
      expect(syncPoolManagerSettings).not.toHaveBeenCalled();
    });

    test("poolName is null on swarm — sync skipped, response still 200", async () => {
      const { repository, workspace } = await setup({ triggerPodRepair: false });

      await createTestSwarm({
        workspaceId: workspace.id,
        // poolName omitted → null
      });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.triggerPodRepair).toBe(true);
      expect(syncPoolManagerSettings).not.toHaveBeenCalled();
    });

    test("syncPoolManagerSettings throws — error swallowed, response still 200", async () => {
      const { repository, workspace } = await setup({ triggerPodRepair: false });

      await createTestSwarm({
        workspaceId: workspace.id,
        poolName: "test-pool",
      });

      vi.mocked(syncPoolManagerSettings).mockRejectedValueOnce(
        new Error("Sync network failure")
      );

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.triggerPodRepair).toBe(true);
    });

    test("no pool API key — sync skipped, response still 200", async () => {
      const { repository, workspace } = await setup({ triggerPodRepair: false });

      await createTestSwarm({
        workspaceId: workspace.id,
        poolName: "test-pool",
      });

      vi.mocked(getSwarmPoolApiKeyFor).mockResolvedValueOnce("");

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.triggerPodRepair).toBe(true);
      expect(syncPoolManagerSettings).not.toHaveBeenCalled();
    });

    test("triggerPodRepair appears in response data", async () => {
      const { repository } = await setup({ triggerPodRepair: false });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { triggerPodRepair: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(Object.keys(body.data)).toContain("triggerPodRepair");
      expect(body.data.triggerPodRepair).toBe(true);
    });
  });

  describe("GET /api/repositories/[id]/settings", () => {
    test("returns triggerPodRepair in response", async () => {
      const { repository } = await setup({ triggerPodRepair: true });

      const request = createGetRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(Object.keys(body.data)).toContain("triggerPodRepair");
      expect(body.data.triggerPodRepair).toBe(true);
    });
  });
});
