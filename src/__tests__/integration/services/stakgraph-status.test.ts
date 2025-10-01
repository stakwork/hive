import { describe, test, expect, beforeEach } from "vitest";
import { updateStakgraphStatus } from "@/services/swarm/stakgraph-status";
import { db } from "@/lib/db";
import type { WebhookPayload } from "@/types";
import { RepositoryStatus } from "@prisma/client";
import { generateUniqueId, expectRepositoryStatus } from "@/__tests__/helpers";
import { createTestWorkspaceScenario, createTestRepository } from "@/__tests__/fixtures";

describe("updateStakgraphStatus - Integration Tests", () => {
  let testWorkspaceId: string;
  let testSwarmId: string;
  let testRepositoryUrl: string;

  beforeEach(async () => {
    testRepositoryUrl = `https://github.com/test/repo-${generateUniqueId()}.git`;

    // Create test workspace with swarm using fixture
    const scenario = await createTestWorkspaceScenario({
      withSwarm: true,
      swarm: { repositoryUrl: testRepositoryUrl },
    });

    testWorkspaceId = scenario.workspace.id;
    testSwarmId = scenario.swarm!.id;

    // Create test repository using fixture
    await createTestRepository({
      workspaceId: testWorkspaceId,
      repositoryUrl: testRepositoryUrl,
      status: RepositoryStatus.PENDING,
    });
  });

  test("should update repository status to PENDING when webhook status is InProgress", async () => {
    await updateStakgraphStatus(
      { id: testSwarmId, workspaceId: testWorkspaceId, repositoryUrl: testRepositoryUrl },
      { request_id: "req-123", status: "InProgress", progress: 50 },
    );

    await expectRepositoryStatus(testWorkspaceId, testRepositoryUrl, RepositoryStatus.PENDING);
  });

  test("should update repository status to SYNCED when webhook status is Complete", async () => {
    await updateStakgraphStatus(
      { id: testSwarmId, workspaceId: testWorkspaceId, repositoryUrl: testRepositoryUrl },
      { request_id: "req-456", status: "Complete", progress: 100, result: { nodes: 10, edges: 20 } },
    );

    await expectRepositoryStatus(testWorkspaceId, testRepositoryUrl, RepositoryStatus.SYNCED);
  });

  test("should update repository status to FAILED when webhook status is Failed", async () => {
    await updateStakgraphStatus(
      { id: testSwarmId, workspaceId: testWorkspaceId, repositoryUrl: testRepositoryUrl },
      { request_id: "req-789", status: "Failed", progress: 75, error: "Some error occurred" },
    );

    await expectRepositoryStatus(testWorkspaceId, testRepositoryUrl, RepositoryStatus.FAILED);
  });

  test("should handle case-insensitive status values (COMPLETE uppercase)", async () => {
    await updateStakgraphStatus(
      { id: testSwarmId, workspaceId: testWorkspaceId, repositoryUrl: testRepositoryUrl },
      { request_id: "req-abc", status: "COMPLETE", progress: 100 },
    );

    await expectRepositoryStatus(testWorkspaceId, testRepositoryUrl, RepositoryStatus.SYNCED);
  });

  test("should handle case-insensitive status values (complete lowercase)", async () => {
    await updateStakgraphStatus(
      { id: testSwarmId, workspaceId: testWorkspaceId, repositoryUrl: testRepositoryUrl },
      { request_id: "req-def", status: "complete", progress: 100 },
    );

    await expectRepositoryStatus(testWorkspaceId, testRepositoryUrl, RepositoryStatus.SYNCED);
  });

  test("should update swarm ingestRefId", async () => {
    await updateStakgraphStatus(
      { id: testSwarmId, workspaceId: testWorkspaceId, repositoryUrl: testRepositoryUrl },
      { request_id: "req-new-id", status: "Complete", progress: 100 },
    );

    const swarm = await db.swarm.findUnique({
      where: { id: testSwarmId },
    });

    expect(swarm?.ingestRefId).toBe("req-new-id");
  });

  test("should not update repository if repositoryUrl is null", async () => {
    await updateStakgraphStatus(
      { id: testSwarmId, workspaceId: testWorkspaceId, repositoryUrl: null },
      { request_id: "req-no-repo", status: "Complete", progress: 100 },
    );

    // Repository should still have its original status (PENDING from beforeEach)
    await expectRepositoryStatus(testWorkspaceId, testRepositoryUrl, RepositoryStatus.PENDING);
  });
});
