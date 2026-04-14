/**
 * Quick check: are coding/build/test/browser agent logs stored with taskId=null?
 *
 * Usage:
 *   npx dotenv-cli -e .env.prod -- npx tsx scripts/scorer/debug-taskid.ts hive
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2] || "hive";

  const workspace = await prisma.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true },
  });

  if (!workspace) {
    console.error(`Workspace "${slug}" not found`);
    process.exit(1);
  }

  // Check: agent logs with featureId set, taskId null, grouped by agent name prefix
  const logs = await prisma.agentLog.findMany({
    where: { workspaceId: workspace.id, taskId: null, featureId: { not: null } },
    select: { agent: true, featureId: true, taskId: true },
  });

  const byPrefix = new Map<string, number>();
  for (const log of logs) {
    const prefix = log.agent.replace(/-[a-z0-9]+$/i, "");
    byPrefix.set(prefix, (byPrefix.get(prefix) || 0) + 1);
  }

  console.log(`\nAgent logs with featureId set + taskId=null:\n`);
  console.log(`Total: ${logs.length}`);
  for (const [prefix, count] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${prefix}: ${count}`);
  }

  // For the feature from earlier, show all logs (with and without taskId)
  const featureId = "cmmk2y9jw0001ib04a3drd2wg";
  const allLogs = await prisma.agentLog.findMany({
    where: { featureId },
    orderBy: { createdAt: "asc" },
    select: { id: true, agent: true, taskId: true, createdAt: true },
  });

  console.log(`\nAll logs for feature ${featureId}:\n`);
  for (const log of allLogs) {
    console.log(`  ${log.agent.padEnd(55)} taskId=${log.taskId || "NULL"}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
