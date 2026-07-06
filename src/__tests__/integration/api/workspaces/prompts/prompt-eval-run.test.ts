import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET as runEvalsGet, POST as runEvalsPost } from "@/app/api/workspaces/[slug]/prompts/[promptId]/versions/[versionId]/run-evals/route";
import { getBaseUrl } from "@/lib/utils";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a Prompt + PromptVersion and return their cuid string ids. */
async function createTestPromptVersion(opts: { name?: string } = {}) {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prompt = await db.prompt.create({
    data: {
      name: `TEST_PROMPT_${uniqueSuffix.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
      value: "test prompt value",
    },
  });
  const version = await db.promptVersion.create({
    data: {
      promptId: prompt.id,
      versionNumber: 1,
      value: "test version value",
    },
  });
  return { promptId: prompt.id, versionId: version.id };
}

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
      const { promptId, versionId } = await createTestPromptVersion();

      const unauthRequest = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
      );
      const response = await runEvalsPost(unauthRequest as any, makeParams(workspace.slug, promptId, versionId));
      await expectUnauthorized(response);
    });

    test("returns 404 when versionId does not belong to promptId", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      // Create two prompts with their own versions — use versionId from one under the other's promptId
      const { promptId: promptIdA } = await createTestPromptVersion();
      const { versionId: versionIdB } = await createTestPromptVersion();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptIdA}/versions/${versionIdB}/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, promptIdA, versionIdB));
      expect(response.status).toBe(404);
    });

    test("returns 404 when versionId does not exist at all", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      const { promptId } = await createTestPromptVersion();
      const nonExistentVersionId = "cuid-does-not-exist-123456";

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${nonExistentVersionId}/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, promptId, nonExistentVersionId));
      expect(response.status).toBe(404);
    });

    test("returns 400 when evalSetId is missing", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      const { promptId, versionId } = await createTestPromptVersion();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
        { promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, promptId, versionId));
      await expectError(response, "evalSetId and promptName are required", 400);
    });

    test("returns 400 when promptName is missing", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      const { promptId, versionId } = await createTestPromptVersion();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
        { evalSetId: "eval-set-abc" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, promptId, versionId));
      await expectError(response, "evalSetId and promptName are required", 400);
    });

    test("returns 400 when STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID is not set", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      // env var intentionally not set
      const { promptId, versionId } = await createTestPromptVersion();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, promptId, versionId));
      await expectError(response, "STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID", 400);
    });

    test("creates StakworkRun with cuid string versionId and returns success when Stakwork responds 200", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      process.env.STAKWORK_EVAL_SET_RUNNER_WORKFLOW_ID = "999";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { project_id: 12345 } }),
      } as any);

      const { promptId, versionId } = await createTestPromptVersion();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, promptId, versionId));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.runId).toBeTruthy();
      expect(data.projectId).toBe(12345);

      // Verify DB record was created with the cuid string (not a number)
      const run = await db.stakworkRun.findUnique({ where: { id: data.runId } });
      expect(run).not.toBeNull();
      expect(run?.type).toBe("PROMPT_EVAL");
      expect(run?.promptVersionId).toBe(versionId); // cuid string
      expect(run?.evalSetId).toBe("eval-set-abc");
      expect(run?.workspaceId).toBe(workspace.id);

      // Verify Stakwork payload uses cuid string versionId
      const fetchCallArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const fetchBody = JSON.parse(fetchCallArgs[1].body as string);
      const vars = fetchBody.workflow_params.set_var.attributes.vars;

      // prompt_overrides: must include prompt_id, prompt_version_id, name — no resolution field
      const override = vars.prompt_overrides[0];
      expect(override.prompt_version_id).toBe(versionId); // cuid string
      expect(override.prompt_id).toBe(promptId); // cuid string from route param
      expect(override.name).toBe("my-prompt");
      expect(override.resolution).toBeUndefined();

      // callback context vars
      expect(vars.sourceHiveUrl).toBe(getBaseUrl());
      expect(vars.tokenReference).toBe(getStakworkTokenReference());

      // webhookUrl/webhook_url must still derive from NEXTAUTH_URL || request host (not getBaseUrl)
      expect(vars.webhookUrl).toContain(`/api/webhook/stakwork/response?type=PROMPT_EVAL&workspace_id=${workspace.id}`);
      expect(fetchBody.webhook_url).toContain("/api/stakwork/webhook?run_id=");
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

      const { promptId, versionId } = await createTestPromptVersion();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
        { evalSetId: "eval-set-abc", promptName: "my-prompt" },
      );

      const response = await runEvalsPost(request, makeParams(workspace.slug, promptId, versionId));
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
      const { promptId, versionId } = await createTestPromptVersion();

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
      );
      const response = await runEvalsGet(request, makeParams(workspace.slug, promptId, versionId));
      await expectUnauthorized(response);
    });

    test("returns 404 when versionId does not belong to promptId", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      const { promptId: promptIdA } = await createTestPromptVersion();
      const { versionId: versionIdB } = await createTestPromptVersion();

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptIdA}/versions/${versionIdB}/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, promptIdA, versionIdB));
      expect(response.status).toBe(404);
    });

    test("returns 404 when versionId does not exist at all", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      const { promptId } = await createTestPromptVersion();
      const nonExistentVersionId = "cuid-does-not-exist-999999";

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${nonExistentVersionId}/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, promptId, nonExistentVersionId));
      expect(response.status).toBe(404);
    });

    test("returns 200 with data: null when no run exists for a valid version", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      const { promptId, versionId } = await createTestPromptVersion();

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, promptId, versionId));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeNull();
    });

    test("returns history array with all runs ordered by createdAt desc", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      const { promptId, versionId } = await createTestPromptVersion();

      // Create two runs for the same cuid versionId — older first
      const older = await db.stakworkRun.create({
        data: {
          type: "PROMPT_EVAL",
          workspaceId: workspace.id,
          promptVersionId: versionId,
          evalSetId: "eval-set-older",
          status: "COMPLETED",
          result: JSON.stringify({ pass: 3, fail: 2, total: 5 }),
          webhookUrl: "https://example.com/webhook",
        },
      });

      // Small delay so createdAt timestamps differ
      await new Promise((r) => setTimeout(r, 5));

      const newer = await db.stakworkRun.create({
        data: {
          type: "PROMPT_EVAL",
          workspaceId: workspace.id,
          promptVersionId: versionId,
          evalSetId: "eval-set-newer",
          status: "IN_PROGRESS",
          result: null,
          webhookUrl: "https://example.com/webhook2",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, promptId, versionId));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // data.data should be the most recent run (backward-compat)
      expect(data.data).not.toBeNull();
      expect(data.data.id).toBe(newer.id);

      // history should contain both runs, newest first
      expect(Array.isArray(data.history)).toBe(true);
      expect(data.history).toHaveLength(2);
      expect(data.history[0].id).toBe(newer.id);
      expect(data.history[1].id).toBe(older.id);
    });

    test("returns the latest PROMPT_EVAL run for the correct cuid versionId", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      const { promptId, versionId } = await createTestPromptVersion();

      // Create a PROMPT_EVAL run in DB directly using cuid versionId
      const run = await db.stakworkRun.create({
        data: {
          type: "PROMPT_EVAL",
          workspaceId: workspace.id,
          promptVersionId: versionId,
          evalSetId: "eval-set-xyz",
          status: "COMPLETED",
          result: JSON.stringify({ pass: 5, fail: 1, total: 6 }),
          webhookUrl: "https://example.com/webhook",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, promptId, versionId));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).not.toBeNull();
      expect(data.data.id).toBe(run.id);
      expect(data.data.promptVersionId).toBe(versionId); // cuid string
      expect(data.data.evalSetId).toBe("eval-set-xyz");
      expect(data.data.status).toBe("COMPLETED");
    });

    test("does not return runs for a different versionId in the same workspace", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
      await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-key", swarmUrl: "https://test.swarm.url" });

      const { promptId, versionId } = await createTestPromptVersion();
      const { versionId: otherVersionId } = await createTestPromptVersion();

      // Create a run for a different version
      await db.stakworkRun.create({
        data: {
          type: "PROMPT_EVAL",
          workspaceId: workspace.id,
          promptVersionId: otherVersionId,
          evalSetId: "eval-set-other",
          status: "COMPLETED",
          result: JSON.stringify({ pass: 5, fail: 0, total: 5 }),
          webhookUrl: "https://example.com/webhook",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/prompts/${promptId}/versions/${versionId}/run-evals`,
        owner,
      );

      const response = await runEvalsGet(request, makeParams(workspace.slug, promptId, versionId));
      expect(response.status).toBe(200);
      const data = await response.json();
      // The queried version has no runs — should return null, not the other version's run
      expect(data.data).toBeNull();
      expect(data.history).toHaveLength(0);
    });
  });
});
