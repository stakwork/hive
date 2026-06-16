/**
 * Integration tests for POST /api/workspaces/[slug]/workflows/[workflowId]/eval/capture
 *
 * Covers:
 * - 401 for unauthenticated requests (middleware-based auth)
 * - 404/403 for non-member / no swarm
 * - 400 for missing `requirement`
 * - 200 happy path: addNode called 3×, addEdge called ≥2×
 * - endpoint_url present in EvalTrigger node_data
 * - Dupes allowed: a second capture creates new nodes
 * - Empty desirable_cases / undesirable_cases are accepted
 * - EvalSet find-or-create: reuses existing ref_id when found
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
import * as nodesService from "@/services/swarm/api/nodes";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/services/swarm/api/nodes");

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

const mockFetch = vi.fn();

import { POST } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/eval/capture/route";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

async function createTestFixtures() {
  const user = await createTestUser({
    id: generateUniqueId("ec-user"),
    email: `ec-${Date.now()}@example.com`,
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    id: generateUniqueId("ec-ws"),
    name: "Eval Capture Test Workspace",
    slug: `ec-ws-${Date.now()}`,
    ownerId: user.id,
  });
  createdWorkspaceIds.push(workspace.id);

  await createTestMembership({ workspaceId: workspace.id, userId: user.id, role: "OWNER" });
  await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-swarm-key" });

  return { user, workspace };
}

function makeRequest(
  slug: string,
  workflowId: string,
  body: Record<string, unknown>,
  user?: { id: string; email: string; name?: string },
) {
  const url = `http://localhost/api/workspaces/${slug}/workflows/${workflowId}/eval/capture`;
  if (user) {
    return createAuthenticatedPostRequest(url, user, body);
  }
  return createPostRequest(url, body);
}

const validBody = {
  run_id: "1001",
  step_id: "llm_generate_title",
  requirement: "Never return an empty response",
  reason: "title step occasionally emits empty string",
  desirable_cases: ["Returns a non-empty string"],
  undesirable_cases: ["Returns empty string"],
  check: { type: "non_empty", want: true },
};

// Project JSON fixture reused for snapshot tests
const projectJsonFixture = {
  transitions: [
    {
      unique_id: "llm_generate_title",
      display_name: "Generate Title",
      attributes: {
        url: "https://api.openai.com/v1/chat/completions",
        request_params: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Generate a title" }],
          tools: null,
        },
      },
      output: {
        output_type: "raw",
        output: {
          response: {
            choices: [{ message: { content: "A great title" } }],
          },
        },
      },
    },
  ],
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  process.env.USE_MOCKS = "false";
  process.env.NODE_ENV = "test";
  global.fetch = mockFetch;
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

describe("POST .../workflows/[workflowId]/eval/capture", () => {
  describe("Authentication", () => {
    test("returns 401 for unauthenticated requests", async () => {
      const { workspace } = await createTestFixtures();

      const request = makeRequest(workspace.slug, "42", validBody);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 404 for non-existent workspace", async () => {
      const user = await createTestUser({
        id: generateUniqueId("ec-nouser"),
        email: `ec-nouser-${Date.now()}@example.com`,
      });
      createdUserIds.push(user.id);

      const request = makeRequest("no-such-workspace", "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: "no-such-workspace", workflowId: "42" }),
      });

      expect(response.status).toBe(404);
    });

    test("returns 403 for non-member user with no swarm access", async () => {
      const owner = await createTestUser({
        id: generateUniqueId("ec-owner"),
        email: `ec-owner-${Date.now()}@example.com`,
      });
      createdUserIds.push(owner.id);

      const workspace = await createTestWorkspace({
        id: generateUniqueId("ec-ws2"),
        name: "EC Test WS 2",
        slug: `ec-ws2-${Date.now()}`,
        ownerId: owner.id,
      });
      createdWorkspaceIds.push(workspace.id);
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "key" });

      const nonMember = await createTestUser({
        id: generateUniqueId("ec-nonmember"),
        email: `ec-nonmember-${Date.now()}@example.com`,
      });
      createdUserIds.push(nonMember.id);

      const request = makeRequest(workspace.slug, "42", validBody, nonMember);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect([403, 404]).toContain(response.status);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });
  });

  describe("Input validation", () => {
    test("returns 400 when requirement is missing", async () => {
      const { user, workspace } = await createTestFixtures();

      const body = { run_id: "1001", step_id: "llm_step" }; // no requirement
      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/requirement/i);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });

    test("returns 400 when requirement is empty string", async () => {
      const { user, workspace } = await createTestFixtures();

      const body = { requirement: "   ", run_id: "1001" };
      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("Happy path", () => {
    function setupNodeMocks(options: { evalSetExists: boolean } = { evalSetExists: false }) {
      // Jarvis lookup for EvalSet find-or-create
      if (options.evalSetExists) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: [{ ref_id: "existing-evalset-ref" }] }),
        });
      } else {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }

      // Stakwork project JSON for snapshot
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => projectJsonFixture,
      });

      // addNode: EvalSet (if not existing), EvalRequirement, EvalTrigger
      if (!options.evalSetExists) {
        vi.mocked(nodesService.addNode)
          .mockResolvedValueOnce({ success: true, ref_id: "evalset-ref-new" })
          .mockResolvedValueOnce({ success: true, ref_id: "req-ref-1" })
          .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-1" });
      } else {
        vi.mocked(nodesService.addNode)
          .mockResolvedValueOnce({ success: true, ref_id: "req-ref-1" })
          .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-1" });
      }

      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });

      // Run node lookup returns null (skip EVALUATED edge)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
    }

    test("200 happy path: addNode called 3×, addEdge called ≥2×", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks({ evalSetExists: false });

      const request = makeRequest(workspace.slug, "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.requirementRef).toBe("req-ref-1");
      expect(data.data.triggerRef).toBe("trigger-ref-1");

      // 3 addNode calls: EvalSet, EvalRequirement, EvalTrigger
      expect(nodesService.addNode).toHaveBeenCalledTimes(3);
      // ≥2 addEdge calls: HAS_REQUIREMENT, HAS_TRIGGER
      expect(nodesService.addEdge).toHaveBeenCalledTimes(2);

      // Verify edge types
      const edgeCalls = vi.mocked(nodesService.addEdge).mock.calls;
      const edgeTypes = edgeCalls.map((c) => c[1].edge.edge_type);
      expect(edgeTypes).toContain("HAS_REQUIREMENT");
      expect(edgeTypes).toContain("HAS_TRIGGER");
    });

    test("EvalTrigger node_data contains endpoint_url", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks({ evalSetExists: false });

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      // Find the EvalTrigger addNode call (3rd call)
      const addNodeCalls = vi.mocked(nodesService.addNode).mock.calls;
      const triggerCall = addNodeCalls.find((c) => c[1].node_type === "EvalTrigger");
      expect(triggerCall).toBeDefined();
      expect(triggerCall![1].node_data.endpoint_url).toBe(
        "https://api.openai.com/v1/chat/completions",
      );
    });

    test("EvalRequirement node_data has correct name", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks({ evalSetExists: false });

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const addNodeCalls = vi.mocked(nodesService.addNode).mock.calls;
      const reqCall = addNodeCalls.find((c) => c[1].node_type === "EvalRequirement");
      expect(reqCall).toBeDefined();
      expect(reqCall![1].node_data.name).toBe("Never return an empty response");
    });

    test("reuses existing EvalSet ref_id (only 2 addNode calls)", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks({ evalSetExists: true });

      const request = makeRequest(workspace.slug, "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      // Only 2 addNode: EvalRequirement + EvalTrigger (EvalSet was found)
      expect(nodesService.addNode).toHaveBeenCalledTimes(2);

      // HAS_REQUIREMENT edge source should be the existing EvalSet ref
      const edgeCalls = vi.mocked(nodesService.addEdge).mock.calls;
      const hasReqEdge = edgeCalls.find((c) => c[1].edge.edge_type === "HAS_REQUIREMENT");
      expect(hasReqEdge![1].source.ref_id).toBe("existing-evalset-ref");
    });

    test("dupes allowed: second capture creates new requirement (not deduplicated)", async () => {
      const { user, workspace } = await createTestFixtures();

      // First capture
      setupNodeMocks({ evalSetExists: false });
      const request1 = makeRequest(workspace.slug, "42", validBody, user);
      const response1 = await POST(request1, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });
      expect(response1.status).toBe(200);

      // Second capture — EvalSet already exists (found via fetch lookup)
      // Set up fetch: EvalSet lookup returns existing ref, project JSON, run lookup returns 404
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: [{ ref_id: "existing-evalset-ref" }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => projectJsonFixture,
        })
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      // Only EvalRequirement + EvalTrigger nodes needed (EvalSet reused)
      vi.mocked(nodesService.addNode)
        .mockResolvedValueOnce({ success: true, ref_id: "req-ref-2" })
        .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-2" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });

      const request2 = makeRequest(workspace.slug, "42", validBody, user);
      const response2 = await POST(request2, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response2.status).toBe(200);
      const data2 = await response2.json();
      // New requirement was created
      expect(data2.data.requirementRef).toBe("req-ref-2");
      expect(data2.data.triggerRef).toBe("trigger-ref-2");
    });

    test("accepts empty desirable_cases and undesirable_cases", async () => {
      const { user, workspace } = await createTestFixtures();

      // EvalSet not found
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      // Project JSON
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => projectJsonFixture });
      vi.mocked(nodesService.addNode)
        .mockResolvedValueOnce({ success: true, ref_id: "evalset-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "req-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });
      // Run lookup
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

      const body = {
        run_id: "1001",
        step_id: "llm_generate_title",
        requirement: "Must return valid JSON",
        desirable_cases: [],
        undesirable_cases: [],
      };

      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify empty arrays were stored in EvalRequirement
      const addNodeCalls = vi.mocked(nodesService.addNode).mock.calls;
      const reqCall = addNodeCalls.find((c) => c[1].node_type === "EvalRequirement");
      expect(reqCall![1].node_data.desirable_cases).toEqual([]);
      expect(reqCall![1].node_data.undesirable_cases).toEqual([]);
    });

    test("EVALUATED edge is created when Run node is found", async () => {
      const { user, workspace } = await createTestFixtures();

      // EvalSet not found
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      // Project JSON
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => projectJsonFixture });
      vi.mocked(nodesService.addNode)
        .mockResolvedValueOnce({ success: true, ref_id: "evalset-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "req-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });

      // Run node lookup returns a ref
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: [{ ref_id: "run-node-ref" }] }),
      });

      const request = makeRequest(workspace.slug, "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);

      // Should have 3 edges: HAS_REQUIREMENT, HAS_TRIGGER, EVALUATED
      expect(nodesService.addEdge).toHaveBeenCalledTimes(3);
      const edgeCalls = vi.mocked(nodesService.addEdge).mock.calls;
      const edgeTypes = edgeCalls.map((c) => c[1].edge.edge_type);
      expect(edgeTypes).toContain("EVALUATED");
    });

    test("EvalTrigger node_data has prompt_version_id when provided in body", async () => {
      const { user, workspace } = await createTestFixtures();

      // EvalSet not found
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      // Project JSON
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => projectJsonFixture });
      vi.mocked(nodesService.addNode)
        .mockResolvedValueOnce({ success: true, ref_id: "evalset-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "req-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });
      // Run lookup
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

      const bodyWithPv = { ...validBody, prompt_version_id: "pv-xyz" };
      const request = makeRequest(workspace.slug, "42", bodyWithPv, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      const addNodeCalls = vi.mocked(nodesService.addNode).mock.calls;
      const triggerCall = addNodeCalls.find((c) => c[1].node_type === "EvalTrigger");
      expect(triggerCall).toBeDefined();
      expect(triggerCall![1].node_data.prompt_version_id).toBe("pv-xyz");
    });

    test("EvalTrigger node_data prompt_version_id is null when omitted from body", async () => {
      const { user, workspace } = await createTestFixtures();

      // EvalSet not found
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      // Project JSON
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => projectJsonFixture });
      vi.mocked(nodesService.addNode)
        .mockResolvedValueOnce({ success: true, ref_id: "evalset-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "req-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });
      // Run lookup
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

      // validBody has no prompt_version_id
      const request = makeRequest(workspace.slug, "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      const addNodeCalls = vi.mocked(nodesService.addNode).mock.calls;
      const triggerCall = addNodeCalls.find((c) => c[1].node_type === "EvalTrigger");
      expect(triggerCall).toBeDefined();
      expect(triggerCall![1].node_data.prompt_version_id).toBeNull();
    });

    test("EVALUATED edge is skipped gracefully when Run node not found", async () => {
      const { user, workspace } = await createTestFixtures();

      // EvalSet not found
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      // Project JSON
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => projectJsonFixture });
      vi.mocked(nodesService.addNode)
        .mockResolvedValueOnce({ success: true, ref_id: "evalset-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "req-ref" })
        .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });
      // Run node not found
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

      const request = makeRequest(workspace.slug, "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      // Only HAS_REQUIREMENT + HAS_TRIGGER, no EVALUATED
      expect(nodesService.addEdge).toHaveBeenCalledTimes(2);
      const edgeCalls = vi.mocked(nodesService.addEdge).mock.calls;
      const edgeTypes = edgeCalls.map((c) => c[1].edge.edge_type);
      expect(edgeTypes).not.toContain("EVALUATED");
    });
  });
});
