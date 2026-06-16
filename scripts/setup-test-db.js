#!/usr/bin/env node

const { execSync } = require("child_process");
const { PrismaClient } = require("@prisma/client");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://test:test@localhost:5433/hive_test";

async function setupTestDatabase() {
  console.log("🚀 Setting up test database...");

  // Debug: Print the database URL being used
  console.log("📊 Database URL:", TEST_DATABASE_URL);

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

    // Run Prisma migrations
    console.log("📦 Running Prisma migrations...");
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "inherit",
    });

    // Clean up any existing test data
    console.log("🧹 Cleaning up existing test data...");
    await prisma.verificationToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.gitHubAuth.deleteMany();
    await prisma.user.deleteMany();

    // Create some test users for integration tests
    console.log("👥 Creating test users...");
    const testUsers = [
      {
        name: "Test User 1",
        email: "test1@example.com",
        role: "USER",
      },
      {
        name: "Test Admin",
        email: "admin@example.com",
        role: "ADMIN",
      },
    ];

    for (const userData of testUsers) {
      await prisma.user.upsert({
        where: { email: userData.email },
        update: userData,
        create: userData,
      });
    }

    await prisma.$disconnect();
    console.log("✅ Test database setup complete!");
    console.log(`📊 Database URL: ${TEST_DATABASE_URL}`);
    console.log(
      "🧪 You can now run integration tests with: npm run test:integration",
    );
  } catch (error) {
    console.error("❌ Error setting up test database:", error);
    process.exit(1);
  }
}

// Run setup if this script is executed directly
if (require.main === module) {
  setupTestDatabase();
}

module.exports = { setupTestDatabase };
