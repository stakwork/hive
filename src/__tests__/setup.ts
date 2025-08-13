import { jest, expect, beforeEach, afterAll } from '@jest/globals';
import 'reflect-metadata';
import type { JestAssertionError } from '@jest/expect';

// Declare global for TypeScript
declare global {
  var testUtils: {
    createMockUser: (overrides?: any) => any;
    createMockWorkspace: (overrides?: any) => any;
    createMockTask: (overrides?: any) => any;
    setupTestDatabase: () => Promise<void>;
    cleanupTestDatabase: () => Promise<void>;
    createMockRequest: (overrides?: any) => any;
    createMockResponse: () => any;
  };
}

// Extend Jest matchers with custom matchers if needed
expect.extend({
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },
  
  toHaveValidTimestamp(received: any, property: string) {
    const timestamp = received[property];
    const isValidDate = timestamp instanceof Date && !isNaN(timestamp.getTime());
    const isValidISOString = typeof timestamp === 'string' && !isNaN(Date.parse(timestamp));
    const pass = isValidDate || isValidISOString;
    
    if (pass) {
      return {
        message: () => `expected ${received} not to have valid timestamp at ${property}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to have valid timestamp at ${property}`,
        pass: false,
      };
    }
  }
});

// Mock console methods to reduce noise in tests
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

// Global test utilities
(global as any).testUtils = {
  // Generate test data
  createMockUser: (overrides: any = {}) => ({
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  }),

  createMockWorkspace: (overrides: any = {}) => ({
    id: 'test-workspace-id',
    name: 'Test Workspace',
    owner_id: 'test-user-id',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  }),

  createMockTask: (overrides: any = {}) => ({
    id: 'test-task-id',
    title: 'Test Task',
    description: 'Test task description',
    workspace_id: 'test-workspace-id',
    assignee_id: 'test-user-id',
    status: 'pending',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  }),

  // Database helpers
  setupTestDatabase: async () => {
    // Mock database setup
    console.log('Setting up test database...');
  },

  cleanupTestDatabase: async () => {
    // Mock database cleanup
    console.log('Cleaning up test database...');
  },

  // HTTP helpers
  createMockRequest: (overrides: any = {}) => ({
    body: {},
    params: {},
    query: {},
    headers: {},
    user: null,
    ...overrides
  }),

  createMockResponse: () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.header = jest.fn().mockReturnValue(res);
    res.cookie = jest.fn().mockReturnValue(res);
    return res;
  }
};

// Environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db';

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Increase timeout for async operations
jest.setTimeout(30000);

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

// Cleanup after all tests
afterAll(async () => {
  // Perform any global cleanup
  await (global as any).testUtils.cleanupTestDatabase();
});