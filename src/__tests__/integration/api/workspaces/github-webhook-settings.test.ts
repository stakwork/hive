import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/settings/github-webhook/route";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
import { createTestUser, createTestWorkspace, createTestRepository } from "@/__tests__/support/fixtures";
import { createTestTask } from "@/__tests__/support/factories/task.factory";
import {
  createGetRequest,
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("GET /api/workspaces/[slug]/settings/github-webhook", () => {
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let repository: Awaited<ReturnType<typeof createTestRepository>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    user = await createTestUser({
      email: "admin@test.com",
      name: "Admin User",
    });

    workspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: user.id,
      members: [
        {
          userId: user.id,
          role: WorkspaceRole.ADMIN,
        },
      ],
    });

    repository = await createTestRepository({
      name: "test-repo",
      url: "https://github.com/test/repo",
      workspaceId: workspace.id,
    });
  });

  afterEach(async () => {
    await db.deployment.deleteMany();
    await db.task.deleteMany();
    await db.repository.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  test("should return webhook URL and not configured status when no deployments exist", async () => {
    const session = createAuthenticatedSession(user);
    getMockedSession().mockResolvedValue(session);

    const request = createGetRequest(`/api/workspaces/${workspace.slug}/settings/github-webhook`);
    const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toMatchObject({
      webhookUrl: expect.stringContaining(`/api/github/webhook/${workspace.id}`),
      isConfigured: false,
      lastWebhookReceived: null,
      recentDeploymentsCount: 0,
    });
  });

  test("should return configured status when recent deployments exist", async () => {
    // Create a task with a deployment
    const task = await createTestTask({
      title: "Test Task",
      workspaceId: workspace.id,
      repositoryId: repository.id,
      createdById: user.id,
      status: "DONE",
    });

    await db.deployment.create({
      data: {
        taskId: task.id,
        repositoryId: repository.id,
        commitSha: "abc123",
        environment: "STAGING",
        status: "SUCCESS",
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    const session = createAuthenticatedSession(user);
    getMockedSession().mockResolvedValue(session);

    const request = createGetRequest(`/api/workspaces/${workspace.slug}/settings/github-webhook`);
    const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toMatchObject({
      webhookUrl: expect.stringContaining(`/api/github/webhook/${workspace.id}`),
      isConfigured: true,
      recentDeploymentsCount: 1,
    });
    expect(data.lastWebhookReceived).toBeTruthy();
  });

  test("should return 403 for non-admin users", async () => {
    const developer = await createTestUser({
      email: "dev@test.com",
      name: "Developer User",
    });

    await db.workspaceMember.create({
      data: {
        userId: developer.id,
        workspaceId: workspace.id,
        role: WorkspaceRole.DEVELOPER,
      },
    });

    const session = createAuthenticatedSession(developer);
    getMockedSession().mockResolvedValue(session);

    const request = createGetRequest(`/api/workspaces/${workspace.slug}/settings/github-webhook`);
    const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(response.status).toBe(403);
  });

  test("should return 401 for unauthenticated users", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const request = createGetRequest(`/api/workspaces/${workspace.slug}/settings/github-webhook`);
    const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(response.status).toBe(401);
  });

  test("should ignore deployments older than 7 days", async () => {
    const task = await createTestTask({
      title: "Test Task",
      workspaceId: workspace.id,
      repositoryId: repository.id,
      createdById: user.id,
      status: "DONE",
    });

    // Create old deployment (8 days ago)
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    await db.deployment.create({
      data: {
        taskId: task.id,
        repositoryId: repository.id,
        commitSha: "old123",
        environment: "PRODUCTION",
        status: "SUCCESS",
        startedAt: eightDaysAgo,
        completedAt: eightDaysAgo,
        createdAt: eightDaysAgo,
      },
    });

    const session = createAuthenticatedSession(user);
    getMockedSession().mockResolvedValue(session);

    const request = createGetRequest(`/api/workspaces/${workspace.slug}/settings/github-webhook`);
    const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.recentDeploymentsCount).toBe(0);
    expect(data.isConfigured).toBe(false);
    // Should still show the old deployment as last received
    expect(data.lastWebhookReceived).toBeTruthy();
  });
});
