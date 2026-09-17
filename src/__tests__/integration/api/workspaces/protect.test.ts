import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST as TriggerRun } from "@/app/api/workspaces/[slug]/protect/run/route";
import { GET as GetFindings } from "@/app/api/workspaces/[slug]/protect/findings/route";
import { PATCH as PatchFinding } from "@/app/api/workspaces/[slug]/protect/findings/[refId]/route";
import { POST as StartChat } from "@/app/api/workspaces/[slug]/protect/findings/[refId]/chat/route";
import { POST as TriggerJanitor } from "@/app/api/workspaces/[slug]/janitors/[type]/run/route";
import { db } from "@/lib/db";
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
  createAuthenticatedPatchRequest,
  createGetRequest,
  createAuthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers";
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

describe("Protect API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION = "true";
    process.env.STAKWORK_API_KEY = "test-key";
    process.env.STAKWORK_PROTECT_WORKFLOW_ID = "555";
    vi.mocked(findings.listProtectFindings).mockResolvedValue({ ok: true, findings: [] });
    mockStakworkRequest.mockResolvedValue({ data: { project_id: 99 } });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION = originalFlag;
  });

  async function setup(role: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER" = "OWNER") {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({ workspaceId: workspace.id, userId: owner.id, role: "OWNER" });
    await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });
    await createTestRepository({
      workspaceId: workspace.id,
      repositoryUrl: "https://github.com/acme/hive",
    });
    await db.janitorConfig.create({
      data: { workspaceId: workspace.id, securityReviewEnabled: true },
    });

    let actor = owner;
    if (role !== "OWNER") {
      actor = await createTestUser();
      await createTestMembership({ workspaceId: workspace.id, userId: actor.id, role });
    }

    return { owner, actor, workspace };
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

    const { actor: admin, workspace: ws } = await setup("ADMIN");
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
        workflow_params: { set_var: { attributes: { vars: { repositoryUrls: string[] } } } };
      }
    ).workflow_params.set_var.attributes.vars;
    expect(vars.repositoryUrls).toEqual(["https://github.com/acme/hive"]);
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
});
