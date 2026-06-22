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
 * - prompts is an array of JSON strings (not a single big string, not a raw object array)
 * - agent is always a string even when step_id is sent as a number
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
    });
  });

  describe("Happy path", () => {
    test("returns 200 and calls addNode twice (EvalRequirement + EvalTrigger)", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);
      expect(nodesService.addNode).toHaveBeenCalledTimes(2);

      const nodeTypes = vi.mocked(nodesService.addNode).mock.calls.map((c) => c[1].node_type);
      expect(nodeTypes).toContain("EvalRequirement");
      expect(nodeTypes).toContain("EvalTrigger");
    });

    test("calls addEdge exactly twice (HAS_REQUIREMENT + HAS_TRIGGER)", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

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

    /**
     * prompts fix: each entry must be individually JSON-stringified.
     * The downstream Python API expects an array of strings, NOT one big JSON blob.
     * Wrong (old): prompts = '[{"name":"TITLE_PROMPT",...}]'          ← single string
     * Right (new): prompts = ['{"name":"TITLE_PROMPT",...}', ...]     ← array of strings
     */
    test("EvalTrigger node_data.prompts is an array of JSON strings (not a plain string, not a raw object array)", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const samplePrompts = [
        { name: "TITLE_PROMPT", prompt_id: 7, prompt_version_id: 42 },
        { name: "SYSTEM_PROMPT", prompt_id: 8, prompt_version_id: 5 },
      ];

      const request = makeRequest(workspace.slug, "42", { ...validBody, prompts: samplePrompts }, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger",
      );
      expect(triggerCall).toBeDefined();

      const { prompts } = triggerCall![1].node_data;

      // Must be an array, not a plain string
      expect(Array.isArray(prompts)).toBe(true);
      expect(typeof prompts).not.toBe("string");

      // Every element must be a JSON string (parseable, not a raw object)
      (prompts as string[]).forEach((entry) => {
        expect(typeof entry).toBe("string");
        expect(() => JSON.parse(entry)).not.toThrow();
        expect(typeof JSON.parse(entry)).toBe("object");
      });

      // Parsed values must round-trip back to the original objects
      const parsed = (prompts as string[]).map((s) => JSON.parse(s));
      expect(parsed).toEqual(samplePrompts);
    });

    test("EvalTrigger node_data.prompts with a single entry is still an array of strings", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const singlePrompt = [{ name: "TITLE_PROMPT", prompt_id: 7, prompt_version_id: 42 }];

      const request = makeRequest(workspace.slug, "42", { ...validBody, prompts: singlePrompt }, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger",
      );
      expect(triggerCall).toBeDefined();

      const { prompts } = triggerCall![1].node_data;
      expect(Array.isArray(prompts)).toBe(true);
      expect((prompts as string[]).length).toBe(1);
      expect(typeof (prompts as string[])[0]).toBe("string");
      expect(JSON.parse((prompts as string[])[0])).toEqual(singlePrompt[0]);
    });

    /**
     * agent fix: step_id may arrive as a number from the client (e.g. step_id: 42).
     * The downstream Python API declares `agent` as a string and rejects integers with:
     *   "expected type string for: agent, got <class 'int'>"
     * The route must always coerce step_id to a string via String().
     */
    test("EvalTrigger agent is always a string even when step_id is sent as a number", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      // Send a numeric step_id to simulate the scenario that caused the log error
      const body = { ...validBody, step_id: 42 };
      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger",
      );
      expect(triggerCall).toBeDefined();

      const { agent } = triggerCall![1].node_data;
      // Must be "42" (string), never 42 (number)
      expect(typeof agent).toBe("string");
      expect(agent).toBe("42");
    });

    test("EvalTrigger agent falls back to 'unknown_step' string when step_id is omitted", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      const { step_id: _omitted, ...bodyWithoutStepId } = validBody;
      const request = makeRequest(workspace.slug, "42", bodyWithoutStepId, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger",
      );
      expect(triggerCall).toBeDefined();
      expect(typeof triggerCall![1].node_data.agent).toBe("string");
      expect(triggerCall![1].node_data.agent).toBe("unknown_step");
    });

    test("EvalTrigger node_data omits prompts key when prompts is absent", async () => {
      const { user, workspace } = await createTestFixtures();
      setupNodeMocks();

      // validBody has no prompts field
      const request = makeRequest(workspace.slug, "42", validBody, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        (c) => c[1].node_type === "EvalTrigger",
      );
      expect(triggerCall).toBeDefined();
      expect(triggerCall![1].node_data).not.toHaveProperty("prompts");
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

  describe("Attach to existing requirement (requirementId)", () => {
    test("(b) requirementId only — skips EvalRequirement creation, only creates EvalTrigger", async () => {
      const { user, workspace } = await createTestFixtures();

      // IDOR check fetch returns valid EvalRequirement
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ node_type: "EvalRequirement", ref_id: "existing-req-ref" }),
      } as Response);

      // addNode only called once for EvalTrigger
      vi.mocked(nodesService.addNode).mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-1" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });

      const body = {
        run_id: "1001",
        step_id: "llm_step",
        requirementId: "existing-req-ref",
        reason: "test",
        inputs: sampleInputs,
        outputs: sampleOutputs,
        evalSetId: SAMPLE_EVAL_SET_ID,
      };

      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(200);

      // Only EvalTrigger created, no EvalRequirement
      expect(nodesService.addNode).toHaveBeenCalledTimes(1);
      const nodeType = vi.mocked(nodesService.addNode).mock.calls[0][1].node_type;
      expect(nodeType).toBe("EvalTrigger");

      // Only HAS_TRIGGER edge, no HAS_REQUIREMENT
      expect(nodesService.addEdge).toHaveBeenCalledTimes(1);
      const edgeType = vi.mocked(nodesService.addEdge).mock.calls[0][1].edge.edge_type;
      expect(edgeType).toBe("HAS_TRIGGER");

      // requirementRef is the provided requirementId
      const data = await response.json();
      expect(data.data.requirementRef).toBe("existing-req-ref");
    });

    test("(c) neither requirement nor requirementId → 400", async () => {
      const { user, workspace } = await createTestFixtures();

      const body = {
        run_id: "1001",
        step_id: "llm_step",
        // neither requirement nor requirementId
        inputs: sampleInputs,
        evalSetId: SAMPLE_EVAL_SET_ID,
      };

      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/requirement/i);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });

    test("(d) requirementId pointing to non-existent node → 403", async () => {
      const { user, workspace } = await createTestFixtures();

      // IDOR check returns 404
      mockFetch.mockResolvedValueOnce({ ok: false } as Response);

      const body = {
        run_id: "1001",
        step_id: "llm_step",
        requirementId: "non-existent-req-ref",
        inputs: sampleInputs,
        evalSetId: SAMPLE_EVAL_SET_ID,
      };

      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(403);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });

    test("(d) requirementId pointing to a wrong node type → 403", async () => {
      const { user, workspace } = await createTestFixtures();

      // Node exists but is wrong type (e.g., EvalSet)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ node_type: "EvalSet", ref_id: "some-evalset-ref" }),
      } as Response);

      const body = {
        run_id: "1001",
        step_id: "llm_step",
        requirementId: "some-evalset-ref",
        inputs: sampleInputs,
        evalSetId: SAMPLE_EVAL_SET_ID,
      };

      const request = makeRequest(workspace.slug, "42", body, user);
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      expect(response.status).toBe(403);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });

    test("HAS_TRIGGER edge source is the provided requirementId when attaching", async () => {
      const { user, workspace } = await createTestFixtures();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ node_type: "EvalRequirement", ref_id: "existing-req-ref" }),
      } as Response);

      vi.mocked(nodesService.addNode).mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-1" });
      vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });

      const body = {
        run_id: "1001",
        step_id: "llm_step",
        requirementId: "existing-req-ref",
        inputs: sampleInputs,
        evalSetId: SAMPLE_EVAL_SET_ID,
      };

      const request = makeRequest(workspace.slug, "42", body, user);
      await POST(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42" }),
      });

      const edgeCalls = vi.mocked(nodesService.addEdge).mock.calls;
      expect(edgeCalls).toHaveLength(1);
      expect(edgeCalls[0][1].edge.edge_type).toBe("HAS_TRIGGER");
      expect(edgeCalls[0][1].source.ref_id).toBe("existing-req-ref");
    });
  });
});
