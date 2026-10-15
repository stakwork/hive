import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { backfillOrgDefaultWorkspaces } from "@/services/backfill-org-default-workspace";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// `db` is an extended client (log/omit options); the service takes the plain PrismaClient type.
const prisma = db as unknown as PrismaClient;

describe("backfillOrgDefaultWorkspaces (integration)", () => {
  let ownerId: string;
  let clock: number;

  const makeOrg = (login: string) =>
    db.sourceControlOrg.create({
      data: {
        githubLogin: `bfdw-test-${login}-${generateUniqueId("org")}`,
        githubInstallationId: Math.floor(Math.random() * 2_000_000_000),
      },
    });

  // Each workspace gets a strictly increasing createdAt so "oldest" is deterministic.
  const makeWs = async (
    orgId: string,
    name: string,
    opts: { swarm: boolean; deleted?: boolean },
  ) => {
    clock += 60_000;
    const slug = `bfdw-test-${name}-${generateUniqueId("ws")}`.toLowerCase();
    const ws = await db.workspace.create({
      data: {
        name,
        slug,
        ownerId,
        sourceControlOrgId: orgId,
        deleted: !!opts.deleted,
        createdAt: new Date(clock),
      },
    });
    if (opts.swarm) {
      await db.swarm.create({ data: { name: `${slug}-swarm`, workspaceId: ws.id } });
    }
    return ws;
  };

  const defaultOf = async (orgId: string) =>
    (await db.sourceControlOrg.findUniqueOrThrow({ where: { id: orgId } })).defaultWorkspaceId;

  let A: { id: string }, B: { id: string }, C: { id: string }, D: { id: string }, E: { id: string };
  let aPick: { id: string }, cNew: { id: string }, dOldest: { id: string };

  beforeEach(async () => {
    ownerId = (await createTestUser()).id;
    clock = Date.parse("2024-01-01T00:00:00Z");
    [A, B, C, D, E] = await Promise.all(["A", "B", "C", "D", "E"].map(makeOrg));

    // A: expected pick is the older of the two live swarm workspaces
    await makeWs(A.id, "a-old-noswarm", { swarm: false });
    await makeWs(A.id, "a-old-deleted", { swarm: true, deleted: true });
    aPick = await makeWs(A.id, "a-pick", { swarm: true });
    await makeWs(A.id, "a-newer", { swarm: true });

    // B: nothing eligible
    await makeWs(B.id, "b-noswarm", { swarm: false });
    await makeWs(B.id, "b-deleted", { swarm: true, deleted: true });

    // C: already has default pointing at its NEWER workspace
    await makeWs(C.id, "c-older", { swarm: true });
    cNew = await makeWs(C.id, "c-newer", { swarm: true });
    await db.sourceControlOrg.update({ where: { id: C.id }, data: { defaultWorkspaceId: cNew.id } });

    // D/E: D's oldest eligible workspace is already E's default
    dOldest = await makeWs(D.id, "d-oldest", { swarm: true });
    await makeWs(D.id, "d-newer", { swarm: true });
    await db.sourceControlOrg.update({ where: { id: E.id }, data: { defaultWorkspaceId: dOldest.id } });
  }, 30000);

  const ours = (s: Awaited<ReturnType<typeof backfillOrgDefaultWorkspaces>>) =>
    s.results.filter((r) => [A.id, B.id, C.id, D.id, E.id].includes(r.orgId));

  it("dry run reports but writes nothing", async () => {
    const s = await backfillOrgDefaultWorkspaces(prisma, { dryRun: true });
    const byOrg = Object.fromEntries(ours(s).map((r) => [r.orgId, r.action]));
    expect(byOrg).toEqual({
      [A.id]: "would-update",
      [B.id]: "no-eligible-workspace",
      [D.id]: "conflict",
    });
    expect(await defaultOf(A.id)).toBeNull();
  });

  it("applies scenarios A-D and is idempotent on re-run", async () => {
    const first = await backfillOrgDefaultWorkspaces(prisma, { dryRun: false });
    expect(first.scanned).toBe(3); // A, B, D (C and E already have defaults)
    expect(first.updated).toBe(1);
    expect(first.skippedNoEligible).toBe(1);
    expect(first.skippedConflict).toBe(1);

    expect(await defaultOf(A.id)).toBe(aPick.id);
    expect(await defaultOf(B.id)).toBeNull();
    expect(await defaultOf(C.id)).toBe(cNew.id);
    expect(await defaultOf(D.id)).toBeNull();
    expect(await defaultOf(E.id)).toBe(dOldest.id);

    const second = await backfillOrgDefaultWorkspaces(prisma, { dryRun: false });
    expect(second.updated).toBe(0);
    expect(second.scanned).toBe(2); // B, D remain null
    expect(await defaultOf(A.id)).toBe(aPick.id);
    expect(await defaultOf(B.id)).toBeNull();
    expect(await defaultOf(C.id)).toBe(cNew.id);
    expect(await defaultOf(D.id)).toBeNull();
    expect(await defaultOf(E.id)).toBe(dOldest.id);
  });
});
