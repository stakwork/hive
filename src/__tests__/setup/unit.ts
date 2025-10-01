import "./global";
import { beforeAll, afterAll, beforeEach } from "vitest";
import { resetDbMock } from "../mocks/prisma";
import { ensureTestEnv } from "./env";
import "../mocks/env"; // Import env mock to prevent validation errors

// Set environment variables for unit tests using shared helper
ensureTestEnv();

beforeAll(() => {
  // Global setup for unit tests
});

beforeEach(() => {
  resetDbMock();
});

afterAll(() => {
  // Unit test suites can add teardown logic here if necessary.
});
