import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST as TriggerRun } from "@/app/api/workspaces/[slug]/protect/run/route";
import { GET as GetConfig, PUT as PutConfig } from "@/app/api/workspaces/[slug]/protect/config/route";
import { GET as GetFindings } from "@/app/api/workspaces/[slug]/protect/findings/route";
import { PATCH as PatchFinding } from "@/app/api/workspaces/[slug]/protect/findings/[refId]/route";
import { POST as StartChat } from "@/app/api/workspaces/[slug]/protect/findings/[refId]/chat/route";
import { GET as GetScope, PUT as PutScope } from "@/app/api/workspaces/[slug]/protect/scope/route";
import { POST as TriggerJanitor } from "@/app/api/workspaces/[slug]/janitors/[type]/run/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { PROTECT_ERRORS } from "@/services/protect";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPutRequest,
  createAuthenticatedPatchRequest,
  createGetRequest,
  createAuthenticatedSession,
  getMockedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestLlmModel } from "@/__tests__/support/factories/llm-model.factory";
import * as findings from "@/lib/protect/findings";

const mockStakworkRequest = vi.fn().mockResolvedValue({ data: { project_id: 99 } });

vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: mockStakworkRequest,
  })),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    isSuperAdmin: () => false,
    config: {
      ...actual.config,
      STAKWORK_API_KEY: "test-key",
      STAKWORK_PROTECT_WORKFLOW_ID: "555",
      STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    },
    optionalEnvVars: {
      ...actual.optionalEnvVars,
      STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
      STAKWORK_PROTECT_WORKFLOW_ID: "555",
    },
  };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/protect/findings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/protect/findings")>(
    "@/lib/protect/findings",
  );
  return {
    ...actual,
    listProtectFindings: vi.fn(),
    getProtectFindingByRef: vi.fn(),
    updateFindingVerification: vi.fn(),
  };
});

vi.mock("@/lib/ai/capabilityGates", () => ({
  isCodeChangeCapabilityEnabledForOrg: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: vi.fn().mockResolvedValue({
    jarvisUrl: "https://jarvis.test",
    apiKey: "test-key",
  }),
}));

const originalFlag = process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenaiKey = process.env.OPENAI_API_KEY;

describe("Protect API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION = "true";
    process.env.STAKWORK_API_KEY = "test-key";
    process.env.STAKWORK_PROTECT_WORKFLOW_ID = "555";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.mocked(findings.listProtectFindings).mockResolvedValue({ ok: true, findings: [] });
    mockStakworkRequest.mockResolvedValue({ data: { project_id: 99 } });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION = originalFlag;
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    process.env.OPENAI_API_KEY = originalOpenaiKey;
  });

  async function setup(role: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER" = "OWNER") {
    const owner = await createTestUser({ withGitHubAuth: true, githubUsername: "owner-gh" });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
    await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });
    const repository = await createTestRepository({
      workspaceId: workspace.id,
      name: "hive",
      repositoryUrl: "https://github.com/acme/hive",
    });
    await db.janitorConfig.create({
      data: { workspaceId: workspace.id, securityReviewEnabled: true },
    });

    let actor = owner;
    if (role !== "OWNER") {
      actor = await createTestUser({ withGitHubAuth: true, githubUsername: `${role.toLowerCase()}-gh` });
      await createTestMembership({ workspaceId: workspace.id, userId: actor.id, role });
    }

    return { owner, actor, workspace, repository };
  }

  async function attachWorkspaceGithubApp(userId: string, workspaceId: string, token = "ghs_workspace_pat") {
    const org = await db.sourceControlOrg.create({
      data: {
        githubLogin: `org-${generateUniqueId("login")}`,
        githubInstallationId: Math.floor(Math.random() * 1_000_000_000),
        name: "Test Org",
      },
    });
    const encryptionService = EncryptionService.getInstance();
    await db.sourceControlToken.create({
      data: {
        userId,
        sourceControlOrgId: org.id,
        token: JSON.stringify(encryptionService.encryptField("source_control_token", token)),
      },
    });
    await db.workspace.update({
      where: { id: workspaceId },
      data: { sourceControlOrgId: org.id },
    });
    return org;
  }

  async function addToScope(workspaceId: string, repositoryId: string) {
    await db.protectReviewRepo.create({
      data: { workspaceId, repositoryId },
    });
  }

  test("janitor run route rejects SECURITY_REVIEW", async () => {
    const { actor, workspace } = await setup("OWNER");
    getMockedSession().mockResolvedValue(createAuthenticatedSession(actor));
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/workspaces/${workspace.slug}/janitors/SECURITY_REVIEW/run`,
      actor,
      {},
    );
    const response = await TriggerJanitor(request, {
      params: Promise.resolve({ slug: workspace.slug, type: "SECURITY_REVIEW" }),
    });
    expect(response.status).toBe(400);
  });

  test("full review requires admin, enabled flag, and rejects in-flight lock", async () => {
    const { actor, workspace } = await setup("DEVELOPER");
    const forbidden = await TriggerRun(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/run`,
        actor,
        {},
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(forbidden.status).toBe(403);

    const { actor: admin, workspace: ws, repository } = await setup("ADMIN");
    await createTestRepository({
      workspaceId: ws.id,
      name: "other",
      repositoryUrl: "https://github.com/acme/other",
    });
    await addToScope(ws.id, repository.id);
    await attachWorkspaceGithubApp(admin.id, ws.id, "ghs_admin_pat");

    const emptyOther = await setup("ADMIN");
    const emptyRes = await TriggerRun(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${emptyOther.workspace.slug}/protect/run`,
        emptyOther.actor,
        {},
      ),
      { params: Promise.resolve({ slug: emptyOther.workspace.slug }) },
    );
    expect(emptyRes.status).toBe(400);
    expect((await emptyRes.json()).error).toBe(PROTECT_ERRORS.EMPTY_SCOPE);
    expect(mockStakworkRequest).not.toHaveBeenCalled();

    const ok = await TriggerRun(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${ws.slug}/protect/run`,
        admin,
        { repositoryUrl: "https://github.com/evil/repo" },
      ),
      { params: Promise.resolve({ slug: ws.slug }) },
    );
    expect(ok.status).toBe(200);
    const created = await db.protectReviewRun.findMany({ where: { workspaceId: ws.id } });
    expect(created).toHaveLength(1);
    expect(created[0].mode).toBe("full");
    expect(created[0].repositoryUrl).toBeNull();
    const snapshot = await db.protectReviewRunRepo.findMany({ where: { runId: created[0].id } });
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].repositoryId).toBe(repository.id);
    expect(snapshot[0].canonicalUrl).toBe("acme/hive");

    const locked = await TriggerRun(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${ws.slug}/protect/run`,
        admin,
        {},
      ),
      { params: Promise.resolve({ slug: ws.slug }) },
    );
    expect(locked.status).toBe(409);

    const vars = (
      mockStakworkRequest.mock.calls[0][1] as {
        workflow_params: { set_var: { attributes: { vars: Record<string, unknown> } } };
      }
    ).workflow_params.set_var.attributes.vars;
    expect(vars.repositoryUrls).toEqual(["https://github.com/acme/hive"]);
    expect(vars.username).toBe(`${"ADMIN".toLowerCase()}-gh`);
    expect(vars.pat).toBe("ghs_admin_pat");
    expect(vars.tokenReference).toBeDefined();
    expect(vars).not.toHaveProperty("swarmApiKey");
  });

  test("full review fails before Stakwork when GitHub App credentials are missing", async () => {
    const { actor, workspace, repository } = await setup("ADMIN");
    await addToScope(workspace.id, repository.id);

    const response = await TriggerRun(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/run`,
        actor,
        {},
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(PROTECT_ERRORS.MISSING_GITHUB_CREDENTIALS);
    expect(mockStakworkRequest).not.toHaveBeenCalled();
  });

  test("scope defaults empty, add/remove one-at-a-time, foreign repositoryId 404s", async () => {
    const { actor, workspace, repository } = await setup("ADMIN");
    const other = await setup("OWNER");

    const listed = await GetScope(
      createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/scope`,
        actor,
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.scope.empty).toBe(true);
    expect(listedBody.scope.selected).toEqual([]);

    const asUser = (user: { id: string; email: string | null; name: string | null }) => ({
      id: user.id,
      email: user.email || "",
      name: user.name || "",
    });

    const added = await PutScope(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/scope`,
        asUser(actor),
        { repositoryId: repository.id, inScope: true },
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(added.status).toBe(200);
    const addedBody = await added.json();
    expect(addedBody.scope.empty).toBe(false);
    expect(addedBody.scope.selected.map((row: { id: string }) => row.id)).toEqual([repository.id]);

    const foreign = await PutScope(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/scope`,
        asUser(actor),
        { repositoryId: other.repository.id, inScope: true },
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(foreign.status).toBe(404);

    const developer = await setup("DEVELOPER");
    const forbidden = await PutScope(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${developer.workspace.slug}/protect/scope`,
        asUser(developer.actor),
        { repositoryId: developer.repository.id, inScope: true },
      ),
      { params: Promise.resolve({ slug: developer.workspace.slug }) },
    );
    expect(forbidden.status).toBe(403);

    const removed = await PutScope(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/scope`,
        asUser(actor),
        { repositoryId: repository.id, inScope: false },
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).scope.empty).toBe(true);

    const leftover = await db.protectReviewRepo.findMany({ where: { workspaceId: workspace.id } });
    expect(leftover).toHaveLength(0);
  });

  test("deleting a repository cascades Protect scope rows", async () => {
    const { workspace, repository } = await setup("OWNER");
    await addToScope(workspace.id, repository.id);
    expect(await db.protectReviewRepo.count({ where: { workspaceId: workspace.id } })).toBe(1);

    await db.repository.delete({ where: { id: repository.id } });
    expect(await db.protectReviewRepo.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });

  test("GET findings includes a scope payload distinct from empty-review status", async () => {
    const { actor, workspace, repository } = await setup("OWNER");
    const emptyRes = await GetFindings(
      createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings`,
        actor,
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    const emptyBody = await emptyRes.json();
    expect(emptyBody.status).toBe("empty");
    expect(emptyBody.scope.empty).toBe(true);
    expect(emptyBody.scope.repositories).toHaveLength(1);

    await addToScope(workspace.id, repository.id);
    const scopedRes = await GetFindings(
      createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings`,
        actor,
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    const scopedBody = await scopedRes.json();
    expect(scopedBody.status).toBe("empty");
    expect(scopedBody.scope.empty).toBe(false);
    expect(scopedBody.scope.selected[0].id).toBe(repository.id);
  });

  test("GET findings: public-viewer 401, Jarvis error is error not empty, secret evidence redacted", async () => {
    const { actor, workspace } = await setup("OWNER");

    const publicRequest = createGetRequest(
      `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings`,
    );
    const unauth = await GetFindings(publicRequest, {
      params: Promise.resolve({ slug: workspace.slug }),
    });
    expect(unauth.status).toBe(401);

    await db.workspace.update({
      where: { id: workspace.id },
      data: { isPublicViewable: true },
    });
    const publicViewer = await GetFindings(
      createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings`,
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(publicViewer.status).toBe(403);
    await db.workspace.update({
      where: { id: workspace.id },
      data: { isPublicViewable: false },
    });

    await db.protectReviewRun.create({
      data: {
        workspaceId: workspace.id,
        mode: "full",
        status: "completed",
        completedAt: new Date(),
      },
    });

    vi.mocked(findings.listProtectFindings).mockResolvedValueOnce({
      ok: false,
      findings: [],
      error: "Jarvis down",
    });
    const errorRes = await GetFindings(
      createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings`,
        actor,
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(errorRes.status).toBe(200);
    const errorBody = await errorRes.json();
    expect(errorBody.status).toBe("error");
    expect(errorBody.findings).toEqual([]);

    vi.mocked(findings.listProtectFindings).mockResolvedValueOnce({
      ok: true,
      findings: [
        {
          ref_id: "ref-secret",
          node_key: "key",
          id: "key",
          category: "secret",
          severity: "high",
          area: "config",
          file: "src/keys.ts",
          line: 1,
          title: "Hardcoded key",
          description: "key in source",
          evidence: "sk-live-secret",
          recommendation: "rotate",
          verification: "reported",
          status: "open",
          repositoryUrl: "https://github.com/acme/hive",
        },
      ],
    });
    const readyRes = await GetFindings(
      createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings`,
        actor,
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    const ready = await readyRes.json();
    expect(ready.status).toBe("ready");
    expect(ready.findings[0].evidence).toBe("");
  });

  test("PATCH verification rejects non-members, non-findings, and only mutates verification", async () => {
    const { workspace } = await setup("OWNER");
    const stranger = await createTestUser();

    const forbidden = await PatchFinding(
      createAuthenticatedPatchRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings/ref-1`,
        { verification: "confirmed" },
        stranger,
      ),
      { params: Promise.resolve({ slug: workspace.slug, refId: "ref-1" }) },
    );
    expect(forbidden.status).toBe(403);

    const { actor, workspace: ws } = await setup("DEVELOPER");
    vi.mocked(findings.updateFindingVerification).mockResolvedValueOnce({
      success: false,
      error: "Finding not found",
    });
    const missing = await PatchFinding(
      createAuthenticatedPatchRequest(
        `http://localhost:3000/api/workspaces/${ws.slug}/protect/findings/not-a-finding`,
        { verification: "confirmed" },
        actor,
      ),
      { params: Promise.resolve({ slug: ws.slug, refId: "not-a-finding" }) },
    );
    expect(missing.status).toBe(404);

    vi.mocked(findings.updateFindingVerification).mockResolvedValueOnce({
      success: true,
      finding: {
        ref_id: "ref-1",
        node_key: "key",
        id: "key",
        category: "bug",
        severity: "low",
        area: "auth",
        file: "a.ts",
        line: 1,
        title: "Issue",
        description: "desc",
        evidence: "ev",
        recommendation: "fix",
        verification: "confirmed",
        status: "open",
        repositoryUrl: "https://github.com/acme/hive",
      },
    });
    const ignored = await PatchFinding(
      createAuthenticatedPatchRequest(
        `http://localhost:3000/api/workspaces/${ws.slug}/protect/findings/ref-1`,
        { verification: "confirmed", title: "should be ignored" },
        actor,
      ),
      { params: Promise.resolve({ slug: ws.slug, refId: "ref-1" }) },
    );
    expect(ignored.status).toBe(400);

    const ok = await PatchFinding(
      createAuthenticatedPatchRequest(
        `http://localhost:3000/api/workspaces/${ws.slug}/protect/findings/ref-1`,
        { verification: "confirmed" },
        actor,
      ),
      { params: Promise.resolve({ slug: ws.slug, refId: "ref-1" }) },
    );
    expect(ok.status).toBe(200);
    expect(findings.updateFindingVerification).toHaveBeenCalledWith(
      expect.anything(),
      "ref-1",
      "confirmed",
    );
  });

  test("Jamie action 404s unknown ref_id and creates an unshared workspace conversation", async () => {
    const { actor, workspace } = await setup("DEVELOPER");
    vi.mocked(findings.getProtectFindingByRef).mockResolvedValueOnce(null);

    const missing = await StartChat(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings/guessed/chat`,
        actor,
        {},
      ),
      { params: Promise.resolve({ slug: workspace.slug, refId: "guessed" }) },
    );
    expect(missing.status).toBe(404);
    expect(await db.sharedConversation.count({ where: { workspaceId: workspace.id } })).toBe(0);

    vi.mocked(findings.getProtectFindingByRef).mockResolvedValueOnce({
      ref_id: "ref-1",
      node_key: "key",
      id: "key",
      category: "bug",
      severity: "low",
      area: "auth",
      file: "a.ts",
      line: 1,
      title: "Issue",
      description: "desc",
      evidence: "ev",
      recommendation: "fix",
      verification: "reported",
      status: "open",
      repositoryUrl: "https://github.com/acme/hive",
    });

    const created = await StartChat(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/findings/ref-1/chat`,
        actor,
        {},
      ),
      { params: Promise.resolve({ slug: workspace.slug, refId: "ref-1" }) },
    );
    expect(created.status).toBe(200);
    const body = await created.json();
    const conversation = await db.sharedConversation.findUnique({
      where: { id: body.conversationId },
    });
    expect(conversation?.workspaceId).toBe(workspace.id);
    expect(conversation?.isShared).toBe(false);
    expect(conversation?.source).toBe("protect");
  });

  test("GET config is readable by a member; PUT persists allowlisted model and null-clear", async () => {
    const { actor, workspace } = await setup("DEVELOPER");
    await createTestLlmModel({
      name: "claude-sonnet-4",
      provider: "ANTHROPIC",
      isPublic: true,
      isTaskDefault: true,
    });

    const getRes = await GetConfig(
      createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/config`,
        actor,
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ securityReviewModel: null });

    const { actor: admin, workspace: ws } = await setup("ADMIN");
    const putRes = await PutConfig(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${ws.slug}/protect/config`,
        admin,
        { securityReviewModel: "anthropic/claude-sonnet-4" },
      ),
      { params: Promise.resolve({ slug: ws.slug }) },
    );
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ securityReviewModel: "anthropic/claude-sonnet-4" });

    const stored = await db.janitorConfig.findUnique({ where: { workspaceId: ws.id } });
    expect(stored?.securityReviewModel).toBe("anthropic/claude-sonnet-4");

    const clearRes = await PutConfig(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${ws.slug}/protect/config`,
        admin,
        { securityReviewModel: null },
      ),
      { params: Promise.resolve({ slug: ws.slug }) },
    );
    expect(clearRes.status).toBe(200);
    expect(await clearRes.json()).toEqual({ securityReviewModel: null });
  });

  test("PUT config rejects non-catalog and key-not-configured models", async () => {
    const { actor, workspace } = await setup("ADMIN");
    await createTestLlmModel({
      name: "claude-sonnet-4",
      provider: "ANTHROPIC",
      isPublic: true,
    });
    await createTestLlmModel({
      name: "gpt-4o",
      provider: "OPENAI",
      isPublic: true,
    });

    const missing = await PutConfig(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/config`,
        actor,
        { securityReviewModel: "anthropic/not-a-real-model" },
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(missing.status).toBe(400);

    const originalOpenai = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const noKey = await PutConfig(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/config`,
        actor,
        { securityReviewModel: "openai/gpt-4o" },
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    process.env.OPENAI_API_KEY = originalOpenai;
    expect(noKey.status).toBe(400);
  });

  test("PUT config is admin-only and IDOR-safe across workspaces", async () => {
    const { actor, workspace } = await setup("DEVELOPER");
    await createTestLlmModel({
      name: "claude-sonnet-4",
      provider: "ANTHROPIC",
      isPublic: true,
    });

    const forbidden = await PutConfig(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/config`,
        actor,
        { securityReviewModel: "anthropic/claude-sonnet-4" },
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(forbidden.status).toBe(403);

    const { actor: adminA, workspace: wsA } = await setup("ADMIN");
    const { workspace: wsB } = await setup("OWNER");

    const idorPut = await PutConfig(
      createAuthenticatedPutRequest(
        `http://localhost:3000/api/workspaces/${wsB.slug}/protect/config`,
        adminA,
        { securityReviewModel: "anthropic/claude-sonnet-4" },
      ),
      { params: Promise.resolve({ slug: wsB.slug }) },
    );
    expect([403, 404]).toContain(idorPut.status);

    const idorGet = await GetConfig(
      createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${wsB.slug}/protect/config`,
        adminA,
      ),
      { params: Promise.resolve({ slug: wsB.slug }) },
    );
    expect([403, 404]).toContain(idorGet.status);

    const own = await db.janitorConfig.findUnique({ where: { workspaceId: wsA.id } });
    const other = await db.janitorConfig.findUnique({ where: { workspaceId: wsB.id } });
    expect(own?.securityReviewModel ?? null).toBeNull();
    expect(other?.securityReviewModel ?? null).toBeNull();
  });

  test("full-review Stakwork vars include the resolved model and credential fields", async () => {
    const { actor, workspace } = await setup("ADMIN");
    await createTestLlmModel({
      name: "claude-sonnet-4",
      provider: "ANTHROPIC",
      isPublic: true,
      isTaskDefault: true,
    });
    await db.janitorConfig.update({
      where: { workspaceId: workspace.id },
      data: { securityReviewModel: "anthropic/claude-sonnet-4" },
    });

    const ok = await TriggerRun(
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/protect/run`,
        actor,
        {},
      ),
      { params: Promise.resolve({ slug: workspace.slug }) },
    );
    expect(ok.status).toBe(200);

    const vars = (
      mockStakworkRequest.mock.calls[0][1] as {
        workflow_params: { set_var: { attributes: { vars: Record<string, unknown> } } };
      }
    ).workflow_params.set_var.attributes.vars;
    expect(vars.model).toBe("anthropic/claude-sonnet-4");
    expect(vars.apiKey).toBe("test-anthropic-key");
  });
});
