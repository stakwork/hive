import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function checkDatabaseStatus() {
  console.log("📊 Checking database status...\n");

  // Count all major entities
  const repositories = await db.repository.count();
  const tasks = await db.task.count();
  const deployments = await db.deployment.count();
  const pullRequestArtifacts = await db.pullRequestArtifact.count();

  console.log(`Repositories: ${repositories}`);
  console.log(`Tasks: ${tasks}`);
  console.log(`Deployments: ${deployments}`);
  console.log(`Pull Request Artifacts: ${pullRequestArtifacts}\n`);

  if (tasks > 0) {
    console.log("Sample of tasks in database:");
    const sampleTasks = await db.task.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        commitSha: true,
        createdAt: true,
        repository: {
          select: {
            name: true,
          },
        },
      },
    });

    sampleTasks.forEach((task) => {
      const commit = task.commitSha ? task.commitSha.substring(0, 7) : "N/A";
      console.log(
        `  - ${task.status} | ${task.repository.name} | ${commit} | ${task.title.substring(0, 50)}`
      );
    });
  }

  console.log("\n📝 Database Environment:");
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL?.replace(/:[^:]*@/, ':****@') || 'Not set'}`);
}

async function main() {
  try {
    await checkDatabaseStatus();
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await db.$disconnect();
  }
}

main();
