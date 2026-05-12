/**
 * Integration tests for the auto-merge gate on PATCH /api/tickets/[ticketId]
 *
 * These tests hit a real test database and mock only the GitHub API layer
 * (getOctokitForWorkspace + checkRepoAllowsAutoMerge).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { PATCH } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { createTestRepository } from "@/__tests__/support/factories/repository.factory";
import { createAuthenticatedPatchRequest } from "@/__tests__/support/helpers";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// ── Mock the GitHub helpers so no real network calls are made ──────────────

const mockGetOctokitForWorkspace = vi.fn();
const mockCheckRepoAllowsAutoMerge = vi.fn();

vi.mock("@/lib/github", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github")>();
  return {
    ...original,
    getOctokitForWorkspace: (...args: unknown[]) =>
      mockGetOctokitForWorkspace(...args),
    checkRepoAllowsAutoMerge: (...args: unknown[]) =>
      mockCheckRepoAllowsAutoMerge(...args),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

const MOCK_OCTOKIT = { rest: {} } as never;

async function setupTicket(
  options: { repositoryUrl?: string; allowAutoMerge?: boolean } = {}
) {
  const user = await createTestUser();
  const workspace = await createTestWorkspace({
    ownerId: user.id,
    slug: `ws-${Date.now()}`,
  });

  const feature = await db.feature.create({
    data: {
      title: "Feature",
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
    },
  });

  const repo = await createTestRepository({
    workspaceId: workspace.id,
    repositoryUrl:
      options.repositoryUrl ?? "https://github.com/owner/myrepo",
    name: "myrepo",
  });

  // Optionally pre-set the allowAutoMerge cache
  if (options.allowAutoMerge) {
    await db.repository.update({
      where: { id: repo.id },
      data: { allowAutoMerge: true },
    });
  }

  const ticket = await db.task.create({
    data: {
      title: "Test Task",
      workspaceId: workspace.id,
      featureId: feature.id,
      repositoryId: repo.id,
      createdById: user.id,
      updatedById: user.id,
      autoMerge: false,
    },
  });

  return { user, workspace, feature, repo, ticket };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PATCH /api/tickets/[ticketId] — auto-merge gate", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns 409 AUTO_MERGE_NOT_ALLOWED with githubSettingsUrl when GitHub disallows auto-merge", async () => {
    const { user, ticket } = await setupTicket();

    mockGetOctokitForWorkspace.mockResolvedValue(MOCK_OCTOKIT);
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: false });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${ticket.id}`,
      { autoMerge: true },
      user
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticketId: ticket.id }),
    });

    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.code).toBe("AUTO_MERGE_NOT_ALLOWED");
    expect(body.githubSettingsUrl).toBe(
      "https://github.com/owner/myrepo/settings"
    );

    // autoMerge must NOT be persisted
    const dbTask = await db.task.findUnique({
      where: { id: ticket.id },
      select: { autoMerge: true },
    });
    expect(dbTask?.autoMerge).toBe(false);

    // Repository cache must NOT be set
    const dbRepo = await db.repository.findFirst({
      where: { tasks: { some: { id: ticket.id } } },
      select: { allowAutoMerge: true },
    });
    expect(dbRepo?.allowAutoMerge).toBe(false);
  });

  test("returns 200 and persists autoMerge when GitHub allows it", async () => {
    const { user, ticket, repo } = await setupTicket();

    mockGetOctokitForWorkspace.mockResolvedValue(MOCK_OCTOKIT);
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: true });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${ticket.id}`,
      { autoMerge: true },
      user
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticketId: ticket.id }),
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.autoMerge).toBe(true);

    // Task must be persisted
    const dbTask = await db.task.findUnique({
      where: { id: ticket.id },
      select: { autoMerge: true },
    });
    expect(dbTask?.autoMerge).toBe(true);

    // Repository cache must be set to true (one-way cache)
    const dbRepo = await db.repository.findUnique({
      where: { id: repo.id },
      select: { allowAutoMerge: true },
    });
    expect(dbRepo?.allowAutoMerge).toBe(true);
  });

  test("returns 200 without calling GitHub when allowAutoMerge already cached on repo", async () => {
    const { user, ticket } = await setupTicket({ allowAutoMerge: true });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${ticket.id}`,
      { autoMerge: true },
      user
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticketId: ticket.id }),
    });

    expect(response.status).toBe(200);

    // GitHub must NOT be called
    expect(mockGetOctokitForWorkspace).not.toHaveBeenCalled();
    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();

    const dbTask = await db.task.findUnique({
      where: { id: ticket.id },
      select: { autoMerge: true },
    });
    expect(dbTask?.autoMerge).toBe(true);
  });

  test("returns 502 AUTO_MERGE_CHECK_FAILED when GitHub check returns an error", async () => {
    const { user, ticket } = await setupTicket();

    mockGetOctokitForWorkspace.mockResolvedValue(MOCK_OCTOKIT);
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({
      allowed: false,
      error: "permission_denied",
    });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${ticket.id}`,
      { autoMerge: true },
      user
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticketId: ticket.id }),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("AUTO_MERGE_CHECK_FAILED");
  });

  test("returns 502 AUTO_MERGE_CHECK_FAILED when octokit is unavailable (no GitHub token)", async () => {
    const { user, ticket } = await setupTicket();

    mockGetOctokitForWorkspace.mockResolvedValue(null); // no token

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${ticket.id}`,
      { autoMerge: true },
      user
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticketId: ticket.id }),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("AUTO_MERGE_CHECK_FAILED");
  });

  test("skips GitHub check and returns 200 when task has no repository (workflow task)", async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      slug: `ws-wf-${Date.now()}`,
    });
    const feature = await db.feature.create({
      data: {
        title: "Feature",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const ticket = await db.task.create({
      data: {
        title: "Workflow Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        repositoryId: null, // no repo
        createdById: user.id,
        updatedById: user.id,
        autoMerge: false,
      },
    });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${ticket.id}`,
      { autoMerge: true },
      user
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticketId: ticket.id }),
    });

    expect(response.status).toBe(200);
    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();
  });

  test("does not run any GitHub check when toggling auto-merge OFF", async () => {
    const { user, ticket } = await setupTicket();
    // Pre-set to true so we're toggling OFF
    await db.task.update({ where: { id: ticket.id }, data: { autoMerge: true } });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${ticket.id}`,
      { autoMerge: false },
      user
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticketId: ticket.id }),
    });

    expect(response.status).toBe(200);
    expect(mockGetOctokitForWorkspace).not.toHaveBeenCalled();
    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();

    const dbTask = await db.task.findUnique({
      where: { id: ticket.id },
      select: { autoMerge: true },
    });
    expect(dbTask?.autoMerge).toBe(false);
  });
});
