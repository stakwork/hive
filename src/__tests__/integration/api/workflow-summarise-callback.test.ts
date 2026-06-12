/**
 * Integration tests for POST /api/workspaces/[slug]/workflows/[workflowId]/summarise/callback
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  generateUniqueId,
  generateUniqueSlug,
  generateUniqueEmail,
} from "@/__tests__/support/helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockPusherTrigger } = vi.hoisted(() => ({
  mockPusherTrigger: vi.fn(),
}));

vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: { trigger: mockPusherTrigger },
  };
});

// Import after mocks
import { POST } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/summarise/callback/route";
import { PUSHER_EVENTS } from "@/lib/pusher";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(slug: string, workflowId: string, summaryId: string, body: object): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/workflows/${workflowId}/summarise/callback?summary_id=${summaryId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": process.env.API_TOKEN ?? "test-token",
      },
      body: JSON.stringify(body),
    },
  );
}

async function createTestSetup() {
  const owner = await db.user.create({
    data: {
      id: generateUniqueId("user"),
      email: generateUniqueEmail("wf-cb"),
      name: "Test Owner",
    },
  });

  const workspace = await db.workspace.create({
    data: {
      id: generateUniqueId("workspace"),
      name: "Test Workspace",
      slug: generateUniqueSlug("wf-cb-ws"),
      ownerId: owner.id,
    },
  });

  const summary = await db.workflowSummary.create({
    data: {
      workflowId: 300,
      workspaceId: workspace.id,
      cacheKey: "abcd1234abcd1234",
      versionIds: ["1", "2"],
      status: "PENDING",
    },
  });

  return { owner, workspace, summary };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflows/[workflowId]/summarise/callback", () => {
  let testData: Awaited<ReturnType<typeof createTestSetup>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.API_TOKEN = "test-token";
    testData = await createTestSetup();
  });

  afterEach(async () => {
    const { workspace, owner } = testData;
    await db.workflowSummary.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.deleteMany({ where: { id: workspace.id } });
    await db.user.deleteMany({ where: { id: owner.id } });
  });

  test("returns 401 without correct x-api-token", async () => {
    const { workspace, summary } = testData;
    const req = new NextRequest(
      `http://localhost/api/workspaces/${workspace.slug}/workflows/300/summarise/callback?summary_id=${summary.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": "wrong-token",
        },
        body: JSON.stringify({ content: "summary", status: "complete" }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ slug: workspace.slug, workflowId: "300" }),
    });
    expect(res.status).toBe(401);
  });

  test("updates WorkflowSummary to COMPLETE with content", async () => {
    const { workspace, summary } = testData;
    const content = "## Summary\n\nSome changes happened.";

    const req = buildRequest(workspace.slug, "300", summary.id, { content, status: "complete" });
    const res = await POST(req, {
      params: Promise.resolve({ slug: workspace.slug, workflowId: "300" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const updated = await db.workflowSummary.findUnique({ where: { id: summary.id } });
    expect(updated?.status).toBe("COMPLETE");
    expect(updated?.content).toBe(content);
  });

  test("emits WORKFLOW_SUMMARY_READY Pusher event", async () => {
    const { workspace, summary } = testData;
    const content = "## My Summary";

    const req = buildRequest(workspace.slug, "300", summary.id, { content, status: "complete" });
    await POST(req, {
      params: Promise.resolve({ slug: workspace.slug, workflowId: "300" }),
    });

    expect(mockPusherTrigger).toHaveBeenCalledOnce();
    const [channel, event, payload] = mockPusherTrigger.mock.calls[0];
    expect(channel).toBe(`workspace-${workspace.slug}`);
    expect(event).toBe(PUSHER_EVENTS.WORKFLOW_SUMMARY_READY);
    expect(payload).toMatchObject({ summaryId: summary.id, workflowId: 300, content });
  });

  test("returns 404 if summary_id doesn't belong to the given workspace (IDOR guard)", async () => {
    // Create a second workspace with its own summary
    const other = await db.user.create({
      data: {
        id: generateUniqueId("other-user"),
        email: generateUniqueEmail("other-cb"),
        name: "Other User",
      },
    });
    const otherWs = await db.workspace.create({
      data: {
        id: generateUniqueId("other-ws"),
        name: "Other WS",
        slug: generateUniqueSlug("other-cb-ws"),
        ownerId: other.id,
      },
    });
    const otherSummary = await db.workflowSummary.create({
      data: {
        workflowId: 300,
        workspaceId: otherWs.id,
        cacheKey: "eeee1234eeee1234",
        versionIds: ["5", "6"],
        status: "PENDING",
      },
    });

    try {
      // Use testData workspace slug but otherSummary's ID — should return 404
      const { workspace } = testData;
      const req = buildRequest(workspace.slug, "300", otherSummary.id, { content: "x", status: "complete" });
      const res = await POST(req, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "300" }),
      });
      expect(res.status).toBe(404);
    } finally {
      await db.workflowSummary.deleteMany({ where: { workspaceId: otherWs.id } });
      await db.workspace.deleteMany({ where: { id: otherWs.id } });
      await db.user.deleteMany({ where: { id: other.id } });
    }
  });
});
