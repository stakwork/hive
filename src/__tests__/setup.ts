import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";

// Mock NextAuth globally
const mockGetServerSession = jest.fn();
jest.mock("next-auth/next", () => ({
  getServerSession: mockGetServerSession,
}));

// Mock console methods to reduce test noise in CI
const originalConsole = { ...console };

beforeEach(() => {
  // Reset console mocks for each test
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
  console.info = jest.fn();
});

afterEach(() => {
  // Restore console after each test
  Object.assign(console, originalConsole);
  
  // Clear all mocks
  jest.clearAllMocks();
});

// Environment-specific setup
if (process.env.NODE_ENV === "test") {
  // Increase timeout for database operations in test environment
  jest.setTimeout(30000);
}

// Global test configuration
global.fetch = global.fetch || jest.fn();

// Mock environment variables for testing
process.env.NODE_ENV = "test";
process.env.NEXTAUTH_SECRET = "test-secret";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test_db";

// Mock Prisma client for unit tests (integration tests will use real database)
const mockDb = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  workspace: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  workspaceMember: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  repository: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  task: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  chatMessage: {
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
};

// Only mock database for unit tests, use real database for integration tests
if (process.env.TEST_SUITE !== "integration") {
  jest.mock("@/lib/db", () => ({
    db: mockDb,
  }));
}

// Export mocks for test utilities
export { mockGetServerSession, mockDb };

// Global error handler for unhandled promise rejections
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection in tests:", error);
});