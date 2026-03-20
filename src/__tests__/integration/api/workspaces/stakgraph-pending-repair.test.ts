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
    setupRepositoryWithWebhook: vi.fn().mockResolvedValue({default_branch: "main" }),
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
    const user = await db.users.create({
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
    const workspace = await db.workspaces.create({
      data: {
        name: "Test Workspace",
        slug: workspaceSlug,owner_id: userId,
      },
    });
    workspaceId = workspace.id;

    // Create workspace member
    await db.workspace_members.create({
      data: {
        workspaceId,
        userId,
        role: "OWNER",
      },
    });

    // Create initial swarm
    await db.swarms.create({
      data: {
        workspaceId,
        name: "test-swarm",
        status: "ACTIVE",pod_state: PodState.COMPLETED,
      },
    });
  });

  it("should set pendingRepairTrigger when adding first repository", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {repository_url: "https://github.com/test/repo1",
            branch: "main",
            name: "repo1",
            triggerPodRepair: true,
          },
        ],
        name: "test-swarm",pool_name: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was set
    const swarm = await db.swarms.findFirst({
      where: { workspaceId },
      select: {pending_repair_trigger: true,pod_state: true },
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
          {repository_url: "https://github.com/test/repo1",
            branch: "main",
            name: "repo1",
            triggerPodRepair: true,
          },
          {repository_url: "https://github.com/test/repo2",
            branch: "main",
            name: "repo2",
            triggerPodRepair: true,
          },
        ],
        name: "test-swarm",pool_name: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was set with first repo URL and all repo names
    const swarm = await db.swarms.findFirst({
      where: { workspaceId },
      select: {pending_repair_trigger: true,pod_state: true },
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
    const repo = await db.repositories.create({
      data: {
        workspaceId,repository_url: "https://github.com/test/existing",
        branch: "main",
        name: "existing",
      },
    });

    // Reset swarm state
    await db.swarms.update({
      where: { workspaceId },
      data: {pending_repair_trigger: null,pod_state: PodState.COMPLETED,
      },
    });

    // Update existing repository (should not trigger repair)
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {
            id: repo.id,repository_url: "https://github.com/test/existing",
            branch: "develop",
            name: "existing-updated",
          },
        ],
        name: "test-swarm",pool_name: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was NOT set
    const swarm = await db.swarms.findFirst({
      where: { workspaceId },
      select: {pending_repair_trigger: true,pod_state: true },
    });

    expect(swarm).toBeTruthy();
    expect(swarm?.pendingRepairTrigger).toBeNull();
    expect(swarm?.podState).toBe(PodState.COMPLETED);
  });

  it("should set pendingRepairTrigger when adding new repo alongside existing repo", async () => {
    // First create an existing repository
    const existingRepo = await db.repositories.create({
      data: {
        workspaceId,repository_url: "https://github.com/test/existing",
        branch: "main",
        name: "existing",
      },
    });

    // Reset swarm state
    await db.swarms.update({
      where: { workspaceId },
      data: {pending_repair_trigger: null,pod_state: PodState.COMPLETED,
      },
    });

    // Add a new repository alongside the existing one
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {
            id: existingRepo.id,repository_url: "https://github.com/test/existing",
            branch: "main",
            name: "existing",
          },
          {repository_url: "https://github.com/test/newrepo",
            branch: "main",
            name: "newrepo",
            triggerPodRepair: true,
          },
        ],
        name: "test-swarm",pool_name: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was set for the new repo only
    const swarm = await db.swarms.findFirst({
      where: { workspaceId },
      select: {pending_repair_trigger: true,pod_state: true },
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
    await db.swarms.update({
      where: { workspaceId },
      data: {pending_repair_trigger: null,pod_state: PodState.COMPLETED,
      },
    });

    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        name: "test-swarm",pool_name: "test-pool",
        // No repositories provided
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    // Verify trigger was NOT set
    const swarm = await db.swarms.findFirst({
      where: { workspaceId },
      select: {pending_repair_trigger: true,pod_state: true },
    });

    expect(swarm).toBeTruthy();
    expect(swarm?.pendingRepairTrigger).toBeNull();
    expect(swarm?.podState).toBe(PodState.COMPLETED);
  });

  it("should NOT set pendingRepairTrigger when triggerPodRepair is false (default)", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {repository_url: "https://github.com/test/repo1",
            branch: "main",
            name: "repo1",
            // triggerPodRepair omitted (defaults to false)
          },
        ],
        name: "test-swarm",pool_name: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    const swarm = await db.swarms.findFirst({
      where: { workspaceId },
      select: {pending_repair_trigger: true,pod_state: true },
    });

    expect(swarm?.pendingRepairTrigger).toBeNull();
    expect(swarm?.podState).toBe(PodState.COMPLETED); // unchanged
  });

  it("should set pendingRepairTrigger when triggerPodRepair is true", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${workspaceSlug}/stakgraph`,
      {
        repositories: [
          {repository_url: "https://github.com/test/repo1",
            branch: "main",
            name: "repo1",
            triggerPodRepair: true,
          },
        ],
        name: "test-swarm",pool_name: "test-pool",
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug: workspaceSlug }),
    });

    expect(response.status).toBe(200);

    const swarm = await db.swarms.findFirst({
      where: { workspaceId },
      select: {pending_repair_trigger: true,pod_state: true },
    });

    expect(swarm?.pendingRepairTrigger).toBeTruthy();
    expect(swarm?.podState).toBe(PodState.NOT_STARTED);
  });
});
