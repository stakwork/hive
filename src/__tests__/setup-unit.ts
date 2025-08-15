// Unit test setup
import "@testing-library/jest-dom";
import { beforeAll, afterAll } from "vitest";

// Add any global test setup here
beforeAll(() => {
  // Setup any global test environment for unit tests
  // Use a valid 32-byte key represented as 64 hex chars
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    process.env.TOKEN_ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY_ID) {
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
  }
});

afterAll(() => {
  // Cleanup after all unit tests
});
