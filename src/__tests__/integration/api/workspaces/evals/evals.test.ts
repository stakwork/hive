import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET as getEvalSets, POST as createEvalSet } from "@/app/api/workspaces/[slug]/evals/route";
import { PUT as updateEvalSet, DELETE as deleteEvalSet } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/route";
import { GET as getRequirements, POST as createRequirement } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/route";
import { PUT as updateRequirement, DELETE as deleteRequirement } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/route";
import { POST as linkRuns } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/runs/route";
import { GET as getSessions } from "@/app/api/workspaces/[slug]/evals/sessions/route";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
} from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPutRequest,
  createAuthenticatedDeleteRequest,
  createGetRequest,
  createPostRequest,
  createDeleteRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  expectSuccess,
  expectForbidden,
  expectNotFound,
  expectUnauthorized,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";
import * as nodesService from "@/services/swarm/api/nodes";

// Mock the Jarvis nodes service and fetch
vi.mock("@/services/swarm/api/nodes");

describe("Evals API — Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure mock mode is off so tests hit real code paths and validation
    process.env.USE_MOCKS = "false";
  });

  // ---------------------------------------------------------------------------
  // GET /api/workspaces/[slug]/evals
  // ---------------------------------------------------------------------------
  describe("GET /api/workspaces/[slug]/evals", () => {
    describe("Success", () => {
      test("returns eval sets for workspace owner", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const mockNodes = [
          { ref_id: "eval-1", node_type: "EvalSet", properties: { name: "Suite A" } },
        ];

        // Mock the Jarvis fetch inside the route
        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: mockNodes, total: 1 }),
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
        );

        const response = await getEvalSets(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.nodes).toHaveLength(1);
        expect(data.data.total).toBe(1);
      });

      test("returns eval sets for workspace member", async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: member.id, role: "DEVELOPER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: [], total: 0 }),
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          member,
        );

        const response = await getEvalSets(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.nodes).toEqual([]);
      });
    });

    describe("Auth failures", () => {
      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        const request = createGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
        );

        const response = await getEvalSets(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectUnauthorized(response);
      });

      test("rejects non-member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          nonMember,
        );

        const response = await getEvalSets(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectForbidden(response, "Access denied");
      });

      test("returns 404 for non-existent workspace", async () => {
        const user = await createTestUser();

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/no-such-workspace/evals`,
          user,
        );

        const response = await getEvalSets(request, {
          params: Promise.resolve({ slug: "no-such-workspace" }),
        });

        await expectNotFound(response, "Workspace not found");
      });
    });

    describe("Swarm not configured", () => {
      test("returns 400 when workspace has no swarm", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        // No swarm created

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
        );

        const response = await getEvalSets(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Swarm not configured", 400);
      });
    });

    describe("Upstream failure", () => {
      test("returns 502 when Jarvis returns non-ok", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 503,
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
        );

        const response = await getEvalSets(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/workspaces/[slug]/evals
  // ---------------------------------------------------------------------------
  describe("POST /api/workspaces/[slug]/evals", () => {
    describe("Success", () => {
      test("creates eval set and returns ref_id", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addNode).mockResolvedValueOnce({
          success: true,
          ref_id: "new-eval-ref-id",
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
          { name: "My Eval Set", description: "A description" },
        );

        const response = await createEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.ref_id).toBe("new-eval-ref-id");

        expect(nodesService.addNode).toHaveBeenCalledWith(
          expect.objectContaining({ apiKey: expect.any(String) }),
          { node_type: "EvalSet", node_data: { id: expect.any(String), name: "My Eval Set", description: "A description" } },
        );
      });
    });

    describe("Validation failures", () => {
      test("rejects missing name", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
          { description: "No name" },
        );

        const response = await createEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "name is required", 400);
        expect(nodesService.addNode).not.toHaveBeenCalled();
      });

      test("rejects empty string name", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
          { name: "   " },
        );

        const response = await createEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "name is required", 400);
      });
    });

    describe("Auth failures", () => {
      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          { name: "Test" },
        );

        const response = await createEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectUnauthorized(response);
      });

      test("rejects non-member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          nonMember,
          { name: "Test" },
        );

        const response = await createEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectForbidden(response, "Access denied");
        expect(nodesService.addNode).not.toHaveBeenCalled();
      });
    });

    describe("Swarm not configured", () => {
      test("returns 400 when workspace has no swarm", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
          { name: "Test" },
        );

        const response = await createEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Swarm not configured", 400);
        expect(nodesService.addNode).not.toHaveBeenCalled();
      });
    });

    describe("Service failures", () => {
      test("returns 502 when addNode fails", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addNode).mockResolvedValueOnce({
          success: false,
          error: "Jarvis unavailable",
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals`,
          owner,
          { name: "Test" },
        );

        const response = await createEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/workspaces/[slug]/evals/[evalSetId]/requirements
  // ---------------------------------------------------------------------------
  describe("GET /api/workspaces/[slug]/evals/[evalSetId]/requirements", () => {
    describe("Success", () => {
      test("returns requirements with order merged from edges", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const mockNodes = [
          { ref_id: "req-1", node_type: "EvalRequirement", properties: { name: "Req A" } },
          { ref_id: "req-2", node_type: "EvalRequirement", properties: { name: "Req B" } },
        ];
        const mockEdges = [
          { target_ref_id: "req-1", properties: { order: 0 } },
          { target_ref_id: "req-2", properties: { order: 1 } },
        ];

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: mockNodes, edges: mockEdges }),
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-set-1/requirements`,
          owner,
        );

        const response = await getRequirements(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-set-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.nodes).toHaveLength(2);
        expect(data.data.total).toBe(2);
        expect(data.data.nodes[0].properties.order).toBe(0);
        expect(data.data.nodes[1].properties.order).toBe(1);
      });

      test("returns empty array when eval set has no requirements", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: [], edges: [] }),
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-set-empty/requirements`,
          owner,
        );

        const response = await getRequirements(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-set-empty" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.nodes).toEqual([]);
        expect(data.data.total).toBe(0);
      });

      test("calls Jarvis with correct URL including Python list literal params", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const fetchMock = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: [], edges: [] }),
        } as any);
        global.fetch = fetchMock;

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/my-eval-set/requirements`,
          owner,
        );

        await getRequirements(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "my-eval-set" }),
        });

        const calledUrl: string = fetchMock.mock.calls[0][0];
        expect(calledUrl).toContain("/v2/nodes/my-eval-set");
        expect(calledUrl).toContain("expand=edges");
        expect(calledUrl).toContain(encodeURIComponent("['HAS_REQUIREMENT']"));
        expect(calledUrl).toContain(encodeURIComponent("['EvalRequirement']"));
        expect(calledUrl).toContain("depth=1");
      });
    });

    describe("Auth failures", () => {
      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        const request = createGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-set-1/requirements`,
        );

        const response = await getRequirements(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-set-1" }),
        });

        await expectUnauthorized(response);
      });

      test("rejects non-member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-set-1/requirements`,
          nonMember,
        );

        const response = await getRequirements(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-set-1" }),
        });

        await expectForbidden(response, "Access denied");
      });
    });

    describe("Swarm not configured", () => {
      test("returns 400 when workspace has no swarm", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-set-1/requirements`,
          owner,
        );

        const response = await getRequirements(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-set-1" }),
        });

        await expectError(response, "Swarm not configured", 400);
      });
    });

    describe("Upstream failure", () => {
      test("returns 502 when Jarvis returns non-ok", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => "Service Unavailable",
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-set-1/requirements`,
          owner,
        );

        const response = await getRequirements(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-set-1" }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/workspaces/[slug]/evals/[evalSetId]/requirements
  // ---------------------------------------------------------------------------
  describe("POST /api/workspaces/[slug]/evals/[evalSetId]/requirements", () => {
    const validBody = {
      name: "Req 1",
      description: "desc",
      prompt_snippet: "When the agent is asked to...",
      positive_cases: ["The agent responds correctly"],
      negative_cases: ["The agent ignores the instruction"],
    };

    describe("Success", () => {
      test("creates requirement and links to eval set", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addNode).mockResolvedValueOnce({ success: true, ref_id: "req-ref-1" });
        vi.mocked(nodesService.addEdge).mockResolvedValueOnce({ success: true });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-set-1/requirements`,
          owner,
          validBody,
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-set-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.ref_id).toBe("req-ref-1");

        expect(nodesService.addNode).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            node_type: "EvalRequirement",
            node_data: expect.objectContaining({
              name: "Req 1",
              prompt_snippet: validBody.prompt_snippet,
              positive_cases: validBody.positive_cases,
              negative_cases: validBody.negative_cases,
            }),
          }),
        );

        expect(nodesService.addEdge).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            edge: expect.objectContaining({ edge_type: "HAS_REQUIREMENT" }),
            source: { ref_id: "eval-set-1" },
            target: { ref_id: "req-ref-1" },
          }),
        );
      });

      test("uses provided order in edge_data", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addNode).mockResolvedValueOnce({ success: true, ref_id: "req-2" });
        vi.mocked(nodesService.addEdge).mockResolvedValueOnce({ success: true });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          { ...validBody, order: 3 },
        );

        await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        expect(nodesService.addEdge).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            edge: expect.objectContaining({ edge_data: { order: 3 } }),
          }),
        );
      });
    });

    describe("Validation failures", () => {
      test("rejects missing name", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const { name: _, ...bodyWithoutName } = validBody;

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          bodyWithoutName,
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        await expectError(response, "name is required", 400);
        expect(nodesService.addNode).not.toHaveBeenCalled();
      });

      test("rejects missing prompt_snippet", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const { prompt_snippet: _, ...bodyWithoutSnippet } = validBody;

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          bodyWithoutSnippet,
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        await expectError(response, "prompt_snippet is required", 400);
        expect(nodesService.addNode).not.toHaveBeenCalled();
      });

      test("rejects empty positive_cases array", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          { ...validBody, positive_cases: [] },
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        await expectError(response, "positive_cases must be a non-empty array", 400);
        expect(nodesService.addNode).not.toHaveBeenCalled();
      });

      test("rejects empty negative_cases array", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          { ...validBody, negative_cases: [] },
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        await expectError(response, "negative_cases must be a non-empty array", 400);
        expect(nodesService.addNode).not.toHaveBeenCalled();
      });
    });

    describe("Auth failures", () => {
      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          validBody,
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Swarm not configured", () => {
      test("returns 400 when workspace has no swarm", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          validBody,
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        await expectError(response, "Swarm not configured", 400);
      });
    });

    describe("Service failures", () => {
      test("returns 502 when addNode fails", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addNode).mockResolvedValueOnce({ success: false, error: "Node error" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          validBody,
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        expect(response.status).toBe(502);
        expect(nodesService.addEdge).not.toHaveBeenCalled();
      });

      test("returns 502 when addEdge fails", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addNode).mockResolvedValueOnce({ success: true, ref_id: "req-1" });
        vi.mocked(nodesService.addEdge).mockResolvedValueOnce({ success: false, error: "Edge error" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements`,
          owner,
          validBody,
        );

        const response = await createRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1" }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/runs
  // ---------------------------------------------------------------------------
  describe("POST /api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/runs", () => {
    describe("Success", () => {
      test("links sessions to requirement", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addEdge)
          .mockResolvedValueOnce({ success: true })
          .mockResolvedValueOnce({ success: true });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1/runs`,
          owner,
          { session_ids: ["session-1", "session-2"] },
        );

        const response = await linkRuns(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.linked).toBe(2);

        expect(nodesService.addEdge).toHaveBeenCalledTimes(2);
        expect(nodesService.addEdge).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            edge: { edge_type: "EVAL_RUN" },
            source: { ref_id: "req-1" },
            target: { ref_id: "session-1" },
          }),
        );
        expect(nodesService.addEdge).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            edge: { edge_type: "EVAL_RUN" },
            source: { ref_id: "req-1" },
            target: { ref_id: "session-2" },
          }),
        );
      });
    });

    describe("Validation failures", () => {
      test("rejects empty session_ids array", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1/runs`,
          owner,
          { session_ids: [] },
        );

        const response = await linkRuns(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "session_ids must be a non-empty array", 400);
        expect(nodesService.addEdge).not.toHaveBeenCalled();
      });

      test("rejects missing session_ids", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1/runs`,
          owner,
          {},
        );

        const response = await linkRuns(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "session_ids must be a non-empty array", 400);
      });
    });

    describe("Auth failures", () => {
      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1/runs`,
          { session_ids: ["s-1"] },
        );

        const response = await linkRuns(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Swarm not configured", () => {
      test("returns 400 when workspace has no swarm", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1/runs`,
          owner,
          { session_ids: ["s-1"] },
        );

        const response = await linkRuns(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "Swarm not configured", 400);
      });
    });

    describe("Service failures", () => {
      test("returns 502 when any addEdge fails", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.addEdge)
          .mockResolvedValueOnce({ success: true })
          .mockResolvedValueOnce({ success: false, error: "Edge failed" });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1/runs`,
          owner,
          { session_ids: ["s-1", "s-2"] },
        );

        const response = await linkRuns(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/workspaces/[slug]/evals/sessions
  // ---------------------------------------------------------------------------
  describe("GET /api/workspaces/[slug]/evals/sessions", () => {
    describe("Success", () => {
      test("returns agent session nodes", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const mockSessions = [
          { ref_id: "s-1", node_type: "AgentSession", properties: { name: "Session 1" } },
        ];

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nodes: mockSessions, total: 1 }),
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/sessions`,
          owner,
        );

        const response = await getSessions(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.nodes).toHaveLength(1);
        expect(data.data.total).toBe(1);
      });
    });

    describe("Auth failures", () => {
      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        const request = createGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/sessions`,
        );

        const response = await getSessions(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectUnauthorized(response);
      });

      test("rejects non-member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/sessions`,
          nonMember,
        );

        const response = await getSessions(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectForbidden(response, "Access denied");
      });
    });

    describe("Swarm not configured", () => {
      test("returns 400 when workspace has no swarm", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/sessions`,
          owner,
        );

        const response = await getSessions(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Swarm not configured", 400);
      });
    });

    describe("Upstream failure", () => {
      test("returns 502 when Jarvis returns non-ok", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 503,
        } as any);

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/sessions`,
          owner,
        );

        const response = await getSessions(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/workspaces/[slug]/evals/[evalSetId]
  // ---------------------------------------------------------------------------
  describe("PUT /api/workspaces/[slug]/evals/[evalSetId]", () => {
    describe("Success", () => {
      test("updates eval set with valid name and description", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.updateNode).mockResolvedValueOnce({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          owner,
          { name: "Updated Name", description: "Updated desc" },
        );

        const response = await updateEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(nodesService.updateNode).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            ref_id: "eval-1",
            node_type: "EvalSet",
            node_data: expect.objectContaining({ name: "Updated Name" }),
          }),
        );
      });
    });

    describe("Validation", () => {
      test("returns 400 when name is missing", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          owner,
          { description: "No name provided" },
        );

        const response = await updateEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        await expectError(response, "name is required", 400);
      });

      test("returns 400 when name is empty string", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          owner,
          { name: "   " },
        );

        const response = await updateEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        await expectError(response, "name is required", 400);
      });
    });

    describe("Auth failures", () => {
      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          owner,
          { name: "Test" },
        );
        // Simulate unauthenticated by creating a plain PUT
        const unauthRequest = createDeleteRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
        );
        // Use a user not in the workspace
        const nonMember = await createTestUser();
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const authRequest = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          nonMember,
          { name: "Test" },
        );

        const response = await updateEvalSet(authRequest, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        await expectForbidden(response, "Access denied");
      });
    });

    describe("Service failures", () => {
      test("returns 502 when updateNode fails", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.updateNode).mockResolvedValueOnce({
          success: false,
          error: "Jarvis unavailable",
        });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          owner,
          { name: "Updated" },
        );

        const response = await updateEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/workspaces/[slug]/evals/[evalSetId]
  // ---------------------------------------------------------------------------
  describe("DELETE /api/workspaces/[slug]/evals/[evalSetId]", () => {
    describe("Success", () => {
      test("deletes eval set successfully", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.deleteNode).mockResolvedValueOnce({ success: true });

        const request = createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          owner,
        );

        const response = await deleteEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(nodesService.deleteNode).toHaveBeenCalledWith(expect.any(Object), "eval-1");
      });
    });

    describe("Auth failures", () => {
      test("rejects non-member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          nonMember,
        );

        const response = await deleteEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        await expectForbidden(response, "Access denied");
      });
    });

    describe("Service failures", () => {
      test("returns 502 when deleteNode fails", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.deleteNode).mockResolvedValueOnce({
          success: false,
          error: "Delete failed",
        });

        const request = createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/eval-1`,
          owner,
        );

        const response = await deleteEvalSet(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "eval-1" }),
        });

        expect(response.status).toBe(502);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]
  // ---------------------------------------------------------------------------
  describe("PUT /api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]", () => {
    const validReqBody = {
      name: "Check output",
      description: "Verifies correct output",
      prompt_snippet: "Summarize this text",
      positive_cases: ["Good summary"],
      negative_cases: ["Bad summary"],
    };

    describe("Success", () => {
      test("updates requirement with valid fields", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.updateNode).mockResolvedValueOnce({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          owner,
          validReqBody,
        );

        const response = await updateRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(nodesService.updateNode).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            ref_id: "req-1",
            node_type: "EvalRequirement",
            node_data: expect.objectContaining({
              name: "Check output",
              prompt_snippet: "Summarize this text",
            }),
          }),
        );
      });
    });

    describe("Validation", () => {
      test("returns 400 when name is missing", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          owner,
          { ...validReqBody, name: "" },
        );

        const response = await updateRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "name is required", 400);
      });

      test("returns 400 when prompt_snippet is missing", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          owner,
          { ...validReqBody, prompt_snippet: "" },
        );

        const response = await updateRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "prompt_snippet is required", 400);
      });

      test("returns 400 when positive_cases is empty", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          owner,
          { ...validReqBody, positive_cases: [] },
        );

        const response = await updateRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "positive_cases must be a non-empty array", 400);
      });

      test("returns 400 when negative_cases is empty", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          owner,
          { ...validReqBody, negative_cases: [] },
        );

        const response = await updateRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "negative_cases must be a non-empty array", 400);
      });
    });

    describe("Auth failures", () => {
      test("rejects non-member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          nonMember,
          validReqBody,
        );

        const response = await updateRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectForbidden(response, "Access denied");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]
  // ---------------------------------------------------------------------------
  describe("DELETE /api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]", () => {
    describe("Success", () => {
      test("deletes requirement successfully", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        vi.mocked(nodesService.deleteNode).mockResolvedValueOnce({ success: true });

        const request = createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          owner,
        );

        const response = await deleteRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(nodesService.deleteNode).toHaveBeenCalledWith(expect.any(Object), "req-1");
      });
    });

    describe("Auth failures", () => {
      test("rejects non-member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key" });

        const request = createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          nonMember,
        );

        const response = await deleteRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectForbidden(response, "Access denied");
      });
    });

    describe("Swarm not configured", () => {
      test("returns 400 when workspace has no swarm", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });

        const request = createAuthenticatedDeleteRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/evals/set-1/requirements/req-1`,
          owner,
        );

        const response = await deleteRequirement(request, {
          params: Promise.resolve({ slug: workspace.slug, evalSetId: "set-1", reqId: "req-1" }),
        });

        await expectError(response, "Swarm not configured", 400);
      });
    });
  });
});
