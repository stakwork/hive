import { PrismaClient, RepositoryStatus, SwarmStatus } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

type SeedArgs = {
  userId?: string;
  email?: string;
  githubUsername?: string;
};

function parseArgs(argv: string[]): SeedArgs {
  const args: SeedArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const current = argv[i];
    if (current === "--userId" && argv[i + 1]) {
      args.userId = argv[++i];
    } else if (current === "--email" && argv[i + 1]) {
      args.email = argv[++i];
    } else if (current === "--githubUsername" && argv[i + 1]) {
      args.githubUsername = argv[++i];
    }
  }
  return args;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function ensureUniqueWorkspaceSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 1;
  while (true) {
    const existing = await prisma.workspace.findUnique({ where: { slug } });
    if (!existing) return slug;
    slug = `${base}-${++suffix}`;
  }
}

async function resolveSeedUser(args: SeedArgs) {
  if (args.userId) {
    const user = await prisma.user.findUnique({ where: { id: args.userId } });
    if (!user) throw new Error(`No user found for id ${args.userId}`);
    return user;
  }

  if (args.email) {
    const user = await prisma.user.findUnique({ where: { email: args.email } });
    if (!user) throw new Error(`No user found for email ${args.email}`);
    return user;
  }

  if (args.githubUsername) {
    const gh = await prisma.gitHubAuth.findFirst({
      where: { githubUsername: args.githubUsername },
      include: { user: true },
    });
    if (!gh || !gh.user)
      throw new Error(
        `No GitHubAuth/User found for username ${args.githubUsername}`,
      );
    return gh.user;
  }

  // Fallback 1: most recently updated GitHubAuth entry
  const latestGh = await prisma.gitHubAuth.findFirst({
    orderBy: { updatedAt: "desc" },
    include: { user: true },
  });
  if (latestGh?.user) return latestGh.user;

  // Fallback 2: any Account with provider=github, prefer most recently updated user
  const ghAccounts = await prisma.account.findMany({
    where: { provider: "github" },
    include: { user: true },
  });
  if (ghAccounts.length) {
    ghAccounts.sort((a, b) => {
      const au = a.user?.updatedAt ? new Date(a.user.updatedAt).getTime() : 0;
      const bu = b.user?.updatedAt ? new Date(b.user.updatedAt).getTime() : 0;
      return bu - au;
    });
    const chosen = ghAccounts.find((a) => !!a.user)?.user;
    if (chosen) return chosen;
  }

  throw new Error(
    "No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername",
  );
}

async function seedForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { githubAuth: true },
  });
  if (!user) throw new Error(`User not found: ${userId}`);

  const displayName = user.name || user.email || "developer";
  const baseSlug = slugify(`${displayName}-workspace`) || "dev-workspace";
  const workspaceSlug = await ensureUniqueWorkspaceSlug(baseSlug);

  const workspaceName = `${displayName}'s Workspace`;
  const description = `Development workspace for ${displayName}`;

  // Mock API keys and related props
  const stakworkApiKey = `stakwork_key_${workspaceSlug}`;

  // Create Workspace (unique by slug)
  const workspace = await prisma.workspace.create({
    data: {
      name: workspaceName,
      description,
      slug: workspaceSlug,
      ownerId: user.id,
      stakworkApiKey,
    },
  });

  // Create Repository linked to workspace
  const repoBaseName = slugify(`${displayName}-app`) || "sample-app";
  const repositoryName = `${repoBaseName}`;
  const repositoryUrl = `https://github.com/${
    user.githubAuth?.githubUsername || "example"
  }/${repositoryName}`;

  const repository = await prisma.repository.create({
    data: {
      name: repositoryName,
      repositoryUrl,
      branch: "main",
      status: RepositoryStatus.SYNCED,
      workspaceId: workspace.id,
    },
  });

  // Create Swarm, one-to-one with workspace
  const swarmName = slugify(`${workspaceSlug}-swarm`);
  const poolApiKey = `pool_key_${workspaceSlug}`;
  const swarmApiKey = `swarm_key_${workspaceSlug}`;

  const environmentVariables = [
    { name: "NODE_ENV", value: "development" },
    { name: "FEATURE_FLAG", value: "true" },
    { name: "API_BASE_URL", value: "http://localhost:3000" },
  ];

  const services = [
    { name: "web", image: "node:18", replicas: 1 },
    { name: "worker", image: "node:18", replicas: 1 },
  ];

  const swarm = await prisma.swarm.create({
    data: {
      name: swarmName,
      status: SwarmStatus.ACTIVE,
      instanceType: "XL",
      repositoryName: repository.name,
      repositoryUrl: repository.repositoryUrl,
      defaultBranch: repository.branch,
      swarmApiKey,
      poolApiKey,
      environmentVariables,
      services,
      wizardStep: "COMPLETION",
      stepStatus: "COMPLETED",
      wizardData: {
        seeded: true,
        seededAt: new Date().toISOString(),
      },
      workspaceId: workspace.id,
    },
  });

  return { user, workspace, repository, swarm };
}

async function main() {
  const args = parseArgs(process.argv);
  await prisma.$connect();

  const targetUser = await resolveSeedUser(args);

  const result = await seedForUser(targetUser.id);

  console.log("Seeded development data for GitHub user:");
  console.log({
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    },
    workspace: {
      id: result.workspace.id,
      name: result.workspace.name,
      slug: result.workspace.slug,
      stakworkApiKey: result.workspace.stakworkApiKey,
    },
    repository: {
      id: result.repository.id,
      name: result.repository.name,
      url: result.repository.repositoryUrl,
      branch: result.repository.branch,
      status: result.repository.status,
    },
    swarm: {
      id: result.swarm.id,
      name: result.swarm.name,
      status: result.swarm.status,
      repositoryUrl: result.swarm.repositoryUrl,
      poolApiKey: result.swarm.poolApiKey,
      swarmApiKey: result.swarm.swarmApiKey,
      wizardStep: result.swarm.wizardStep,
      stepStatus: result.swarm.stepStatus,
    },
  });

  console.log(
    "\nUsage: tsx scripts/seed-from-github-account.ts [--email you@example.com | --userId <id> | --githubUsername <handle>]",
  );
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
