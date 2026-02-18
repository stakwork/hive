import "@testing-library/jest-dom";
import { beforeAll, afterAll, vi } from "vitest";
import { TextEncoder, TextDecoder } from "util";

// Polyfill TextEncoder/TextDecoder for jsdom environment
// Required by jose/next-auth JWT encryption
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
}

// Mock NextAuth globally for all tests
// This eliminates the need to mock in individual test files
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Also mock the main next-auth module since some routes import from there
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock ResizeObserver for 3D components (react-three/fiber Canvas)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock window.matchMedia for theme hooks (only in browser/jsdom environments)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeAll(() => {
  // Global test hooks can be added here when needed.
});

afterAll(() => {
  // Global cleanup for all test suites.
});
