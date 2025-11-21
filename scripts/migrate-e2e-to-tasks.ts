#!/usr/bin/env ts-node

/**
 * Migration Script: Create Task Records for Existing E2E Tests
 *
 * This script scans the graph for existing E2E tests and creates
 * task records with sourceType=USER_JOURNEY for tracking purposes.
 *
 * Note: The graph remains the source of truth for test code.
 * Tasks are metadata records for filtering, viewing, and status tracking.
 *
 * Usage:
 *   npm run migrate:e2e-tasks -- --workspace=<workspace-slug>
 *   npm run migrate:e2e-tasks -- --all  (all workspaces)
 *   npm run migrate:e2e-tasks -- --workspace=<workspace-slug> --dry-run  (preview only)
 *   npm run migrate:e2e-tasks -- --workspace=<workspace-slug> --verbose  (detailed logging)
 */

import { PrismaClient, TaskSourceType } from "@prisma/client";
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
      "x-api-token": apiKey,
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
  testsByKind: Record<string, number>;
}

interface MigrationOptions {
  dryRun: boolean;
  verbose: boolean;
}

async function fetchE2eTestsFromGraph(swarmUrl: string, swarmApiKey: string): Promise<E2eTestNode[]> {
  try {
    // Extract hostname from swarm URL and construct graph endpoint
    // Port can be configured via GRAPH_SERVICE_PORT environment variable
    const graphPort = process.env.GRAPH_SERVICE_PORT || "3355";
    const swarmUrlObj = new URL(swarmUrl);
    const graphUrl = `https://${swarmUrlObj.hostname}:${graphPort}`;

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

async function migrateWorkspace(
  workspaceSlug: string,
  stats: MigrationStats,
  options: MigrationOptions,
): Promise<void> {
  console.log(`\n📦 Processing workspace: ${workspaceSlug}`);
  if (options.dryRun) {
    console.log(`   🔍 DRY RUN MODE - No tasks will be created`);
  }

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
          branch: true,
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
  const decryptedApiKey = encryptionService.decryptField("swarmApiKey", workspace.swarm.swarmApiKey);

  // Fetch E2E tests from graph
  console.log(`   Fetching E2E tests from graph...`);
  const tests = await fetchE2eTestsFromGraph(workspace.swarm.swarmUrl, decryptedApiKey);

  if (tests.length === 0) {
    console.log(`   ℹ️  No E2E tests found in graph`);
    return;
  }

  console.log(`   Found ${tests.length} E2E test cases in graph`);
  stats.testsFound += tests.length;

  // Group tests by file path to create one task per file (matching pre-PR-1498 behavior)
  const testsByFile = new Map<string, E2eTestNode>();
  tests.forEach((test) => {
    const filePath = test.properties.file;
    // Only keep the first test case we encounter for each file
    if (!testsByFile.has(filePath)) {
      testsByFile.set(filePath, test);
    }
  });

  const uniqueTests = Array.from(testsByFile.values());
  console.log(`   Grouped into ${uniqueTests.length} unique test files`);

  // Group tests by test_kind for analysis
  const testsByKind: Record<string, E2eTestNode[]> = {};
  uniqueTests.forEach((test) => {
    const kind = test.properties.test_kind || "unknown";
    if (!testsByKind[kind]) {
      testsByKind[kind] = [];
      stats.testsByKind[kind] = 0;
    }
    testsByKind[kind].push(test);
    stats.testsByKind[kind]++;
  });

  // Log test breakdown by kind
  console.log(`   Test breakdown by kind:`);
  Object.entries(testsByKind).forEach(([kind, tests]) => {
    console.log(`     - ${kind}: ${tests.length} files`);
  });

  if (options.verbose) {
    console.log(`\n   📝 Detailed test file list:`);
    uniqueTests.forEach((test, index) => {
      console.log(`     ${index + 1}. ${test.properties.file}`);
      console.log(`        Kind: ${test.properties.test_kind || "unknown"}`);
      console.log(`        Ref ID: ${test.ref_id}`);
    });
  }

  const repository = workspace.repositories[0];
  const ownerId = workspace.ownerId;

  if (!repository) {
    console.log(`   ⚠️  Warning: No repository configured for workspace`);
    console.log(`              GitHub URLs will not be generated for tasks`);
  }

  console.log(`\n   Processing test files...`);

  // Process each unique test file
  for (const test of uniqueTests) {
    try {
      const testFilePath = test.properties.file;

      // Generate title from file name (not individual test name)
      const fileName =
        testFilePath
          .split("/")
          .pop()
          ?.replace(/\.spec\.ts$/, "")
          .replace(/\.test\.ts$/, "") || "E2E Test";
      const title = fileName;

      // Log test being processed (verbose mode)
      if (options.verbose) {
        console.log(`\n   📝 Processing file: ${testFilePath}`);
        console.log(`      Title: ${title}`);
        console.log(`      Kind: ${test.properties.test_kind || "unknown"}`);
        console.log(`      Ref ID: ${test.ref_id}`);
      }

      // Check if task already exists for this file
      // We only check testFilePath to create one task per file (pre-PR-1498 behavior)
      if (options.verbose) {
        console.log(`      🔍 Checking for duplicate with testFilePath: "${testFilePath}"`);
      }

      const existingTask = await prisma.task.findFirst({
        where: {
          workspaceId: workspace.id,
          testFilePath: testFilePath,
          deleted: false,
        },
        select: {
          id: true,
          title: true,
          testFilePath: true,
          status: true,
          workflowStatus: true,
          createdAt: true,
        },
      });

      if (existingTask) {
        const status = options.verbose ? `exists with status=${existingTask.status}` : "exists";
        console.log(`   ⏭️  Skipped (${status}): ${title}`);
        if (options.verbose) {
          console.log(`      ✅ Found existing task:`);
          console.log(`         Task ID: ${existingTask.id}`);
          console.log(`         Task title: ${existingTask.title}`);
          console.log(`         Task path: ${existingTask.testFilePath}`);
          console.log(`         Created at: ${existingTask.createdAt}`);
          console.log(`         Status: ${existingTask.status} / ${existingTask.workflowStatus || "N/A"}`);
        }
        stats.tasksSkipped++;
        continue;
      }

      // No duplicate found, will create new task
      if (options.verbose) {
        console.log(`      ✅ No duplicate found, proceeding with creation`);
      }

      // Construct GitHub URL from file path
      // The graph may store paths in different formats:
      // 1. Relative path: "src/__tests__/e2e/specs/test.spec.ts"
      // 2. Full GitHub path: "owner/repo/src/__tests__/e2e/specs/test.spec.ts"
      //
      // We normalize to relative paths and use the workspace's repository URL
      let testFileUrl: string | null = null;
      let normalizedPath = testFilePath;

      if (repository?.repositoryUrl) {
        // Try to extract owner/repo from the path if present (format: owner/repo/path)
        const fileParts = testFilePath.split("/");
        if (fileParts.length >= 3) {
          // Check if this looks like a GitHub path (owner/repo/...)
          // by seeing if the repository URL contains the first two parts
          const potentialOwner = fileParts[0];
          const potentialRepo = fileParts[1];
          const repoUrlLower = repository.repositoryUrl.toLowerCase();

          if (repoUrlLower.includes(`/${potentialOwner}/${potentialRepo}`.toLowerCase())) {
            // This is a full GitHub path, extract the relative path
            normalizedPath = fileParts.slice(2).join("/");
          }
        }

        // Construct URL using repository URL + relative path
        // Use dynamic branch from repository (fallback to 'main' if not set)
        const branch = repository.branch || "main";
        testFileUrl = `${repository.repositoryUrl}/blob/${branch}/${normalizedPath}`;
      }

      // Log data that will be used for task creation
      if (options.verbose) {
        console.log(`      📋 Task data prepared:`);
        console.log(`         title: "${title}"`);
        console.log(`         testFilePath: "${testFilePath}"`);
        console.log(`         testFilePath length: ${testFilePath?.length || 0} chars`);
        console.log(`         testFileUrl: ${testFileUrl || "null"}`);
        console.log(`         normalizedPath: "${normalizedPath}"`);
        console.log(`         branch: ${repository?.branch || "main (default)"}`);
        console.log(`         repositoryId: ${repository?.id || "null"}`);
        console.log(`         ownerId: ${ownerId || "null"}`);
        console.log(`         workspaceId: ${workspace.id}`);
      }

      // Create task (or just log in dry-run mode)
      if (options.dryRun) {
        console.log(`   🔍 Would create: ${title}`);
        if (options.verbose) {
          console.log(`      (Dry-run mode - no database changes)`);
        }
      } else {
        if (options.verbose) {
          console.log(`      💾 Creating task in database...`);
        }
        await prisma.task.create({
          data: {
            title,
            description: `E2E test file: ${testFilePath}`,
            workspaceId: workspace.id,
            sourceType: TaskSourceType.USER_JOURNEY,
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
        console.log(`   ✅ Created: ${title}`);
      }
      stats.tasksCreated++;
    } catch (error) {
      // Enhanced error logging
      console.error(`\n   ❌ ERROR creating task for file: ${test.properties.file}`);
      console.error(`      Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`      Error message: ${error instanceof Error ? error.message : String(error)}`);

      // Log the problematic test data
      console.error(`\n      🔍 Test data that caused error:`);
      console.error(`         testFilePath: ${test.properties.file || "undefined"}`);
      console.error(`         testFilePath length: ${test.properties.file?.length || 0} chars`);
      console.error(`         test_kind: ${test.properties.test_kind || "undefined"}`);
      console.error(`         ref_id: ${test.ref_id || "undefined"}`);

      console.error(`\n      🔍 Context data:`);
      console.error(`         workspaceId: ${workspace.id}`);
      console.error(`         ownerId: ${ownerId || "NULL/UNDEFINED"}`);
      console.error(`         repositoryId: ${repository?.id || "NULL/UNDEFINED"}`);
      console.error(`         repository exists: ${!!repository}`);

      if (options.verbose && error instanceof Error && error.stack) {
        console.error(`\n      📚 Stack trace:`);
        console.error(error.stack);
      }

      stats.errors++;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const workspaceArg = args.find((arg) => arg.startsWith("--workspace="));
  const allFlag = args.includes("--all");
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose") || args.includes("-v");

  const options: MigrationOptions = {
    dryRun,
    verbose,
  };

  console.log("🚀 Starting E2E Test Migration\n");
  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No changes will be made to the database\n");
  }
  if (verbose) {
    console.log("📝 VERBOSE MODE - Detailed logging enabled\n");
  }

  const stats: MigrationStats = {
    workspacesProcessed: 0,
    testsFound: 0,
    tasksCreated: 0,
    tasksSkipped: 0,
    errors: 0,
    testsByKind: {},
  };

  try {
    if (workspaceArg) {
      // Process single workspace
      const workspaceSlug = workspaceArg.split("=")[1];
      if (!workspaceSlug) {
        console.error("❌ Invalid workspace argument. Usage: --workspace=<workspace-slug>");
        process.exit(1);
      }

      await migrateWorkspace(workspaceSlug, stats, options);
      stats.workspacesProcessed = 1;
    } else if (allFlag) {
      // Process all workspaces
      const workspaces = await prisma.workspace.findMany({
        where: { deleted: false },
        select: { slug: true },
      });

      console.log(`Found ${workspaces.length} workspaces\n`);

      for (const workspace of workspaces) {
        await migrateWorkspace(workspace.slug, stats, options);
        stats.workspacesProcessed++;
      }
    } else {
      console.error("❌ Missing argument. Usage:");
      console.error("   npm run migrate:e2e-tasks -- --workspace=<workspace-slug>");
      console.error("   npm run migrate:e2e-tasks -- --all");
      console.error("   npm run migrate:e2e-tasks -- --workspace=<workspace-slug> --dry-run");
      console.error("   npm run migrate:e2e-tasks -- --workspace=<workspace-slug> --verbose");
      process.exit(1);
    }

    // Print summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 Migration Summary");
    console.log("=".repeat(70));
    console.log(`Workspaces Processed: ${stats.workspacesProcessed}`);
    console.log(`E2E Tests Found:      ${stats.testsFound}`);
    console.log(`Tasks ${dryRun ? "Would Be " : ""}Created:        ${stats.tasksCreated}`);
    console.log(`Tasks Skipped:        ${stats.tasksSkipped}`);
    console.log(`Errors:               ${stats.errors}`);

    if (Object.keys(stats.testsByKind).length > 0) {
      console.log("\nTests by Kind:");
      Object.entries(stats.testsByKind)
        .sort((a, b) => b[1] - a[1])
        .forEach(([kind, count]) => {
          console.log(`  - ${kind}: ${count}`);
        });
    }

    // Accounting check
    const totalProcessed = stats.tasksCreated + stats.tasksSkipped + stats.errors;
    console.log("\n" + "-".repeat(70));
    console.log("🧮 Accounting:");
    console.log(`  Tests Found:  ${stats.testsFound}`);
    console.log(`  Created:      ${stats.tasksCreated}`);
    console.log(`  Skipped:      ${stats.tasksSkipped}`);
    console.log(`  Errors:       ${stats.errors}`);
    console.log(`  ` + "-".repeat(30));
    console.log(`  Total:        ${totalProcessed}`);

    if (stats.testsFound === totalProcessed) {
      console.log(`  ✅ All tests accounted for!`);
    } else {
      const diff = stats.testsFound - totalProcessed;
      console.log(`  ❌ MISMATCH: ${Math.abs(diff)} test(s) ${diff > 0 ? "missing" : "extra"}!`);
    }

    console.log("=".repeat(70));

    if (dryRun) {
      console.log("\n🔍 DRY RUN COMPLETE");
      console.log("   Run without --dry-run to actually create tasks.");
    } else if (stats.tasksCreated > 0) {
      console.log("\n✅ Migration completed successfully!");
      console.log("   Visit the User Journeys page to see the migrated tests.");
    } else if (stats.tasksSkipped > 0) {
      console.log("\n✅ All tests already migrated (nothing to do).");
    } else {
      console.log("\nℹ️  No tests found to migrate.");
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
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
