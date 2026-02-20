// Test database connection
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Testing database connection...");
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log("✅ Database connection successful!");
    console.log("Result:", result);
    
    // Try to query deployments
    console.log("\nQuerying deployments...");
    const deployments = await prisma.deployment.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' }
    });
    console.log(`Found ${deployments.length} deployments`);
    
    // Try to query tasks
    console.log("\nQuerying tasks...");
    const tasks = await prisma.task.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' }
    });
    console.log(`Found ${tasks.length} tasks`);
    
  } catch (error) {
    console.error("❌ Database error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
