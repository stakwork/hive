import "@testing-library/jest-dom";
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { db } from "@/lib/db";

// Test database URL - should be different from development
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL or DATABASE_URL environment variable is required for integration tests",
  );
}

// Ensure we're using a test database
if (
  !TEST_DATABASE_URL.includes("test") &&
  !process.env.NODE_ENV?.includes("test")
) {
  console.warn(
    "WARNING: DATABASE_URL does not contain 'test' - ensure you're using a test database",
  );
}

// Make sure Prisma and modules using env.ts have needed vars during tests
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ||
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.TOKEN_ENCRYPTION_KEY_ID =
  process.env.TOKEN_ENCRYPTION_KEY_ID || "k-test";
process.env.STAKWORK_API_KEY = process.env.STAKWORK_API_KEY || "test-stakwork";
process.env.POOL_MANAGER_API_KEY =
  process.env.POOL_MANAGER_API_KEY || "test-pool";
process.env.POOL_MANAGER_API_USERNAME =
  process.env.POOL_MANAGER_API_USERNAME || "user";
process.env.POOL_MANAGER_API_PASSWORD =
  process.env.POOL_MANAGER_API_PASSWORD || "pass";
process.env.SWARM_SUPERADMIN_API_KEY =
  process.env.SWARM_SUPERADMIN_API_KEY || "super";
process.env.SWARM_SUPER_ADMIN_URL =
  process.env.SWARM_SUPER_ADMIN_URL || "https://super.test";
process.env.STAKWORK_CUSTOMERS_EMAIL =
  process.env.STAKWORK_CUSTOMERS_EMAIL || "c@test.local";
process.env.STAKWORK_CUSTOMERS_PASSWORD =
  process.env.STAKWORK_CUSTOMERS_PASSWORD || "secret";

beforeAll(async () => {
  // Ensure encryption env vars exist for integration tests
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    process.env.TOKEN_ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY_ID) {
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  }
  // Ensure database schema is up to date
  try {
    execSync("npx prisma db push --accept-data-loss", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
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
    // Most dependent entities first, least dependent last
    
    // Level 5: Most dependent entities (no other entities depend on them)
    await db.attachment.deleteMany();
    await db.artifact.deleteMany();
    await db.comment.deleteMany();
    await db.roadmapItem.deleteMany();
    
    // Level 4: Entities that depend on Level 5+ entities
    await db.chatMessage.deleteMany();
    await db.roadmap.deleteMany();
    await db.requirement.deleteMany();
    
    // Level 3: Entities that depend on Level 4+ entities  
    await db.userStory.deleteMany();
    await db.task.deleteMany();
    
    // Janitor system cleanup
    await db.janitorRecommendation.deleteMany();
    await db.janitorRun.deleteMany();
    await db.janitorConfig.deleteMany();
    
    // Level 2: Entities that depend on Level 3+ entities
    await db.feature.deleteMany();
    await db.repository.deleteMany();
    await db.product.deleteMany();
    await db.swarm.deleteMany();
    
    // Level 1: Workspace-related entities
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    
    // Level 0: Authentication and user entities (most fundamental)
    await db.session.deleteMany();
    await db.account.deleteMany();
    await db.verificationToken.deleteMany();
    await db.gitHubAuth.deleteMany();
    await db.user.deleteMany();
    
  } catch (error) {
    // If standard cleanup fails, try a more aggressive approach
    try {
      await aggressiveCleanup();
    } catch (aggressiveError) {
      throw aggressiveError;
    }
  }
}

async function aggressiveCleanup() {
  // Disable foreign key checks temporarily and truncate all tables
  await db.$executeRaw`SET session_replication_role = replica;`;
  
  try {
    const tableNames = [
      'attachments', 'artifacts', 'comments', 'roadmap_items',
      'chat_messages', 'roadmaps', 'requirements', 'user_stories', 
      'tasks', 'janitor_recommendations', 'janitor_runs', 'janitor_configs',
      'features', 'repositories', 'products', 'swarms',
      'workspace_members', 'workspaces', 'sessions', 'accounts', 
      'verification_tokens', 'github_auth', 'users'
    ];
    
    for (const tableName of tableNames) {
      try {
        await db.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" CASCADE;`);
      } catch (error) {
        // Table might not exist, continue with others
      }
    }
  } finally {
    // Re-enable foreign key checks
    await db.$executeRaw`SET session_replication_role = DEFAULT;`;
  }
}

// Helper function to reset database state
export { cleanDatabase };
