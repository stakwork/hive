import { PrismaClient } from "@prisma/client";
import { EncryptableField, EncryptionService } from "@/lib/encryption";
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

async function migrateAccounts(): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: {
      access_token: {
        not: null,
      },
    },
    select: {
      id: true,
      access_token: true,
    },
  });

  for (const account of accounts) {
    try {
      if (
        !account.access_token ||
        (await isAlreadyEncrypted(account.access_token))
      ) {
        continue;
      }

      const encryptedToken = await encryptValue(
        "access_token",
        account.access_token,
      );

      await prisma.account.update({
        where: { id: account.id },
        data: { access_token: encryptedToken },
      });
    } catch (error) {
      console.error(`Failed to encrypt account ${account.id}:`, error);
    }
  }
}

async function migrateSwarms(): Promise<void> {
  const swarms = await prisma.swarm.findMany({
    select: {
      id: true,
      environmentVariables: true,
      swarmApiKey: true,
    },
  });

  for (const swarm of swarms) {
    try {
      let updated = false;
      const updateData: Record<string, string> = {};

      if (
        swarm.environmentVariables &&
        typeof swarm.environmentVariables === "string" &&
        !(await isAlreadyEncrypted(swarm.environmentVariables))
      ) {
        updateData.environmentVariables = await encryptValue(
          "environmentVariables",
          swarm.environmentVariables,
        );
        updated = true;
      }

      if (swarm.swarmApiKey && !(await isAlreadyEncrypted(swarm.swarmApiKey))) {
        updateData.swarmApiKey = await encryptValue(
          "swarmApiKey",
          swarm.swarmApiKey,
        );
        updated = true;
      }

      if (updated) {
        await prisma.swarm.update({
          where: { id: swarm.id },
          data: updateData,
        });
      }
    } catch (error) {
      console.error(`Failed to encrypt swarm ${swarm.id}:`, error);
    }
  }
}

async function migrateWorkspaces(): Promise<void> {
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
      if (
        !workspace.stakworkApiKey ||
        (await isAlreadyEncrypted(workspace.stakworkApiKey))
      ) {
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
    } catch (error) {
      console.error(`Failed to encrypt workspace ${workspace.id}:`, error);
    }
  }
}

async function migrateUsers(): Promise<void> {
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
      if (!user.poolApiKey || (await isAlreadyEncrypted(user.poolApiKey))) {
        continue;
      }

      const encryptedKey = await encryptValue("poolApiKey", user.poolApiKey);

      await prisma.user.update({
        where: { id: user.id },
        data: { poolApiKey: encryptedKey },
      });
    } catch (error) {
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

    await migrateAccounts();
    await migrateSwarms();
    await migrateWorkspaces();
    await migrateUsers();
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
