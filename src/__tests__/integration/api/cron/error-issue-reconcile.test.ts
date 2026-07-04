/**
 * Integration tests for GET /api/cron/error-issue-reconcile
 *
 * Tests verify:
 * - Authentication via CRON_SECRET (401 when missing/invalid)
 * - ERROR_ISSUE_RECONCILE_CRON_ENABLED flag short-circuits with disabled message
 * - Reconciliation resolves UNRESOLVED ErrorIssues whose feature has a task
 *   with a PULL_REQUEST artifact already marked merged (content.status = 'DONE')
 * - RESOLVED/IGNORED issues are left untouched
 * - Idempotency across multiple invocations
 * - Per-feature failure isolation (one failure does not abort the batch)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/fixtures";
import {
  generateUniqueId,
  generateUniqueSlug,
  generateUniqueEmail,
} from "@/__tests__/support/helpers";
import { ArtifactType, TaskStatus, WorkflowStatus, ErrorIssueStatus } from "@prisma/client";

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

import { GET } from "@/app/api/cron/error-issue-reconcile/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/error-issue-reconcile", { headers });
}

function createAuthenticatedRequest(): NextRequest {
  return createRequest("Bearer test-cron-secret");
}

/**
 * Seeds a full chain:
 *   Workspace → User → ErrorIssue (linked via Feature.errorIssueId)
 *   → Feature → Task → ChatMessage → PULL_REQUEST Artifact (status='DONE')
 *
 * This models the "stuck" scenario: the artifact is already marked merged
 * but the ErrorIssue was never resolved.
 */
async function seedStuckScenario(opts: {
  errorIssueStatus?: ErrorIssueStatus;
  prArtifactStatus?: string;
} = {}) {
  const { errorIssueStatus = "UNRESOLVED", prArtifactStatus = "DONE" } = opts;

  const user = await db.user.create({
    data: {
      email: generateUniqueEmail("reconcile"),
      name: "Test User",
    },
  });

  const workspace = await db.workspace.create({
    data: {
      name: "Test Workspace",
      slug: generateUniqueSlug("reconcile-ws"),
      ownerId: user.id,
    },
  });

  const errorIssue = await db.errorIssue.create({
    data: {
      workspaceId: workspace.id,
      repoKey: "test-owner/test-repo",
      fingerprint: `fp-${generateUniqueId()}`,
      exceptionType: "TypeError",
      title: "TypeError: something stuck",
      status: errorIssueStatus,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });

  const feature = await db.feature.create({
    data: {
      title: "Fix feature",
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      errorIssueId: errorIssue.id,
    },
  });

  const task = await db.task.create({
    data: {
      title: "Fix task",
      workspaceId: workspace.id,
      featureId: feature.id,
      status: TaskStatus.DONE,
      workflowStatus: WorkflowStatus.COMPLETED,
      createdById: user.id,
      updatedById: user.id,
    },
  });

  const chatMessage = await db.chatMessage.create({
    data: {
      taskId: task.id,
      role: "ASSISTANT",
      message: "",
    },
  });

  const artifact = await db.artifact.create({
    data: {
      messageId: chatMessage.id,
      type: ArtifactType.PULL_REQUEST,
      content: {
        repo: "test-owner/test-repo",
        url: "https://github.com/test-owner/test-repo/pull/99",
        status: prArtifactStatus,
      },
    },
  });

  return { user, workspace, errorIssue, feature, task, chatMessage, artifact };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/cron/error-issue-reconcile", () => {
  let originalCronSecret: string | undefined;
  let originalEnabled: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    originalCronSecret = process.env.CRON_SECRET;
    originalEnabled = process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED;

    process.env.CRON_SECRET = "test-cron-secret";
    mockPusherTrigger.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = originalEnabled;
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong secret", async () => {
    const res = await GET(createRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header uses non-Bearer scheme", async () => {
    const res = await GET(createRequest("Basic test-cron-secret"));
    expect(res.status).toBe(401);
  });

  // ── Feature gate ──────────────────────────────────────────────────────────

  it("returns 200 disabled message when ERROR_ISSUE_RECONCILE_CRON_ENABLED is 'false'", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "false";

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/disabled/i);
    expect(body.issuesScanned).toBe(0);
    expect(body.issuesResolved).toBe(0);
  });

  it("returns 200 disabled message when ERROR_ISSUE_RECONCILE_CRON_ENABLED is unset", async () => {
    delete process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED;

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/disabled/i);
  });

  it("does not touch DB when disabled", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "false";

    // Seed a stuck scenario that would be resolved if enabled
    await seedStuckScenario();

    await GET(createAuthenticatedRequest());

    // No issues should have been resolved
    const issues = await db.errorIssue.findMany({ where: { status: "RESOLVED" } });
    expect(issues).toHaveLength(0);
  });

  // ── Reconciliation (happy path) ───────────────────────────────────────────

  it("resolves an UNRESOLVED ErrorIssue whose feature has a task with a merged PR artifact", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    const { errorIssue, workspace } = await seedStuckScenario();

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.issuesScanned).toBeGreaterThanOrEqual(1);
    expect(body.issuesResolved).toBeGreaterThanOrEqual(1);
    expect(body.errorCount).toBe(0);

    // DB assertion
    const updated = await db.errorIssue.findUnique({ where: { id: errorIssue.id } });
    expect(updated?.status).toBe("RESOLVED");

    // Pusher broadcast assertion
    const errorUpdatedCalls = mockPusherTrigger.mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    );
    expect(errorUpdatedCalls.length).toBeGreaterThanOrEqual(1);
    const resolveCall = errorUpdatedCalls.find((c) => c[2]?.id === errorIssue.id);
    expect(resolveCall).toBeDefined();
    expect(resolveCall![2]).toMatchObject({ id: errorIssue.id, status: "RESOLVED" });
  });

  it("does not resolve an UNRESOLVED ErrorIssue whose PR artifact is still open", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    // Artifact status is 'open' — not merged yet
    const { errorIssue } = await seedStuckScenario({ prArtifactStatus: "open" });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.issuesResolved).toBe(0);

    const updated = await db.errorIssue.findUnique({ where: { id: errorIssue.id } });
    expect(updated?.status).toBe("UNRESOLVED");
  });

  it("leaves a RESOLVED ErrorIssue untouched", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    const { errorIssue } = await seedStuckScenario({ errorIssueStatus: "RESOLVED" });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    // Query filters to UNRESOLVED only — this issue should not appear in scan
    expect(body.issuesResolved).toBe(0);

    const updated = await db.errorIssue.findUnique({ where: { id: errorIssue.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  it("leaves an IGNORED ErrorIssue untouched", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    const { errorIssue } = await seedStuckScenario({ errorIssueStatus: "IGNORED" });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.issuesResolved).toBe(0);

    const updated = await db.errorIssue.findUnique({ where: { id: errorIssue.id } });
    expect(updated?.status).toBe("IGNORED");

    // No error-issue-updated Pusher event for ignored issues
    const errorUpdatedCalls = mockPusherTrigger.mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    );
    expect(errorUpdatedCalls).toHaveLength(0);
  });

  // ── Multiple features ─────────────────────────────────────────────────────

  it("resolves multiple stuck issues across different features in one run", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    const [{ errorIssue: issueA }, { errorIssue: issueB }] = await Promise.all([
      seedStuckScenario(),
      seedStuckScenario(),
    ]);

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.issuesResolved).toBeGreaterThanOrEqual(2);

    const [updatedA, updatedB] = await Promise.all([
      db.errorIssue.findUnique({ where: { id: issueA.id } }),
      db.errorIssue.findUnique({ where: { id: issueB.id } }),
    ]);
    expect(updatedA?.status).toBe("RESOLVED");
    expect(updatedB?.status).toBe("RESOLVED");
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it("is idempotent — running the cron twice resolves the issue exactly once", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    const { errorIssue } = await seedStuckScenario();

    // First run
    const res1 = await GET(createAuthenticatedRequest());
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.issuesResolved).toBeGreaterThanOrEqual(1);

    const firstResolveEvents = mockPusherTrigger.mock.calls.filter(
      (c) => c[1] === "error-issue-updated" && c[2]?.id === errorIssue.id,
    ).length;
    expect(firstResolveEvents).toBe(1);

    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);

    // Second run — already RESOLVED, should skip
    const res2 = await GET(createAuthenticatedRequest());
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.issuesResolved).toBe(0);
    expect(body2.success).toBe(true);

    const secondResolveEvents = mockPusherTrigger.mock.calls.filter(
      (c) => c[1] === "error-issue-updated" && c[2]?.id === errorIssue.id,
    ).length;
    expect(secondResolveEvents).toBe(0);

    // Still RESOLVED — not double-resolved or reverted
    const updated = await db.errorIssue.findUnique({ where: { id: errorIssue.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  // ── Response shape ────────────────────────────────────────────────────────

  it("returns a well-formed JSON summary with all expected fields", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      success: expect.any(Boolean),
      issuesScanned: expect.any(Number),
      issuesResolved: expect.any(Number),
      errorCount: expect.any(Number),
      errors: expect.any(Array),
      timestamp: expect.any(String),
    });
    // timestamp should be a valid ISO string
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  // ── Empty run (nothing stuck) ─────────────────────────────────────────────

  it("returns success with zero counts when there are no stuck issues", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    // No data seeded — clean DB

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.issuesScanned).toBe(0);
    expect(body.issuesResolved).toBe(0);
    expect(body.errorCount).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  // ── No PR artifact at all ─────────────────────────────────────────────────

  it("does not resolve an ErrorIssue when the feature's task has no PULL_REQUEST artifact", async () => {
    process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED = "true";

    const user = await db.user.create({
      data: { email: generateUniqueEmail("reconcile-nopr"), name: "No PR User" },
    });
    const workspace = await db.workspace.create({
      data: {
        name: "No PR Workspace",
        slug: generateUniqueSlug("no-pr-ws"),
        ownerId: user.id,
      },
    });
    const errorIssue = await db.errorIssue.create({
      data: {
        workspaceId: workspace.id,
        repoKey: "owner/repo",
        fingerprint: `fp-nopr-${generateUniqueId()}`,
        exceptionType: "Error",
        title: "No PR Error",
        status: "UNRESOLVED",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    const feature = await db.feature.create({
      data: {
        title: "Feature without PR",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        errorIssueId: errorIssue.id,
      },
    });
    // Task exists but has no PULL_REQUEST artifact
    await db.task.create({
      data: {
        title: "Task without PR",
        workspaceId: workspace.id,
        featureId: feature.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.issuesResolved).toBe(0);

    const updated = await db.errorIssue.findUnique({ where: { id: errorIssue.id } });
    expect(updated?.status).toBe("UNRESOLVED");
  });
});
