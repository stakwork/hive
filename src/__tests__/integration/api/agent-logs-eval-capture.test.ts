/**
 * Integration tests for:
 *   POST /api/workspaces/[slug]/agent-logs/[logId]/eval/capture
 *   POST /api/workspaces/[slug]/agent-logs/[logId]/flag-as-eval
 *
 * Covers:
 * — Existing AgentLog-based capture paths are unchanged
 * — SharedConversation-backed capture succeeds (previously 404)
 * — Cross-workspace IDOR is denied for both AgentLog and SharedConversation
 * — Org-scoped canvas conversation (workspaceId null) is resolved via org fallback
 * — Explicit agent override in eval/capture
 * — flag-as-eval IDOR check now resolves SharedConversation
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

// blob-fetch is used by the AgentLog branch only
vi.mock("@/lib/utils/blob-fetch", () => ({
  fetchBlobContent: vi.fn().mockResolvedValue(
    JSON.stringify({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    }),
  ),
}));

// Route imports (after mocks)
import { POST as capturePost } from "@/app/api/workspaces/[slug]/agent-logs/[logId]/eval/capture/route";
import { POST as flagPost } from "@/app/api/workspaces/[slug]/agent-logs/[logId]/flag-as-eval/route";

// ── Cleanup tracking ──────────────────────────────────────────────────────────

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdAgentLogIds: string[] = [];
const createdConversationIds: string[] = [];
const createdOrgIds: string[] = [];

// Unique installation id counter (avoids unique-constraint conflicts)
let _installationId = 8_900_000;
function nextInstallationId() { return _installationId++; }

// ── Factory helpers ───────────────────────────────────────────────────────────

async function createFixtures(orgId?: string) {
  const user = await createTestUser({
    email: `ec-int-${Date.now()}-${Math.random()}@example.com`,
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    slug: `ec-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ownerId: user.id,
    sourceControlOrgId: orgId ?? null,
  });
  createdWorkspaceIds.push(workspace.id);

  await createTestMembership({ workspaceId: workspace.id, userId: user.id, role: "OWNER" });
  await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-swarm-key" });

  return { user, workspace };
}

async function createAgentLog(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const log = await db.agentLog.create({
    data: {
      workspaceId,
      blobUrl: "https://store.private.blob.vercel-storage.com/test-log.json",
      agent: "coding-agent-cmr3abc",
      source: "repo_agent",
      repos: [],
      config: {
        model: "claude-3-5-sonnet",
        source: "repo_agent",
        systemOverride: "You are a coding agent.",
      },
      ...overrides,
    } as Parameters<typeof db.agentLog.create>[0]["data"],
  });
  createdAgentLogIds.push(log.id);
  return log;
}

const CANVAS_MESSAGES = [
  { id: "m1", role: "user", content: "Canvas question" },
  { id: "m2", role: "assistant", content: "Canvas answer" },
];

async function createOrgCanvasConversation(
  sourceControlOrgId: string,
  userId: string,
  workspaceId: string | null = null,
) {
  const conv = await db.sharedConversation.create({
    data: {
      sourceControlOrgId,
      userId,
      workspaceId,
      messages: CANVAS_MESSAGES as unknown as Parameters<typeof db.sharedConversation.create>[0]["data"]["messages"],
      source: "org-canvas",
      followUpQuestions: [],
      title: "Test canvas conversation",
    },
  });
  createdConversationIds.push(conv.id);
  return conv;
}

async function createWorkspaceConversation(workspaceId: string, userId: string) {
  const conv = await db.sharedConversation.create({
    data: {
      workspaceId,
      userId,
      messages: CANVAS_MESSAGES as unknown as Parameters<typeof db.sharedConversation.create>[0]["data"]["messages"],
      source: "canvas",
      followUpQuestions: [],
      title: "Workspace canvas conversation",
    },
  });
  createdConversationIds.push(conv.id);
  return conv;
}

// ── Request builders ──────────────────────────────────────────────────────────

function makeCaptureRequest(
  slug: string,
  logId: string,
  body: Record<string, unknown>,
  user: { id: string; email: string; name?: string },
) {
  return createAuthenticatedPostRequest(
    `http://localhost/api/workspaces/${slug}/agent-logs/${logId}/eval/capture`,
    user,
    body,
  );
}

function makeFlagRequest(
  slug: string,
  logId: string,
  body: Record<string, unknown>,
  user: { id: string; email: string; name?: string },
) {
  return createAuthenticatedPostRequest(
    `http://localhost/api/workspaces/${slug}/agent-logs/${logId}/flag-as-eval`,
    user,
    body,
  );
}

const VALID_CAPTURE_BODY = {
  evalSetId: "existing-evalset-ref-123",
  requirement: "Never return an empty response",
  reason: "Testing",
};

const VALID_FLAG_BODY = {
  evalSetId: "existing-evalset-ref-123",
  requirementName: "Never return an empty response",
  requirementDescription: "Agent should always reply",
  positiveCases: ["Good output"],
  negativeCases: ["Empty output"],
  agent: "repo-agent",
  environment: "test-env",
  source: "repo_agent",
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  process.env.USE_MOCKS = "false";
  process.env.NODE_ENV = "test";

  // Default: nodes succeed
  vi.mocked(nodesService.addNode)
    .mockResolvedValueOnce({ success: true, ref_id: "req-ref-1" })
    .mockResolvedValueOnce({ success: true, ref_id: "trigger-ref-1" })
    .mockResolvedValueOnce({ success: true, ref_id: "hive-agent-ref-1" });
  vi.mocked(nodesService.addEdge).mockResolvedValue({ success: true });
});

afterEach(async () => {
  if (createdConversationIds.length > 0) {
    await db.sharedConversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    createdConversationIds.length = 0;
  }
  if (createdAgentLogIds.length > 0) {
    await db.agentLog.deleteMany({ where: { id: { in: createdAgentLogIds } } });
    createdAgentLogIds.length = 0;
  }
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
  if (createdOrgIds.length > 0) {
    await db.sourceControlOrg.deleteMany({ where: { id: { in: createdOrgIds } } }).catch(() => {});
    createdOrgIds.length = 0;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// eval/capture
// ─────────────────────────────────────────────────────────────────────────────

describe("POST .../agent-logs/[logId]/eval/capture", () => {
  describe("AgentLog branch (existing behavior unchanged)", () => {
    test("succeeds for a valid AgentLog id and returns evalSetRef/requirementRef/triggerRef", async () => {
      const { user, workspace } = await createFixtures();
      const log = await createAgentLog(workspace.id);

      const req = makeCaptureRequest(workspace.slug, log.id, VALID_CAPTURE_BODY, user);
      const res = await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: log.id }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.evalSetRef).toBe(VALID_CAPTURE_BODY.evalSetId);
      expect(body.data.requirementRef).toBeTruthy();
      expect(body.data.triggerRef).toBeTruthy();
    });

    test("returns 404 when AgentLog id does not exist (and no SharedConversation either)", async () => {
      const { user, workspace } = await createFixtures();

      const req = makeCaptureRequest(workspace.slug, "nonexistent-id-xyz", VALID_CAPTURE_BODY, user);
      const res = await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: "nonexistent-id-xyz" }),
      });

      expect(res.status).toBe(404);
    });

    test("returns 403 when AgentLog belongs to a different workspace (IDOR)", async () => {
      const { user: user1, workspace: ws1 } = await createFixtures();
      const { workspace: ws2 } = await createFixtures();

      // Log belongs to ws2 but request comes in on ws1
      const log = await createAgentLog(ws2.id);

      const req = makeCaptureRequest(ws1.slug, log.id, VALID_CAPTURE_BODY, user1);
      const res = await capturePost(req, {
        params: Promise.resolve({ slug: ws1.slug, logId: log.id }),
      });

      expect(res.status).toBe(403);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });

    test("agent auto-derived from agentLog.agent field", async () => {
      const { user, workspace } = await createFixtures();
      const log = await createAgentLog(workspace.id, { agent: "plan-agent-cmr3abc" });

      const req = makeCaptureRequest(workspace.slug, log.id, VALID_CAPTURE_BODY, user);
      await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: log.id }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        ([, n]) => n.node_type === "EvalTrigger",
      );
      expect(triggerCall?.[1].node_data.agent).toBe("plan-agent");
    });

    test("explicit agent override in body overrides auto-derived agent", async () => {
      const { user, workspace } = await createFixtures();
      const log = await createAgentLog(workspace.id, { agent: "coding-agent-cmr3abc" });

      const req = makeCaptureRequest(workspace.slug, log.id, {
        ...VALID_CAPTURE_BODY,
        agent: "canvas-agent",
      }, user);
      await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: log.id }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        ([, n]) => n.node_type === "EvalTrigger",
      );
      expect(triggerCall?.[1].node_data.agent).toBe("canvas-agent");
    });

    test("invalid agent override is ignored (auto-derivation applies)", async () => {
      const { user, workspace } = await createFixtures();
      const log = await createAgentLog(workspace.id, { agent: "coding-agent-cmr3abc" });

      const req = makeCaptureRequest(workspace.slug, log.id, {
        ...VALID_CAPTURE_BODY,
        agent: "totally-unknown-bot",
      }, user);
      await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: log.id }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        ([, n]) => n.node_type === "EvalTrigger",
      );
      // Falls back to parsed canonical name
      expect(triggerCall?.[1].node_data.agent).toBe("coding-agent");
    });
  });

  describe("SharedConversation branch (new)", () => {
    test("succeeds for workspace-scoped conversation id", async () => {
      const { user, workspace } = await createFixtures();
      const conv = await createWorkspaceConversation(workspace.id, user.id);

      const req = makeCaptureRequest(workspace.slug, conv.id, VALID_CAPTURE_BODY, user);
      const res = await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: conv.id }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.agentName).toBe("canvas-agent"); // default for canvas_chat
    });

    test("succeeds for org-scoped canvas conversation (workspaceId null) via org fallback", async () => {
      const orgId = generateUniqueId("org");
      // Org must exist in SourceControlOrg table
      await db.sourceControlOrg.create({ data: { id: orgId, name: `org-${orgId}`, githubLogin: `org-${orgId}`, githubInstallationId: nextInstallationId() } });
      createdOrgIds.push(orgId);

      const { user, workspace } = await createFixtures(orgId);
      const conv = await createOrgCanvasConversation(orgId, user.id, null);

      const req = makeCaptureRequest(workspace.slug, conv.id, VALID_CAPTURE_BODY, user);
      const res = await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: conv.id }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      // canvas-agent is the default for org-canvas
      expect(body.data.agentName).toBe("canvas-agent");

      // Cleanup handled in afterEach via createdOrgIds
    });

    test("returns 403 for org-canvas conversation belonging to a different org (IDOR)", async () => {
      const orgId1 = generateUniqueId("org1");
      const orgId2 = generateUniqueId("org2");

      await db.sourceControlOrg.create({ data: { id: orgId1, name: `org-${orgId1}`, githubLogin: `org-${orgId1}`, githubInstallationId: nextInstallationId() } });
      await db.sourceControlOrg.create({ data: { id: orgId2, name: `org-${orgId2}`, githubLogin: `org-${orgId2}`, githubInstallationId: nextInstallationId() } });
      createdOrgIds.push(orgId1, orgId2);

      const { user: user1, workspace: ws1 } = await createFixtures(orgId1);
      const { user: user2 } = await createFixtures(orgId2);

      // Conversation belongs to org2
      const conv = await createOrgCanvasConversation(orgId2, user2.id, null);

      // Request comes in on ws1 (which is linked to org1)
      const req = makeCaptureRequest(ws1.slug, conv.id, VALID_CAPTURE_BODY, user1);
      const res = await capturePost(req, {
        params: Promise.resolve({ slug: ws1.slug, logId: conv.id }),
      });

      // Should be 404 (not in org1's canvas conversations)
      expect([403, 404]).toContain(res.status);
      expect(nodesService.addNode).not.toHaveBeenCalled();

      // Cleanup handled in afterEach via createdOrgIds
    });

    test("prompt_snapshot for conversation contains messages from stored messages", async () => {
      const { user, workspace } = await createFixtures();
      const conv = await createWorkspaceConversation(workspace.id, user.id);

      const req = makeCaptureRequest(workspace.slug, conv.id, VALID_CAPTURE_BODY, user);
      await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: conv.id }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        ([, n]) => n.node_type === "EvalTrigger",
      );
      expect(triggerCall).toBeDefined();
      const parsed = JSON.parse(triggerCall![1].node_data.body);
      const snapshot = JSON.parse(parsed.prompt_snapshot);
      // Messages from CANVAS_MESSAGES
      expect(snapshot.request_params.messages.length).toBeGreaterThan(0);
    });

    test("conversation branch: explicit agent override works", async () => {
      const { user, workspace } = await createFixtures();
      const conv = await createWorkspaceConversation(workspace.id, user.id);

      const req = makeCaptureRequest(workspace.slug, conv.id, {
        ...VALID_CAPTURE_BODY,
        agent: "repo-agent",
      }, user);
      await capturePost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: conv.id }),
      });

      const triggerCall = vi.mocked(nodesService.addNode).mock.calls.find(
        ([, n]) => n.node_type === "EvalTrigger",
      );
      expect(triggerCall?.[1].node_data.agent).toBe("repo-agent");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// flag-as-eval
// ─────────────────────────────────────────────────────────────────────────────

describe("POST .../agent-logs/[logId]/flag-as-eval", () => {
  describe("AgentLog branch (existing behavior unchanged)", () => {
    test("succeeds for a valid AgentLog id", async () => {
      const { user, workspace } = await createFixtures();
      const log = await createAgentLog(workspace.id);

      // lookupAgentSessionByLogUrl needs a mock since it makes an HTTP call
      global.fetch = vi.fn().mockResolvedValue({
        ok: false, // session not found → no EVALUATED edge
        json: async () => ({}),
      } as Response);

      const req = makeFlagRequest(workspace.slug, log.id, VALID_FLAG_BODY, user);
      const res = await flagPost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: log.id }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    test("returns 404 when AgentLog does not exist (and no SharedConversation)", async () => {
      const { user, workspace } = await createFixtures();

      const req = makeFlagRequest(workspace.slug, "nonexistent-xyz", VALID_FLAG_BODY, user);
      const res = await flagPost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: "nonexistent-xyz" }),
      });

      expect(res.status).toBe(404);
    });

    test("returns 403 when AgentLog belongs to a different workspace (IDOR)", async () => {
      const { user: user1, workspace: ws1 } = await createFixtures();
      const { workspace: ws2 } = await createFixtures();

      const log = await createAgentLog(ws2.id);

      const req = makeFlagRequest(ws1.slug, log.id, VALID_FLAG_BODY, user1);
      const res = await flagPost(req, {
        params: Promise.resolve({ slug: ws1.slug, logId: log.id }),
      });

      expect(res.status).toBe(403);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });
  });

  describe("SharedConversation branch (new)", () => {
    test("succeeds for a workspace-scoped SharedConversation id", async () => {
      const { user, workspace } = await createFixtures();
      const conv = await createWorkspaceConversation(workspace.id, user.id);

      const req = makeFlagRequest(workspace.slug, conv.id, VALID_FLAG_BODY, user);
      const res = await flagPost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: conv.id }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    test("denies access to a SharedConversation owned by a different workspace (IDOR)", async () => {
      const { user: user1, workspace: ws1 } = await createFixtures();
      const { user: user2, workspace: ws2 } = await createFixtures();

      // Conversation belongs to ws2
      const conv = await createWorkspaceConversation(ws2.id, user2.id);

      const req = makeFlagRequest(ws1.slug, conv.id, VALID_FLAG_BODY, user1);
      const res = await flagPost(req, {
        params: Promise.resolve({ slug: ws1.slug, logId: conv.id }),
      });

      // The workspace-scoped query won't find ws2's conversation → 404
      // (resolver uses scoped lookup, not fetch-then-check)
      expect([403, 404]).toContain(res.status);
      expect(nodesService.addNode).not.toHaveBeenCalled();
    });
  });

  describe("Validation", () => {
    test("returns 400 when required fields are missing", async () => {
      const { user, workspace } = await createFixtures();
      const log = await createAgentLog(workspace.id);

      const req = makeFlagRequest(workspace.slug, log.id, { evalSetId: "x" }, user);
      const res = await flagPost(req, {
        params: Promise.resolve({ slug: workspace.slug, logId: log.id }),
      });

      expect(res.status).toBe(400);
    });
  });
});
