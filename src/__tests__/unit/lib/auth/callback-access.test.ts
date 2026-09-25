/**
 * Unit tests for src/lib/auth/callback-access.ts:
 *  - authenticateCallbackRequest
 *  - parseCallbackIds
 *  - authorizeCallbackTargets
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth/caller-token", () => ({
  classifyCallerToken: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: { findFirst: vi.fn() },
    feature: { findFirst: vi.fn() },
    stakworkRun: { findMany: vi.fn() },
  },
}));

import {
  authenticateCallbackRequest,
  authorizeCallbackTargets,
  parseCallbackIds,
} from "@/lib/auth/callback-access";
import { classifyCallerToken } from "@/lib/auth/caller-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/chat/response", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authenticateCallbackRequest", () => {
  test("system token passes with no DB calls and is not rate-limited", async () => {
    vi.mocked(classifyCallerToken).mockResolvedValue({ kind: "system" });

    const result = await authenticateCallbackRequest(makeRequest());

    expect(result).toEqual({ kind: "system" });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test("valid org key passes and is rate-limited by apiKeyId", async () => {
    vi.mocked(classifyCallerToken).mockResolvedValue({
      kind: "org",
      orgId: "org-1",
      apiKeyId: "key-1",
      validated: { apiKey: { id: "key-1", name: "x", createdById: "u1" }, orgId: "org-1" },
    });
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });

    const result = await authenticateCallbackRequest(makeRequest());

    expect(result).toEqual({ kind: "org", orgId: "org-1", apiKeyId: "key-1" });
    expect(checkRateLimit).toHaveBeenCalledWith("callback:key-1", expect.any(Number), expect.any(Number));
  });

  test("missing/invalid token → 401", async () => {
    vi.mocked(classifyCallerToken).mockResolvedValue(null);

    const result = await authenticateCallbackRequest(makeRequest());

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  test("rate limit exceeded → 429 with no target reads", async () => {
    vi.mocked(classifyCallerToken).mockResolvedValue({
      kind: "org",
      orgId: "org-1",
      apiKeyId: "key-1",
      validated: { apiKey: { id: "key-1", name: "x", createdById: "u1" }, orgId: "org-1" },
    });
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 42 });

    const result = await authenticateCallbackRequest(makeRequest());

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(429);
    expect((result as NextResponse).headers.get("Retry-After")).toBe("42");
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.feature.findFirst).not.toHaveBeenCalled();
    expect(db.stakworkRun.findMany).not.toHaveBeenCalled();
  });

  test("rate limiter throwing fails open (best-effort, not an authz control)", async () => {
    vi.mocked(classifyCallerToken).mockResolvedValue({
      kind: "org",
      orgId: "org-1",
      apiKeyId: "key-1",
      validated: { apiKey: { id: "key-1", name: "x", createdById: "u1" }, orgId: "org-1" },
    });
    vi.mocked(checkRateLimit).mockRejectedValue(new Error("redis down"));

    const result = await authenticateCallbackRequest(makeRequest());

    expect(result).toEqual({ kind: "org", orgId: "org-1", apiKeyId: "key-1" });
  });
});

describe("parseCallbackIds", () => {
  test("accepts valid string taskId/featureId and numeric stakworkRunId", () => {
    const result = parseCallbackIds({
      taskId: "task-abc123",
      featureId: "feature-xyz789",
      stakworkRunId: "42",
    });
    expect(result).toEqual({
      taskId: "task-abc123",
      featureId: "feature-xyz789",
      stakworkProjectId: 42,
    });
  });

  test("returns {} when nothing is provided", () => {
    expect(parseCallbackIds({})).toEqual({});
  });

  test("rejects an object taskId → 400", () => {
    const result = parseCallbackIds({ taskId: { $ne: null } as unknown as string });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  test("rejects an array featureId → 400", () => {
    const result = parseCallbackIds({ featureId: ["a", "b"] as unknown as string });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  test("rejects a NaN stakworkRunId → 400", () => {
    const result = parseCallbackIds({ stakworkRunId: "not-a-number" });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  test("rejects a non-positive stakworkRunId → 400", () => {
    const result = parseCallbackIds({ stakworkRunId: -5 });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  test("rejects a non-integer stakworkRunId → 400", () => {
    const result = parseCallbackIds({ stakworkRunId: 4.5 });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });
});

describe("authorizeCallbackTargets", () => {
  test("system callers pass straight through with no DB reads", async () => {
    const result = await authorizeCallbackTargets({ kind: "system" }, { taskId: "t1" });

    expect(result).toEqual({ caller: { kind: "system" } });
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });

  test("org caller with no ids → 400", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };

    const result = await authorizeCallbackTargets(caller, {});

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  test("task in caller's org resolves the workspace", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.task.findFirst).mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { sourceControlOrgId: "org-1" },
    } as never);

    const result = await authorizeCallbackTargets(caller, { taskId: "t1" });

    expect(result).toEqual({ caller, workspaceId: "ws-1" });
  });

  test("task not found → 404", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.task.findFirst).mockResolvedValue(null);

    const result = await authorizeCallbackTargets(caller, { taskId: "missing" });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
  });

  test("task in another org → 404 (indistinguishable from not-found)", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.task.findFirst).mockResolvedValue({
      workspaceId: "ws-2",
      workspace: { sourceControlOrgId: "org-2" },
    } as never);

    const result = await authorizeCallbackTargets(caller, { taskId: "t2" });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
  });

  test("workspace with null sourceControlOrgId is denied (404)", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.task.findFirst).mockResolvedValue({
      workspaceId: "ws-3",
      workspace: { sourceControlOrgId: null },
    } as never);

    const result = await authorizeCallbackTargets(caller, { taskId: "t3" });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
  });

  test("feature in another org → 404", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.feature.findFirst).mockResolvedValue({
      workspaceId: "ws-2",
      workspace: { sourceControlOrgId: "org-2" },
    } as never);

    const result = await authorizeCallbackTargets(caller, { featureId: "f2" });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
  });

  test("task and feature resolve to the same workspace → ok", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.task.findFirst).mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { sourceControlOrgId: "org-1" },
    } as never);
    vi.mocked(db.feature.findFirst).mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { sourceControlOrgId: "org-1" },
    } as never);

    const result = await authorizeCallbackTargets(caller, { taskId: "t1", featureId: "f1" });

    expect(result).toEqual({ caller, workspaceId: "ws-1" });
  });

  test("task and feature resolve to different workspaces (same org) → 400 ambiguous_workspace", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.task.findFirst).mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { sourceControlOrgId: "org-1" },
    } as never);
    vi.mocked(db.feature.findFirst).mockResolvedValue({
      workspaceId: "ws-2",
      workspace: { sourceControlOrgId: "org-1" },
    } as never);

    const result = await authorizeCallbackTargets(caller, { taskId: "t1", featureId: "f1" });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  test("a run projectId shared with another org resolves only to the caller's run", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    // The mock simulates the DB query already being scoped to caller.orgId —
    // only the caller's own run comes back even though another org has a run
    // with the same projectId.
    vi.mocked(db.stakworkRun.findMany).mockResolvedValue([
      { workspaceId: "ws-1" },
    ] as never);

    const result = await authorizeCallbackTargets(caller, { stakworkProjectId: 999 });

    expect(result).toEqual({ caller, workspaceId: "ws-1" });
    expect(db.stakworkRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 999,
          workspace: expect.objectContaining({ sourceControlOrgId: "org-1", deleted: false }),
        }),
      }),
    );
  });

  test("run not found for caller's org → 404", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.stakworkRun.findMany).mockResolvedValue([]);

    const result = await authorizeCallbackTargets(caller, { stakworkProjectId: 999 });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
  });

  test("mixed-org ids (task ok, run belongs elsewhere) → 404", async () => {
    const caller = { kind: "org" as const, orgId: "org-1", apiKeyId: "key-1" };
    vi.mocked(db.task.findFirst).mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { sourceControlOrgId: "org-1" },
    } as never);
    // Narrowed by task's workspace — no matching run in ws-1 → empty.
    vi.mocked(db.stakworkRun.findMany).mockResolvedValue([]);

    const result = await authorizeCallbackTargets(caller, {
      taskId: "t1",
      stakworkProjectId: 555,
    });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
  });
});
