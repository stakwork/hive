import { PrismaClient } from "@prisma/client";
import { put } from "@vercel/blob";

const prisma = new PrismaClient();

// Check if blob storage is configured
const isBlobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;

/**
 * Seeds agent log data for testing the Agent Logs UI
 * Creates 60 logs spanning multiple agents and dates
 */
export async function seedAgentLogs() {
  console.log("\n🤖 Starting agent logs seed...");

  // Check if blob storage is configured
  if (!isBlobConfigured) {
    console.log("⚠️  Blob storage not configured (BLOB_READ_WRITE_TOKEN missing) - skipping agent logs seed");
    console.log("   To enable: Set BLOB_READ_WRITE_TOKEN environment variable");
    return;
  }

  // Get first workspace for seeding
  const workspace = await prisma.workspace.findFirst({
    where: { deleted: false },
    include: {
      stakworkRuns: { take: 10 },
      tasks: { take: 10, where: { deleted: false, archived: false } },
    },
  });

  if (!workspace) {
    console.log("ℹ️  No workspace found - skipping agent logs seed");
    return;
  }

  // Check for existing logs
  const existingCount = await prisma.agentLog.count({
    where: { workspaceId: workspace.id },
  });

  if (existingCount >= 50) {
    console.log(`✓ Already have ${existingCount} agent logs - skipping seed`);
    return;
  }

  console.log(`✓ Found workspace: ${workspace.name}`);

  // Agent types to create logs for
  const agents = ["researcher", "architect", "coder", "reviewer"];

  // Generate date distribution (3 months back to now)
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);

  const logsToCreate = 60; // Create 60 logs for good pagination testing
  const logs: Array<{
    workspaceId: string;
    blobUrl: string;
    agent: string;
    stakworkRunId: string | null;
    taskId: string | null;
    createdAt: Date;
  }> = [];

  console.log("📝 Generating log content and uploading to blob storage...");

  for (let i = 0; i < logsToCreate; i++) {
    // Distribute dates with more recent concentration
    // Use quadratic distribution to create more logs in recent dates
    const normalizedIndex = i / logsToCreate;
    const quadraticFactor = Math.pow(normalizedIndex, 2);
    const dateOffset =
      (now.getTime() - threeMonthsAgo.getTime()) * quadraticFactor;
    const createdAt = new Date(threeMonthsAgo.getTime() + dateOffset);

    // Randomly assign to StakworkRun or Task
    const useStakworkRun = i % 2 === 0 && workspace.stakworkRuns.length > 0;
    const stakworkRunId = useStakworkRun
      ? workspace.stakworkRuns[i % workspace.stakworkRuns.length].id
      : null;
    const taskId =
      !useStakworkRun && workspace.tasks.length > 0
        ? workspace.tasks[i % workspace.tasks.length].id
        : null;

    const agent = agents[i % agents.length];

    // Create varied log content (some short, some long)
    const messageCount = Math.floor(Math.random() * 10) + 1;
    const messages = [];

    for (let j = 0; j < messageCount; j++) {
      messages.push({
        role: "user",
        content: `${agent} request ${i + 1}-${j + 1}: Analyze the codebase structure and identify potential improvements.`,
        timestamp: new Date(createdAt.getTime() + j * 1000).toISOString(),
      });

      // Add reasoning for some messages
      if (j % 2 === 0 && agent === "researcher") {
        messages.push({
          role: "assistant",
          reasoning: `Analyzing code patterns for request ${i + 1}-${j + 1}...`,
          timestamp: new Date(createdAt.getTime() + j * 1000 + 500).toISOString(),
        });
      }

      messages.push({
        role: "assistant",
        content: `${agent} response ${i + 1}-${j + 1}: Found ${Math.floor(Math.random() * 20) + 1} files to analyze. Processing dependencies and identifying architecture patterns. Current focus: ${["data flow", "error handling", "type safety", "component structure"][j % 4]}.`,
        timestamp: new Date(createdAt.getTime() + j * 1000 + 800).toISOString(),
      });
    }

    // Add tool calls for some logs
    const includeToolCalls = i % 3 === 0;
    if (includeToolCalls) {
      messages.push({
        role: "assistant",
        tool_calls: [
          {
            id: `call_${i}_1`,
            type: "function",
            function: {
              name: "analyze_code",
              arguments: JSON.stringify({
                path: `/src/${agent}/module-${i}.ts`,
                depth: 3,
              }),
            },
          },
        ],
        timestamp: new Date(
          createdAt.getTime() + messageCount * 1000
        ).toISOString(),
      });

      messages.push({
        role: "tool",
        tool_call_id: `call_${i}_1`,
        content: JSON.stringify({
          files_analyzed: Math.floor(Math.random() * 50) + 10,
          issues_found: Math.floor(Math.random() * 15),
          suggestions: ["Improve error handling", "Add type annotations"],
        }),
        timestamp: new Date(
          createdAt.getTime() + messageCount * 1000 + 500
        ).toISOString(),
      });
    }

    // Create sample log content
    const logContent = {
      messages,
      metadata: {
        agent,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        stakworkRunId,
        taskId,
        index: i,
        duration_ms: Math.floor(Math.random() * 30000) + 5000,
        tokens_used: Math.floor(Math.random() * 10000) + 1000,
      },
      summary: {
        total_messages: messages.length,
        has_tool_calls: includeToolCalls,
        status: Math.random() > 0.1 ? "completed" : "failed",
      },
    };

    try {
      // Upload to blob storage
      const blobPath = `agent-logs/${workspace.id}/${stakworkRunId || taskId}/${agent}-${i}.json`;
      const blob = await put(blobPath, JSON.stringify(logContent, null, 2), {
        access: "public",
        addRandomSuffix: true,
      });

      logs.push({
        workspaceId: workspace.id,
        blobUrl: blob.url,
        agent,
        stakworkRunId,
        taskId,
        createdAt,
      });

      // Show progress every 10 logs
      if ((i + 1) % 10 === 0) {
        console.log(`   Progress: ${i + 1}/${logsToCreate} logs uploaded...`);
      }
    } catch (error) {
      console.error(`   ⚠️  Failed to upload log ${i + 1}:`, error);
      // Continue with other logs even if one fails
    }
  }

  if (logs.length === 0) {
    console.log("❌ No logs were successfully created - check blob storage configuration");
    return;
  }

  // Bulk insert
  await prisma.agentLog.createMany({
    data: logs,
  });

  // Calculate distribution stats
  const now24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const now7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const now30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const last24h = logs.filter((l) => l.createdAt >= now24h).length;
  const last7d = logs.filter((l) => l.createdAt >= now7d).length;
  const last30d = logs.filter((l) => l.createdAt >= now30d).length;

  const agentCounts = agents.map(
    (agent) => `${agent}: ${logs.filter((l) => l.agent === agent).length}`
  );

  console.log(
    `✓ Agent logs seed complete:\n` +
      `  - ${logs.length} logs created\n` +
      `  - ${agents.length} agent types (${agentCounts.join(", ")})\n` +
      `  - Date range: ${threeMonthsAgo.toDateString()} to ${now.toDateString()}\n` +
      `  - Distribution:\n` +
      `    • Last 24 hours: ${last24h} logs\n` +
      `    • Last 7 days: ${last7d} logs\n` +
      `    • Last 30 days: ${last30d} logs\n` +
      `    • Older: ${logs.length - last30d} logs\n` +
      `  - StakworkRun associations: ${logs.filter((l) => l.stakworkRunId).length}\n` +
      `  - Task associations: ${logs.filter((l) => l.taskId).length}`
  );
}

// Allow running independently
if (require.main === module) {
  seedAgentLogs()
    .catch((err) => {
      console.error("Agent logs seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
