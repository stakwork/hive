import { describe, test, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { setOrgDefaultWorkspaceIfUnset } from "@/lib/helpers/org-workspace";
import { POST as swarmPOST } from "@/app/api/swarm/route";
import { GET as githubCallbackGET } from "@/app/api/github/app/callback/route";
import { PATCH as settingsPATCH } from "@/app/api/orgs/[githubLogin]/settings/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  createPostRequest,
  createGetRequest,
  createAuthenticatedPatchRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";
import { signGithubAppState } from "@/lib/auth/github-app-state";

// External swarm service + Stakwork customer creation are mocked; DB is real.
vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn().mockImplementation(() => ({
    createSwarm: vi.fn().mockResolvedValue({
      data: {
        swarm_id: "auto-default-swarm-id",
        address: "auto-default.test.sphinx.chat",
        x_api_key: "test-x-api-key",
        ec2_id: "i-auto-default",
      },
    }),
  })),
}));

vi.mock("@/config/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/services")>();
  return {
    ...actual,
    getServiceConfig: vi.fn().mockReturnValue({
      baseUrl: "http://test-swarm-api.com",
      apiKey: "test-api-key",
    }),
  };
});

vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    createCustomer: vi.fn().mockResolvedValue({
      data: { id: 4242, token: "stakwork-customer-token", workflow_id: null },
    }),
    createSecret: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      GITHUB_APP_CLIENT_ID: "test_client_id_123",
      GITHUB_APP_CLIENT_SECRET: "test_client_secret_456",
    },
  };
});

const mockFetch = vi.fn();

let installationCounter = 920000;

async function createOrg(defaultWorkspaceId: string | null = null) {
  const githubLogin = `auto-default-org-${generateUniqueId()}`.toLowerCase();
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: installationCounter++,
      type: "ORG",
      name: githubLogin,
      defaultWorkspaceId,
    },
  });
}

async function orgDefault(orgId: string) {
  const org = await db.sourceControlOrg.findUnique({ where: { id: orgId } });
  return org?.defaultWorkspaceId ?? null;
}

describe("Auto-set org default workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("setOrgDefaultWorkspaceIfUnset (helper)", () => {
    test("fresh onboarding: no-op without swarm, sets default once swarm is ACTIVE", async () => {
      const user = await createTestUser();
      const org = await createOrg();
      const ws = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });

      expect(await setOrgDefaultWorkspaceIfUnset(ws.id)).toBe(false);
      expect(await orgDefault(org.id)).toBeNull();

      await createTestSwarm({ workspaceId: ws.id, status: "ACTIVE" });

      expect(await setOrgDefaultWorkspaceIfUnset(ws.id)).toBe(true);
      expect(await orgDefault(org.id)).toBe(ws.id);
    });

    test("does not set default for a FAILED swarm", async () => {
      const user = await createTestUser();
      const org = await createOrg();
      const ws = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      await createTestSwarm({ workspaceId: ws.id, status: "FAILED" });

      expect(await setOrgDefaultWorkspaceIfUnset(ws.id)).toBe(false);
      expect(await orgDefault(org.id)).toBeNull();
    });

    test("existing default is never overwritten", async () => {
      const user = await createTestUser();
      const org = await createOrg();
      const wsA = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      await createTestSwarm({ workspaceId: wsA.id, status: "ACTIVE" });
      await db.sourceControlOrg.update({ where: { id: org.id }, data: { defaultWorkspaceId: wsA.id } });

      const wsB = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      await createTestSwarm({ workspaceId: wsB.id, status: "ACTIVE" });

      expect(await setOrgDefaultWorkspaceIfUnset(wsB.id)).toBe(false);
      expect(await orgDefault(org.id)).toBe(wsA.id);
    });

    test("workspace with a swarm but no org is a no-op", async () => {
      const user = await createTestUser();
      const ws = await createTestWorkspace({ ownerId: user.id });
      await createTestSwarm({ workspaceId: ws.id, status: "ACTIVE" });

      expect(await setOrgDefaultWorkspaceIfUnset(ws.id)).toBe(false);
      const after = await db.workspace.findUnique({ where: { id: ws.id } });
      expect(after?.sourceControlOrgId).toBeNull();
    });
  });

  describe("POST /api/swarm", () => {
    test("sets org default when the swarm goes ACTIVE and org has no default", async () => {
      const user = await createTestUser();
      const org = await createOrg();
      const ws = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const res = await swarmPOST(
        createPostRequest("http://localhost:3000/api/swarm", {
          workspaceId: ws.id,
          repositoryUrl: `https://github.com/${org.githubLogin}/repo`,
        }),
      );
      expect(res.status).toBe(200);

      const swarm = await db.swarm.findFirst({ where: { workspaceId: ws.id } });
      expect(swarm?.status).toBe("ACTIVE");
      expect(await orgDefault(org.id)).toBe(ws.id);
    });

    test("links workspace via repositoryUrl owner and sets default", async () => {
      const user = await createTestUser();
      const org = await createOrg();
      const ws = await createTestWorkspace({ ownerId: user.id });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const res = await swarmPOST(
        createPostRequest("http://localhost:3000/api/swarm", {
          workspaceId: ws.id,
          repositoryUrl: `https://github.com/${org.githubLogin}/repo`,
        }),
      );
      expect(res.status).toBe(200);
      expect(await orgDefault(org.id)).toBe(ws.id);
    });

    test("leaves an existing different default unchanged", async () => {
      const user = await createTestUser();
      const org = await createOrg();
      const wsA = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      await createTestSwarm({ workspaceId: wsA.id, status: "ACTIVE" });
      await db.sourceControlOrg.update({ where: { id: org.id }, data: { defaultWorkspaceId: wsA.id } });

      const wsB = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const res = await swarmPOST(
        createPostRequest("http://localhost:3000/api/swarm", {
          workspaceId: wsB.id,
          repositoryUrl: `https://github.com/${org.githubLogin}/repo-b`,
        }),
      );
      expect(res.status).toBe(200);
      expect((await db.swarm.findFirst({ where: { workspaceId: wsB.id } }))?.status).toBe("ACTIVE");
      expect(await orgDefault(org.id)).toBe(wsA.id);
    });
  });

  describe("GET /api/github/app/callback", () => {
    test("links a workspace that already has a swarm and makes it the org default", async () => {
      const user = await createTestUser({ name: "Callback User" });
      const login = `cb-owner-${generateUniqueId()}`.toLowerCase();
      const installationId = installationCounter++;
      const ws = await createTestWorkspace({
        ownerId: user.id,
        repositoryDraft: `https://github.com/${login}/repo`,
      });
      await createTestSwarm({ workspaceId: ws.id, status: "ACTIVE" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const state = signGithubAppState({
        workspaceSlug: ws.slug,
        randomState: `test-random-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
      });
      await db.session.create({
        data: {
          userId: user.id,
          sessionToken: `sess-${user.id}-${Date.now()}`,
          expires: new Date(Date.now() + 86400000),
          githubState: state,
        },
      });

      const original = globalThis.fetch;
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      mockFetch
        .mockResolvedValueOnce(ok({ access_token: "ghu_x", refresh_token: "ghr_x" }))
        .mockResolvedValueOnce(ok({ id: 777, login, name: "Owner", avatar_url: "https://a/u" }))
        .mockResolvedValueOnce(
          ok({ installations: [{ id: installationId, account: { login, type: "Organization", avatar_url: "https://a/u" } }] }),
        )
        .mockResolvedValueOnce(
          ok({ name: "repo", full_name: `${login}/repo`, private: false, default_branch: "main", permissions: { push: true, admin: false } }),
        );

      try {
        const res = await githubCallbackGET(
          createGetRequest("http://localhost:3000/api/github/app/callback", {
            code: "test_code",
            state,
            installation_id: String(installationId),
            setup_action: "install",
          }),
        );
        expect(res.headers.get("location")).toContain("repository_access"); expect(res.status).toBe(307);
      } finally {
        globalThis.fetch = original;
      }

      const org = await db.sourceControlOrg.findUnique({ where: { githubLogin: login } });
      expect(org).toBeTruthy();
      expect((await db.workspace.findUnique({ where: { id: ws.id } }))?.sourceControlOrgId).toBe(org!.id);
      expect(org!.defaultWorkspaceId).toBe(ws.id);
    });
  });

  describe("PATCH /api/orgs/[githubLogin]/settings", () => {
    test("manual override still works after an auto-set", async () => {
      const user = await createTestUser();
      const org = await createOrg();
      const wsA = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      const wsB = await createTestWorkspace({ ownerId: user.id, sourceControlOrgId: org.id });
      await createTestSwarm({ workspaceId: wsA.id, status: "ACTIVE" });

      expect(await setOrgDefaultWorkspaceIfUnset(wsA.id)).toBe(true);
      expect(await orgDefault(org.id)).toBe(wsA.id);

      const res = await settingsPATCH(
        createAuthenticatedPatchRequest(
          `/api/orgs/${org.githubLogin}/settings`,
          { defaultWorkspaceId: wsB.id },
          { id: user.id, email: user.email, name: user.name },
        ),
        { params: Promise.resolve({ githubLogin: org.githubLogin }) },
      );
      expect(res.status).toBe(200);
      expect(await orgDefault(org.id)).toBe(wsB.id);
    });
  });
});
