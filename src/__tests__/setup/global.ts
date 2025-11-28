import "@testing-library/jest-dom";
import { beforeAll, afterAll, vi } from "vitest";
import React from "react";

// Make React available globally for JSX transform in tests
(global as any).React = React;

// Mock NextAuth globally for all tests
// This eliminates the need to mock in individual test files
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

beforeAll(() => {
  // Global test hooks can be added here when needed.
});

afterAll(() => {
  // Global cleanup for all test suites.
});
