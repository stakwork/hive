import type { LearnMessage } from "@/types/learn";

/**
 * Helper function to create test LearnMessage objects with default values.
 * Use this for consistent test message creation across test files.
 * 
 * @param overrides - Partial LearnMessage to override defaults
 * @returns Complete LearnMessage object
 */
export const createTestLearnMessage = (overrides: Partial<LearnMessage> = {}): LearnMessage => ({
  id: "test-msg-1",
  content: "Test message",
  role: "user",
  timestamp: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});
