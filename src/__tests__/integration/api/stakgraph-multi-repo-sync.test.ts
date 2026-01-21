import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/swarm/stakgraph/sync/route";
import { PUT } from "@/app/api/workspaces/[slug]/stakgraph/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
  createPostRequest,
  createPutRequest,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";

// Mock external dependencies
vi.mock("@/services/swarm/stakgraph-actions", () => ({
  triggerAsyncSync: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn(),
  };
});

import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

const mockTriggerAsyncSync = triggerAsyncSync as unknown as ReturnType<typeof vi.fn>;
const mockGetGithubUsernameAndPAT = getGithubUsernameAndPAT as unknown as ReturnType<typeof vi.fn>;

describe("Multi-Repository Stakgraph Sync", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "multi_repo_test_key_xyz";

  let testUser: User;
  let testWorkspace: Workspace;
  let testSwarm: Swarm;
  let repo1: Repository;
  let repo2: Repository;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data in transaction
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `multi-repo-user-${generateUniqueId()}@example.com`,
          name: "Multi-Repo Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Multi-Repo Test Workspace",
          slug: generateUniqueSlug("multi-repo-test"),
          ownerId: user.id,
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: "https://test-swarm.sphinx.chat/api",
          swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)),
          services: [],
          agentRequestId: null,
          agentStatus: null,
        },
      });

      const repository1 = await tx.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/test-org/repo1",
          name: "repo1",
          branch: "main",
          status: RepositoryStatus.PENDING,
        },
      });

      const repository2 = await tx.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/test-org/repo2",
          name: "repo2",
          branch: "main",
          status: RepositoryStatus.PENDING,
        },
      });

      return { user, workspace, swarm, repository1, repository2 };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testSwarm = testData.swarm;
    repo1 = testData.repository1;
    repo2 = testData.repository2;

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should sync specific repository when repositoryId provided", async () => {
    mockTriggerAsyncSync.mockResolvedValue({
      ok: true,
      status: 200,
      data: { request_id: "test-request-123" },
    });

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-token",
    });

    const request = createPostRequest("http://localhost:3000/api/swarm/stakgraph/sync", {
      workspaceId: testWorkspace.id,
      repositoryId: repo1.id,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify the correct repository was used
    const updatedRepo = await db.repository.findUnique({
      where: { id: repo1.id },
    });
    expect(updatedRepo?.stakgraphRequestId).toBe("test-request-123");
  });

  it("should fallback to primary repository when no repositoryId provided", async () => {
    mockTriggerAsyncSync.mockResolvedValue({
      ok: true,
      status: 200,
      data: { request_id: "test-request-456" },
    });

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-token",
    });

    const request = createPostRequest("http://localhost:3000/api/swarm/stakgraph/sync", {
      workspaceId: testWorkspace.id,
      // No repositoryId - should use primary (first created)
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Should use repo1 (first created = primary)
    const updatedRepo = await db.repository.findUnique({
      where: { id: repo1.id },
    });
    expect(updatedRepo?.stakgraphRequestId).toBe("test-request-456");
  });

  it("should reject invalid repositoryId from different workspace", async () => {
    // Create another workspace and repository
    const otherData = await db.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: "Other Workspace",
          slug: generateUniqueSlug("other-workspace"),
          ownerId: testUser.id,
        },
      });

      const repository = await tx.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/other-org/repo",
          name: "other-repo",
          branch: "main",
          status: RepositoryStatus.PENDING,
        },
      });

      return { workspace, repository };
    });

    const request = createPostRequest("http://localhost:3000/api/swarm/stakgraph/sync", {
      workspaceId: testWorkspace.id,
      repositoryId: otherData.repository.id, // Repository from different workspace
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.message).toContain("doesn't belong to workspace");

    // Cleanup
    await db.repository.deleteMany({ where: { workspaceId: otherData.workspace.id } });
    await db.workspace.deleteMany({ where: { id: otherData.workspace.id } });
  });

  it("should store stakgraphRequestId in repository record", async () => {
    // First, verify repository doesn't have a request ID
    const beforeRepo = await db.repository.findUnique({
      where: { id: repo2.id },
    });
    expect(beforeRepo?.stakgraphRequestId).toBeNull();

    mockTriggerAsyncSync.mockResolvedValue({
      ok: true,
      status: 200,
      data: { request_id: "test-request-789" },
    });

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-token",
    });

    const request = createPostRequest("http://localhost:3000/api/swarm/stakgraph/sync", {
      workspaceId: testWorkspace.id,
      repositoryId: repo2.id,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Verify stakgraphRequestId was stored
    const afterRepo = await db.repository.findUnique({
      where: { id: repo2.id },
    });
    expect(afterRepo?.stakgraphRequestId).toBe("test-request-789");
  });

  it("should update webhook setup for all repositories", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${testWorkspace.slug}/stakgraph`,
      {
        repositories: [
          {
            id: repo1.id,
            repositoryUrl: "https://github.com/test-org/repo1",
            branch: "main",
            name: "repo1",
          },
          {
            id: repo2.id,
            repositoryUrl: "https://github.com/test-org/repo2",
            branch: "main",
            name: "repo2",
          },
        ],
      }
    );

    const response = await PUT(
      request,
      { params: Promise.resolve({ slug: testWorkspace.slug }) }
    );

    expect(response.status).toBe(200);

    // Verify both repositories still exist
    const repos = await db.repository.findMany({
      where: { workspaceId: testWorkspace.id },
    });
    expect(repos.length).toBe(2);
  });
});
