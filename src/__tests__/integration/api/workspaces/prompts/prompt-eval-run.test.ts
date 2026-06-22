import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET as runEvalsGet, POST as runEvalsPost } from "@/app/api/workspaces/[slug]/prompts/[promptId]/versions/[versionId]/run-evals/route";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
} from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";
import { db } from "@/lib/db";

describe("Prompt Eval Run API — Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_MOCKS = "false";
    // Clear STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID so each test can set it explicitly
    delete process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID;
  });

  const makeParams = (slug: string, promptId: string, versionId: string) => ({
    params: Promise.resolve({ slug, promptId, versionId }),
  });

  // ---------------------------------------------------------------------------
  // POST /api/workspaces/[slug]/prompts/[promptId]/versions/[versionId]/run-evals
  // ---------------------------------------------------------------------------
  describe("POST run-evals", () => {
    test("returns 401 when unauthenticated", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
      ) as any; // createGetRequest returns GET; route handler only checks auth headers

      // Use a plain GET request without auth headers to trigger 401
      const unauthRequest = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
      );
      // POST handler requires auth
      const response = await runEvalsPost(unauthRequest as any, makeParams(workspace.slug, "1", "42"));
      await expectUnauthorized(response);
    });

    test("returns 400 when evalSetId is missing", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
        owner,
        { promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, "1", "42"));
      await expectError(response, "evalSetId and promptName are required", 400);
    });

    test("returns 400 when promptName is missing", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
        owner,
        { evalSetId: "eval-set-abc" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, "1", "42"));
      await expectError(response, "evalSetId and promptName are required", 400);
    });

    test("returns 400 when STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID is not set", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      // env var intentionally not set
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, "1", "42"));
      await expectError(response, "STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID", 400);
    });

    test("creates StakworkRun and returns success when Stakwork responds 200", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { project_id: 12345 } }),
      } as any);

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, "1", "42"));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.runId).toBeTruthy();
      expect(data.projectId).toBe(12345);

      // Verify DB record was created
      const run = await db.stakworkRun.findUnique({ where: { id: data.runId } });
      expect(run).not.toBeNull();
      expect(run?.type).toBe("PROMPT_EVAL");
      expect(run?.promptVersionId).toBe(42);
      expect(run?.evalSetId).toBe("eval-set-abc");
      expect(run?.workspaceId).toBe(workspace.id);

      // Verify Stakwork payload uses webhookUrl (not resultWebhookUrl)
      const fetchCallArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const fetchBody = JSON.parse(fetchCallArgs[1].body as string);
      const vars = fetchBody.workflow_params.set_var.attributes.vars;
      expect(vars.webhookUrl).toContain(`/api/webhook/stakwork/response?type=PROMPT_EVAL&workspace_id=${workspace.id}`);
      expect(vars.resultWebhookUrl).toBeUndefined();
    });

    test("returns 502 when Stakwork returns non-OK response", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as any);

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, "1", "42"));
      expect(response.status).toBe(502);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/workspaces/[slug]/prompts/[promptId]/versions/[versionId]/run-evals
  // ---------------------------------------------------------------------------
  describe("GET run-evals", () => {
    test("returns 401 when unauthenticated", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/42/run-evals`,
      );
      const response = await runEvalsGet(request, makeParams(workspace.slug, "1", "42"));
      await expectUnauthorized(response);
    });

    test("returns 200 with data: null when no run exists", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/99/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, "1", "99"));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeNull();
    });

    test("returns the latest PROMPT_EVAL run for the correct promptVersionId", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      // Create a PROMPT_EVAL run in DB directly
      const run = await db.stakworkRun.create({
        data: {
          type: "PROMPT_EVAL",
          workspaceId: workspace.id,
          promptVersionId: 77,
          evalSetId: "eval-set-xyz",
          status: "COMPLETED",
          result: JSON.stringify({ pass: 5, fail: 1, total: 6 }),
          webhookUrl: "https://example.com/webhook",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/1/versions/77/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, "1", "77"));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).not.toBeNull();
      expect(data.data.id).toBe(run.id);
      expect(data.data.promptVersionId).toBe(77);
      expect(data.data.evalSetId).toBe("eval-set-xyz");
      expect(data.data.status).toBe("COMPLETED");
    });
  });
});
