import "@testing-library/jest-dom";
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { db } from "@/lib/db";

// Test database URL - should be different from development
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL environment variable is required for integration tests");
}

// Ensure we're using a test database
if (!TEST_DATABASE_URL.includes("test") && !process.env.NODE_ENV?.includes("test")) {
  console.warn("WARNING: DATABASE_URL does not contain 'test' - ensure you're using a test database");
}

beforeAll(async () => {
  // Ensure database schema is up to date
  try {
    execSync("npx prisma db push --accept-data-loss", { 
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }
    });
  } catch (error) {
    console.error("Failed to setup test database schema:", error);
    throw error;
  }
});

beforeEach(async () => {
  // Clean the database before each test
  await cleanDatabase();
});

afterEach(async () => {
  // Clean the database after each test
  await cleanDatabase();
});

afterAll(async () => {
  // Disconnect from database
  await db.$disconnect();
});

async function cleanDatabase() {
  try {
    // Delete in reverse dependency order to avoid foreign key constraints
    // Clean only the core workspace-related tables
    const tablesToClean = [
      'product',
      'swarm', 
      'workspaceMember',
      'workspace',
      'githubAuth',
      'user'
    ];

    for (const table of tablesToClean) {
      if (db[table] && typeof db[table].deleteMany === 'function') {
        await db[table].deleteMany();
      }
    }
  } catch (error) {
    console.error("Failed to clean database:", error);
    throw error;
  }
}

// Helper function to reset database state
export { cleanDatabase };
