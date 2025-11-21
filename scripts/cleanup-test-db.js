#!/usr/bin/env node

const { PrismaClient } = require("@prisma/client");

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://test:test@localhost:5433/hive_test";

async function cleanupTestDatabase() {
  console.log("🧹 Cleaning up test database...");
  console.log(
    "⚠️  Note: You may also need to clear your browser cookies for localhost to fully reset the session state",
  );

  try {
    // Create test Prisma client
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DATABASE_URL,
        },
      },
    });

    // Test connection
    await prisma.$connect();
    console.log("✅ Connected to test database");

    // Clean up all test data (order matters due to foreign key constraints)
    console.log("🗑️  Removing all test data...");

    // Clean up tables if they exist (handle gracefully if they don't)

    try {
      await prisma.session.deleteMany();
      console.log("✅ Cleared all sessions");
    } catch (error) {
      console.log("⚠️  Session table does not exist, skipping...");
    }

    try {
      await prisma.account.deleteMany();
    } catch (error) {
      console.log("⚠️  Account table does not exist, skipping...");
    }

    try {
      await prisma.gitHubAuth.deleteMany();
    } catch (error) {
      console.log("⚠️  GitHubAuth table does not exist, skipping...");
    }

    try {
      await prisma.user.deleteMany();
    } catch (error) {
      console.log("⚠️  User table does not exist, skipping...");
    }

    await prisma.$disconnect();
    console.log("✅ Test database cleanup complete!");
    console.log("🔐 To fully reset authentication, also clear your browser cookies for localhost");
  } catch (error) {
    console.error("❌ Error cleaning up test database:", error);
    process.exit(1);
  }
}

// Run cleanup if this script is executed directly
if (require.main === module) {
  cleanupTestDatabase();
}

module.exports = { cleanupTestDatabase };
