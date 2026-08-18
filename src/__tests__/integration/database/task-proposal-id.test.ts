import { describe, it, expect, afterEach } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Minimal helper to create a workspace + required user so we can insert Tasks.
async function createWorkspaceWithOwner(suffix: string) {
  const user = await prisma.user.create({
    data: { email: `test-proposal-${suffix}@example.com` },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: `Test WS ${suffix}`,
      slug: `test-ws-${suffix}`,
      ownerId: user.id,
    },
  });
  return { user, workspace };
}

async function createTask(
  workspaceId: string,
  userId: string,
  proposalId: string | null,
) {
  return prisma.task.create({
    data: {
      title: `Task for proposal ${proposalId}`,
      workspaceId,
      createdById: userId,
      updatedById: userId,
      proposalId,
    },
  });
}

describe("Task.proposalId — @@unique([workspaceId, proposalId])", () => {
  const suffix = `${Date.now()}`;

  afterEach(async () => {
    // Clean up in reverse dependency order.
    await prisma.task.deleteMany({
      where: { workspace: { slug: { startsWith: `test-ws-${suffix}` } } },
    });
    await prisma.workspace.deleteMany({
      where: { slug: { startsWith: `test-ws-${suffix}` } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: `test-proposal-${suffix}` } },
    });
  });

  it("allows a task with proposalId = null", async () => {
    const { user, workspace } = await createWorkspaceWithOwner(
      `${suffix}-a`,
    );
    const task = await createTask(workspace.id, user.id, null);
    expect(task.proposalId).toBeNull();
  });

  it("allows multiple tasks with proposalId = null in the same workspace", async () => {
    const { user, workspace } = await createWorkspaceWithOwner(
      `${suffix}-b`,
    );
    const t1 = await createTask(workspace.id, user.id, null);
    const t2 = await createTask(workspace.id, user.id, null);
    expect(t1.id).not.toBe(t2.id);
  });

  it("allows the same proposalId in different workspaces", async () => {
    const { user: u1, workspace: ws1 } = await createWorkspaceWithOwner(
      `${suffix}-c1`,
    );
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner(
      `${suffix}-c2`,
    );
    const sharedProposalId = "prop-shared-xyz";
    const t1 = await createTask(ws1.id, u1.id, sharedProposalId);
    const t2 = await createTask(ws2.id, u2.id, sharedProposalId);
    expect(t1.proposalId).toBe(sharedProposalId);
    expect(t2.proposalId).toBe(sharedProposalId);
  });

  it("raises P2002 when inserting a duplicate (workspaceId, proposalId) pair", async () => {
    const { user, workspace } = await createWorkspaceWithOwner(
      `${suffix}-d`,
    );
    const proposalId = "prop-dupe-test-123";

    await createTask(workspace.id, user.id, proposalId);

    await expect(
      createTask(workspace.id, user.id, proposalId),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("stores and retrieves the proposalId correctly", async () => {
    const { user, workspace } = await createWorkspaceWithOwner(
      `${suffix}-e`,
    );
    const proposalId = "prop-retrieve-check";
    await createTask(workspace.id, user.id, proposalId);

    const found = await prisma.task.findFirst({
      where: { workspaceId: workspace.id, proposalId },
    });
    expect(found).not.toBeNull();
    expect(found?.proposalId).toBe(proposalId);
  });
});
