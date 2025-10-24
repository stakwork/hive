#!/usr/bin/env ts-node

/**
 * Migration Script: Create Task Records for Existing E2E Tests
 *
 * This script scans the graph for existing E2E tests and creates
 * task records with sourceType=USER_JOURNEY for tracking purposes.
 *
 * Usage:
 *   npm run migrate:e2e-tasks -- --workspace=<workspace-slug>
 *   npm run migrate:e2e-tasks -- --all  (all workspaces)
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { EncryptionService } from "../src/lib/encryption";

// Load environment variables
dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();
const encryptionService = EncryptionService.getInstance();

// Inline graph API request to avoid importing env.ts
async function graphApiRequest(graphUrl: string, apiKey: string, params: Record<string, string>) {
  const url = new URL(graphUrl + "/nodes");
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    return { ok: false, status: response.status, data: null };
  }

  const data = await response.json();
  return { ok: true, status: response.status, data };
}

interface E2eTestNode {
  node_type: string;
  ref_id: string;
  properties: {
    token_count: number;
    file: string;
    test_kind: string;
    node_key: string;
    start: number;
    name: string;
    end: number;
    body: string;
  };
}

interface MigrationStats {
  workspacesProcessed: number;
  testsFound: number;
  tasksCreated: number;
  tasksSkipped: number;
  errors: number;
}

async function fetchE2eTestsFromGraph(
  swarmUrl: string,
  swarmApiKey: string
): Promise<E2eTestNode[]> {
  try {
    // Extract hostname from swarm URL and construct graph endpoint
    const swarmUrlObj = new URL(swarmUrl);
    const graphUrl = `https://${swarmUrlObj.hostname}:3355`;

    // Query graph microservice directly
    const apiResult = await graphApiRequest(graphUrl, swarmApiKey, {
      node_type: "E2etest",
      output: "json",
    });

    if (!apiResult.ok) {
      console.error(`Failed to fetch E2E tests: ${apiResult.status}`);
      return [];
    }

    if (Array.isArray(apiResult.data)) {
      return apiResult.data;
    }

    return [];
  } catch (error) {
    console.error(`Error fetching E2E tests:`, error);
    return [];
  }
}

async function migrateWorkspace(workspaceSlug: string, stats: MigrationStats): Promise<void> {
  console.log(`\n📦 Processing workspace: ${workspaceSlug}`);

  // Get workspace data with swarm
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug, deleted: false },
    include: {
      owner: true,
      swarm: true,
      repositories: {
        take: 1,
        select: {
          id: true,
          repositoryUrl: true,
        },
      },
    },
  });

  if (!workspace) {
    console.error(`❌ Workspace not found: ${workspaceSlug}`);
    stats.errors++;
    return;
  }

  if (!workspace.swarm) {
    console.log(`   ⏭️  Skipped: No swarm configured`);
    return;
  }

  if (!workspace.swarm.swarmUrl || !workspace.swarm.swarmApiKey) {
    console.log(`   ⏭️  Skipped: Swarm configuration incomplete`);
    return;
  }

  // Decrypt swarm API key
  const decryptedApiKey = encryptionService.decryptField(
    "swarmApiKey",
    workspace.swarm.swarmApiKey
  );

  // Fetch E2E tests from graph
  console.log(`   Fetching E2E tests from graph...`);
  const tests = await fetchE2eTestsFromGraph(
    workspace.swarm.swarmUrl,
    decryptedApiKey
  );

  if (tests.length === 0) {
    console.log(`   ℹ️  No E2E tests found in graph`);
    return;
  }

  console.log(`   Found ${tests.length} E2E tests`);
  stats.testsFound += tests.length;

  const repository = workspace.repositories[0];
  const ownerId = workspace.ownerId;

  // Process each test
  for (const test of tests) {
    try {
      const testName = test.properties.name;
      const testFilePath = test.properties.file;

      // Check if task already exists for this test file
      const existingTask = await prisma.task.findFirst({
        where: {
          workspaceId: workspace.id,
          testFilePath: testFilePath,
          deleted: false,
        },
      });

      if (existingTask) {
        console.log(`   ⏭️  Skipped (exists): ${testName}`);
        stats.tasksSkipped++;
        continue;
      }

      // Generate title from test name
      const title = testName || testFilePath.split('/').pop()?.replace('.spec.ts', '') || 'E2E Test';

      // Construct GitHub URL if repository URL exists
      let testFileUrl: string | null = null;
      if (repository?.repositoryUrl) {
        // Extract owner/repo from URL like "https://github.com/owner/repo" or file path like "owner/repo/path"
        const fileParts = testFilePath.split('/');
        if (fileParts.length >= 3) {
          const owner = fileParts[0];
          const repo = fileParts[1];
          const path = fileParts.slice(2).join('/');
          testFileUrl = `https://github.com/${owner}/${repo}/blob/HEAD/${path}`;
        }
      }

      // Create task
      await prisma.task.create({
        data: {
          title,
          description: `E2E test: ${testName}`,
          workspaceId: workspace.id,
          sourceType: "USER_JOURNEY",
          status: "DONE",
          workflowStatus: "COMPLETED",
          priority: "MEDIUM",
          testFilePath,
          testFileUrl,
          repositoryId: repository?.id || null,
          createdById: ownerId,
          updatedById: ownerId,
        },
      });

      console.log(`   ✅ Created: ${testName}`);
      stats.tasksCreated++;

    } catch (error) {
      console.error(`   ❌ Error creating task for ${test.properties.name}:`, error);
      stats.errors++;
    }
  }
}

async function main() {
  console.log('🚀 Starting E2E Test Migration\n');

  const args = process.argv.slice(2);
  const workspaceArg = args.find(arg => arg.startsWith('--workspace='));
  const allFlag = args.includes('--all');

  const stats: MigrationStats = {
    workspacesProcessed: 0,
    testsFound: 0,
    tasksCreated: 0,
    tasksSkipped: 0,
    errors: 0,
  };

  try {
    if (workspaceArg) {
      // Process single workspace
      const workspaceSlug = workspaceArg.split('=')[1];
      if (!workspaceSlug) {
        console.error('❌ Invalid workspace argument. Usage: --workspace=<workspace-slug>');
        process.exit(1);
      }

      await migrateWorkspace(workspaceSlug, stats);
      stats.workspacesProcessed = 1;

    } else if (allFlag) {
      // Process all workspaces
      const workspaces = await prisma.workspace.findMany({
        where: { deleted: false },
        select: { slug: true },
      });

      console.log(`Found ${workspaces.length} workspaces\n`);

      for (const workspace of workspaces) {
        await migrateWorkspace(workspace.slug, stats);
        stats.workspacesProcessed++;
      }

    } else {
      console.error('❌ Missing argument. Usage:');
      console.error('   npm run migrate:e2e-tasks -- --workspace=<workspace-slug>');
      console.error('   npm run migrate:e2e-tasks -- --all');
      process.exit(1);
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));
    console.log(`Workspaces Processed: ${stats.workspacesProcessed}`);
    console.log(`E2E Tests Found:      ${stats.testsFound}`);
    console.log(`Tasks Created:        ${stats.tasksCreated}`);
    console.log(`Tasks Skipped:        ${stats.tasksSkipped}`);
    console.log(`Errors:               ${stats.errors}`);
    console.log('='.repeat(60));

    if (stats.tasksCreated > 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('   Visit the User Journeys page to see the migrated tests.');
    } else if (stats.tasksSkipped > 0) {
      console.log('\n✅ All tests already migrated (nothing to do).');
    } else {
      console.log('\nℹ️  No tests found to migrate.');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
if (require.main === module) {
  main();
}

export { main as migrateE2eToTasks };
