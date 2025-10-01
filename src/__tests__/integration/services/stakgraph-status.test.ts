import { describe, test, expect, beforeEach } from "vitest";
import { updateStakgraphStatus } from "@/services/swarm/stakgraph-status";
import { db } from "@/lib/db";
import type { WebhookPayload } from "@/types";
import { RepositoryStatus } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/fixtures";

describe("updateStakgraphStatus - Integration Tests", () => {
  let testWorkspaceId: string;
  let testSwarmId: string;
  let testRepositoryUrl: string;

  beforeEach(async () => {
    // Create test workspace with swarm using fixture
    const scenario = await createTestWorkspaceScenario({
      withSwarm: true,
    });

    testWorkspaceId = scenario.workspace.id;
    testSwarmId = scenario.swarm!.id;
    testRepositoryUrl = `https://github.com/test/repo-${generateUniqueId()}.git`;

    // Update swarm with repository URL
    await db.swarm.update({
      where: { id: testSwarmId },
      data: { repositoryUrl: testRepositoryUrl },
    });

    // Create test repository
    await db.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: testRepositoryUrl,
        workspaceId: testWorkspaceId,
        status: RepositoryStatus.PENDING,
      },
    });
  });

  test("should update repository status to PENDING when webhook status is InProgress", async () => {
    const payload: WebhookPayload = {
      request_id: "req-123",
      status: "InProgress",
      progress: 50,
    };

    await updateStakgraphStatus(
      {
        id: testSwarmId,
        workspaceId: testWorkspaceId,
        repositoryUrl: testRepositoryUrl,
      },
      payload,
    );

    const repository = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: testRepositoryUrl,
          workspaceId: testWorkspaceId,
        },
      },
    });

    expect(repository?.status).toBe(RepositoryStatus.PENDING);
  });

  test("should update repository status to SYNCED when webhook status is Complete", async () => {
    const payload: WebhookPayload = {
      request_id: "req-456",
      status: "Complete",
      progress: 100,
      result: { nodes: 10, edges: 20 },
    };

    await updateStakgraphStatus(
      {
        id: testSwarmId,
        workspaceId: testWorkspaceId,
        repositoryUrl: testRepositoryUrl,
      },
      payload,
    );

    const repository = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: testRepositoryUrl,
          workspaceId: testWorkspaceId,
        },
      },
    });

    expect(repository?.status).toBe(RepositoryStatus.SYNCED);
  });

  test("should update repository status to FAILED when webhook status is Failed", async () => {
    const payload: WebhookPayload = {
      request_id: "req-789",
      status: "Failed",
      progress: 75,
      error: "Some error occurred",
    };

    await updateStakgraphStatus(
      {
        id: testSwarmId,
        workspaceId: testWorkspaceId,
        repositoryUrl: testRepositoryUrl,
      },
      payload,
    );

    const repository = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: testRepositoryUrl,
          workspaceId: testWorkspaceId,
        },
      },
    });

    expect(repository?.status).toBe(RepositoryStatus.FAILED);
  });

  test("should handle case-insensitive status values (COMPLETE uppercase)", async () => {
    const payload: WebhookPayload = {
      request_id: "req-abc",
      status: "COMPLETE",
      progress: 100,
    };

    await updateStakgraphStatus(
      {
        id: testSwarmId,
        workspaceId: testWorkspaceId,
        repositoryUrl: testRepositoryUrl,
      },
      payload,
    );

    const repository = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: testRepositoryUrl,
          workspaceId: testWorkspaceId,
        },
      },
    });

    expect(repository?.status).toBe(RepositoryStatus.SYNCED);
  });

  test("should handle case-insensitive status values (complete lowercase)", async () => {
    const payload: WebhookPayload = {
      request_id: "req-def",
      status: "complete",
      progress: 100,
    };

    await updateStakgraphStatus(
      {
        id: testSwarmId,
        workspaceId: testWorkspaceId,
        repositoryUrl: testRepositoryUrl,
      },
      payload,
    );

    const repository = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: testRepositoryUrl,
          workspaceId: testWorkspaceId,
        },
      },
    });

    expect(repository?.status).toBe(RepositoryStatus.SYNCED);
  });

  test("should update swarm ingestRefId", async () => {
    const payload: WebhookPayload = {
      request_id: "req-new-id",
      status: "Complete",
      progress: 100,
    };

    await updateStakgraphStatus(
      {
        id: testSwarmId,
        workspaceId: testWorkspaceId,
        repositoryUrl: testRepositoryUrl,
      },
      payload,
    );

    const swarm = await db.swarm.findUnique({
      where: { id: testSwarmId },
    });

    expect(swarm?.ingestRefId).toBe("req-new-id");
  });

  test("should not update repository if repositoryUrl is null", async () => {
    const payload: WebhookPayload = {
      request_id: "req-no-repo",
      status: "Complete",
      progress: 100,
    };

    await updateStakgraphStatus(
      {
        id: testSwarmId,
        workspaceId: testWorkspaceId,
        repositoryUrl: null,
      },
      payload,
    );

    const repository = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: testRepositoryUrl,
          workspaceId: testWorkspaceId,
        },
      },
    });

    // Repository should still have its original status (PENDING from beforeEach)
    expect(repository?.status).toBe(RepositoryStatus.PENDING);
  });
});
