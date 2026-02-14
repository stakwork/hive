import { describe, it, expect, beforeEach, vi } from "vitest";
import { PUT as PUT_STAK } from "@/app/api/workspaces/[slug]/stakgraph/route";
import { db } from "@/lib/db";
import { PodState } from "@prisma/client";
import {
  createAuthenticatedSession,
  generateUniqueSlug,
  generateUniqueId,
  createPutRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";

vi.mock("@/services/pool-manager/sync", () => ({
  syncPoolManagerSettings: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    setupRepositoryWithWebhook: vi.fn().mockResolvedValue({ defaultBranch: "main" }),
  })),
}));

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn().mockResolvedValue("test-pool-key"),
  updateSwarmPoolApiKeyFor: vi.fn().mockResolvedValue(undefined),
}));

describe("Stakgraph API - Pending Repair Trigger", () => {
  let workspaceId: string;
  let workspaceSlug: string;
  let userId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create user first
    const user = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `user-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });
    userId = user.id;

    // Mock session
    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(user)
    );

    workspaceSlug = generateUniqueSlug();

    // Create workspace
    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: workspaceSlug,
        ownerId: userId,
      },
    });
    workspaceId = workspace.id;

    // Create workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId,
        userId,
        role: "OWNER",
      },
    });

    // Create initial swarm
    await db.swarm.create({
      data: {
        workspaceId,
        name: "test-swarm",
        status: "ACTIVE",
        podState: PodState.COMPLETED,
      },
    });
  });

  it("should set pendingRepairTrigger when adding first repository", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo1",
            branch: "main",
            name: "repo1",
          },
        ],
        name: "test-swarm",
        poolName: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was set
    const swarm = await db.swarm.findFirst({
      where: { workspaceId },
      select: { pendingRepairTrigger: true, podState: true },
    });

    expect(swarm).toBeTruthy();
    expect(swarm?.pendingRepairTrigger).toBeTruthy();

    const trigger = swarm?.pendingRepairTrigger as {
      repoUrl: string;
      repoName: string;
      requestedAt: string;
    };

    expect(trigger.repoUrl).toBe("https://github.com/test/repo1");
    expect(trigger.repoName).toBe("repo1");
    expect(trigger.requestedAt).toBeTruthy();
    expect(swarm?.podState).toBe(PodState.NOT_STARTED);
  });

  it("should set pendingRepairTrigger with multiple new repositories", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo1",
            branch: "main",
            name: "repo1",
          },
          {
            repositoryUrl: "https://github.com/test/repo2",
            branch: "main",
            name: "repo2",
          },
        ],
        name: "test-swarm",
        poolName: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was set with first repo URL and all repo names
    const swarm = await db.swarm.findFirst({
      where: { workspaceId },
      select: { pendingRepairTrigger: true, podState: true },
    });

    expect(swarm).toBeTruthy();
    expect(swarm?.pendingRepairTrigger).toBeTruthy();

    const trigger = swarm?.pendingRepairTrigger as {
      repoUrl: string;
      repoName: string;
      requestedAt: string;
    };

    expect(trigger.repoUrl).toBe("https://github.com/test/repo1");
    expect(trigger.repoName).toBe("repo1, repo2");
    expect(swarm?.podState).toBe(PodState.NOT_STARTED);
  });

  it("should NOT set pendingRepairTrigger when updating existing repositories", async () => {
    // First create a repository
    const repo = await db.repository.create({
      data: {
        workspaceId,
        repositoryUrl: "https://github.com/test/existing",
        branch: "main",
        name: "existing",
      },
    });

    // Reset swarm state
    await db.swarm.update({
      where: { workspaceId },
      data: {
        pendingRepairTrigger: null,
        podState: PodState.COMPLETED,
      },
    });

    // Update existing repository (should not trigger repair)
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {
            id: repo.id,
            repositoryUrl: "https://github.com/test/existing",
            branch: "develop",
            name: "existing-updated",
          },
        ],
        name: "test-swarm",
        poolName: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was NOT set
    const swarm = await db.swarm.findFirst({
      where: { workspaceId },
      select: { pendingRepairTrigger: true, podState: true },
    });

    expect(swarm).toBeTruthy();
    expect(swarm?.pendingRepairTrigger).toBeNull();
    expect(swarm?.podState).toBe(PodState.COMPLETED);
  });

  it("should set pendingRepairTrigger when adding new repo alongside existing repo", async () => {
    // First create an existing repository
    const existingRepo = await db.repository.create({
      data: {
        workspaceId,
        repositoryUrl: "https://github.com/test/existing",
        branch: "main",
        name: "existing",
      },
    });

    // Reset swarm state
    await db.swarm.update({
      where: { workspaceId },
      data: {
        pendingRepairTrigger: null,
        podState: PodState.COMPLETED,
      },
    });

    // Add a new repository alongside the existing one
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {
            id: existingRepo.id,
            repositoryUrl: "https://github.com/test/existing",
            branch: "main",
            name: "existing",
          },
          {
            repositoryUrl: "https://github.com/test/newrepo",
            branch: "main",
            name: "newrepo",
          },
        ],
        name: "test-swarm",
        poolName: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was set for the new repo only
    const swarm = await db.swarm.findFirst({
      where: { workspaceId },
      select: { pendingRepairTrigger: true, podState: true },
    });

    expect(swarm).toBeTruthy();
    expect(swarm?.pendingRepairTrigger).toBeTruthy();

    const trigger = swarm?.pendingRepairTrigger as {
      repoUrl: string;
      repoName: string;
      requestedAt: string;
    };

    expect(trigger.repoUrl).toBe("https://github.com/test/newrepo");
    expect(trigger.repoName).toBe("newrepo");
    expect(swarm?.podState).toBe(PodState.NOT_STARTED);
  });

  it("should NOT set pendingRepairTrigger when no repositories provided", async () => {
    // Reset swarm state
    await db.swarm.update({
      where: { workspaceId },
      data: {
        pendingRepairTrigger: null,
        podState: PodState.COMPLETED,
      },
    });

    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        name: "test-swarm",
        poolName: "test-pool",
        // No repositories provided
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was NOT set
    const swarm = await db.swarm.findFirst({
      where: { workspaceId },
      select: { pendingRepairTrigger: true, podState: true },
    });

    expect(swarm).toBeTruthy();
    expect(swarm?.pendingRepairTrigger).toBeNull();
    expect(swarm?.podState).toBe(PodState.COMPLETED);
  });
});
