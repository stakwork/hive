import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import {
  resolveUserWorkspaceRedirect,
  validateUserWorkspaceAccess,
} from "@/lib/auth/workspace-resolver";
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { redirect } from "next/navigation";
import * as workspaceSvc from "@/services/workspace";

vi.mock("@/services/workspace", () => ({
  getUserWorkspaces: vi.fn(),
  getDefaultWorkspaceForUser: vi.fn(),
}));

describe("workspace-resolver", () => {
  const { getUserWorkspaces, getDefaultWorkspaceForUser } = workspaceSvc as unknown as {
    getUserWorkspaces: ReturnType<typeof vi.fn>;
    getDefaultWorkspaceForUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const makeSession = (id?: string): Session | null =>
    id
      ? ({ user: { id } } as unknown as Session)
      : ({ user: undefined } as unknown as Session);

  describe("resolveUserWorkspaceRedirect", () => {
    it("redirects to signin when no user in session", async () => {
      const res = await resolveUserWorkspaceRedirect(null);
      expect(res).toEqual({
        shouldRedirect: true,
        redirectUrl: "/auth/signin",
        workspaceCount: 0,
      });
    });

    it("redirects to onboarding when user has 0 workspaces", async () => {
      getUserWorkspaces.mockResolvedValueOnce([]);
      const res = await resolveUserWorkspaceRedirect(makeSession("u1"));
      expect(res.redirectUrl).toBe("/onboarding/workspace");
      expect(res.workspaceCount).toBe(0);
    });

    it("redirects to the single workspace when exactly one exists", async () => {
      getUserWorkspaces.mockResolvedValueOnce([{ slug: "s1" }]);
      const res = await resolveUserWorkspaceRedirect(makeSession("u1"));
      expect(res.redirectUrl).toBe("/w/s1");
      expect(res.defaultWorkspaceSlug).toBe("s1");
      expect(res.workspaceCount).toBe(1);
    });

    it("redirects to default workspace when multiple exist and default present", async () => {
      getUserWorkspaces.mockResolvedValueOnce([{ slug: "a" }, { slug: "b" }]);
      getDefaultWorkspaceForUser.mockResolvedValueOnce({ slug: "b" });
      const res = await resolveUserWorkspaceRedirect(makeSession("u1"));
      expect(res.redirectUrl).toBe("/w/b");
      expect(res.defaultWorkspaceSlug).toBe("b");
      expect(res.workspaceCount).toBe(2);
    });

    it("falls back to first workspace when no default set", async () => {
      getUserWorkspaces.mockResolvedValueOnce([{ slug: "a" }, { slug: "b" }]);
      getDefaultWorkspaceForUser.mockResolvedValueOnce(null);
      const res = await resolveUserWorkspaceRedirect(makeSession("u1"));
      expect(res.redirectUrl).toBe("/w/a");
      expect(res.defaultWorkspaceSlug).toBe("a");
      expect(res.workspaceCount).toBe(2);
    });

    it("on service error, redirects to onboarding", async () => {
      getUserWorkspaces.mockRejectedValueOnce(new Error("db down"));
      const res = await resolveUserWorkspaceRedirect(makeSession("u1"));
      expect(res.redirectUrl).toBe("/onboarding/workspace");
      expect(res.workspaceCount).toBe(0);
    });
  });

  describe("validateUserWorkspaceAccess", () => {
    it("returns null when no session user", async () => {
      const res = await validateUserWorkspaceAccess(null, "slug");
      expect(res).toBeNull();
    });

    it("returns slug when user has access", async () => {
      getUserWorkspaces.mockResolvedValueOnce([{ slug: "x" }]);
      const res = await validateUserWorkspaceAccess(makeSession("u"), "x");
      expect(res).toBe("x");
    });

    it("returns null when user lacks access or on error", async () => {
      getUserWorkspaces.mockResolvedValueOnce([{ slug: "x" }]);
      const res1 = await validateUserWorkspaceAccess(makeSession("u"), "y");
      expect(res1).toBeNull();

      getUserWorkspaces.mockRejectedValueOnce(new Error("boom"));
      const res2 = await validateUserWorkspaceAccess(makeSession("u"), "x");
      expect(res2).toBeNull();
    });
  });

  it("handleWorkspaceRedirect redirects to computed URL", async () => {
    const { handleWorkspaceRedirect } = await import("@/lib/auth/workspace-resolver");
    (getUserWorkspaces as any).mockResolvedValueOnce([{ slug: "s1" }]);
    await handleWorkspaceRedirect(makeSession("u1"));
    expect(redirect).toHaveBeenCalledWith("/w/s1");
  });
});


