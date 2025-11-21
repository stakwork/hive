/*
  Seed Stakgraph prerequisites: Workspace, Repository, Swarm

  Usage examples:

  # Create workspace if missing using owner email
  npx ts-node scripts/helpers/seed-stakgraph.ts \
    --workspaceSlug webhook-test \
    --workspaceName "Webhook Test" \
    --ownerEmail faye.12222883@lpu.in \
    --swarmName alpha-swarm \
    --repoUrl https://github.com/fayekelmith/FayeKelmith \
    --defaultBranch main \
    --swarmApiKey mock-api-key \
    --swarmUrl https://stak-5678.ngrok.io

  # Or target an existing workspace by id
  npx ts-node scripts/helpers/seed-stakgraph.ts \
    --workspaceId <WORKSPACE_ID> \
    --swarmName alpha-swarm \
    --repoUrl https://github.com/fayekelmith/FayeKelmith \
    --defaultBranch main \
    --swarmApiKey mock-api-key \
    --swarmUrl https://stak-5678.ngrok.io
*/

import { PrismaClient, RepositoryStatus, SwarmStatus } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

type Args = {
  workspaceId?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  ownerEmail?: string;
  ownerId?: string;
  swarmName?: string;
  repoUrl?: string;
  defaultBranch?: string;
  swarmApiKey?: string;
  swarmUrl?: string;
};

function parseArgs(): Args {
  const args: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    const v = process.argv[i + 1];
    if (!v || v.startsWith("--")) continue;
    switch (k) {
      case "--workspaceId":
        args.workspaceId = v;
        break;
      case "--workspaceSlug":
        args.workspaceSlug = v;
        break;
      case "--workspaceName":
        args.workspaceName = v;
        break;
      case "--ownerEmail":
        args.ownerEmail = v;
        break;
      case "--ownerId":
        args.ownerId = v;
        break;
      case "--swarmName":
        args.swarmName = v;
        break;
      case "--repoUrl":
        args.repoUrl = v;
        break;
      case "--defaultBranch":
        args.defaultBranch = v;
        break;
      case "--swarmApiKey":
        args.swarmApiKey = v;
        break;
      case "--swarmUrl":
        args.swarmUrl = v;
        break;
    }
  }
  return args;
}

async function main() {
  const {
    workspaceId,
    workspaceSlug,
    workspaceName,
    ownerEmail,
    ownerId,
    swarmName = "alpha-swarm",
    repoUrl = "https://github.com/fayekelmith/FayeKelmith",
    defaultBranch = "main",
    swarmApiKey = "mock-api-key",
    swarmUrl,
  } = parseArgs();

  await prisma.$connect();

  // Resolve or create workspace
  let workspace = await prisma.workspace.findFirst({
    where: workspaceId ? { id: workspaceId } : workspaceSlug ? { slug: workspaceSlug } : undefined,
  });

  if (!workspace) {
    if (!ownerId && !ownerEmail) {
      throw new Error("Provide --ownerId or --ownerEmail to create workspace");
    }
    let resolvedOwnerId = ownerId || null;
    if (!resolvedOwnerId && ownerEmail) {
      const owner = await prisma.user.findFirst({
        where: { email: ownerEmail },
      });
      if (!owner) throw new Error(`Owner with email ${ownerEmail} not found`);
      resolvedOwnerId = owner.id;
    }
    if (!resolvedOwnerId) throw new Error("Owner id could not be resolved");

    const slug = workspaceSlug || "webhook-test";
    const name = workspaceName || slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    workspace = await prisma.workspace.create({
      data: { name, slug, ownerId: resolvedOwnerId },
    });
  }

  // Upsert repository
  const repository = await prisma.repository.upsert({
    where: {
      repositoryUrl_workspaceId: {
        repositoryUrl: repoUrl,
        workspaceId: workspace.id,
      },
    },
    update: {
      branch: defaultBranch,
      status: RepositoryStatus.PENDING,
    },
    create: {
      name: repoUrl.split("/").pop() || repoUrl,
      repositoryUrl: repoUrl,
      workspaceId: workspace.id,
      status: RepositoryStatus.PENDING,
      branch: defaultBranch,
    },
  });

  // Upsert swarm (one-to-one with workspace)
  const swarm = await prisma.swarm.upsert({
    where: { workspaceId: workspace.id },
    update: {
      name: swarmName,
      swarmApiKey,
      status: SwarmStatus.ACTIVE,
      ...(swarmUrl ? { swarmUrl } : {}),
    },
    create: {
      name: swarmName,
      workspaceId: workspace.id,
      swarmApiKey,
      status: SwarmStatus.ACTIVE,
      ...(swarmUrl ? { swarmUrl } : {}),
    },
  });

  console.log("Seed complete:", {
    workspace: { id: workspace.id, slug: workspace.slug },
    repository: {
      id: repository.id,
      url: repository.repositoryUrl,
      branch: repository.branch,
    },
    swarm: {
      id: swarm.id,
      name: swarm.name,
      workspaceId: swarm.workspaceId,
      url: (swarm as unknown as { swarmUrl?: string }).swarmUrl || null,
      repo: repository.repositoryUrl,
      branch: repository.branch,
    },
  });
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
