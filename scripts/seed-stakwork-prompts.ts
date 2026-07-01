/**
 * Deploy-time seed script: import global Stakwork prompts into Hive.
 *
 * Usage:
 *   npm run seed:prompts
 *   (or directly: tsx scripts/seed-stakwork-prompts.ts)
 *
 * Reads STAKWORK_BASE_URL and STAKWORK_API_KEY from the environment.
 * Exits with code 1 if any per-prompt errors occurred.
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { seedPrompts } from "../src/services/prompts/seed-stakwork-prompts";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

seedPrompts({ prisma })
  .then((result) => {
    if (result.totalErrors > 0) {
      console.error(
        `[seed:prompts] Completed with ${result.totalErrors} error(s). Check logs above.`
      );
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("[seed:prompts] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
