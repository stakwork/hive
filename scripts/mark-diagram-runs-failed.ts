/**
 * One-off cleanup for the Excalidraw Whiteboards removal (Phase 1).
 *
 * The Excalidraw Whiteboards feature and its DIAGRAM_GENERATION Stakwork run
 * type have been retired end-to-end: no code path can create a new
 * DIAGRAM_GENERATION run, and `processStakworkRunWebhook` now rejects any
 * webhook naming that type with "Unauthorized: run type retired".
 *
 * Any DIAGRAM_GENERATION run that was PENDING or IN_PROGRESS at deploy time
 * will never receive a webhook it can act on again (the generic webhook
 * route now 401/400s those callbacks). This script marks those stranded
 * runs FAILED so they don't linger indefinitely in a non-terminal state.
 *
 * Idempotent: only rows currently PENDING/IN_PROGRESS with
 * type = DIAGRAM_GENERATION are affected; re-running finds nothing to do.
 *
 * Usage:
 *   npx tsx scripts/mark-diagram-runs-failed.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/mark-diagram-runs-failed.ts
 */

import { PrismaClient, StakworkRunType, WorkflowStatus } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.stakworkRun.updateMany({
    where: {
      type: StakworkRunType.DIAGRAM_GENERATION,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    },
    data: {
      status: WorkflowStatus.FAILED,
    },
  });

  console.log(
    `Marked ${result.count} in-flight DIAGRAM_GENERATION run(s) as FAILED.`
  );
}

main()
  .catch((error) => {
    console.error("Failed to mark in-flight DIAGRAM_GENERATION runs:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
