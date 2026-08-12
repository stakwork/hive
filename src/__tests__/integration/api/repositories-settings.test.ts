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

  async function setup(
    repOpts?: { triggerPodRepair?: boolean; shallowClone?: boolean; blobSizeLimit?: string | null },
    memberRole: "OWNER" | "ADMIN" | "PM" | "DEVELOPER" | "STAKEHOLDER" | "VIEWER" = "OWNER"
  ) {
    // The workspace owner always gets OWNER role regardless of the membership row.
    // For roles other than OWNER we create a separate non-owner member so the
    // role check is exercised properly.
    const owner = await createTestUser({ name: "Workspace Owner" });
    const workspace = await createTestWorkspace({
      name: `Test Workspace ${generateUniqueId()}`,
      ownerId: owner.id,
    });

    let actingUser = owner;
    if (memberRole === "OWNER") {
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
    } else {
      // Create a distinct non-owner user and give them the requested role
      actingUser = await createTestUser({ name: `${memberRole} User` });
      await createTestMembership({ workspaceId: workspace.id, userId: actingUser.id, role: memberRole });
    }

    const repository = await createTestRepository({
      workspaceId: workspace.id,
      ...repOpts,
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(actingUser));

    return { user: actingUser, workspace, repository };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // PATCH – existing triggerPodRepair behaviour (unchanged)
  // ---------------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // shallowClone + blobSizeLimit – new fields
    // -----------------------------------------------------------------------

    test("PATCH persists shallowClone=true and returns it in response", async () => {
      const { repository } = await setup({ shallowClone: false });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.shallowClone).toBe(true);
      const updated = await db.repository.findUnique({ where: { id: repository.id } });
      expect(updated?.shallowClone).toBe(true);
    });

    test("PATCH persists shallowClone=false and returns it in response", async () => {
      const { repository } = await setup({ shallowClone: true });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: false }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.shallowClone).toBe(false);
    });

    test("PATCH persists valid blobSizeLimit and returns it in response", async () => {
      const { repository } = await setup();

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { blobSizeLimit: "1m" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.blobSizeLimit).toBe("1m");
      const updated = await db.repository.findUnique({ where: { id: repository.id } });
      expect(updated?.blobSizeLimit).toBe("1m");
    });

    test("PATCH normalizes empty blobSizeLimit string to null in DB", async () => {
      const { repository } = await setup({ blobSizeLimit: "1m" });

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { blobSizeLimit: "" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      // Response reflects the null stored value
      expect(body.data.blobSizeLimit).toBeNull();
      const updated = await db.repository.findUnique({ where: { id: repository.id } });
      expect(updated?.blobSizeLimit).toBeNull();
    });

    test("PATCH rejects invalid blobSizeLimit with 400", async () => {
      const { repository } = await setup();

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { blobSizeLimit: "abc" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      expect(response.status).toBe(400);
    });

    test("PATCH rejects bare '0' blobSizeLimit with 400", async () => {
      const { repository } = await setup();

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { blobSizeLimit: "0" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      expect(response.status).toBe(400);
    });

    test("PATCH round-trips shallowClone + blobSizeLimit together", async () => {
      const { repository } = await setup();

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: true, blobSizeLimit: "500k" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.shallowClone).toBe(true);
      expect(body.data.blobSizeLimit).toBe("500k");

      const updated = await db.repository.findUnique({ where: { id: repository.id } });
      expect(updated?.shallowClone).toBe(true);
      expect(updated?.blobSizeLimit).toBe("500k");
    });

    test("response always includes shallowClone and blobSizeLimit keys", async () => {
      const { repository } = await setup();

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { codeIngestionEnabled: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(Object.keys(body.data)).toContain("shallowClone");
      expect(Object.keys(body.data)).toContain("blobSizeLimit");
    });

    // -----------------------------------------------------------------------
    // Authorization – write-permission guard
    // -----------------------------------------------------------------------

    test("VIEWER member is rejected with 403 when attempting PATCH", async () => {
      const { repository } = await setup({}, "VIEWER");

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      expect(response.status).toBe(403);
    });

    test("STAKEHOLDER member is rejected with 403 when attempting PATCH", async () => {
      const { repository } = await setup({}, "STAKEHOLDER");

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      expect(response.status).toBe(403);
    });

    test("DEVELOPER member is allowed to PATCH (write-level access)", async () => {
      const { repository } = await setup({}, "DEVELOPER");

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      await expectSuccess(response);
    });

    test("OWNER member is allowed to PATCH", async () => {
      const { repository } = await setup({}, "OWNER");

      const request = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: true }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      await expectSuccess(response);
    });
  });

  // ---------------------------------------------------------------------------
  // GET
  // ---------------------------------------------------------------------------

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

    test("GET returns shallowClone and blobSizeLimit", async () => {
      const { repository } = await setup({ shallowClone: true, blobSizeLimit: "2g" });

      const request = createGetRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.shallowClone).toBe(true);
      expect(body.data.blobSizeLimit).toBe("2g");
    });

    test("GET returns shallowClone=false and blobSizeLimit=null by default", async () => {
      const { repository } = await setup();

      const request = createGetRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.shallowClone).toBe(false);
      expect(body.data.blobSizeLimit).toBeNull();
    });

    test("GET reflects value saved by a preceding PATCH (round-trip)", async () => {
      const { repository } = await setup();

      // PATCH first
      const patchReq = createPatchRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`,
        { shallowClone: true, blobSizeLimit: "100k" }
      );
      await PATCH(patchReq, { params: Promise.resolve({ id: repository.id }) });

      // Then GET
      const getReq = createGetRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`
      );
      const response = await GET(getReq, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(body.data.shallowClone).toBe(true);
      expect(body.data.blobSizeLimit).toBe("100k");
    });

    test("GET response always includes shallowClone and blobSizeLimit keys", async () => {
      const { repository } = await setup();

      const request = createGetRequest(
        `http://localhost:3000/api/repositories/${repository.id}/settings`
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: repository.id }),
      });
      const body = await expectSuccess(response);

      expect(Object.keys(body.data)).toContain("shallowClone");
      expect(Object.keys(body.data)).toContain("blobSizeLimit");
    });
  });
});
