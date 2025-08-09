import { PrismaClient } from "@prisma/client";
import {
  EncryptableField,
  EncryptionService,
  encryptEnvVars,
} from "@/lib/encryption";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();
const encryptionService = EncryptionService.getInstance();

async function isAlreadyEncrypted(value: string | null): Promise<boolean> {
  if (!value || value.trim() === "") return false;

  try {
    const parsed = JSON.parse(value);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.data === "string" &&
      typeof parsed.iv === "string" &&
      typeof parsed.tag === "string" &&
      typeof parsed.encryptedAt === "string"
    );
  } catch {
    return false;
  }
}

async function encryptValue(fieldName: string, value: string): Promise<string> {
  try {
    const encrypted = encryptionService.encryptField(
      fieldName as EncryptableField,
      value,
    );
    return JSON.stringify(encrypted);
  } catch (error) {
    console.error(`Failed to encrypt ${fieldName}:`, error);
    throw error;
  }
}

type MigrationStats = {
  processed: number;
  encrypted: number;
  skipped: number;
  errors: number;
};

function newStats(): MigrationStats {
  return { processed: 0, encrypted: 0, skipped: 0, errors: 0 };
}

function logStats(label: string, stats: MigrationStats) {
  console.log(`${label} migration complete`);
  console.log(stats);
}

async function migrateAccounts(stats: MigrationStats): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: {
      OR: [
        { access_token: { not: null } },
        { refresh_token: { not: null } },
        { id_token: { not: null } },
      ],
    },
    select: {
      id: true,
      access_token: true,
      refresh_token: true,
      id_token: true,
    },
  });

  for (const account of accounts) {
    try {
      stats.processed++;
      const data: Record<string, string> = {};
      let updated = false;
      if (
        account.access_token &&
        !(await isAlreadyEncrypted(account.access_token))
      ) {
        data.access_token = await encryptValue(
          "access_token",
          account.access_token,
        );
        updated = true;
      }
      if (
        account.refresh_token &&
        !(await isAlreadyEncrypted(account.refresh_token))
      ) {
        data.refresh_token = await encryptValue(
          "refresh_token",
          account.refresh_token,
        );
        updated = true;
      }
      if (account.id_token && !(await isAlreadyEncrypted(account.id_token))) {
        data.id_token = await encryptValue("id_token", account.id_token);
        updated = true;
      }
      if (updated) {
        await prisma.account.update({ where: { id: account.id }, data });
        stats.encrypted++;
      } else {
        stats.skipped++;
      }
    } catch (error) {
      stats.errors++;
      console.error(`Failed to encrypt account ${account.id}:`, error);
    }
  }
}

async function migrateSwarms(stats: MigrationStats): Promise<void> {
  const swarms = await prisma.swarm.findMany({
    select: {
      id: true,
      environmentVariables: true,
      swarmApiKey: true,
      poolApiKey: true,
    },
  });

  for (const swarm of swarms) {
    try {
      stats.processed++;
      let updated = false;
      const updateData: Record<string, string> = {};

      // environmentVariables migration to per-item encryption
      if (swarm.environmentVariables) {
        if (typeof swarm.environmentVariables === "string") {
          try {
            const parsed = JSON.parse(swarm.environmentVariables);
            if (Array.isArray(parsed)) {
              const encArr = encryptEnvVars(
                parsed as Array<{ name: string; value: string }>,
              );
              (
                updateData as unknown as { environmentVariables: unknown }
              ).environmentVariables = encArr;
              updated = true;
            } else if (
              !(await isAlreadyEncrypted(swarm.environmentVariables))
            ) {
              // legacy single-string case; leave as-is for compatibility
            }
          } catch {
            // not JSON, skip
          }
        } else if (Array.isArray(swarm.environmentVariables)) {
          const arr = swarm.environmentVariables as Array<{
            name: string;
            value: unknown;
          }>;
          const needsEncrypt = arr.some((ev) => typeof ev.value === "string");
          if (needsEncrypt) {
            const plain = arr.map((ev) => ({
              name: ev.name as string,
              value: String(ev.value ?? ""),
            }));
            const encArr = encryptEnvVars(plain);
            (
              updateData as unknown as { environmentVariables: unknown }
            ).environmentVariables = encArr;
            updated = true;
          }
        }
      }

      if (swarm.swarmApiKey && !(await isAlreadyEncrypted(swarm.swarmApiKey))) {
        updateData.swarmApiKey = await encryptValue(
          "swarmApiKey",
          swarm.swarmApiKey,
        );
        updated = true;
      }

      if (swarm.poolApiKey && !(await isAlreadyEncrypted(swarm.poolApiKey))) {
        updateData.poolApiKey = await encryptValue(
          "poolApiKey",
          swarm.poolApiKey,
        );
        updated = true;
      }

      if (updated) {
        await prisma.swarm.update({
          where: { id: swarm.id },
          data: updateData,
        });
        stats.encrypted++;
      } else {
        stats.skipped++;
      }
    } catch (error) {
      stats.errors++;
      console.error(`Failed to encrypt swarm ${swarm.id}:`, error);
    }
  }
}

async function migrateRepositories(stats: MigrationStats): Promise<void> {
  const rows = await prisma.repository.findMany({
    where: { githubWebhookSecret: { not: null } },
    select: { id: true, githubWebhookSecret: true },
  });

  for (const row of rows) {
    try {
      stats.processed++;
      const current = row.githubWebhookSecret as string | null;
      if (!current || (await isAlreadyEncrypted(current))) continue;
      const encrypted = await encryptValue("githubWebhookSecret", current);
      await prisma.repository.update({
        where: { id: row.id },
        data: { githubWebhookSecret: encrypted },
      });
      stats.encrypted++;
    } catch (error) {
      stats.errors++;
      console.error(`Failed to encrypt repository ${row.id}:`, error);
    }
  }
}

async function migrateWorkspaces(stats: MigrationStats): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      stakworkApiKey: {
        not: null,
      },
    },
    select: {
      id: true,
      stakworkApiKey: true,
    },
  });

  for (const workspace of workspaces) {
    try {
      stats.processed++;
      if (
        !workspace.stakworkApiKey ||
        (await isAlreadyEncrypted(workspace.stakworkApiKey))
      ) {
        stats.skipped++;
        continue;
      }

      const encryptedKey = await encryptValue(
        "stakworkApiKey",
        workspace.stakworkApiKey,
      );

      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { stakworkApiKey: encryptedKey },
      });
      stats.encrypted++;
    } catch (error) {
      stats.errors++;
      console.error(`Failed to encrypt workspace ${workspace.id}:`, error);
    }
  }
}

async function migrateUsers(stats: MigrationStats): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      poolApiKey: {
        not: null,
      },
    },
    select: {
      id: true,
      poolApiKey: true,
    },
  });

  for (const user of users) {
    try {
      stats.processed++;
      if (!user.poolApiKey || (await isAlreadyEncrypted(user.poolApiKey))) {
        stats.skipped++;
        continue;
      }

      const encryptedKey = await encryptValue("poolApiKey", user.poolApiKey);

      await prisma.user.update({
        where: { id: user.id },
        data: { poolApiKey: encryptedKey },
      });
      stats.encrypted++;
    } catch (error) {
      stats.errors++;
      console.error(`Failed to encrypt user ${user.id}:`, error);
    }
  }
}

async function main() {
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.error("TOKEN_ENCRYPTION_KEY environment variable is required!");
    process.exit(1);
  }

  try {
    await prisma.$connect();

    const accStats = newStats();
    await migrateAccounts(accStats);
    logStats("Accounts", accStats);

    const swarmStats = newStats();
    await migrateSwarms(swarmStats);
    logStats("Swarms", swarmStats);

    const repoStats = newStats();
    await migrateRepositories(repoStats);
    logStats("Repositories", repoStats);

    const wsStats = newStats();
    await migrateWorkspaces(wsStats);
    logStats("Workspaces", wsStats);

    const userStats = newStats();
    await migrateUsers(userStats);
    logStats("Users", userStats);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

export { main as migrateEncryptExistingData };
