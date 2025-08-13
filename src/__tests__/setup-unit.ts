// Unit test setup
import "@testing-library/jest-dom";
import { beforeAll, afterAll } from "vitest";

// Add any global test setup here
beforeAll(() => {
  // Setup any global test environment for unit tests
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-32-chars-long-here";
  }
});

afterAll(() => {
  // Cleanup after all unit tests
});
