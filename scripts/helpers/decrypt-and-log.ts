import { PrismaClient } from "@prisma/client";
import { EncryptionService, decryptEnvVars } from "@/lib/encryption";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();
const encryption = EncryptionService.getInstance();

async function logAccounts() {
  const accounts = await prisma.account.findMany({
    select: { id: true, userId: true, provider: true, access_token: true },
  });

  console.log("\n=== ACCOUNTS (access_token) ===");
  for (const a of accounts) {
    try {
      const token = a.access_token ?? null;
      const decrypted = token
        ? encryption.decryptField("access_token", token)
        : null;
      console.log(
        `[ACCOUNT] id=${a.id} userId=${a.userId} provider=${a.provider}`,
      );
      console.log(`  access_token (decrypted): ${decrypted}`);
    } catch (err) {
      console.log(
        `[ACCOUNT] id=${a.id} userId=${a.userId} provider=${a.provider}`,
      );
      console.log(`  error: ${String(err)}`);
    }
  }
}

async function logUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });

  console.log("\n=== USERS ===");
  for (const u of users) {
    console.log(`[USER] id=${u.id} email=${u.email}`);
  }
}


async function logWorkspaces() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, slug: true, stakworkApiKey: true },
  });

  console.log("\n=== WORKSPACES (stakworkApiKey) ===");
  for (const w of workspaces) {
    try {
      const key = w.stakworkApiKey ?? null;
      const decrypted = key
        ? encryption.decryptField("stakworkApiKey", key)
        : null;
      console.log(`[WORKSPACE] id=${w.id} slug=${w.slug}`);
      console.log(`  stakworkApiKey (decrypted): ${decrypted}`);
    } catch (err) {
      console.log(`[WORKSPACE] id=${w.id} slug=${w.slug}`);
      console.log(`  error: ${String(err)}`);
    }
  }
}

async function logSwarms() {
  const swarms = await prisma.swarm.findMany({
    select: {
      id: true,
      name: true,
      workspaceId: true,
      swarmApiKey: true,
      poolApiKey: true,
      environmentVariables: true,
    },
  });

  console.log("\n=== SWARMS (swarmApiKey, poolApiKey, environmentVariables) ===");
  for (const s of swarms) {
    try {
      const swarmKey = s.swarmApiKey ?? null;
      const decryptedKey = swarmKey
        ? encryption.decryptField("swarmApiKey", swarmKey)
        : null;

      const poolKey = s.poolApiKey ?? null;
      const decryptedPoolKey = poolKey
        ? encryption.decryptField("poolApiKey", poolKey)
        : null;

      let envVarsOut: Array<{ name: string; value: string }> | unknown =
        s.environmentVariables;
      if (typeof s.environmentVariables === "string") {
        try {
          const parsed = JSON.parse(s.environmentVariables);
          if (Array.isArray(parsed)) {
            envVarsOut = decryptEnvVars(
              parsed as Array<{ name: string; value: unknown }>,
            );
          } else {
            envVarsOut = parsed;
          }
        } catch (err) {
          console.error("Error parsing environmentVariables", err);
          envVarsOut = s.environmentVariables;
        }
      } else if (Array.isArray(s.environmentVariables)) {
        try {
          envVarsOut = decryptEnvVars(
            s.environmentVariables as Array<{ name: string; value: unknown }>,
          );
        } catch (err) {
          console.error("Error decrypting environmentVariables array", err);
          envVarsOut = s.environmentVariables;
        }
      }

      console.log(
        `[SWARM] id=${s.id} name=${s.name} workspaceId=${s.workspaceId}`,
      );
      console.log(`  swarmApiKey (decrypted): ${decryptedKey}`);
      console.log(`  poolApiKey (decrypted): ${decryptedPoolKey}`);
      if (Array.isArray(envVarsOut)) {
        console.log("  environmentVariables (decrypted):");
        for (const ev of envVarsOut as Array<{ name: string; value: string }>) {
          console.log(`    - ${ev.name}=${ev.value}`);
        }
      } else {
        console.log(`  environmentVariables: ${JSON.stringify(envVarsOut)}`);
      }
    } catch (err) {
      console.log(`[SWARM] id=${s.id} name=${s.name}`);
      console.log(`  error: ${String(err)}`);
    }
  }
}

async function main() {
  await prisma.$connect();
  await logAccounts();
  await logUsers();
  await logSwarms();
  await logWorkspaces();
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Decrypt-and-log failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main as decryptAndLog };
