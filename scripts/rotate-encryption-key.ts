import { PrismaClient } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

type RotationStats = {
  processed: number;
  reencrypted: number;
  skipped: number;
  errors: number;
};

function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

// To generate a new key, run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

function seedKeyRegistry(service: EncryptionService) {
  const newKeyId = getEnvOrThrow("TOKEN_ENCRYPTION_KEY_ID");
  const newKeyHex = getEnvOrThrow("TOKEN_ENCRYPTION_KEY");
  service.setKey(newKeyId, newKeyHex);
  service.setActiveKeyId(newKeyId);

  const oldKeysJson = process.env.ROTATION_OLD_KEYS; // JSON: {"k1":"hex", "k2":"hex"}

  if (oldKeysJson) {
    try {
      const map = JSON.parse(oldKeysJson) as Record<string, string>;
      for (const [kid, hex] of Object.entries(map)) {
        service.setKey(kid, hex);
      }
    } catch (error) {
      console.error("Error parsing ROTATION_OLD_KEYS:", error);
      throw new Error(
        "ROTATION_OLD_KEYS must be valid JSON mapping {keyId: hex}",
      );
    }
  }
}

function isEncryptedLike(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    return (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.data === "string" &&
      typeof parsed.iv === "string" &&
      typeof parsed.tag === "string" &&
      typeof parsed.encryptedAt === "string"
    );
  } catch {
    return false;
  }
}

async function rotateAccounts(
  service: EncryptionService,
  stats: RotationStats,
) {
  const rows = await prisma.account.findMany({
    where: { access_token: { not: null } },
    select: { id: true, access_token: true },
  });

  for (const row of rows) {
    stats.processed++;
    const current = row.access_token as string | null;
    if (!isEncryptedLike(current)) {
      stats.skipped++;
      continue;
    }
    try {
      const parsed = JSON.parse(current!);
      const activeKeyId = service.getActiveKeyId();
      const hasKeyId =
        typeof parsed.keyId === "string" && parsed.keyId.length > 0;
      const keyId = hasKeyId ? parsed.keyId : undefined;
      if (hasKeyId && keyId === activeKeyId) {
        stats.skipped++;
        continue;
      }
      const plaintext = service.decryptField("access_token", parsed);
      const reenc = service.encryptFieldWithKeyId(
        "access_token",
        plaintext,
        activeKeyId || "default",
      );
      await prisma.account.update({
        where: { id: row.id },
        data: { access_token: JSON.stringify(reenc) },
      });
      stats.reencrypted++;
    } catch (e) {
      stats.errors++;
      console.error(`Account ${row.id} rotation error:`, e);
    }
  }
}

async function rotateSwarms(service: EncryptionService, stats: RotationStats) {
  const rows = await prisma.swarm.findMany({
    select: { id: true, environmentVariables: true, swarmApiKey: true, poolApiKey: true },
  });

  for (const row of rows) {
    let updated = false;
    const data: Record<string, string> = {};

    // environmentVariables
    if (isEncryptedLike(row.environmentVariables as string | null)) {
      try {
        const parsed = JSON.parse(row.environmentVariables as string);
        const activeKeyId = service.getActiveKeyId();
        const hasKeyId =
          typeof parsed.keyId === "string" && parsed.keyId.length > 0;
        const keyId = hasKeyId ? parsed.keyId : undefined;
        if (!hasKeyId || keyId !== activeKeyId) {
          const plaintext = service.decryptField(
            "environmentVariables",
            parsed,
          );
          const reenc = service.encryptFieldWithKeyId(
            "environmentVariables",
            plaintext,
            activeKeyId || "default",
          );
          data.environmentVariables = JSON.stringify(reenc);
          updated = true;
          stats.reencrypted++;
        } else {
          stats.skipped++;
        }
      } catch (e) {
        stats.errors++;
        console.error(`Swarm ${row.id} envVars rotation error:`, e);
      }
    } else if (row.environmentVariables) {
      stats.skipped++;
    }

    // swarmApiKey
    if (isEncryptedLike(row.swarmApiKey as string | null)) {
      try {
        const parsed = JSON.parse(row.swarmApiKey as string);
        const activeKeyId = service.getActiveKeyId();
        const hasKeyId =
          typeof parsed.keyId === "string" && parsed.keyId.length > 0;
        const keyId = hasKeyId ? parsed.keyId : undefined;
        if (!hasKeyId || keyId !== activeKeyId) {
          const plaintext = service.decryptField("swarmApiKey", parsed);
          const reenc = service.encryptFieldWithKeyId(
            "swarmApiKey",
            plaintext,
            activeKeyId || "default",
          );
          data.swarmApiKey = JSON.stringify(reenc);
          updated = true;
          stats.reencrypted++;
        } else {
          stats.skipped++;
        }
      } catch (e) {
        stats.errors++;
        console.error(`Swarm ${row.id} swarmApiKey rotation error:`, e);
      }
    } else if (row.swarmApiKey) {
      stats.skipped++;
    }

    // poolApiKey
    if (isEncryptedLike(row.poolApiKey as string | null)) {
      try {
        const parsed = JSON.parse(row.poolApiKey as string);
        const activeKeyId = service.getActiveKeyId();
        const hasKeyId =
          typeof parsed.keyId === "string" && parsed.keyId.length > 0;
        const keyId = hasKeyId ? parsed.keyId : undefined;
        if (!hasKeyId || keyId !== activeKeyId) {
          const plaintext = service.decryptField("poolApiKey", parsed);
          const reenc = service.encryptFieldWithKeyId(
            "poolApiKey",
            plaintext,
            activeKeyId || "default",
          );
          data.poolApiKey = JSON.stringify(reenc);
          updated = true;
          stats.reencrypted++;
        } else {
          stats.skipped++;
        }
      } catch (e) {
        stats.errors++;
        console.error(`Swarm ${row.id} poolApiKey rotation error:`, e);
      }
    } else if (row.poolApiKey) {
      stats.skipped++;
    }

    if (updated) {
      try {
        await prisma.swarm.update({ where: { id: row.id }, data });
      } catch (e) {
        stats.errors++;
        console.error(`Swarm ${row.id} update error:`, e);
      }
    }
    if (!updated) {
      // nothing changed
    }
  }
}

async function rotateWorkspaces(
  service: EncryptionService,
  stats: RotationStats,
) {
  const rows = await prisma.workspace.findMany({
    where: { stakworkApiKey: { not: null } },
    select: { id: true, stakworkApiKey: true },
  });

  for (const row of rows) {
    stats.processed++;
    const current = row.stakworkApiKey as string | null;
    if (!isEncryptedLike(current)) {
      stats.skipped++;
      continue;
    }
    try {
      const parsed = JSON.parse(current!);
      const activeKeyId = service.getActiveKeyId();
      const hasKeyId =
        typeof parsed.keyId === "string" && parsed.keyId.length > 0;
      const keyId = hasKeyId ? parsed.keyId : undefined;
      if (hasKeyId && keyId === activeKeyId) {
        stats.skipped++;
        continue;
      }
      const plaintext = service.decryptField("stakworkApiKey", parsed);
      const reenc = service.encryptFieldWithKeyId(
        "stakworkApiKey",
        plaintext,
        activeKeyId || "default",
      );
      await prisma.workspace.update({
        where: { id: row.id },
        data: { stakworkApiKey: JSON.stringify(reenc) },
      });
      stats.reencrypted++;
    } catch (e) {
      stats.errors++;
      console.error(`Workspace ${row.id} rotation error:`, e);
    }
  }
}


async function main() {
  const encryption = EncryptionService.getInstance();
  seedKeyRegistry(encryption);

  await prisma.$connect();

  const stats: RotationStats = {
    processed: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
  };

  await rotateAccounts(encryption, stats);
  await rotateSwarms(encryption, stats);
  await rotateWorkspaces(encryption, stats);

  console.log("\nRotation complete:");
  console.log(stats);

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Rotation failed:", err);
    process.exit(1);
  });
}

export { main as rotateEncryptionKey };
