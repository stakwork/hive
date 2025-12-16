/**
 * Simple Mock User Scenario
 *
 * Creates a complete dev environment with:
 * - Mock auth user (Dev User) with GitHub auth
 * - Workspace with repository linked
 * - Active swarm ready for E2E testing
 *
 * Based on scripts/seed-from-github-account.ts
 * Use this for quick E2E test setup.
 */
import type { ScenarioDefinition, ScenarioResult } from "../types";
import { resetDatabase } from "../../utilities/database";
import { createTestUser } from "../../factories/user.factory";
import { createTestWorkspace, createTestMembership } from "../../factories/workspace.factory";
import { createTestSwarm } from "../../factories/swarm.factory";
import { createTestTasks } from "../../factories/task.factory";
import { db } from "@/lib/db";
import { RepositoryStatus } from "@prisma/client";
import { slugify } from "@/utils/slugify";

export const simpleMockUserScenario: ScenarioDefinition = {
  name: "simple_mock_user",
  description: "Mock user with workspace, repository, swarm, and sample tasks",
  tags: ["mock", "e2e", "recording"],

  run: async (): Promise<ScenarioResult> => {
    // Reset database to ensure clean state
    await resetDatabase();

    // Create mock auth user (matches E2E mock auth provider)
    const owner = await createTestUser({
      valueKey: "mockAuthUser",
      withGitHubAuth: true,
      idempotent: true,
    });

    // Generate workspace slug from user name
    const displayName = owner.name || owner.email || "developer";
    const workspaceSlug = slugify(`${displayName}-workspace`) || "dev-workspace";
    const workspaceName = `${displayName}'s Workspace`;

    // Create workspace
    const workspace = await createTestWorkspace({
      name: workspaceName,
      slug: workspaceSlug,
      description: `Development workspace for ${displayName}`,
      ownerId: owner.id,
      stakworkApiKey: `stakwork_key_${workspaceSlug}`,
      idempotent: true,
    });

    // Create owner membership
    await createTestMembership({
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
      idempotent: true,
    });

    // Get GitHub username for repository URL
    const githubAuth = await db.gitHubAuth.findFirst({
      where: { userId: owner.id },
    });
    const githubUsername = githubAuth?.githubUsername || "example";

    // Create repository linked to workspace
    const repoName = slugify(`${displayName}-app`) || "sample-app";
    const repositoryUrl = `https://github.com/${githubUsername}/${repoName}`;

    const repository = await db.repository.create({
      data: {
        name: repoName,
        repositoryUrl,
        branch: "main",
        status: RepositoryStatus.SYNCED,
        workspaceId: workspace.id,
      },
    });

    // Create E2E-ready swarm
    const swarmName = slugify(`${workspaceSlug}-swarm`);
    const swarm = await createTestSwarm({
      valueKey: "e2eReady",
      workspaceId: workspace.id,
      name: swarmName,
      swarmApiKey: `swarm_key_${workspaceSlug}`,
      idempotent: true,
    });

    // Create sample tasks (mix of bug, feature, chore, janitor)
    const tasks = await createTestTasks(workspace.id, owner.id, 8);

    return {
      metadata: {
        name: "simple_mock_user",
        description: "Mock user with workspace, repository, swarm, and sample tasks",
        tags: ["mock", "e2e", "recording"],
        executedAt: new Date().toISOString(),
      },
      data: {
        owner,
        workspace,
        swarm,
        repository: {
          id: repository.id,
          name: repository.name,
          repositoryUrl: repository.repositoryUrl,
          branch: repository.branch,
          status: repository.status,
        },
        tasks,
        members: [],
        memberships: [],
      },
    };
  },
};
