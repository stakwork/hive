/**
 * Test data exports
 *
 * This index re-exports everything for backwards compatibility.
 * For new code, prefer importing directly from:
 * - factories/ for DB entity creators
 * - fixtures/ for in-memory mock data
 * - utilities/ for DB utilities
 */

// In-memory mock data builders (true fixtures)
export * from "./mock-data";
export * from "./janitor-mocks";
export * from "./task-coordinator-mocks";
export * from "./task-workflow-mocks";
export * from "./feature-data";

// Re-export factories for backwards compatibility
export * from "../factories";

// Re-export utilities for backwards compatibility
export * from "../utilities/database";
