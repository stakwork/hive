import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import {
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
} from "@/__tests__/support/helpers";

// ── Mock repoAgent so tests don't block on the 5-second poll interval ───────
const mockRepoAgent = vi.fn();
vi.mock("@/lib/ai/askTools", () => ({
  repoAgent: (...args: unknown[]) => mockRepoAgent(...args),
}));

// ── Mock fetch for outbound webhook calls ────────────────────────────────────
global.fetch = vi.fn();
const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

// Import route AFTER mocks are declared
import { POST } from "@/app/api/mock/stakwork/run/route";

// ── Constants ─────────────────────────────────────────────────────────────────
const FALLBACK_WORKSPACE_ID = "cmh4vrcj70001id04idolu9br";
const WEBHOOK_URL = "http://localhost:3000/api/stakwork/webhook";
const SWARM_URL = "http://localhost:3355";
const SWARM_API_KEY = "test-api-key";
const REPO_URL = "https://github.com/org/repo";
const PROMPT = "Analyse the codebase";

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    workflow_params: {
      set_var: {
        attributes: {
          vars: {
            webhookUrl: WEBHOOK_URL,
            swarmUrl: SWARM_URL,
            swarmApiKey: SWARM_API_KEY,
            repo_url: REPO_URL,
            prompt: PROMPT,
            ...overrides,
          },
        },
      },
    },
  };
}

describe("POST /api/mock/stakwork/run", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Ensure the fallback workspace exists so FK constraint passes
    const existing = await db.workspaces.findUnique({ where: { id: FALLBACK_WORKSPACE_ID } });
    if (!existing) {
      const now = new Date();
      const user = await db.users.create({
        data: {
          id: generateUniqueId("user"),
          email: `mock-owner-${generateUniqueId()}@example.com`,
          name: "Mock Owner",
          updated_at: now,
        },
      });
      await db.workspaces.create({
        data: {
          id: FALLBACK_WORKSPACE_ID,
          name: "Mock Workspace",
          slug: generateUniqueSlug("mock-ws"),
          owner_id: user.id,
          updated_at: now,
        },
      });
    }
  });

  afterEach(async () => {
    await db.stakwork_runs.deleteMany({ where: { workspace_id: FALLBACK_WORKSPACE_ID } });
  });

  // ─── Validation ─────────────────────────────────────────────────────────────

  describe("Validation — 400 on missing required fields", () => {
    const requiredFields = ["webhookUrl", "swarmUrl", "swarmApiKey", "repo_url", "prompt"] as const;

    for (const field of requiredFields) {
      test(`returns 400 when '${field}' is missing`, async () => {
        const vars: Record<string, unknown> = {
          webhookUrl: WEBHOOK_URL,
          swarmUrl: SWARM_URL,
          swarmApiKey: SWARM_API_KEY,
          repo_url: REPO_URL,
          prompt: PROMPT,
        };
        delete vars[field];

        const request = createPostRequest("http://localhost/api/mock/stakwork/run", {
          workflow_params: { set_var: { attributes: { vars } } },
        });
        const response = await POST(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain(field);
      });
    }
  });

  // ─── Success path ────────────────────────────────────────────────────────────

  describe("Success path", () => {
    beforeEach(() => {
      mockRepoAgent.mockResolvedValue({ answer: "done" });
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    });

    test("creates StakworkRun with REPO_AGENT type and marks it COMPLETED", async () => {
      const request = createPostRequest(
        "http://localhost/api/mock/stakwork/run",
        buildBody()
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.run_id).toBeDefined();

      const run = await db.stakwork_runs.findUnique({ where: { id: body.run_id } });
      expect(run).not.toBeNull();
      expect(run!.type).toBe(StakworkRunType.REPO_AGENT);
      expect(run!.status).toBe(WorkflowStatus.COMPLETED);
      expect(run!.result).not.toBeNull();
      expect(run!.workspace_id).toBe(FALLBACK_WORKSPACE_ID);
    });

    test("POSTs to webhookUrl with project_status: 'complete' and correct run_id", async () => {
      const request = createPostRequest(
        "http://localhost/api/mock/stakwork/run",
        buildBody()
      );
      const response = await POST(request);
      const body = await response.json();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [webhookUrlCalled, webhookInit] = mockFetch.mock.calls[0];

      expect(String(webhookUrlCalled)).toContain(`run_id=${body.run_id}`);
      expect(String(webhookUrlCalled)).toContain(WEBHOOK_URL);

      const webhookBody = JSON.parse(webhookInit!.body as string);
      expect(webhookBody.project_status).toBe("complete");
      expect(webhookBody.project_id).toBeNull();
    });

    test("uses caller-supplied workspaceId when provided", async () => {
      const now = new Date();
      const user2 = await db.users.create({
        data: {
          id: generateUniqueId("user"),
          email: `ws2-owner-${generateUniqueId()}@example.com`,
          name: "WS2 Owner",
          updated_at: now,
        },
      });
      const ws2 = await db.workspaces.create({
        data: {
          id: randomUUID(),
          name: "WS2",
          slug: generateUniqueSlug("ws2"),
          owner_id: user2.id,
          updated_at: now,
        },
      });

      try {
        const request = createPostRequest(
          "http://localhost/api/mock/stakwork/run",
          buildBody({ workspaceId: ws2.id })
        );
        const response = await POST(request);
        const body = await response.json();
        expect(response.status).toBe(200);

        const run = await db.stakwork_runs.findUnique({ where: { id: body.run_id } });
        expect(run!.workspace_id).toBe(ws2.id);
      } finally {
        await db.stakwork_runs.deleteMany({ where: { workspace_id: ws2.id } });
        await db.workspaces.delete({ where: { id: ws2.id } });
        await db.users.delete({ where: { id: user2.id } });
      }
    });
  });

  // ─── subAgents forwarding ────────────────────────────────────────────────────

  describe("subAgents forwarding", () => {
    test("forwards subAgents array into the repoAgent call", async () => {
      const subAgents = [
        { url: "http://agent1.example.com", apiToken: "tok1", name: "Agent 1" },
        { url: "http://agent2.example.com", apiToken: "tok2" },
      ];

      mockRepoAgent.mockResolvedValue({ result: "ok" });
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

      const request = createPostRequest(
        "http://localhost/api/mock/stakwork/run",
        buildBody({ subAgents })
      );
      await POST(request);

      expect(mockRepoAgent).toHaveBeenCalledOnce();
      const [, , params] = mockRepoAgent.mock.calls[0];
      expect(params.subAgents).toEqual(subAgents);
    });
  });

  // ─── Error path ───────────────────────────────────────────────────────────────

  describe("Error path — repoAgent throws", () => {
    test("marks run as FAILED and POSTs project_status: 'failed' to webhookUrl", async () => {
      mockRepoAgent.mockRejectedValue(new Error("repo agent failed"));
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

      const request = createPostRequest(
        "http://localhost/api/mock/stakwork/run",
        buildBody()
      );
      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("repo agent failed");

      // Confirm run is persisted as FAILED
      const runs = await db.stakwork_runs.findMany({
        where: { workspace_id: FALLBACK_WORKSPACE_ID, status: WorkflowStatus.FAILED },
        orderBy: { created_at: "desc" },
        take: 1,
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].type).toBe(StakworkRunType.REPO_AGENT);

      // Webhook should have been called with failed status
      expect(mockFetch).toHaveBeenCalledOnce();
      const [webhookUrlCalled, webhookInit] = mockFetch.mock.calls[0];
      expect(String(webhookUrlCalled)).toContain(`run_id=${runs[0].id}`);
      const webhookBody = JSON.parse(webhookInit!.body as string);
      expect(webhookBody.project_status).toBe("failed");
    });
  });
});
