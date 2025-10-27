/**
 * Shared test helpers and types for pod-related tests
 */

/**
 * ProcessInfo interface for test data (matches implementation in utils.ts)
 */
export interface ProcessInfo {
  pid: number;
  name: string;
  status: string;
  pm_uptime: number;
  port?: string;
  cwd?: string;
}

/**
 * Factory function to create a mock ProcessInfo object with sensible defaults
 */
export function createMockProcess(overrides: Partial<ProcessInfo>): ProcessInfo {
  return {
    pid: 1234,
    name: 'test-process',
    status: 'online',
    pm_uptime: 10000,
    ...overrides,
  };
}

/**
 * Factory function to create a mock Goose process
 */
export function createMockGooseProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return createMockProcess({
    name: 'goose',
    port: '15551',
    ...overrides,
  });
}
