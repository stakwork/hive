/**
 * Shared test helpers and types for pod management tests
 */

/**
 * ProcessInfo interface matching the structure used in pod process lists
 * This interface is used by the pod management utilities to represent
 * individual processes in a workspace.
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
 * Creates a mock ProcessInfo object with default values
 * @param overrides - Partial ProcessInfo to override defaults
 * @returns A complete ProcessInfo object
 */
export function createMockProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid: 1234,
    name: 'test-process',
    status: 'online',
    pm_uptime: 123456,
    ...overrides,
  };
}

/**
 * Creates a list of mock processes
 * @param count - Number of processes to create
 * @param namePrefix - Prefix for process names (will append index)
 * @returns Array of ProcessInfo objects
 */
export function createMockProcessList(count: number, namePrefix = 'process'): ProcessInfo[] {
  return Array.from({ length: count }, (_, i) => createMockProcess({
    pid: i + 1,
    name: `${namePrefix}-${i}`,
    pm_uptime: (i + 1) * 1000,
  }));
}
