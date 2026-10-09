/**
 * Integration tests for GET /api/orgs/[githubLogin]/concepts — the org
 * canvas composer's "/" concept-mention menu data source.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { createTestWorkspaceScenario, createTestSwarm } from "@/__tests__/support/fixtures";
import { createAuthenticatedGetRequest, createGetRequest, generateUniqueId } from "@/__tests__/support/helpers";
import { GET } from "@/app/api/orgs/[githubLogin]/concepts/route";
import type { User, Workspace } from "@prisma/client";

const SWARM_API_KEY = "test-org-concepts-api-key";

const MOCK_CONCEPTS = [
  { id: "hive/founder", name: "Founder-Operator Mindset" },
  { id: "hive/pm", name: "Product Management Loop" },
  { id: "hive/eng", name: "Engineering Excellence" },
];

function makeConceptsResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

let installationIdCounter = 910000;
function nextInstallationId() {
  return installationIdCounter++;
}

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: githubLogin,
    },
  });
}

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.workspaceMember.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await db.swarm.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await db.sourceControlOrg.updateMany({
      where: { defaultWorkspaceId: { in: createdWorkspaceIds } },
      data: { defaultWorkspaceId: null },
    });
    await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    createdWorkspaceIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.sourceControlOrg.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
  vi.restoreAllMocks();
});

describe("GET /api/orgs/[githubLogin]/concepts", () => {
  it("returns noDefaultSwarm when the org has no default workspace configured", async () => {
    const githubLogin = `concepts-no-default-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const request = createGetRequest(`/api/orgs/${githubLogin}/concepts`);
    const response = await GET(request, { params: makeParams(githubLogin) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ concepts: [], noDefaultSwarm: true });
  });

  it("returns 401 for unauthenticated requests when a default workspace exists", async () => {
    const githubLogin = `concepts-unauth-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Concepts Owner" },
    });
    createdWorkspaceIds.push(scenario.workspace.id);

    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { defaultWorkspaceId: scenario.workspace.id },
    });

    const request = createGetRequest(`/api/orgs/${githubLogin}/concepts`);
    const response = await GET(request, { params: makeParams(githubLogin) });

    expect(response.status).toBe(401);
  });

  it("returns 403 for authenticated non-members of the default workspace", async () => {
    const githubLogin = `concepts-forbidden-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Concepts Owner 2" },
    });
    createdWorkspaceIds.push(scenario.workspace.id);
    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { defaultWorkspaceId: scenario.workspace.id },
    });

    const nonMember = await db.user.create({
      data: {
        name: "Non Member",
        email: `non-member-concepts-${generateUniqueId("user")}@example.com`,
      },
    });

    const request = createAuthenticatedGetRequest(`/api/orgs/${githubLogin}/concepts`, nonMember);
    const response = await GET(request, { params: makeParams(githubLogin) });

    expect(response.status).toBe(403);

    await db.user.delete({ where: { id: nonMember.id } });
  });

  describe("with a default workspace + swarm", () => {
    let owner: User;
    let workspace: Workspace;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Concepts Scenario Owner" },
      });
      owner = scenario.owner;
      workspace = scenario.workspace;
      createdWorkspaceIds.push(workspace.id);

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField("swarmApiKey", SWARM_API_KEY);
      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `org-concepts-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-org-concepts.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });

    it("returns the first ~20 concepts when q is empty", async () => {
      const githubLogin = `concepts-empty-q-${generateUniqueId()}`;
      const org = await createOrg(githubLogin);
      createdOrgIds.push(org.id);
      await db.sourceControlOrg.update({
        where: { id: org.id },
        data: { defaultWorkspaceId: workspace.id },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS));

      const request = createAuthenticatedGetRequest(`/api/orgs/${githubLogin}/concepts`, owner);
      const response = await GET(request, { params: makeParams(githubLogin) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.concepts).toHaveLength(3);
      expect(data.concepts.map((c: { name: string }) => c.name)).toContain("Founder-Operator Mindset");
    });

    it("filters concepts by case-insensitive substring on name", async () => {
      const githubLogin = `concepts-filter-${generateUniqueId()}`;
      const org = await createOrg(githubLogin);
      createdOrgIds.push(org.id);
      await db.sourceControlOrg.update({
        where: { id: org.id },
        data: { defaultWorkspaceId: workspace.id },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS));

      const request = createAuthenticatedGetRequest(`/api/orgs/${githubLogin}/concepts`, owner, {
        q: "founder",
      });
      const response = await GET(request, { params: makeParams(githubLogin) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.concepts).toHaveLength(1);
      expect(data.concepts[0].name).toBe("Founder-Operator Mindset");
    });

    it("caps results at 20 and accepts the `features` response shape", async () => {
      const githubLogin = `concepts-cap-${generateUniqueId()}`;
      const org = await createOrg(githubLogin);
      createdOrgIds.push(org.id);
      await db.sourceControlOrg.update({
        where: { id: org.id },
        data: { defaultWorkspaceId: workspace.id },
      });

      const many = Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, name: `Concept ${i}` }));
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeConceptsResponse({ features: many }));

      const request = createAuthenticatedGetRequest(`/api/orgs/${githubLogin}/concepts`, owner);
      const response = await GET(request, { params: makeParams(githubLogin) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.concepts).toHaveLength(20);
    });
  });
});
