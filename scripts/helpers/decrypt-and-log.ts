import { PrismaClient } from "@prisma/client";
import { EncryptionService, decryptEnvVars } from "@/lib/encryption";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();
const encryption = EncryptionService.getInstance();

async function logAccounts() {
  const accounts = await prisma.account.findMany({});

  console.log("\n=== ACCOUNTS (access_token) ===");
  for (const a of accounts) {
    try {
      console.log(a);
      const token = a.access_token ?? null;
      const decrypted = token
        ? encryption.decryptField("access_token", token)
        : null;
      console.log(
        `[ACCOUNT] id=${a.id} userId=${a.userId} provider=${a.provider}`,
      );
      console.log(`  access_token (decrypted): ${decrypted}`);
      const rt = a.refresh_token ?? null;
      const rtDec = rt ? encryption.decryptField("refresh_token", rt) : null;
      console.log(`  refresh_token (decrypted): ${rtDec}`);
      const idt = a.id_token ?? null;
      const idtDec = idt ? encryption.decryptField("id_token", idt) : null;
      console.log(`  id_token (decrypted): ${idtDec}`);
    } catch (err) {
      console.log(
        `[ACCOUNT] id=${a.id} userId=${a.userId} provider=${a.provider}`,
      );
      console.log(`  error: ${String(err)}`);
    }
  }
}

async function logUsers() {
  const users = await prisma.user.findMany({});

  console.log("\n=== USERS (poolApiKey) ===");
  for (const u of users) {
    try {
      console.log(u);
      const key = u.poolApiKey ?? null;
      const decrypted = key ? encryption.decryptField("poolApiKey", key) : null;
      console.log(`[USER] id=${u.id} email=${u.email}`);
      console.log(`  poolApiKey (decrypted): ${decrypted}`);
    } catch (err) {
      console.log(`[USER] id=${u.id} email=${u.email}`);
      console.log(`  error: ${String(err)}`);
    }
  }
}

async function logWorkspaces() {
  const workspaces = await prisma.workspace.findMany({});

  console.log("\n=== WORKSPACES (stakworkApiKey) ===");
  for (const w of workspaces) {
    try {
      console.log(w);
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
  const swarms = await prisma.swarm.findMany({});

  console.log("\n=== SWARMS (swarmApiKey, environmentVariables) ===");
  for (const s of swarms) {
    try {
      console.log(s);
      const swarmKey = s.swarmApiKey ?? null;
      const decryptedKey = swarmKey
        ? encryption.decryptField("swarmApiKey", swarmKey)
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

async function logUserWorkspaces() {
  const userWorkspaces = await prisma.user.findMany({});

  console.log("\n=== USER WORKSPACES ===");
  for (const uw of userWorkspaces) {
    console.log(uw);
  }
}

async function logSessionDb() {
  const session = await prisma.session.findMany({});
  console.log(session);
}

async function main() {
  await prisma.$connect();
  await logAccounts();
  await logUsers();
  await logWorkspaces();
  await logSwarms();
  await logUserWorkspaces();
  await logSessionDb();
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
