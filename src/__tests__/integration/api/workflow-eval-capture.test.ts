/**
 * Integration tests for POST /api/workspaces/[slug]/workflows/[workflowId]/eval/capture
 *
 * Covers:
 * - 401 for unauthenticated requests (middleware-based auth)
 * - 404/403 for non-member / no swarm
 * - 400 for missing `requirement`
 * - 400 for missing `evalSetId`
 * - 200 happy path: addNode called 2× (EvalRequirement + EvalTrigger), addEdge called exactly 2×
 * - HAS_REQUIREMENT edge source is the provided evalSetId (not auto-generated)
 * - prompt_snapshot and output_snapshot stored from posted inputs/outputs
 * - EvalTrigger body has no `model` or `provider` fields
 * - capture with null inputs/outputs stores "null" strings gracefully
 * - Dupes allowed: a second capture creates new nodes
 * - No outbound fetch to STAKWORK_BASE_URL/projects/...
 * - No EVALUATED edge is created
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

const sampleInputs = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Generate a title" }],
};

const sampleOutputs = {
  choices: [{ message: { content: "A great title" } }],
};

const SAMPLE_EVAL_SET_ID = "existing-evalset-ref-123";

const validBody = {
  run_id: "1001",
  step_id: "llm_generate_title",
  requirement: "Never return an empty response",
  reason: "title step occasionally emits empty string",
  inputs: sampleInputs,
  outputs: sampleOutputs,
  evalSetId: SAMPLE_EVAL_SET_ID,
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

// ── Helper: setup node mocks for happy path ───────────────────────────────────

function setupNodeMocks() {
  // addNode: EvalRequirement, EvalTrigger (no EvalSet creation — provided by client)
  vi.mocked(nodesService.addNode)
    .mockResolvedValueOnce({ success: true, ref_id: "req-ref-1" })
    .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-1" });

  vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });
}

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

      const body = { run_id: "1001", step_id: "llm_step", inputs: sampleInputs, evalSetId: SAMPLE_EVAL_SET_ID };
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

      const body = { requirement: "   ", run_id: "1001", inputs: sampleInputs, evalSetId: SAMPLE_EVAL_SET_ID };
      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 400 when evalSetId is missing", async () => {
      const { user, workspace } = await createTestFixtures();

      const body = {
        run_id: "1001",
        step_id: "llm_step",
        requirement: "Never return an empty response",
        inputs: sampleInputs,
        // evalSetId intentionally omitted
      };
      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/evalSetId/i);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });

    test("returns 400 when evalSetId is empty string", async () => {
      const { user, workspace } = await createTestFixtures();

      const body = { ...validBody, evalSetId: "   " };
      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("Happy path", () => {
    test("200 happy path: addNode called 2×, addEdge called exactly 2× (no EVALUATED edge)", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.requirementRef).toBe("req-ref-1");
      expect(data.data.triggerRef).toBe("trigger-ref-1");
      expect(data.data.evalSetRef).toBe(SAMPLE_EVAL_SET_ID);

      // Only 2 addNode calls: EvalRequirement + EvalTrigger (no EvalSet creation)
      expect(nodesService.addNode).toHaveBeenCalledTimes(2);
      // Exactly 2 addEdge calls: HAS_REQUIREMENT + HAS_TRIGGER — no EVALUATED
      expect(nodesService.addEdge).toHaveBeenCalledTimes(2);

      const edgeTypes = vi.mocked(nodesService.addEdge).mock.calls.map((c) => c[1].edge.edge_type);
      expect(edgeTypes).toContain("HAS_REQUIREMENT");
      expect(edgeTypes).toContain("HAS_TRIGGER");
      expect(edgeTypes).not.toContain("EVALUATED");
    });

    test("HAS_REQUIREMENT edge source is the provided evalSetId (not auto-generated)", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const edgeCalls = vi.mocked(nodesService.addEdge).mock.calls;
      const hasReqEdge = edgeCalls.find((c) => c[1].edge.edge_type === "HAS_REQUIREMENT");
      expect(hasReqEdge).toBeDefined();
      expect(hasReqEdge![1].source.ref_id).toBe(SAMPLE_EVAL_SET_ID);
    });

    test("no EVALUATED edge is created even when run_id is provided", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const edgeTypes = vi.mocked(nodesService.addEdge).mock.calls.map((c) => c[1].edge.edge_type);
      expect(edgeTypes).not.toContain("EVALUATED");
    });

    test("EvalTrigger body has no model or provider fields", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger"
      );
      expect(triggerCall).toBeDefined();

      const bodyParsed = JSON.parse(triggerCall![1].node_data.body);
      expect(bodyParsed.model).toBeUndefined();
      expect(bodyParsed.provider).toBeUndefined();
    });

    test("(a) EvalTrigger stores prompt_snapshot and output_snapshot from posted inputs/outputs", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger"
      );
      expect(triggerCall).toBeDefined();

      const bodyParsed = JSON.parse(triggerCall![1].node_data.body);
      expect(bodyParsed.prompt_snapshot).toBe(JSON.stringify(sampleInputs));
      expect(bodyParsed.output_snapshot).toBe(JSON.stringify(sampleOutputs));
      expect(bodyParsed.tool_call_trace).toBeNull();
      expect(bodyParsed.feedback_note).toBe("title step occasionally emits empty string");
    });

    test("(b) capture with null inputs/outputs stores \"null\" strings gracefully", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const body = {
        run_id: "1001",
        step_id: "llm_generate_title",
        requirement: "Never return an empty response",
        inputs: null,
        outputs: null,
        evalSetId: SAMPLE_EVAL_SET_ID,
      };

      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger"
      );
      expect(triggerCall).toBeDefined();

      const bodyParsed = JSON.parse(triggerCall![1].node_data.body);
      expect(bodyParsed.prompt_snapshot).toBe("null");
      expect(bodyParsed.output_snapshot).toBe("null");
      expect(bodyParsed.model).toBeUndefined();
    });

    test("no outbound fetch to STAKWORK_BASE_URL/projects/... is made", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const fetchUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      const stakworkCalls = fetchUrls.filter((url) =>
        url.includes("stakwork.com") && url.includes("/projects/"),
      );
      expect(stakworkCalls).toHaveLength(0);
    });

    test("no outbound fetch at all (no run node lookup)", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("EvalRequirement node_data has correct name", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const reqCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalRequirement"
      );
      expect(reqCall).toBeDefined();
      expect(reqCall![1].node_data.name).toBe("Never return an empty response");
    });

    test("dupes allowed: second capture creates new requirement (not deduplicated)", async () => {
      const { user, workspace } = await createTestFixtures();

      // First capture
      setupNodeMocks();
      const request1 = makeRequest(workspace.slug, "42", validBody, user);
      const response1 = await POST(request1, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });
      expect(response1.status).toBe(200);

      // Second capture — same evalSetId provided, new nodes created
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
      expect(data2.data.requirementRef).toBe("req-ref-2");
      expect(data2.data.triggerRef).toBe("trigger-ref-2");
    });
  });
});
