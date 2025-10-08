#!/usr/bin/env node

const { PrismaClient } = require("@prisma/client");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://test:test@localhost:5433/hive_test";

async function debugSession() {
  console.log("🔍 Debugging session storage...");

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DATABASE_URL,
      },
    },
  });

  try {
    await prisma.$connect();
    console.log("✅ Connected to test database");

    // Create a test user
    const user = await prisma.user.create({
      data: {
        name: "Debug User",
        email: "debug@test.com",
        role: "USER",
      },
    });
    console.log("👤 Created user:", user.id);

    // Create a session for the user
    const session = await prisma.session.create({
      data: {
        sessionToken: `debug-token-${Date.now()}`,
        userId: user.id,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        githubState: "debug-github-state",
      },
    });
    console.log("📝 Created session:", session.id, "with githubState:", session.githubState);

    // Try updateMany like the test does
    const updateResult = await prisma.session.updateMany({
      where: { userId: user.id },
      data: { githubState: "updated-state-from-updateMany" },
    });
    console.log("🔄 UpdateMany result:", updateResult);

    // Check if it was updated
    const updatedSession = await prisma.session.findFirst({
      where: { userId: user.id },
    });
    console.log("🔍 Session after updateMany:", {
      id: updatedSession?.id,
      githubState: updatedSession?.githubState,
    });

    // Clean up
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });
    await prisma.user.delete({
      where: { id: user.id },
    });
    console.log("🧹 Cleaned up test data");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

debugSession();
