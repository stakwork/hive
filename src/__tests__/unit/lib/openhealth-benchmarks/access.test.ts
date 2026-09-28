/**
 * Unit tests for `lib/openhealth-benchmarks/access.ts`: the gate every
 * OpenHealth Benchmarks route passes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));

vi.mock("@/lib/auth/workspace-access", () => ({ resolveWorkspaceAccess: mockResolve }));

import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";

const request = () => new NextRequest("http://localhost/api/workspaces/hive/openhealth/benchmarks/runs");
const member = (role: string) => ({ kind: "member", userId: "user-1", workspaceId: "ws-1", slug: "hive", role });

async function status(result: unknown): Promise<number | null> {
  return result instanceof NextResponse ? result.status : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorizeOpenHealth", () => {
  it("answers 404 for a workspace that is not on the list, before looking anything up", async () => {
    expect(await status(await authorizeOpenHealth(request(), "openhealth"))).toBe(404);
    expect(await status(await authorizeOpenHealth(request(), "openlaw"))).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    mockResolve.mockResolvedValue({ kind: "unauthenticated" });
    expect(await status(await authorizeOpenHealth(request(), "hive"))).toBe(401);
  });

  it.each(["forbidden", "not-found", "public-viewer"])("answers 404 for a caller who is %s", async (kind) => {
    mockResolve.mockResolvedValue({ kind });
    expect(await status(await authorizeOpenHealth(request(), "hive"))).toBe(404);
  });

  it("lets any member read", async () => {
    mockResolve.mockResolvedValue(member("VIEWER"));
    expect(await authorizeOpenHealth(request(), "hive")).toMatchObject({ workspaceId: "ws-1", userId: "user-1" });
  });

  it("takes a developer to launch", async () => {
    mockResolve.mockResolvedValue(member("VIEWER"));
    expect(await status(await authorizeOpenHealth(request(), "hive", { launch: true }))).toBe(403);

    mockResolve.mockResolvedValue(member("STAKEHOLDER"));
    expect(await status(await authorizeOpenHealth(request(), "hive", { launch: true }))).toBe(403);

    mockResolve.mockResolvedValue(member("DEVELOPER"));
    expect(await authorizeOpenHealth(request(), "hive", { launch: true })).toMatchObject({ role: "DEVELOPER" });
  });
});
