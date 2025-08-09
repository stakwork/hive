import { PrismaClient } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();
const encryption = EncryptionService.getInstance();

async function logAccounts() {
  const accounts = await prisma.account.findMany({
    select: { id: true, userId: true, provider: true, access_token: true },
  });

  console.log("\n--- Accounts (access_token) ---");
  for (const a of accounts) {
    try {
      const token = a.access_token ?? null;
      const decrypted = token
        ? encryption.decryptField("access_token", token)
        : null;
      console.log(
        JSON.stringify({
          id: a.id,
          userId: a.userId,
          provider: a.provider,
          access_token: decrypted,
        }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({
          id: a.id,
          userId: a.userId,
          provider: a.provider,
          error: String(err),
        }),
      );
    }
  }
}

async function logUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, poolApiKey: true },
  });

  console.log("\n--- Users (poolApiKey) ---");
  for (const u of users) {
    try {
      const key = u.poolApiKey ?? null;
      const decrypted = key ? encryption.decryptField("poolApiKey", key) : null;
      console.log(
        JSON.stringify({ id: u.id, email: u.email, poolApiKey: decrypted }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({ id: u.id, email: u.email, error: String(err) }),
      );
    }
  }
}

async function logWorkspaces() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, slug: true, stakworkApiKey: true },
  });

  console.log("\n--- Workspaces (stakworkApiKey) ---");
  for (const w of workspaces) {
    try {
      const key = w.stakworkApiKey ?? null;
      const decrypted = key
        ? encryption.decryptField("stakworkApiKey", key)
        : null;
      console.log(
        JSON.stringify({ id: w.id, slug: w.slug, stakworkApiKey: decrypted }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({ id: w.id, slug: w.slug, error: String(err) }),
      );
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
      environmentVariables: true,
    },
  });

  console.log("\n--- Swarms (swarmApiKey, environmentVariables) ---");
  for (const s of swarms) {
    try {
      const swarmKey = s.swarmApiKey ?? null;
      const decryptedKey = swarmKey
        ? encryption.decryptField("swarmApiKey", swarmKey)
        : null;

      let envVarsOut: unknown = s.environmentVariables;
      if (typeof s.environmentVariables === "string") {
        try {
          envVarsOut = encryption.decryptField(
            "environmentVariables",
            s.environmentVariables,
          );
        } catch (err) {
          console.error("Error decrypting environmentVariables", err);
          envVarsOut = s.environmentVariables;
        }
      }

      console.log(
        JSON.stringify({
          id: s.id,
          name: s.name,
          workspaceId: s.workspaceId,
          swarmApiKey: decryptedKey,
          environmentVariables: envVarsOut,
        }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({ id: s.id, name: s.name, error: String(err) }),
      );
    }
  }
}

async function main() {
  await prisma.$connect();
  await logAccounts();
  await logUsers();
  await logWorkspaces();
  await logSwarms();
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
