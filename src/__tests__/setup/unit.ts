import "./global";
import { beforeAll, afterAll, beforeEach } from "vitest";
import { resetDbMock } from "../mocks/prisma";
import "../mocks/env"; // Import env mock to prevent validation errors

// Set environment variables for unit tests
// These match the values from integration.ts to maintain consistency
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

beforeAll(() => {
  // Global setup for unit tests
});

beforeEach(() => {
  resetDbMock();
});

afterAll(() => {
  // Unit test suites can add teardown logic here if necessary.
});
