/**
 * Integration tests for POST /api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/triggers/[triggerId]/run
 *
 * Covers:
 * - 401 for unauthenticated requests
 * - 404/403 for non-member / no swarm / workspace not found
 * - 502 when Jarvis node fetch fails
 * - swarmUrl still present in Stakwork payload vars (no regression)
 * - source + replayUrl in Stakwork payload vars
 * - replayUrl is null for provider_direct
 * - replayUrl ends with :3355/repo/agent for repo_agent
 * - replayUrl ends with /api/ask/sync for jamie_agent
 * - Bifrost vars absent when getBifrostForLLM returns undefined
 * - Bifrost vars present when getBifrostForLLM returns a value
 * - No Stakwork call when Jarvis node fetch fails
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createAuthenticatedPostRequest,
  createPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
} from "@/__tests__/support/factories";
import { POST } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/triggers/[triggerId]/run/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(),
  BIFROST_AGENT_NAMES: ["repo-agent", "canvas-agent"],
}));

import { getBifrostForLLM } from "@/services/bifrost/orchestrator";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

const SWARM_URL = "https://ai.sphinx.chat/api";
const SWARM_NAME = "test-swarm-evals-run";
const EVAL_SET_ID = "evalset-ref-123";
const REQ_ID = "req-ref-456";
const TRIGGER_ID = "trigger-ref-789";

async function createTestFixtures() {
  const user = await createTestUser({
    id: generateUniqueId("etr-user"),
    email: `etr-${Date.now()}@example.com`,
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    id: generateUniqueId("etr-ws"),
    name: "Evals Trigger Run Test Workspace",
    slug: `etr-ws-${Date.now()}`,
    ownerId: user.id,
  });
  createdWorkspaceIds.push(workspace.id);

  await createTestMembership({ workspaceId: workspace.id, userId: user.id, role: "OWNER" });
  await createTestSwarm({
    workspaceId: workspace.id,
    swarmApiKey: "test-swarm-key",
    name: SWARM_NAME,
    swarmUrl: SWARM_URL,
  });

  return { user, workspace };
}

function makeRequest(
  slug: string,
  user?: { id: string; email: string; name?: string },
) {
  const url = `http://localhost/api/workspaces/${slug}/evals/${EVAL_SET_ID}/requirements/${REQ_ID}/triggers/${TRIGGER_ID}/run`;
  if (user) {
    return createAuthenticatedPostRequest(url, user, {});
  }
  return createPostRequest(url, {});
}

function makeRouteParams(slug: string) {
  return {
    params: Promise.resolve({
      slug,
      evalSetId: EVAL_SET_ID,
      reqId: REQ_ID,
      triggerId: TRIGGER_ID,
    }),
  };
}

// Helper: mock successful Jarvis node fetch returning a given source
function mockJarvisNodeFetch(source: string) {
  mockFetch.mockImplementationOnce(async (url: string) => {
    if (typeof url === "string" && url.includes(`/node/${TRIGGER_ID}`)) {
      return {
        ok: true,
        json: async () => ({ properties: { source } }),
      } as Response;
    }
    // Default fallthrough (shouldn't be reached in single-source tests)
    return { ok: false } as Response;
  });
}

// Helper: mock successful Stakwork project creation
function mockStakworkSuccess() {
  mockFetch.mockImplementationOnce(async () => ({
    ok: true,
    json: async () => ({ project_id: "stakwork-project-99" }),
  } as Response));
}

// Capture vars sent to Stakwork
function capturedStakworkVars(): Record<string, unknown> | undefined {
  const stakworkCall = mockFetch.mock.calls.find(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("stakwork"),
  );
  if (!stakworkCall) return undefined;
  const body = JSON.parse(stakworkCall[1]?.body as string);
  return body?.workflow_params?.set_var?.attributes?.vars;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  process.env.USE_MOCKS = "false";
  process.env.NODE_ENV = "test";
  process.env.STAKWORK_EVAL_WORKFLOW_ID = "42";
  process.env.STAKWORK_API_KEY = "test-stakwork-api-key";
  process.env.STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";
  global.fetch = mockFetch;
  vi.mocked(getBifrostForLLM).mockResolvedValue(undefined);
});

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.workspaceMember.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await db.swarm.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    createdWorkspaceIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST .../triggers/[triggerId]/run", () => {
  describe("Authentication & authorization", () => {
    test("returns 401 for unauthenticated requests", async () => {
      const { workspace } = await createTestFixtures();
      const request = makeRequest(workspace.slug);
      const response = await POST(request, makeRouteParams(workspace.slug));
      expect(response.status).toBe(401);
    });

    test("returns 404 for non-existent workspace", async () => {
      const user = await createTestUser({
        id: generateUniqueId("etr-nouser"),
        email: `etr-nouser-${Date.now()}@example.com`,
      });
      createdUserIds.push(user.id);

      const request = makeRequest("no-such-workspace", user);
      const response = await POST(request, makeRouteParams("no-such-workspace"));
      expect(response.status).toBe(404);
    });

    test("returns 403 for non-member user", async () => {
      const { workspace } = await createTestFixtures();

      const nonMember = await createTestUser({
        id: generateUniqueId("etr-nm"),
        email: `etr-nm-${Date.now()}@example.com`,
      });
      createdUserIds.push(nonMember.id);

      const request = makeRequest(workspace.slug, nonMember);
      const response = await POST(request, makeRouteParams(workspace.slug));
      expect([403, 404]).toContain(response.status);
    });
  });

  describe("Configuration guards", () => {
    test("returns 400 when STAKWORK_EVAL_WORKFLOW_ID is unset", async () => {
      const { user, workspace } = await createTestFixtures();
      delete process.env.STAKWORK_EVAL_WORKFLOW_ID;

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/STAKWORK_EVAL_WORKFLOW_ID/);
    });

    test("returns 400 when STAKWORK_API_KEY is unset", async () => {
      const { user, workspace } = await createTestFixtures();
      delete process.env.STAKWORK_API_KEY;

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));
      expect(response.status).toBe(400);
    });
  });

  describe("Jarvis node fetch", () => {
    test("returns 502 when Jarvis node fetch fails and makes no Stakwork call", async () => {
      const { user, workspace } = await createTestFixtures();

      // Jarvis returns error
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(502);
      const data = await response.json();
      expect(data.error).toMatch(/trigger node/i);

      // No Stakwork call made
      const stakworkCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("stakwork"),
      );
      expect(stakworkCalls).toHaveLength(0);
    });
  });

  describe("Happy path — source + replayUrl", () => {
    test("repo_agent: swarmUrl still present, source=repo_agent, replayUrl ends with :3355/repo/agent", async () => {
      const { user, workspace } = await createTestFixtures();
      mockJarvisNodeFetch("repo_agent");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars).toBeDefined();
      // swarmUrl preserved (regression guard)
      expect(vars!.swarmUrl).toBe(SWARM_URL);
      // source
      expect(vars!.source).toBe("repo_agent");
      // replayUrl — transformSwarmUrlToRepo2Graph replaces /api with :3355
      expect(vars!.replayUrl).toBe("https://ai.sphinx.chat:3355/repo/agent");
    });

    test("provider_direct: replayUrl is null", async () => {
      const { user, workspace } = await createTestFixtures();
      mockJarvisNodeFetch("provider_direct");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars!.source).toBe("provider_direct");
      expect(vars!.replayUrl).toBeNull();
    });

    test("jamie_agent: replayUrl ends with /api/ask/sync", async () => {
      const { user, workspace } = await createTestFixtures();
      mockJarvisNodeFetch("jamie_agent");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars!.source).toBe("jamie_agent");
      expect(typeof vars!.replayUrl).toBe("string");
      expect((vars!.replayUrl as string).endsWith("/api/ask/sync")).toBe(true);
    });

    test("unknown/missing source defaults to repo_agent", async () => {
      const { user, workspace } = await createTestFixtures();

      // Jarvis returns node with no source property
      mockFetch.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ properties: {} }),
      } as Response));
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars!.source).toBe("repo_agent");
    });

    test("reads source from top-level node property when properties is absent", async () => {
      const { user, workspace } = await createTestFixtures();

      // Some Jarvis shapes return source at top level
      mockFetch.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ source: "provider_direct" }),
      } as Response));
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars!.source).toBe("provider_direct");
    });
  });

  describe("Bifrost vars", () => {
    test("Bifrost vars absent when getBifrostForLLM returns undefined", async () => {
      const { user, workspace } = await createTestFixtures();
      vi.mocked(getBifrostForLLM).mockResolvedValue(undefined);

      mockJarvisNodeFetch("repo_agent");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars).not.toHaveProperty("bifrostApiKey");
      expect(vars).not.toHaveProperty("bifrostBaseUrl");
      expect(vars).not.toHaveProperty("bifrostHeaders");
    });

    test("Bifrost vars present when getBifrostForLLM returns credentials (repo_agent)", async () => {
      const { user, workspace } = await createTestFixtures();
      vi.mocked(getBifrostForLLM).mockResolvedValue({
        apiKey: "vk-test-key",
        baseUrl: "https://bifrost.example.com/anthropic/v1",
        headers: { "x-macaroon": "test-macaroon" },
        runId: "run-123",
        agentName: "repo-agent",
      });

      mockJarvisNodeFetch("repo_agent");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars!.bifrostApiKey).toBe("vk-test-key");
      expect(vars!.bifrostBaseUrl).toBe("https://bifrost.example.com/anthropic/v1");
      expect(vars!.bifrostHeaders).toEqual({ "x-macaroon": "test-macaroon" });
    });

    test("Bifrost vars present when getBifrostForLLM returns credentials (jamie_agent)", async () => {
      const { user, workspace } = await createTestFixtures();
      vi.mocked(getBifrostForLLM).mockResolvedValue({
        apiKey: "vk-jamie-key",
        baseUrl: "https://bifrost.example.com/openai/v1",
        headers: { "x-macaroon": "jamie-macaroon" },
        runId: "run-456",
        agentName: "canvas-agent",
      });

      mockJarvisNodeFetch("jamie_agent");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars!.bifrostApiKey).toBe("vk-jamie-key");
    });

    test("getBifrostForLLM NOT called for provider_direct source", async () => {
      const { user, workspace } = await createTestFixtures();

      mockJarvisNodeFetch("provider_direct");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      expect(getBifrostForLLM).not.toHaveBeenCalled();

      const vars = capturedStakworkVars();
      expect(vars).not.toHaveProperty("bifrostApiKey");
    });
  });

  describe("Stakwork payload structure", () => {
    test("swarmSecretAlias is present in vars", async () => {
      const { user, workspace } = await createTestFixtures();
      mockJarvisNodeFetch("repo_agent");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const vars = capturedStakworkVars();
      expect(vars).toHaveProperty("swarmSecretAlias");
    });

    test("returns project_id from Stakwork response", async () => {
      const { user, workspace } = await createTestFixtures();
      mockJarvisNodeFetch("repo_agent");
      mockStakworkSuccess();

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.project_id).toBe("stakwork-project-99");
    });

    test("returns 502 when Stakwork call fails", async () => {
      const { user, workspace } = await createTestFixtures();
      mockJarvisNodeFetch("repo_agent");

      // Stakwork returns error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      const request = makeRequest(workspace.slug, user);
      const response = await POST(request, makeRouteParams(workspace.slug));

      expect(response.status).toBe(502);
      const data = await response.json();
      expect(data.error).toMatch(/eval workflow/i);
    });
  });
});
