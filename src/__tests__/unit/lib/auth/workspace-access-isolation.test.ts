import { describe, test, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";

const { dbMock, findActiveMemberMock, getMiddlewareContextMock, checkIsSuperAdminMock, getUserWorkspacesMock } =
  vi.hoisted(() => ({
    dbMock: { workspace: { findFirst: vi.fn() } },
    findActiveMemberMock: vi.fn(),
    getMiddlewareContextMock: vi.fn(),
    checkIsSuperAdminMock: vi.fn(),
    getUserWorkspacesMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/helpers/workspace-member-queries", () => ({ findActiveMember: findActiveMemberMock }));
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: getMiddlewareContextMock,
  checkIsSuperAdmin: checkIsSuperAdminMock,
}));
vi.mock("@/services/workspace", () => ({
  getUserWorkspaces: getUserWorkspacesMock,
  getDefaultWorkspaceForUser: vi.fn(),
  getWorkspaceOrgGithubLogin: vi.fn(),
}));

import { resolveWorkspaceAccess, requireReadAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { validateUserWorkspaceAccess } from "@/lib/auth/workspace-resolver";

const request = {} as NextRequest;
const workspace = { id: "ws1", slug: "acme", ownerId: "owner1", isPublicViewable: false };

function asUser(id: string) {
  getMiddlewareContextMock.mockReturnValue({ authStatus: "authenticated", user: { id } });
}

describe("API-side access: resolveWorkspaceAccess", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    dbMock.workspace.findFirst.mockResolvedValue(workspace);
    findActiveMemberMock.mockResolvedValue(null);
    checkIsSuperAdminMock.mockResolvedValue(false);
  });

  test("refuses a signed-in non-member of a private workspace (403)", async () => {
    asUser("stranger");
    const access = await resolveWorkspaceAccess(request, { slug: "acme" });
    expect(access.kind).toBe("forbidden");
    const res = requireReadAccess(access);
    expect("status" in res && res.status).toBe(403);
    const res2 = requireMemberAccess(access);
    expect("status" in res2 && res2.status).toBe(403);
  });

  test("refuses a user whose membership was removed (leftAt set)", async () => {
    asUser("former");
    // findActiveMember filters leftAt: null, so a removed member yields null
    const access = await resolveWorkspaceAccess(request, { workspaceId: "ws1" });
    expect(findActiveMemberMock).toHaveBeenCalledWith("ws1", "former");
    expect(access.kind).toBe("forbidden");
  });

  test("lets an active member in with their role", async () => {
    asUser("member1");
    findActiveMemberMock.mockResolvedValue({ role: "DEVELOPER" });
    const access = await resolveWorkspaceAccess(request, { slug: "acme" });
    expect(access).toMatchObject({ kind: "member", userId: "member1", role: "DEVELOPER", workspaceId: "ws1" });
  });

  test("lets the owner in", async () => {
    asUser("owner1");
    const access = await resolveWorkspaceAccess(request, { slug: "acme" });
    expect(access).toMatchObject({ kind: "member", role: "OWNER" });
    expect(findActiveMemberMock).not.toHaveBeenCalled();
  });

  test("lets a super admin in on purpose", async () => {
    asUser("root");
    checkIsSuperAdminMock.mockResolvedValue(true);
    const access = await resolveWorkspaceAccess(request, { slug: "acme" });
    expect(access).toMatchObject({ kind: "member", superAdmin: true });
  });

  test("returns not-found for a missing workspace", async () => {
    asUser("stranger");
    dbMock.workspace.findFirst.mockResolvedValue(null);
    expect((await resolveWorkspaceAccess(request, { slug: "nope" })).kind).toBe("not-found");
  });
});

describe("page-side access: validateUserWorkspaceAccess", () => {
  const session = (id: string) => ({ user: { id } }) as unknown as Session;

  beforeEach(() => {
    vi.resetAllMocks();
    getUserWorkspacesMock.mockResolvedValue([{ slug: "mine" }, { slug: "shared" }]);
  });

  test("refuses a non-member slug", async () => {
    expect(await validateUserWorkspaceAccess(session("u1"), "acme")).toBeNull();
  });

  test("refuses with no session", async () => {
    expect(await validateUserWorkspaceAccess(null, "mine")).toBeNull();
  });

  test("allows a slug from the user's own (owned/member) workspaces", async () => {
    expect(await validateUserWorkspaceAccess(session("u1"), "shared")).toBe("shared");
  });

  test("fails closed on lookup error", async () => {
    getUserWorkspacesMock.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await validateUserWorkspaceAccess(session("u1"), "mine")).toBeNull();
    spy.mockRestore();
  });
});
