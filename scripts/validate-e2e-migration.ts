#!/usr/bin/env ts-node

/**
 * Validation Script: Compare E2E Tests in Graph vs Database
 *
 * This script helps debug migration issues by comparing:
 * - Tests stored in the swarm graph (E2etest nodes)
 * - Tasks in the database (sourceType=USER_JOURNEY)
 *
 * It identifies which tests are missing from the database and why.
 *
 * Usage:
 *   npm run validate:e2e-migration -- --workspace=<workspace-slug>
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { EncryptionService } from "../src/lib/encryption";

// Load environment variables
dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();
const encryptionService = EncryptionService.getInstance();

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

async function fetchE2eTestsFromGraph(swarmUrl: string, swarmApiKey: string): Promise<E2eTestNode[]> {
  try {
    const graphPort = process.env.GRAPH_SERVICE_PORT || "3355";
    const swarmUrlObj = new URL(swarmUrl);
    const graphUrl = `https://${swarmUrlObj.hostname}:${graphPort}`;

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

async function validateWorkspace(workspaceSlug: string): Promise<void> {
  console.log(`\n🔍 Validating workspace: ${workspaceSlug}\n`);

  // Get workspace data
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug, deleted: false },
    include: {
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
    return;
  }

  if (!workspace.swarm?.swarmUrl || !workspace.swarm?.swarmApiKey) {
    console.error(`❌ Swarm not configured for workspace`);
    return;
  }

  console.log(`✅ Workspace found: ${workspace.name}`);
  console.log(`   Swarm URL: ${workspace.swarm.swarmUrl}`);
  console.log(`   Repository: ${workspace.repositories[0]?.repositoryUrl || "not configured"}`);

  // Fetch tests from graph
  console.log(`\n📊 Fetching tests from graph...`);
  const decryptedApiKey = encryptionService.decryptField("swarmApiKey", workspace.swarm.swarmApiKey);
  const graphTests = await fetchE2eTestsFromGraph(workspace.swarm.swarmUrl, decryptedApiKey);

  console.log(`   Found ${graphTests.length} test cases in graph`);

  // Group tests by file path (matching migration script behavior)
  const testsByFile = new Map<string, E2eTestNode>();
  graphTests.forEach((test) => {
    const filePath = test.properties.file;
    // Only keep the first test case we encounter for each file
    if (!testsByFile.has(filePath)) {
      testsByFile.set(filePath, test);
    }
  });

  const uniqueTestFiles = Array.from(testsByFile.values());
  console.log(`   Grouped into ${uniqueTestFiles.length} unique test files`);

  // Fetch tasks from database
  console.log(`\n💾 Fetching tasks from database...`);
  const dbTasks = await prisma.task.findMany({
    where: {
      workspaceId: workspace.id,
      sourceType: "USER_JOURNEY",
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

  console.log(`   Found ${dbTasks.length} tasks in database`);

  // Group tests by test_kind
  const testsByKind: Record<string, E2eTestNode[]> = {};
  uniqueTestFiles.forEach((test) => {
    const kind = test.properties.test_kind || "unknown";
    if (!testsByKind[kind]) {
      testsByKind[kind] = [];
    }
    testsByKind[kind].push(test);
  });

  console.log(`\n📈 Test File Breakdown by Kind:`);
  Object.entries(testsByKind)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([kind, tests]) => {
      console.log(`   ${kind}: ${tests.length} files`);
    });

  // Create lookup map for database tasks
  const dbTasksByPath = new Map<string, (typeof dbTasks)[0]>();
  dbTasks.forEach((task) => {
    if (task.testFilePath) {
      dbTasksByPath.set(task.testFilePath, task);
    }
  });

  // Find missing test files
  console.log(`\n🔎 Analysis:`);
  console.log(`   Test files in graph: ${uniqueTestFiles.length}`);
  console.log(`   Tasks in database:   ${dbTasks.length}`);
  console.log(`   Missing:             ${Math.max(0, uniqueTestFiles.length - dbTasks.length)}`);

  if (uniqueTestFiles.length > dbTasks.length) {
    console.log(`\n❌ Missing Test Files (in graph but not in database):\n`);

    const missingTestFiles = uniqueTestFiles.filter((test) => {
      return !dbTasksByPath.has(test.properties.file);
    });

    missingTestFiles.forEach((test, index) => {
      const fileName = test.properties.file.split("/").pop() || test.properties.file;
      console.log(`   ${index + 1}. ${fileName}`);
      console.log(`      File: ${test.properties.file}`);
      console.log(`      Kind: ${test.properties.test_kind || "unknown"}`);
      console.log(`      Ref ID: ${test.ref_id}`);
      console.log();
    });

    // Analyze why they might be missing
    console.log(`\n📋 Potential Issues:`);
    const missingByKind: Record<string, number> = {};
    missingTestFiles.forEach((test) => {
      const kind = test.properties.test_kind || "unknown";
      missingByKind[kind] = (missingByKind[kind] || 0) + 1;
    });

    Object.entries(missingByKind).forEach(([kind, count]) => {
      console.log(`   - ${count} ${kind} test files missing`);
    });

    if (!workspace.repositories[0]) {
      console.log(`   - No repository configured (GitHub URLs cannot be generated)`);
    }
  } else if (dbTasks.length > uniqueTestFiles.length) {
    console.log(`\n⚠️  More tasks in database than test files in graph!`);
    console.log(`   This could indicate:`);
    console.log(`   - Tests were deleted from the graph`);
    console.log(`   - Tests were manually created via recording`);
    console.log(`   - Tests were moved/renamed in the graph`);
  } else {
    console.log(`\n✅ All graph test files are migrated to database!`);
  }

  // Show detailed comparison
  console.log(`\n\n${"=".repeat(80)}`);
  console.log(`📝 Detailed Comparison`);
  console.log(`${"=".repeat(80)}\n`);

  console.log(`Graph Test Files:`);
  uniqueTestFiles.forEach((test, index) => {
    const inDb = dbTasksByPath.has(test.properties.file);
    const status = inDb ? "✅" : "❌";
    const fileName = test.properties.file.split("/").pop() || test.properties.file;
    console.log(`   ${status} ${index + 1}. ${fileName}`);
    console.log(`      Path: ${test.properties.file}`);
    console.log(`      Kind: ${test.properties.test_kind || "unknown"}`);
    if (inDb) {
      const task = dbTasksByPath.get(test.properties.file)!;
      console.log(`      Task ID: ${task.id}`);
      console.log(`      Task Title: ${task.title}`);
      console.log(`      Status: ${task.status} / ${task.workflowStatus || "N/A"}`);
    }
    console.log();
  });
}

async function main() {
  console.log("🚀 E2E Test Migration Validation\n");

  const args = process.argv.slice(2);
  const workspaceArg = args.find((arg) => arg.startsWith("--workspace="));

  if (!workspaceArg) {
    console.error("❌ Missing argument. Usage:");
    console.error("   npm run validate:e2e-migration -- --workspace=<workspace-slug>");
    process.exit(1);
  }

  const workspaceSlug = workspaceArg.split("=")[1];
  if (!workspaceSlug) {
    console.error("❌ Invalid workspace argument");
    process.exit(1);
  }

  try {
    await validateWorkspace(workspaceSlug);
  } catch (error) {
    console.error("\n❌ Validation failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run validation
if (require.main === module) {
  main();
}

export { main as validateE2eMigration };
