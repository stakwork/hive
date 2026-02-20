import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function checkDeployments() {
  console.log("Checking deployment data in database...\n");

  const totalDeployments = await db.deployment.count();
  console.log(`Total deployments: ${totalDeployments}`);

  const productionDeployments = await db.deployment.count({
    where: { environment: "PRODUCTION", status: "SUCCESS" },
  });
  console.log(`Production deployments: ${productionDeployments}`);

  const stagingDeployments = await db.deployment.count({
    where: { environment: "STAGING", status: "SUCCESS" },
  });
  console.log(`Staging deployments: ${stagingDeployments}\n`);

  if (totalDeployments === 0) {
    console.log("No deployments found in database.");
    console.log("This could mean:");
    console.log("1. No deployments have been triggered yet");
    console.log("2. The webhook isn't configured");
    console.log("3. You need to check a different database\n");
    return;
  }

  // Get recent deployments
  const recentDeployments = await db.deployment.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      environment: true,
      status: true,
      commitSha: true,
      createdAt: true,
      repository: {
        select: {
          name: true,
          repositoryUrl: true,
        },
      },
    },
  });

  console.log("Recent deployments:");
  recentDeployments.forEach((d) => {
    const repoName = d.repository.name;
    const commit = d.commitSha.substring(0, 7);
    console.log(
      `  - ${d.environment} ${d.status} | ${repoName} | ${commit} | ${d.createdAt.toISOString()}`
    );
  });
}

async function main() {
  try {
    await checkDeployments();
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await db.$disconnect();
  }
}

main();
