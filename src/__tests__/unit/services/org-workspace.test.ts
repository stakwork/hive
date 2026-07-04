import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db");

import { getDefaultWorkspaceForOrg } from "@/lib/helpers/org-workspace";

const mockedDb = vi.mocked(db, true);

function setupOrg(opts: {
  org?: {
    defaultWorkspaceId?: string | null;
    defaultWorkspace?: { id: string; slug: string; swarm: { id: string } | null } | null;
  } | null;
}) {
  (mockedDb.sourceControlOrg as any) = {
    findUnique: vi.fn(async () => opts.org ?? null),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDefaultWorkspaceForOrg", () => {
  it("returns workspace id and slug when org has defaultWorkspace with swarm", async () => {
    setupOrg({
      org: {
        defaultWorkspaceId: "ws_1",
        defaultWorkspace: { id: "ws_1", slug: "my-workspace", swarm: { id: "swarm_1" } },
      },
    });
    const result = await getDefaultWorkspaceForOrg("org_1");
    expect(result).toEqual({ id: "ws_1", slug: "my-workspace" });
  });

  it("returns null when org is not found", async () => {
    setupOrg({ org: null });
    const result = await getDefaultWorkspaceForOrg("nonexistent");
    expect(result).toBeNull();
  });

  it("returns null when org has no defaultWorkspaceId", async () => {
    setupOrg({
      org: {
        defaultWorkspaceId: null,
        defaultWorkspace: null,
      },
    });
    const result = await getDefaultWorkspaceForOrg("org_1");
    expect(result).toBeNull();
  });

  it("returns null when defaultWorkspace is null (id set but workspace missing)", async () => {
    setupOrg({
      org: {
        defaultWorkspaceId: "ws_1",
        defaultWorkspace: null,
      },
    });
    const result = await getDefaultWorkspaceForOrg("org_1");
    expect(result).toBeNull();
  });

  it("returns null when workspace has no swarm", async () => {
    setupOrg({
      org: {
        defaultWorkspaceId: "ws_1",
        defaultWorkspace: { id: "ws_1", slug: "no-swarm-ws", swarm: null },
      },
    });
    const result = await getDefaultWorkspaceForOrg("org_1");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when db throws", async () => {
    (mockedDb.sourceControlOrg as any) = {
      findUnique: vi.fn(async () => { throw new Error("DB down"); }),
    };
    const result = await getDefaultWorkspaceForOrg("org_1");
    expect(result).toBeNull();
  });
});
