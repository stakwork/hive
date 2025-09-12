// Unit test setup
import "@testing-library/jest-dom";
import { beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

// Mock DOM globals for testing-library/react-dom
Object.defineProperty(global, 'document', {
  value: {
    createElement: vi.fn((tagName: string) => ({
      tagName: tagName.toUpperCase(),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      querySelector: vi.fn(),
      querySelectorAll: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      getAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      innerHTML: '',
      textContent: '',
      children: [],
      childNodes: [],
      style: {},
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn(),
        toggle: vi.fn(),
      },
    })),
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      querySelector: vi.fn(),
      querySelectorAll: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    documentElement: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true
});

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
