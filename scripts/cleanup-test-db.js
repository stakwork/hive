#!/usr/bin/env node

const { PrismaClient } = require("@prisma/client");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://test:test@localhost:5433/hive_test";

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
    const cleanup = async (fn, name) => {
      try {
        await fn();
      } catch (error) {
        console.log(`⚠️  ${name} table does not exist, skipping...`);
      }
    };

    await cleanup(() => prisma.attachment.deleteMany(), "Attachment");
    await cleanup(() => prisma.artifact.deleteMany(), "Artifact");
    await cleanup(() => prisma.chatMessage.deleteMany(), "ChatMessage");
    await cleanup(() => prisma.stakworkRun.deleteMany(), "StakworkRun");
    await cleanup(() => prisma.phase.deleteMany(), "Phase");
    await cleanup(() => prisma.userStory.deleteMany(), "UserStory");
    await cleanup(() => prisma.feature.deleteMany(), "Feature");
    await cleanup(() => prisma.task.deleteMany(), "Task");
    await cleanup(() => prisma.janitorRecommendation.deleteMany(), "JanitorRecommendation");
    await cleanup(() => prisma.janitorRun.deleteMany(), "JanitorRun");
    await cleanup(() => prisma.janitorConfig.deleteMany(), "JanitorConfig");
    await cleanup(() => prisma.repository.deleteMany(), "Repository");
    await cleanup(() => prisma.swarm.deleteMany(), "Swarm");
    await cleanup(() => prisma.workspaceMember.deleteMany(), "WorkspaceMember");
    await cleanup(() => prisma.workspace.deleteMany(), "Workspace");
    await cleanup(() => prisma.session.deleteMany(), "Session");
    await cleanup(() => prisma.account.deleteMany(), "Account");
    await cleanup(() => prisma.gitHubAuth.deleteMany(), "GitHubAuth");
    await cleanup(() => prisma.sourceControlToken.deleteMany(), "SourceControlToken");
    await cleanup(() => prisma.sourceControlOrg.deleteMany(), "SourceControlOrg");
    await cleanup(() => prisma.user.deleteMany(), "User");
    
    console.log("✅ Cleared all sessions");

    await prisma.$disconnect();
    console.log("✅ Test database cleanup complete!");
    console.log(
      "🔐 To fully reset authentication, also clear your browser cookies for localhost",
    );
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
