import { describe, test, expect, vi, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { backfillOrgDefaultWorkspaces } from "@/services/backfill-org-default-workspace";

function makeMockClient() {
  return {
    sourceControlOrg: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workspace: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;
}

const org = { id: "org-1", githubLogin: "acme" };

describe("backfillOrgDefaultWorkspaces", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  test("only queries orgs with null defaultWorkspaceId", async () => {
    vi.mocked(client.sourceControlOrg.findMany).mockResolvedValue([]);
    const res = await backfillOrgDefaultWorkspaces(client, { dryRun: false });
    expect(vi.mocked(client.sourceControlOrg.findMany).mock.calls[0][0]?.where).toEqual({
      defaultWorkspaceId: null,
    });
    expect(res.scanned).toBe(0);
  });

  test("picks the oldest eligible workspace and updates with guard", async () => {
    vi.mocked(client.sourceControlOrg.findMany).mockResolvedValue([org] as any);
    vi.mocked(client.workspace.findFirst).mockResolvedValue({ id: "ws-1", defaultForOrg: null } as any);

    const res = await backfillOrgDefaultWorkspaces(client, { dryRun: false });

    const args = vi.mocked(client.workspace.findFirst).mock.calls[0][0]!;
    expect(args.where).toEqual({
      sourceControlOrgId: "org-1",
      deleted: false,
      swarm: { isNot: null },
    });
    expect(args.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(client.sourceControlOrg.updateMany).toHaveBeenCalledWith({
      where: { id: "org-1", defaultWorkspaceId: null },
      data: { defaultWorkspaceId: "ws-1" },
    });
    expect(res.updated).toBe(1);
    expect(res.results).toEqual([
      { orgId: "org-1", githubLogin: "acme", workspaceId: "ws-1", action: "updated" },
    ]);
  });

  test("dry-run performs no writes", async () => {
    vi.mocked(client.sourceControlOrg.findMany).mockResolvedValue([org] as any);
    vi.mocked(client.workspace.findFirst).mockResolvedValue({ id: "ws-1", defaultForOrg: null } as any);

    const res = await backfillOrgDefaultWorkspaces(client, { dryRun: true });

    expect(client.sourceControlOrg.updateMany).not.toHaveBeenCalled();
    expect(res.updated).toBe(0);
    expect(res.results[0].action).toBe("would-update");
  });

  test("org with no eligible workspace is untouched", async () => {
    vi.mocked(client.sourceControlOrg.findMany).mockResolvedValue([org] as any);
    vi.mocked(client.workspace.findFirst).mockResolvedValue(null);

    const res = await backfillOrgDefaultWorkspaces(client, { dryRun: false });

    expect(client.sourceControlOrg.updateMany).not.toHaveBeenCalled();
    expect(res.skippedNoEligible).toBe(1);
    expect(res.results[0]).toMatchObject({ workspaceId: null, action: "no-eligible-workspace" });
  });

  test("updateMany count 0 is recorded as already-set", async () => {
    vi.mocked(client.sourceControlOrg.findMany).mockResolvedValue([org] as any);
    vi.mocked(client.workspace.findFirst).mockResolvedValue({ id: "ws-1", defaultForOrg: null } as any);
    vi.mocked(client.sourceControlOrg.updateMany).mockResolvedValue({ count: 0 });

    const res = await backfillOrgDefaultWorkspaces(client, { dryRun: false });

    expect(res.skippedAlreadySet).toBe(1);
    expect(res.updated).toBe(0);
    expect(res.results[0].action).toBe("already-set");
  });

  test("workspace that is another org's default is skipped as conflict", async () => {
    vi.mocked(client.sourceControlOrg.findMany).mockResolvedValue([org] as any);
    vi.mocked(client.workspace.findFirst).mockResolvedValue({
      id: "ws-1",
      defaultForOrg: { id: "org-2" },
    } as any);

    const res = await backfillOrgDefaultWorkspaces(client, { dryRun: false });

    expect(client.sourceControlOrg.updateMany).not.toHaveBeenCalled();
    expect(res.skippedConflict).toBe(1);
    expect(res.results[0].action).toBe("conflict");
  });
});
