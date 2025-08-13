import { PrismaClient, SwarmStatus } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

async function seedUsersWithAccounts() {
  const users = [
    { name: "Alice Test", email: "alice@example.com" },
    { name: "Bob Test", email: "bob@example.com" },
  ];

  const results: Array<{ id: string; email: string }> = [];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name },
      create: { name: u.name, email: u.email, emailVerified: new Date() },
    });

    const providerAccountId = `${user.id.slice(0, 8)}-gh`;
    const plainAccessToken = `gho_test_token_${user.id}`;

    await prisma.account.upsert({
      where: {
        provider_providerAccountId: { provider: "github", providerAccountId },
      },
      update: { access_token: plainAccessToken, scope: "repo,read:org" },
      create: {
        userId: user.id,
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: plainAccessToken,
        token_type: "bearer",
        scope: "repo,read:org",
      },
    });

    results.push({ id: user.id, email: user.email || u.email });
  }

  return results;
}

async function seedWorkspacesAndSwarms(
  users: Array<{ id: string; email: string }>,
) {
  const items = [
    {
      owner: users[0],
      workspace: { name: "Alpha Workspace", slug: "alpha-workspace" },
      swarm: {
        name: "alpha-swarm",
        repoUrl: "https://github.com/example/alpha",
      },
    },
    {
      owner: users[1],
      workspace: { name: "Beta Workspace", slug: "beta-workspace" },
      swarm: { name: "beta-swarm", repoUrl: "https://github.com/example/beta" },
    },
  ];

  for (const item of items) {
    const stakworkApiKey = `stakwork_key_${item.workspace.slug}`;

    const ws = await prisma.workspace.upsert({
      where: { slug: item.workspace.slug },
      update: {
        name: item.workspace.name,
        ownerId: item.owner.id,
        stakworkApiKey,
      },
      create: {
        name: item.workspace.name,
        slug: item.workspace.slug,
        ownerId: item.owner.id,
        stakworkApiKey,
      },
    });

    const poolApiKey = `pool_key_${item.workspace.slug}`;

    const swarmApiKey = `swarm_key_${item.swarm.name}`;

    await prisma.swarm.upsert({
      where: { workspaceId: ws.id },
      update: {
        name: item.swarm.name,
        status: SwarmStatus.ACTIVE,
        repositoryUrl: item.swarm.repoUrl,
        swarmApiKey,
        poolApiKey,
        environmentVariables: [
          { name: "NODE_ENV", value: "development" },
          { name: "FEATURE_FLAG", value: "true" },
        ],
      },
      create: {
        name: item.swarm.name,
        status: SwarmStatus.ACTIVE,
        repositoryUrl: item.swarm.repoUrl,
        workspaceId: ws.id,
        swarmApiKey,
        poolApiKey,
        environmentVariables: [
          { name: "NODE_ENV", value: "development" },
          { name: "FEATURE_FLAG", value: "true" },
        ],
      },
    });
  }
}

async function main() {
  await prisma.$connect();

  const users = await seedUsersWithAccounts();
  await seedWorkspacesAndSwarms(users);

  console.log("Seed completed.");
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main as seedDatabase };
