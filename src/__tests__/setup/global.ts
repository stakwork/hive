import "@testing-library/jest-dom";
import { beforeAll, afterAll, vi } from "vitest";

// Mock NextAuth v5 globally for all tests
// This eliminates the need to mock in individual test files
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

beforeAll(() => {
  // Global test hooks can be added here when needed.
});

afterAll(() => {
  // Global cleanup for all test suites.
});
