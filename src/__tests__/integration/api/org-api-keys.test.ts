import { describe, test, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/orgs/[githubLogin]/api-keys/route";
import { DELETE } from "@/app/api/orgs/[githubLogin]/api-keys/[keyId]/route";
import { POST as CLAIM } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { POST as DROP } from "@/app/api/pool-manager/drop-pod/[workspaceId]/route";
import {
  createAuthenticatedDeleteRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  expectForbidden,
  expectNotFound,
  expectSuccess,
  expectUnauthorized,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createRequestWithHeaders } from "@/__tests__/support/helpers/request-builders";
import { createTestUser, createTestWorkspaceScenario, createTestSwarm } from "@/__tests__/support/fixtures";
import { createTestPod } from "@/__tests__/support/factories/pod.factory";
import { createOrgApiKey } from "@/lib/org-api-keys";
import { hashApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";

vi.mock("@/config/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test.com",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn(() => "decrypted-api-key"),
      encryptField: vi.fn(() => ({
        data: "encrypted-data",
        iv: "initialization-vector",
        tag: "auth-tag",
        keyId: "default",
        version: "1",
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

let installationIdCounter = 930000;

async function createOrg() {
  const githubLogin = `org-keys-${generateUniqueId()}`;
  return db.sourceControlOrg.create({
    data: { githubLogin, githubInstallationId: installationIdCounter++, type: "ORG", name: githubLogin },
  });
}

/** Workspace (with swarm + one pod) attached to the given org. */
async function createOrgWorkspace(orgId: string) {
  const scenario = await createTestWorkspaceScenario({ withSwarm: true, withPods: true, podCount: 1 });
  await db.workspace.update({ where: { id: scenario.workspace.id }, data: { sourceControlOrgId: orgId } });
  return scenario;
}

function asSessionUser(user: { id: string; email: string | null; name: string | null }) {
  return { id: user.id, email: user.email ?? "", name: user.name ?? "" };
}

function orgKeyRequest(url: string, key: string) {
  return createRequestWithHeaders(url, "POST", { "x-api-token": key });
}

const claimUrl = (workspaceId: string) => `http://localhost:3000/api/pool-manager/claim-pod/${workspaceId}`;
const claimParams = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });

describe("org API keys", () => {
  beforeEach(() => {
    process.env.API_TOKEN = "test-api-token-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
        text: async () => "",
      }),
    );
  });

  describe("management routes", () => {
    test("admin creates, lists, and revokes a key; raw key returned only on create", async () => {
      const org = await createOrg();
      const { owner } = await createOrgWorkspace(org.id);

      const createRes = await POST(
        createAuthenticatedPostRequest(`http://localhost:3000/api/orgs/${org.githubLogin}/api-keys`, owner, {
          name: "strut",
        }),
        { params: Promise.resolve({ githubLogin: org.githubLogin }) },
      );
      const created = await expectSuccess(createRes, 201);
      expect(created.key.key).toMatch(/^hiveorg_[0-9A-Za-z]{32}$/);
      expect(created.key.keyPrefix).toBe(created.key.key.slice(0, 12));

      const row = await db.orgApiKey.findUniqueOrThrow({ where: { id: created.key.id } });
      expect(row.keyHash).toBe(hashApiKey(created.key.key));
      expect(row.sourceControlOrgId).toBe(org.id);

      const listRes = await GET(
        createAuthenticatedGetRequest(`http://localhost:3000/api/orgs/${org.githubLogin}/api-keys`, owner),
        { params: Promise.resolve({ githubLogin: org.githubLogin }) },
      );
      const listed = await expectSuccess(listRes, 200);
      expect(listed.keys).toHaveLength(1);
      expect(listed.keys[0]).not.toHaveProperty("key");
      expect(JSON.stringify(listed)).not.toContain(created.key.key);

      const delRes = await DELETE(
        createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/orgs/${org.githubLogin}/api-keys/${created.key.id}`,
          asSessionUser(owner),
        ),
        { params: Promise.resolve({ githubLogin: org.githubLogin, keyId: created.key.id }) },
      );
      await expectSuccess(delRes, 200);
      expect((await db.orgApiKey.findUniqueOrThrow({ where: { id: created.key.id } })).revokedAt).not.toBeNull();
    });

    test("non-member cannot create keys", async () => {
      const org = await createOrg();
      await createOrgWorkspace(org.id);
      const outsider = await createTestUser({ name: "Outsider" });

      const res = await POST(
        createAuthenticatedPostRequest(`http://localhost:3000/api/orgs/${org.githubLogin}/api-keys`, outsider, {
          name: "strut",
        }),
        { params: Promise.resolve({ githubLogin: org.githubLogin }) },
      );
      await expectNotFound(res);
    });

    test("cannot revoke another org's key", async () => {
      const orgA = await createOrg();
      const orgB = await createOrg();
      const { owner } = await createOrgWorkspace(orgA.id);
      const bScenario = await createOrgWorkspace(orgB.id);
      const keyB = await createOrgApiKey({ orgId: orgB.id, name: "b", createdById: bScenario.owner.id });

      const res = await DELETE(
        createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/orgs/${orgA.githubLogin}/api-keys/${keyB.id}`,
          asSessionUser(owner),
        ),
        { params: Promise.resolve({ githubLogin: orgA.githubLogin, keyId: keyB.id }) },
      );
      await expectNotFound(res);
      expect((await db.orgApiKey.findUniqueOrThrow({ where: { id: keyB.id } })).revokedAt).toBeNull();
    });
  });

  describe("claim-pod", () => {
    test("org key claims a pod in any workspace of its org", async () => {
      const org = await createOrg();
      const { owner, workspace, pods } = await createOrgWorkspace(org.id);
      const { key } = await createOrgApiKey({ orgId: org.id, name: "strut", createdById: owner.id });

      const res = await CLAIM(orgKeyRequest(claimUrl(workspace.id), key), claimParams(workspace.id));

      const data = await expectSuccess(res, 200);
      expect(data.podId).toBe(pods[0].podId);
      expect(data).toHaveProperty("password");
    });

    test("org key is rejected for a workspace in another org", async () => {
      const orgA = await createOrg();
      const orgB = await createOrg();
      const a = await createOrgWorkspace(orgA.id);
      const b = await createOrgWorkspace(orgB.id);
      const { key } = await createOrgApiKey({ orgId: orgA.id, name: "strut", createdById: a.owner.id });

      const res = await CLAIM(orgKeyRequest(claimUrl(b.workspace.id), key), claimParams(b.workspace.id));

      await expectForbidden(res);
      const pod = await db.pod.findFirstOrThrow({ where: { podId: b.pods[0].podId } });
      expect(pod.usageStatus).not.toBe("USED");
    });

    test("revoked, expired, and unknown org keys are 401", async () => {
      const org = await createOrg();
      const { owner, workspace } = await createOrgWorkspace(org.id);

      const revoked = await createOrgApiKey({ orgId: org.id, name: "revoked", createdById: owner.id });
      await db.orgApiKey.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });

      const expired = await createOrgApiKey({ orgId: org.id, name: "expired", createdById: owner.id });
      await db.orgApiKey.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

      for (const key of [revoked.key, expired.key, "hiveorg_doesnotexist"]) {
        const res = await CLAIM(orgKeyRequest(claimUrl(workspace.id), key), claimParams(workspace.id));
        await expectUnauthorized(res);
      }
    });
  });

  describe("drop-pod", () => {
    test("org key drops a pod in its org's workspace", async () => {
      const org = await createOrg();
      const { owner, workspace } = await createTestWorkspaceScenario();
      await db.workspace.update({ where: { id: workspace.id }, data: { sourceControlOrgId: org.id } });
      const swarm = await createTestSwarm({ workspaceId: workspace.id, status: "ACTIVE", poolName: "p" });
      const pod = await createTestPod({ podId: `pod-${generateUniqueId()}`, swarmId: swarm.id });
      const { key } = await createOrgApiKey({ orgId: org.id, name: "strut", createdById: owner.id });

      const res = await DROP(
        orgKeyRequest(`http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=${pod.podId}`, key),
        claimParams(workspace.id),
      );
      const data = await expectSuccess(res, 200);
      expect(data.success).toBe(true);
    });

    test("org key cannot drop a pod that belongs to another workspace", async () => {
      const orgA = await createOrg();
      const orgB = await createOrg();
      const a = await createOrgWorkspace(orgA.id);
      const b = await createOrgWorkspace(orgB.id);
      const { key } = await createOrgApiKey({ orgId: orgA.id, name: "strut", createdById: a.owner.id });

      // Own workspace in the URL, foreign pod in the query.
      const res = await DROP(
        orgKeyRequest(
          `http://localhost:3000/api/pool-manager/drop-pod/${a.workspace.id}?podId=${b.pods[0].podId}`,
          key,
        ),
        claimParams(a.workspace.id),
      );
      await expectNotFound(res);
    });
  });
});
