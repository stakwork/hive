import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/stakwork/runs/[runId]/thinking/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { vi } from "vitest";
import { generateUniqueSlug } from "@/__tests__/support/helpers";

vi.mock("next-auth");
vi.mock("@/lib/service-factory");

describe("GET /api/stakwork/runs/[runId]/thinking", () => {
  let testWorkspace: any;
  let testUser: any;
  let testRun: any;

  beforeEach(async () => {
    // Create test user
    testUser = await db.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: generateUniqueSlug("test-workspace"),
        ownerId: testUser.id,
        members: {
          create: {
            userId: testUser.id,
            role: "OWNER",
          },
        },
      },
    });

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: testUser.id, email: testUser.email },
    } as any);
  });

  afterEach(async () => {
    await db.stakworkRun.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  it("should return stored thinking artifacts if available", async () => {
    const thinkingArtifacts = [
      {
        stepId: "step-1",
        stepName: "Analyzing code",
        status: "completed",
        timestamp: new Date().toISOString(),
      },
    ];

    testRun = await db.stakworkRun.create({
      data: {
        type: "ARCHITECTURE",
        dataType: "json",
        workspaceId: testWorkspace.id,
        webhookUrl: "http://localhost:3000/api/test/webhook",
        thinkingArtifacts: thinkingArtifacts as any,
      },
    });

    const request = new Request("http://localhost:3000/api/test");
    const response = await GET(request, { params: { runId: testRun.id } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.runId).toBe(testRun.id);
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts[0].stepName).toBe("Analyzing code");
  });

  it("should return empty artifacts if none stored and no projectId", async () => {
    testRun = await db.stakworkRun.create({
      data: {
        type: "ARCHITECTURE",
        dataType: "json",
        workspaceId: testWorkspace.id,
        webhookUrl: "http://localhost:3000/api/test/webhook",
      },
    });

    const request = new Request("http://localhost:3000/api/test");
    const response = await GET(request, { params: { runId: testRun.id } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.artifacts).toEqual([]);
  });

  it("should return 403 if user not in workspace", async () => {
    const otherUser = await db.user.create({
      data: {
        email: "other@example.com",
        name: "Other User",
      },
    });

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: otherUser.id, email: otherUser.email },
    } as any);

    testRun = await db.stakworkRun.create({
      data: {
        type: "ARCHITECTURE",
        dataType: "json",
        workspaceId: testWorkspace.id,
        webhookUrl: "http://localhost:3000/api/test/webhook",
      },
    });

    const request = new Request("http://localhost:3000/api/test");
    const response = await GET(request, { params: { runId: testRun.id } });

    expect(response.status).toBe(403);

    await db.user.delete({ where: { id: otherUser.id } });
  });

  it("should return 404 if run not found", async () => {
    const request = new Request("http://localhost:3000/api/test");
    const response = await GET(request, { params: { runId: "non-existent" } });

    expect(response.status).toBe(404);
  });

  it("should return 401 if not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/test");
    const response = await GET(request, { params: { runId: "any-id" } });

    expect(response.status).toBe(401);
  });
});
