import "@testing-library/jest-dom";
import { beforeAll, afterAll, vi } from "vitest";

// Mock NextAuth globally for all tests
// This eliminates the need to mock in individual test files
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock ResizeObserver for 3D components (react-three/fiber Canvas)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeAll(() => {
  // Global test hooks can be added here when needed.
});

afterAll(() => {
  // Global cleanup for all test suites.
});
