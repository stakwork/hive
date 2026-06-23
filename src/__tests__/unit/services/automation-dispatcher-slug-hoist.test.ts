/**
 * Unit tests for `resolveOrgWorkspaceSlugs` default-slug hoisting
 * in src/services/automation-dispatcher.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db");

const mockedDb = vi.mocked(db);

// Import AFTER mock is set up
import { resolveOrgWorkspaceSlugs } from "@/services/automation-dispatcher";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeOrg(defaultWorkspaceId: string | null) {
  return { defaultWorkspaceId };
}

function makeWorkspace(id: string, slug: string) {
  return { id, slug };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("resolveOrgWorkspaceSlugs — default slug hoisting", () => {
  const orgId = "org-abc";
  const userId = "user-xyz";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hoists default workspace slug to index 0 when it is in the accessible list", async () => {
    const ws1 = makeWorkspace("ws-1", "alpha");
    const ws2 = makeWorkspace("ws-2", "beta");
    const ws3 = makeWorkspace("ws-3", "gamma");

    mockedDb.sourceControlOrg.findUnique = vi.fn().mockResolvedValue(makeOrg("ws-2"));
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([ws1, ws2, ws3]);

    const slugs = await resolveOrgWorkspaceSlugs(orgId, userId);

    expect(slugs[0]).toBe("beta");
    expect(slugs).toEqual(["beta", "alpha", "gamma"]);
  });

  it("hoists default workspace slug to index 0 when it is already first (no-op reorder)", async () => {
    const ws1 = makeWorkspace("ws-1", "alpha");
    const ws2 = makeWorkspace("ws-2", "beta");

    mockedDb.sourceControlOrg.findUnique = vi.fn().mockResolvedValue(makeOrg("ws-1"));
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([ws1, ws2]);

    const slugs = await resolveOrgWorkspaceSlugs(orgId, userId);

    expect(slugs[0]).toBe("alpha");
    expect(slugs).toEqual(["alpha", "beta"]);
  });

  it("preserves original ordering when default workspace ID is not in accessible list", async () => {
    const ws1 = makeWorkspace("ws-1", "alpha");
    const ws2 = makeWorkspace("ws-2", "beta");

    // org has a defaultWorkspaceId that didn't pass the query filter
    mockedDb.sourceControlOrg.findUnique = vi.fn().mockResolvedValue(makeOrg("ws-inaccessible"));
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([ws1, ws2]);

    const slugs = await resolveOrgWorkspaceSlugs(orgId, userId);

    expect(slugs).toEqual(["alpha", "beta"]);
  });

  it("preserves original ordering when no default is set (null)", async () => {
    const ws1 = makeWorkspace("ws-1", "alpha");
    const ws2 = makeWorkspace("ws-2", "beta");
    const ws3 = makeWorkspace("ws-3", "gamma");

    mockedDb.sourceControlOrg.findUnique = vi.fn().mockResolvedValue(makeOrg(null));
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([ws1, ws2, ws3]);

    const slugs = await resolveOrgWorkspaceSlugs(orgId, userId);

    expect(slugs).toEqual(["alpha", "beta", "gamma"]);
  });

  it("preserves original ordering when org row is not found", async () => {
    const ws1 = makeWorkspace("ws-1", "alpha");
    const ws2 = makeWorkspace("ws-2", "beta");

    mockedDb.sourceControlOrg.findUnique = vi.fn().mockResolvedValue(null);
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([ws1, ws2]);

    const slugs = await resolveOrgWorkspaceSlugs(orgId, userId);

    expect(slugs).toEqual(["alpha", "beta"]);
  });

  it("returns empty array when no accessible workspaces", async () => {
    mockedDb.sourceControlOrg.findUnique = vi.fn().mockResolvedValue(makeOrg("ws-1"));
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([]);

    const slugs = await resolveOrgWorkspaceSlugs(orgId, userId);

    expect(slugs).toEqual([]);
  });
});
