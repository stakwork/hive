import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";
import { createTestUser, createTestRepository } from "@/__tests__/support/factories";
import { createTestTask, createTestChatMessage } from "@/__tests__/support/factories/task.factory";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";

// Mock GitHub API calls so integration tests never hit external services
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/github/pr-stats", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/github/pr-stats")>();
  return {
    ...real,
    getPRCountForRepo: vi.fn().mockResolvedValue({ items: [] }),
  };
});

describe("GET /api/admin/workspaces/[id]/pr-stats (integration)", () => {
  let superAdminUser: User;
  let regularUser: User;
  let workspace: { id: string; name: string; slug: string };

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: `superadmin-prstats-${Date.now()}@test.com`,
      name: "Super Admin",
    });
    regularUser = await createTestUser({
      role: "USER",
      email: `user-prstats-${Date.now()}@test.com`,
      name: "Regular User",
    });

    workspace = await db.workspaces.create({
      data: {
        name: `PR Stats Test Workspace ${Date.now()}`,
        slug: `pr-stats-ws-${Date.now()}`,owner_id: regularUser.id,
      },
      select: { id: true, name: true, slug: true },
    });
  });

  it("returns 403 for non-super-admin users", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspace.id}/pr-stats`,
      regularUser,
    );
    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const response = await GET(request, { params: Promise.resolve({ id: workspace.id }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 for unknown workspace", async () => {
    const fakeId = "cm00000000000000000000000";
    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${fakeId}/pr-stats`,
      superAdminUser,
    );
    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const response = await GET(request, { params: Promise.resolve({ id: fakeId }) });
    expect(response.status).toBe(404);
  });

  it("returns empty repos array when workspace has no repositories", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspace.id}/pr-stats`,
      superAdminUser,
    );
    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const response = await GET(request, { params: Promise.resolve({ id: workspace.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.repos).toEqual([]);
    expect(body.totals.windows).toBeDefined();
    for (const w of ["24h", "48h", "1w", "2w", "1mo"]) {
      expect(body.totals.windows[w].hiveCount).toBe(0);
    }
  });

  it("counts only DONE PR artifacts — excludes open/cancelled", async () => {
    // Create a repository for this workspace
    const repo = await createTestRepository({workspace_id: workspace.id,repository_url: "https://github.com/testorg/testrepo",
    });

    // Helper: create a task → message → PR artifact
    async function seedPRArtifact(status: string, ageHours: number) {
      const task = await createTestTask({workspace_id: workspace.id,created_by_id: regularUser.id,repository_id: repo.id,
      });
      const message = await createTestChatMessage({task_id: task.id, message: "test" });
      const createdAt = new Date(Date.now() - ageHours * 60 * 60 * 1000);
      // Use raw DB insert so we can control created_at
      await db.artifacts.create({
        data: {
          messageId: message.id,
          type: "PULL_REQUEST",
          content: {
            url: `https://github.com/testorg/testrepo/pull/${Math.floor(Math.random() * 9999)}`,
            repo: "testorg/testrepo",
            status,
            title: `Test PR (${status})`,
          },
          createdAt,
        },
      });
    }

    // 2 DONE artifacts within 24h window
    await seedPRArtifact("DONE", 1);
    await seedPRArtifact("DONE", 6);
    // These must NOT be counted
    await seedPRArtifact("open", 2);
    await seedPRArtifact("CANCELLED", 3);

    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspace.id}/pr-stats`,
      superAdminUser,
    );
    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const response = await GET(request, { params: Promise.resolve({ id: workspace.id }) });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].repoName).toBe("testorg/testrepo");

    // Only the 2 DONE artifacts should be counted
    expect(body.repos[0].windows["24h"].hiveCount).toBe(2);
    expect(body.repos[0].windows["48h"].hiveCount).toBe(2);
  });

  it("buckets artifacts into the correct time windows", async () => {
    const repo = await createTestRepository({workspace_id: workspace.id,repository_url: "https://github.com/testorg/bucketrepo",
    });

    async function seedDoneArtifact(ageHours: number) {
      const task = await createTestTask({workspace_id: workspace.id,created_by_id: regularUser.id });
      const message = await createTestChatMessage({task_id: task.id, message: "test" });
      const createdAt = new Date(Date.now() - ageHours * 60 * 60 * 1000);
      await db.artifacts.create({
        data: {
          messageId: message.id,
          type: "PULL_REQUEST",
          content: {
            url: `https://github.com/testorg/bucketrepo/pull/${Math.floor(Math.random() * 9999)}`,
            repo: "testorg/bucketrepo",
            status: "DONE",
            title: "Test PR",
          },
          createdAt,
        },
      });
    }

    // 1 in 24h, 1 more in 24h–48h, 1 more in 48h–1w, 1 more in 1w–2w
    await seedDoneArtifact(12);   // in 24h, 48h, 1w, 2w, 1mo
    await seedDoneArtifact(36);   // in 48h, 1w, 2w, 1mo
    await seedDoneArtifact(5 * 24); // in 1w, 2w, 1mo
    await seedDoneArtifact(10 * 24); // in 2w, 1mo

    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspace.id}/pr-stats`,
      superAdminUser,
    );
    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const response = await GET(request, { params: Promise.resolve({ id: workspace.id }) });
    expect(response.status).toBe(200);

    const body = await response.json();
    const repo0 = body.repos[0];
    expect(repo0.windows["24h"].hiveCount).toBe(1);
    expect(repo0.windows["48h"].hiveCount).toBe(2);
    expect(repo0.windows["1w"].hiveCount).toBe(3);
    expect(repo0.windows["2w"].hiveCount).toBe(4);
    expect(repo0.windows["1mo"].hiveCount).toBe(4);
  });

  it("does not count artifacts older than 30 days", async () => {
    await createTestRepository({workspace_id: workspace.id,repository_url: "https://github.com/testorg/oldrepo",
    });

    const task = await createTestTask({workspace_id: workspace.id,created_by_id: regularUser.id });
    const message = await createTestChatMessage({task_id: task.id, message: "old" });
    // 31 days old — outside the 30-day query window
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.artifacts.create({
      data: {
        messageId: message.id,
        type: "PULL_REQUEST",
        content: { url: "https://github.com/testorg/oldrepo/pull/1", repo: "testorg/oldrepo", status: "DONE", title: "Old PR" },created_at: old,
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/admin/workspaces/${workspace.id}/pr-stats`,
      superAdminUser,
    );
    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const response = await GET(request, { params: Promise.resolve({ id: workspace.id }) });
    const body = await response.json();

    // The artifact's repo doesn't have a configured repository — it won't appear in repos[]
    // totals should all be 0
    for (const w of ["24h", "48h", "1w", "2w", "1mo"]) {
      expect(body.totals.windows[w].hiveCount).toBe(0);
    }
  });
});
