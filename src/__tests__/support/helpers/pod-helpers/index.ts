/**
 * Pod-related test helpers
 * Provides utilities for creating mock process data and related test fixtures
 */

/**
 * ProcessInfo type definition for tests
 * Matches the structure returned by pod control API
 */
export type ProcessInfo = {
  pid: number;
  name: string;
  status: string;
  pm_uptime: number;
  port?: string;
  cwd?: string;
};

/**
 * Default values for ProcessInfo
 */
const DEFAULTS = {
  status: "online",
  pm_uptime: 123456,
  cwd: "/workspace",
} as const;

/**
 * Create a mock ProcessInfo object with sensible defaults
 * @param overrides - Partial ProcessInfo to override defaults
 * @returns Complete ProcessInfo object
 */
export function createMockProcess(overrides: Partial<ProcessInfo> & Pick<ProcessInfo, "pid" | "name">): ProcessInfo {
  return {
    status: DEFAULTS.status,
    pm_uptime: DEFAULTS.pm_uptime,
    cwd: DEFAULTS.cwd,
    ...overrides,
  };
}

/**
 * Create a mock goose process with typical configuration
 * @param overrides - Optional overrides for specific fields
 * @returns ProcessInfo for a goose process
 */
export function createMockGooseProcess(overrides?: Partial<ProcessInfo>): ProcessInfo {
  return createMockProcess({
    pid: 5678,
    name: "goose",
    port: "15551",
    cwd: "/workspace/goose",
    ...overrides,
  });
}

/**
 * Create a mock frontend process with typical configuration
 * @param overrides - Optional overrides for specific fields
 * @returns ProcessInfo for a frontend process
 */
export function createMockFrontendProcess(overrides?: Partial<ProcessInfo>): ProcessInfo {
  return createMockProcess({
    pid: 1234,
    name: "frontend",
    port: "3000",
    cwd: "/workspace/app",
    ...overrides,
  });
}
