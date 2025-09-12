// Unit test setup
import "@testing-library/jest-dom";
import { beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import { configure } from '@testing-library/react';

// Configure React Testing Library for React 18
configure({
  asyncUtilTimeout: 5000,
});

// Ensure we have a proper DOM environment
if (typeof document !== 'undefined') {
  // Create a proper document body if it doesn't exist
  if (!document.body) {
    document.body = document.createElement('body');
  }
  
  // Ensure document.documentElement exists
  if (!document.documentElement) {
    const html = document.createElement('html');
    document.appendChild(html);
    html.appendChild(document.head || document.createElement('head'));
    html.appendChild(document.body);
  }
}

// Mock window and global DOM APIs if needed
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
