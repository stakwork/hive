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
        `[ACCOUNT] id=${a.id} userId=${a.userId} provider=${a.provider} providerAccountId=${a.providerAccountId}`,
      );
      console.log(`  scope: ${a.scope || "(none)"}`);
      console.log(`  access_token (decrypted): ${decrypted}`);
      const rt = a.refresh_token ?? null;
      const rtDec = rt ? encryption.decryptField("refresh_token", rt) : null;
      console.log(`  refresh_token (decrypted): ${rtDec}`);
      const idt = a.id_token ?? null;
      const idtDec = idt ? encryption.decryptField("id_token", idt) : null;
      console.log(`  id_token (decrypted): ${idtDec}`);
    } catch (err) {
      console.log(
        `[ACCOUNT] id=${a.id} userId=${a.userId} provider=${a.provider} providerAccountId=${a.providerAccountId}`,
      );
      console.log(`  error: ${String(err)}`);
    }
  }
}

async function logUsers() {
  const users = await prisma.user.findMany({});

  console.log("\n=== USERS ===");
  for (const u of users) {
    console.log(`[USER] id=${u.id} email=${u.email} role=${u.role}`);
  }
}

async function logGitHubAuths() {
  const auths = await prisma.gitHubAuth.findMany({
    select: {
      userId: true,
      githubUsername: true,
      scopes: true,
      organizationsHash: true,
      updatedAt: true,
    },
  });
  console.log("\n=== GITHUB AUTH ===");
  for (const a of auths) {
    console.log(
      `[GITHUB] userId=${a.userId} username=${a.githubUsername} scopes=${(a.scopes || []).join(",")} organizationsHash=${a.organizationsHash} updatedAt=${a.updatedAt.toISOString()}`,
    );
    console.log(a);
  }
}

async function logWorkspaces() {
  const workspaces = await prisma.workspace.findMany({
    include: {
      owner: { select: { id: true, email: true, name: true } },
      repositories: { select: { id: true } },
      swarm: { select: { id: true } },
    },
  });

  console.log("\n=== WORKSPACES (stakworkApiKey) ===");
  for (const w of workspaces) {
    try {
      console.log(w);
      const key = w.stakworkApiKey ?? null;
      const decrypted = key
        ? encryption.decryptField("stakworkApiKey", key)
        : null;
      console.log(
        `[WORKSPACE] id=${w.id} slug=${w.slug} owner=${w.owner?.email || w.owner?.id} repos=${w.repositories.length} swarm=${w.swarm ? "yes" : "no"}`,
      );
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
      status: true,
      instanceType: true,
      repositoryName: true,
      repositoryUrl: true,
      defaultBranch: true,
      swarmUrl: true,
      swarmSecretAlias: true,
      ingestRefId: true,
      wizardStep: true,
      stepStatus: true,
      swarmApiKey: true,
      poolApiKey: true,
      environmentVariables: true,
      services: true,
    },
  });

  console.log("\n=== SWARMS (keys, env vars, status) ===");
  for (const s of swarms) {
    try {
      console.log(s);
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
        `[SWARM] id=${s.id} name=${s.name} workspaceId=${s.workspaceId} status=${s.status} instanceType=${s.instanceType}`,
      );
      console.log(
        `  repo: ${s.repositoryName || "(none)"} url=${s.repositoryUrl || "(none)"} branch=${s.defaultBranch || "(none)"}`,
      );
      console.log(
        `  wizard: step=${s.wizardStep} status=${s.stepStatus} swarmUrl=${s.swarmUrl || "(none)"} secretAlias=${s.swarmSecretAlias || "(none)"} ingestRefId=${s.ingestRefId || "(none)"}`,
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

      if (Array.isArray(s.services)) {
        console.log(
          `  services: ${s.services
            .map((svc: any) => svc?.name || JSON.stringify(svc))
            .join(", ")}`,
        );
      } else {
        console.log(`  services: ${JSON.stringify(s.services)}`);
      }
    } catch (err) {
      console.log(`[SWARM] id=${s.id} name=${s.name}`);
      console.log(`  error: ${String(err)}`);
    }
  }
}

async function logRepositories() {
  const repos = await prisma.repository.findMany({
    select: {
      id: true,
      name: true,
      repositoryUrl: true,
      branch: true,
      status: true,
      workspaceId: true,
    },
  });
  console.log("\n=== REPOSITORIES ===");
  for (const r of repos) {
    console.log(
      `[REPO] id=${r.id} name=${r.name} url=${r.repositoryUrl} branch=${r.branch} status=${r.status} workspaceId=${r.workspaceId}`,
    );
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
  await logGitHubAuths();
  await logRepositories();
  await logSwarms();
  await logWorkspaces();
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
