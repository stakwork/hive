/**
 * Seed script for populating Workflow_version nodes in the graph database
 * 
 * This script creates test data for the workflow version selector functionality.
 * It generates multiple workflow versions with varying properties for testing.
 * 
 * Usage:
 *   npm run tsx scripts/helpers/seed-workflow-versions.ts -- --workspaceSlug=my-workspace
 *   npm run tsx scripts/helpers/seed-workflow-versions.ts -- --workspaceSlug=my-workspace --dry-run
 *   npm run tsx scripts/helpers/seed-workflow-versions.ts -- --workspaceSlug=my-workspace --graphUrl=http://localhost:3355 --graphApiKey=test-key
 * 
 * Environment variables (fallback):
 *   - No direct env vars - script retrieves swarm config from database using workspace slug
 * 
 * Options:
 *   --workspaceSlug    (required) The workspace slug to seed data for
 *   --graphUrl         (optional) Override graph API URL
 *   --graphApiKey      (optional) Override graph API key
 *   --dry-run          (optional) Preview data without creating nodes
 *   --force            (optional) Skip existing data check and create anyway
 */

import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { randomUUID } from "crypto";

interface WorkflowVersionNode {
  workflow_version_id: string;
  workflow_id: number;
  workflow_json: string;
  date_added_to_graph: string;
  published_at: string | null;
  workflow_name: string;
  node_type: "Workflow_version";
}

interface GraphApiResponse {
  success: boolean;
  message?: string;
  data?: unknown;
}

interface ExistingVersionsResponse {
  edges?: Array<{
    properties?: {
      workflow_id?: number;
      workflow_version_id?: string;
      date_added_to_graph?: string;
    };
  }>;
}

// Parse CLI arguments
function parseArgs(): {
  workspaceSlug: string | null;
  graphUrl: string | null;
  graphApiKey: string | null;
  dryRun: boolean;
  force: boolean;
} {
  const args = process.argv.slice(2);
  let workspaceSlug: string | null = null;
  let graphUrl: string | null = null;
  let graphApiKey: string | null = null;
  let dryRun = false;
  let force = false;

  for (const arg of args) {
    if (arg.startsWith("--workspaceSlug=")) {
      workspaceSlug = arg.split("=")[1] || null;
    } else if (arg.startsWith("--graphUrl=")) {
      graphUrl = arg.split("=")[1] || null;
    } else if (arg.startsWith("--graphApiKey=")) {
      graphApiKey = arg.split("=")[1] || null;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    }
  }

  return { workspaceSlug, graphUrl, graphApiKey, dryRun, force };
}

// Generate realistic workflow JSON
function generateWorkflowJson(workflowId: number, versionNumber: number): string {
  const workflow = {
    nodes: [
      {
        id: `node-${randomUUID()}`,
        type: "start",
        position: { x: 100, y: 100 },
        data: { label: "Start" },
      },
      {
        id: `node-${randomUUID()}`,
        type: "task",
        position: { x: 300, y: 100 },
        data: { label: `Task ${versionNumber}`, description: `Version ${versionNumber} task` },
      },
      {
        id: `node-${randomUUID()}`,
        type: "decision",
        position: { x: 500, y: 100 },
        data: { label: "Decision Point", condition: "status === 'approved'" },
      },
      {
        id: `node-${randomUUID()}`,
        type: "end",
        position: { x: 700, y: 100 },
        data: { label: "End" },
      },
    ],
    edges: [
      { id: `edge-${randomUUID()}`, source: "node-1", target: "node-2" },
      { id: `edge-${randomUUID()}`, source: "node-2", target: "node-3" },
      { id: `edge-${randomUUID()}`, source: "node-3", target: "node-4", label: "approved" },
    ],
    version: versionNumber,
    workflowId: workflowId,
  };

  return JSON.stringify(workflow);
}

// Generate test data for workflow versions
function generateTestData(): WorkflowVersionNode[] {
  const versions: WorkflowVersionNode[] = [];
  const now = new Date();

  // Workflow 1: 12 versions (test 10-version limit)
  console.log("📝 Generating Workflow 1: 12 versions (testing pagination)");
  for (let i = 1; i <= 12; i++) {
    const daysAgo = 12 - i; // Newest first
    const createdDate = new Date(now);
    createdDate.setDate(createdDate.getDate() - daysAgo);

    const isPublished = i === 8 || i === 11; // Mark versions 8 and 11 as published

    versions.push({
      workflow_version_id: randomUUID(),
      workflow_id: 1001,
      workflow_json: generateWorkflowJson(1001, i),
      date_added_to_graph: createdDate.toISOString(),
      published_at: isPublished ? createdDate.toISOString() : null,
      workflow_name: `Test Workflow Alpha v${i}`,
      node_type: "Workflow_version",
    });
  }

  // Workflow 2: 5 versions with mix of published/draft
  console.log("📝 Generating Workflow 2: 5 versions (mixed published/draft)");
  for (let i = 1; i <= 5; i++) {
    const daysAgo = (5 - i) * 2; // Spread over 8 days
    const createdDate = new Date(now);
    createdDate.setDate(createdDate.getDate() - daysAgo);

    const isPublished = i === 3 || i === 5; // Mark versions 3 and 5 as published

    versions.push({
      workflow_version_id: randomUUID(),
      workflow_id: 1002,
      workflow_json: generateWorkflowJson(1002, i),
      date_added_to_graph: createdDate.toISOString(),
      published_at: isPublished ? createdDate.toISOString() : null,
      workflow_name: `Test Workflow Beta v${i}`,
      node_type: "Workflow_version",
    });
  }

  // Workflow 3: 1 version (edge case)
  console.log("📝 Generating Workflow 3: 1 version (edge case - single version)");
  const singleVersionDate = new Date(now);
  singleVersionDate.setDate(singleVersionDate.getDate() - 1);

  versions.push({
    workflow_version_id: randomUUID(),
    workflow_id: 1003,
    workflow_json: generateWorkflowJson(1003, 1),
    date_added_to_graph: singleVersionDate.toISOString(),
    published_at: singleVersionDate.toISOString(), // Published
    workflow_name: "Test Workflow Gamma v1",
    node_type: "Workflow_version",
  });

  return versions;
}

// Query existing workflow versions from graph
async function checkExistingVersions(
  graphUrl: string,
  apiKey: string
): Promise<{ workflowId: number; count: number; latestDate: string }[]> {
  try {
    console.log("\n🔍 Checking for existing Workflow_version nodes...");

    const response = await fetch(`${graphUrl}/api/graph/search/attributes`, {
      method: "POST",
      headers: {
        "x-api-token": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        node_type: ["Workflow_version"],
        include_properties: true,
        limit: 100,
        skip: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as ExistingVersionsResponse;
    const edges = data.edges || [];

    if (edges.length === 0) {
      console.log("✅ No existing Workflow_version nodes found");
      return [];
    }

    // Group by workflow_id
    const byWorkflow = new Map<number, { count: number; latestDate: string }>();

    for (const edge of edges) {
      const workflowId = edge.properties?.workflow_id;
      const dateAdded = edge.properties?.date_added_to_graph;

      if (typeof workflowId === "number") {
        const existing = byWorkflow.get(workflowId);
        if (!existing) {
          byWorkflow.set(workflowId, {
            count: 1,
            latestDate: dateAdded || "",
          });
        } else {
          existing.count++;
          if (dateAdded && dateAdded > existing.latestDate) {
            existing.latestDate = dateAdded;
          }
        }
      }
    }

    const summary = Array.from(byWorkflow.entries()).map(([workflowId, stats]) => ({
      workflowId,
      count: stats.count,
      latestDate: stats.latestDate,
    }));

    console.log(`📊 Found ${edges.length} existing versions across ${summary.length} workflows:`);
    for (const { workflowId, count, latestDate } of summary) {
      console.log(
        `   - Workflow ${workflowId}: ${count} version${count !== 1 ? "s" : ""} (latest: ${latestDate})`
      );
    }

    return summary;
  } catch (error) {
    console.error("❌ Error checking existing versions:", error);
    throw error;
  }
}

// Create workflow version node in graph
async function createWorkflowVersionNode(
  graphUrl: string,
  apiKey: string,
  version: WorkflowVersionNode
): Promise<void> {
  const response = await fetch(`${graphUrl}/api/graph/nodes`, {
    method: "POST",
    headers: {
      "x-api-token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      node_type: "Workflow_version",
      ref_id: version.workflow_version_id,
      properties: {
        workflow_version_id: version.workflow_version_id,
        workflow_id: version.workflow_id,
        workflow_json: version.workflow_json,
        date_added_to_graph: version.date_added_to_graph,
        published_at: version.published_at,
        workflow_name: version.workflow_name,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create node: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as GraphApiResponse;
  if (!result.success) {
    throw new Error(`Graph API returned error: ${result.message}`);
  }
}

// Main execution
async function main() {
  const { workspaceSlug, graphUrl: cliGraphUrl, graphApiKey: cliApiKey, dryRun, force } = parseArgs();

  console.log("🚀 Workflow Version Seed Script");
  console.log("================================\n");

  // Validate workspace slug
  if (!workspaceSlug) {
    console.error("❌ Error: --workspaceSlug is required");
    console.log("\nUsage:");
    console.log("  npm run tsx scripts/helpers/seed-workflow-versions.ts -- --workspaceSlug=my-workspace");
    process.exit(1);
  }

  try {
    // Get workspace and swarm config from database
    console.log(`🔍 Looking up workspace: ${workspaceSlug}`);
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      include: { swarm: true },
    });

    if (!workspace) {
      console.error(`❌ Error: Workspace '${workspaceSlug}' not found`);
      process.exit(1);
    }

    console.log(`✅ Found workspace: ${workspace.name} (ID: ${workspace.id})`);

    if (!workspace.swarm) {
      console.error("❌ Error: No swarm configuration found for this workspace");
      console.log("   Please configure a swarm for this workspace first");
      process.exit(1);
    }

    // Get graph URL and API key
    let graphUrl = cliGraphUrl;
    let apiKey = cliApiKey;

    if (!graphUrl || !apiKey) {
      console.log("🔑 Retrieving swarm configuration from database...");

      if (!workspace.swarm.swarmUrl || !workspace.swarm.swarmApiKey) {
        console.error("❌ Error: Incomplete swarm configuration in database");
        process.exit(1);
      }

      // Construct graph URL from swarm URL
      if (!graphUrl) {
        const swarmUrlObj = new URL(workspace.swarm.swarmUrl);
        const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";
        graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
        console.log(`   Graph URL: ${graphUrl}`);
      }

      // Decrypt API key
      if (!apiKey) {
        const encryptionService = EncryptionService.getInstance();
        apiKey = encryptionService.decryptField("swarmApiKey", workspace.swarm.swarmApiKey);
        console.log("   API Key: [decrypted from database]");
      }
    } else {
      console.log(`🔑 Using provided credentials:`);
      console.log(`   Graph URL: ${graphUrl}`);
      console.log(`   API Key: [provided via CLI]`);
    }

    // Check existing data
    if (!force) {
      const existing = await checkExistingVersions(graphUrl, apiKey);

      if (existing.length > 0) {
        const hasMultipleVersions = existing.some((w) => w.count >= 3);
        if (hasMultipleVersions) {
          console.log("\n⚠️  Warning: Found workflows with 3+ versions already.");
          console.log("   Use --force to create test data anyway, or remove existing data first.");
          console.log("   Exiting without changes.");
          process.exit(0);
        }
      }
    } else {
      console.log("\n⚠️  Force mode: skipping existing data check");
    }

    // Generate test data
    console.log("\n📦 Generating test data...");
    const versions = generateTestData();

    console.log(`\n✅ Generated ${versions.length} workflow versions:`);
    console.log(`   - Workflow 1001: 12 versions (2 published)`);
    console.log(`   - Workflow 1002: 5 versions (2 published)`);
    console.log(`   - Workflow 1003: 1 version (1 published)`);

    if (dryRun) {
      console.log("\n🔍 Dry run mode - showing sample data:");
      console.log("\nFirst version (Workflow 1001):");
      console.log(JSON.stringify(versions[0], null, 2));
      console.log("\nLast version (Workflow 1003):");
      console.log(JSON.stringify(versions[versions.length - 1], null, 2));
      console.log("\n✅ Dry run complete - no data created");
      return;
    }

    // Create nodes
    console.log("\n🔨 Creating Workflow_version nodes...");
    let created = 0;
    let failed = 0;

    for (const version of versions) {
      try {
        await createWorkflowVersionNode(graphUrl, apiKey, version);
        created++;
        process.stdout.write(`\r   Progress: ${created}/${versions.length} nodes created`);
      } catch (error) {
        failed++;
        console.error(`\n❌ Failed to create version ${version.workflow_version_id}:`, error);
      }
    }

    console.log("\n");
    console.log("================================");
    console.log("✅ Seeding complete!");
    console.log(`   Created: ${created} nodes`);
    if (failed > 0) {
      console.log(`   Failed: ${failed} nodes`);
    }
    console.log("\n💡 Next steps:");
    console.log("   1. Verify nodes in graph database");
    console.log("   2. Test version selector UI with workflow IDs: 1001, 1002, 1003");
    console.log("   3. Confirm versions are sorted by date (newest first)");
    console.log("   4. Check published badge display");
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

// Run the script
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
