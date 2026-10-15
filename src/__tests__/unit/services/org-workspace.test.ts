import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/db");

import { getDefaultWorkspaceForOrg, resolveOrgDefaultSwarmWorkspace, setOrgDefaultWorkspaceIfUnset } from "@/lib/helpers/org-workspace";

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

describe("resolveOrgDefaultSwarmWorkspace", () => {
  function setup(opts: {
    org?: { defaultWorkspaceId?: string | null } | null;
    workspace?: unknown | null;
  }) {
    (mockedDb.sourceControlOrg as any) = {
      findUnique: vi.fn(async () => opts.org ?? null),
    };
    (mockedDb.workspace as any) = {
      findFirst: vi.fn(async () => opts.workspace ?? null),
    };
  }

  it("returns the default workspace with its swarm", async () => {
    const workspace = { id: "ws_1", slug: "my-ws", swarm: { id: "swarm_1" } };
    setup({ org: { defaultWorkspaceId: "ws_1" }, workspace });
    const result = await resolveOrgDefaultSwarmWorkspace("acme");
    expect(result).toEqual(workspace);
    expect((mockedDb.workspace as any).findFirst).toHaveBeenCalledWith({
      where: { id: "ws_1", deleted: false },
      include: { swarm: true },
    });
  });

  it("returns null when the org has no default workspace set", async () => {
    setup({ org: { defaultWorkspaceId: null } });
    const result = await resolveOrgDefaultSwarmWorkspace("acme");
    expect(result).toBeNull();
  });

  it("returns null when the org isn't found", async () => {
    setup({ org: null });
    const result = await resolveOrgDefaultSwarmWorkspace("acme");
    expect(result).toBeNull();
  });

  it("returns null when the default workspace is deleted or missing (findFirst filters deleted: false)", async () => {
    setup({ org: { defaultWorkspaceId: "ws_1" }, workspace: null });
    const result = await resolveOrgDefaultSwarmWorkspace("acme");
    expect(result).toBeNull();
  });

  it("returns null when the default workspace has no swarm", async () => {
    setup({ org: { defaultWorkspaceId: "ws_1" }, workspace: { id: "ws_1", slug: "no-swarm", swarm: null } });
    const result = await resolveOrgDefaultSwarmWorkspace("acme");
    expect(result).toBeNull();
  });
});

describe("setOrgDefaultWorkspaceIfUnset", () => {
  function setup(workspace: any, count = 1) {
    const updateMany = vi.fn(async () => ({ count }));
    (mockedDb.workspace as any) = { findFirst: vi.fn(async () => workspace) };
    (mockedDb.sourceControlOrg as any) = { updateMany };
    return updateMany;
  }

  it("sets the default when unset", async () => {
    const updateMany = setup({ sourceControlOrgId: "org_1", swarm: { id: "s", status: "ACTIVE" } });
    expect(await setOrgDefaultWorkspaceIfUnset("ws_1")).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "org_1", defaultWorkspaceId: null },
      data: { defaultWorkspaceId: "ws_1" },
    });
  });

  it("does not overwrite an existing default (count 0)", async () => {
    setup({ sourceControlOrgId: "org_1", swarm: { id: "s", status: "ACTIVE" } }, 0);
    expect(await setOrgDefaultWorkspaceIfUnset("ws_1")).toBe(false);
  });

  it("no-ops when workspace has no org", async () => {
    const updateMany = setup({ sourceControlOrgId: null, swarm: { id: "s", status: "ACTIVE" } });
    expect(await setOrgDefaultWorkspaceIfUnset("ws_1")).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("no-ops when workspace has no swarm or a FAILED swarm", async () => {
    const updateMany = setup({ sourceControlOrgId: "org_1", swarm: null });
    expect(await setOrgDefaultWorkspaceIfUnset("ws_1")).toBe(false);
    setup({ sourceControlOrgId: "org_1", swarm: { id: "s", status: "FAILED" } });
    expect(await setOrgDefaultWorkspaceIfUnset("ws_1")).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns false on unique constraint error", async () => {
    const updateMany = setup({ sourceControlOrgId: "org_1", swarm: { id: "s", status: "ACTIVE" } });
    updateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
    );
    expect(await setOrgDefaultWorkspaceIfUnset("ws_1")).toBe(false);
  });
});
