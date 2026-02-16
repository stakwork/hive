import { PrismaClient, DeploymentEnvironment, DeploymentStatus } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds deployment tracking data for tasks with PR artifacts
 * Creates realistic deployment progression scenarios across staging and production
 */
export async function seedDeploymentTracking() {
  console.log("\n🚀 Starting deployment tracking seed...");

  // Query for tasks with PULL_REQUEST artifacts that have merge_commit_sha
  const tasksWithPRs = await prisma.$queryRaw<
    Array<{
      task_id: string;
      repository_id: string | null;
      pr_url: string;
      merge_commit_sha: string;
      created_at: Date;
    }>
  >`
    SELECT
      t.id as task_id,
      t.repository_id,
      t.created_at,
      a.content->>'url' as pr_url,
      a.content->>'merge_commit_sha' as merge_commit_sha
    FROM artifacts a
    JOIN chat_messages m ON a.message_id = m.id
    JOIN tasks t ON m.task_id = t.id
    WHERE a.type = 'PULL_REQUEST'
      AND a.content->>'merge_commit_sha' IS NOT NULL
      AND t.deleted = false
      AND t.archived = false
    ORDER BY t.created_at DESC
    LIMIT 10
  `;

  if (tasksWithPRs.length === 0) {
    console.log("ℹ️  No tasks with merged PRs found - skipping deployment seed");
    return;
  }

  console.log(`✓ Found ${tasksWithPRs.length} tasks with merged PRs`);

  // Generate realistic commit SHAs for tasks without one
  const generateCommitSha = (index: number) => {
    return `a1b2c3d4e5f6${String(index).padStart(4, "0")}${Math.random().toString(36).substring(2, 15)}`.substring(0, 40);
  };

  const now = new Date();
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  let deploymentCount = 0;

  // Scenario 1: Complete staging → production progression (3 tasks)
  const completeTasks = tasksWithPRs.slice(0, 3);
  for (let i = 0; i < completeTasks.length; i++) {
    const task = completeTasks[i];
    const commitSha = task.merge_commit_sha || generateCommitSha(i);
    const stagingStart = hoursAgo(48 - i * 8);
    const stagingComplete = hoursAgo(47 - i * 8);
    const prodStart = hoursAgo(24 - i * 4);
    const prodComplete = hoursAgo(23 - i * 4);

    // Staging deployment - in progress
    await prisma.deployment.create({
      data: {
        taskId: task.task_id,
        repositoryId: task.repository_id,
        commitSha,
        prUrl: task.pr_url,
        environment: DeploymentEnvironment.STAGING,
        status: DeploymentStatus.IN_PROGRESS,
        githubDeploymentId: `gh_deploy_staging_${i + 1}_start`,
        deploymentUrl: `https://staging-${i + 1}.vercel.app`,
        startedAt: stagingStart,
        createdAt: stagingStart,
      },
    });
    deploymentCount++;

    // Staging deployment - success
    await prisma.deployment.create({
      data: {
        taskId: task.task_id,
        repositoryId: task.repository_id,
        commitSha,
        prUrl: task.pr_url,
        environment: DeploymentEnvironment.STAGING,
        status: DeploymentStatus.SUCCESS,
        githubDeploymentId: `gh_deploy_staging_${i + 1}_success`,
        deploymentUrl: `https://staging-${i + 1}.vercel.app`,
        startedAt: stagingStart,
        completedAt: stagingComplete,
        createdAt: stagingComplete,
      },
    });
    deploymentCount++;

    // Production deployment - in progress
    await prisma.deployment.create({
      data: {
        taskId: task.task_id,
        repositoryId: task.repository_id,
        commitSha,
        prUrl: task.pr_url,
        environment: DeploymentEnvironment.PRODUCTION,
        status: DeploymentStatus.IN_PROGRESS,
        githubDeploymentId: `gh_deploy_prod_${i + 1}_start`,
        deploymentUrl: `https://production-${i + 1}.vercel.app`,
        startedAt: prodStart,
        createdAt: prodStart,
      },
    });
    deploymentCount++;

    // Production deployment - success
    await prisma.deployment.create({
      data: {
        taskId: task.task_id,
        repositoryId: task.repository_id,
        commitSha,
        prUrl: task.pr_url,
        environment: DeploymentEnvironment.PRODUCTION,
        status: DeploymentStatus.SUCCESS,
        githubDeploymentId: `gh_deploy_prod_${i + 1}_success`,
        deploymentUrl: `https://production-${i + 1}.vercel.app`,
        startedAt: prodStart,
        completedAt: prodComplete,
        createdAt: prodComplete,
      },
    });
    deploymentCount++;

    // Update task deployment status
    await prisma.task.update({
      where: { id: task.task_id },
      data: {
        deploymentStatus: "production",
        deployedToStagingAt: stagingComplete,
        deployedToProductionAt: prodComplete,
      },
    });
  }

  console.log(`✓ Created ${completeTasks.length} tasks with complete staging → production progression (${completeTasks.length * 4} deployments)`);

  // Scenario 2: Staging deployment only (2 tasks)
  const stagingOnlyTasks = tasksWithPRs.slice(3, 5);
  for (let i = 0; i < stagingOnlyTasks.length; i++) {
    const task = stagingOnlyTasks[i];
    const commitSha = task.merge_commit_sha || generateCommitSha(i + 10);
    const stagingStart = hoursAgo(12 - i * 4);
    const stagingComplete = hoursAgo(11 - i * 4);

    // Staging deployment - success
    await prisma.deployment.create({
      data: {
        taskId: task.task_id,
        repositoryId: task.repository_id,
        commitSha,
        prUrl: task.pr_url,
        environment: DeploymentEnvironment.STAGING,
        status: DeploymentStatus.SUCCESS,
        githubDeploymentId: `gh_deploy_staging_only_${i + 1}`,
        deploymentUrl: `https://staging-only-${i + 1}.vercel.app`,
        startedAt: stagingStart,
        completedAt: stagingComplete,
        createdAt: stagingComplete,
      },
    });
    deploymentCount++;

    // Update task deployment status
    await prisma.task.update({
      where: { id: task.task_id },
      data: {
        deploymentStatus: "staging",
        deployedToStagingAt: stagingComplete,
      },
    });
  }

  console.log(`✓ Created ${stagingOnlyTasks.length} tasks with staging deployment only (${stagingOnlyTasks.length} deployments)`);

  // Scenario 3: Failed staging deployment (1 task)
  if (tasksWithPRs.length > 5) {
    const failedTask = tasksWithPRs[5];
    const commitSha = failedTask.merge_commit_sha || generateCommitSha(20);
    const failedStart = hoursAgo(6);
    const failedComplete = hoursAgo(5);

    // Staging deployment - in progress
    await prisma.deployment.create({
      data: {
        taskId: failedTask.task_id,
        repositoryId: failedTask.repository_id,
        commitSha,
        prUrl: failedTask.pr_url,
        environment: DeploymentEnvironment.STAGING,
        status: DeploymentStatus.IN_PROGRESS,
        githubDeploymentId: `gh_deploy_staging_failed_start`,
        deploymentUrl: `https://staging-failed.vercel.app`,
        startedAt: failedStart,
        createdAt: failedStart,
      },
    });
    deploymentCount++;

    // Staging deployment - failure
    await prisma.deployment.create({
      data: {
        taskId: failedTask.task_id,
        repositoryId: failedTask.repository_id,
        commitSha,
        prUrl: failedTask.pr_url,
        environment: DeploymentEnvironment.STAGING,
        status: DeploymentStatus.FAILURE,
        githubDeploymentId: `gh_deploy_staging_failed`,
        deploymentUrl: `https://staging-failed.vercel.app`,
        startedAt: failedStart,
        completedAt: failedComplete,
        createdAt: failedComplete,
      },
    });
    deploymentCount++;

    console.log(`✓ Created 1 task with failed staging deployment (2 deployments)`);
  }

  // Scenario 4: Direct production deployment (skipping staging) (1 task)
  if (tasksWithPRs.length > 6) {
    const directProdTask = tasksWithPRs[6];
    const commitSha = directProdTask.merge_commit_sha || generateCommitSha(30);
    const prodStart = hoursAgo(3);
    const prodComplete = hoursAgo(2);

    // Production deployment - success (no staging)
    await prisma.deployment.create({
      data: {
        taskId: directProdTask.task_id,
        repositoryId: directProdTask.repository_id,
        commitSha,
        prUrl: directProdTask.pr_url,
        environment: DeploymentEnvironment.PRODUCTION,
        status: DeploymentStatus.SUCCESS,
        githubDeploymentId: `gh_deploy_prod_direct`,
        deploymentUrl: `https://production-direct.vercel.app`,
        startedAt: prodStart,
        completedAt: prodComplete,
        createdAt: prodComplete,
      },
    });
    deploymentCount++;

    // Update task deployment status
    await prisma.task.update({
      where: { id: directProdTask.task_id },
      data: {
        deploymentStatus: "production",
        deployedToProductionAt: prodComplete,
      },
    });

    console.log(`✓ Created 1 task with direct production deployment (1 deployment)`);
  }

  // Scenario 5: Multiple tasks sharing same commit/PR (if we have remaining tasks)
  if (tasksWithPRs.length > 7) {
    const sharedTasks = tasksWithPRs.slice(7, 9);
    const sharedCommitSha = generateCommitSha(40);
    const sharedPrUrl = "https://github.com/test/repo/pull/999";
    const sharedStagingStart = hoursAgo(8);
    const sharedStagingComplete = hoursAgo(7);

    for (const task of sharedTasks) {
      // Staging deployment - success
      await prisma.deployment.create({
        data: {
          taskId: task.task_id,
          repositoryId: task.repository_id,
          commitSha: sharedCommitSha,
          prUrl: sharedPrUrl,
          environment: DeploymentEnvironment.STAGING,
          status: DeploymentStatus.SUCCESS,
          githubDeploymentId: `gh_deploy_shared_staging`,
          deploymentUrl: `https://staging-shared.vercel.app`,
          startedAt: sharedStagingStart,
          completedAt: sharedStagingComplete,
          createdAt: sharedStagingComplete,
        },
      });
      deploymentCount++;

      // Update task deployment status
      await prisma.task.update({
        where: { id: task.task_id },
        data: {
          deploymentStatus: "staging",
          deployedToStagingAt: sharedStagingComplete,
        },
      });
    }

    console.log(`✓ Created ${sharedTasks.length} tasks sharing same deployment (${sharedTasks.length} deployments)`);
  }

  console.log(`\n✅ Deployment tracking seed complete:`);
  console.log(`   - Total deployments created: ${deploymentCount}`);
  console.log(`   - Tasks updated with deployment status: ${tasksWithPRs.length}`);
  console.log(`   - Scenarios covered: staging→production, staging-only, failed, direct-production, shared\n`);
}

// Allow running independently
if (require.main === module) {
  seedDeploymentTracking()
    .catch((err) => {
      console.error("Deployment tracking seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
