/**
 * Test fixtures and factories for pod-related tests
 * These factories create test data for ProcessInfo objects used in pod management
 */

export interface ProcessInfo {
  pid: number;
  name: string;
  status: string;
  pm_uptime: number;
  port?: string;
  cwd?: string;
}

export interface CreateProcessInfoOptions {
  pid?: number;
  name: string;
  status?: string;
  pm_uptime?: number;
  port?: string;
  cwd?: string;
}

/**
 * Create a ProcessInfo object with sensible defaults
 */
export function createProcessInfo(options: CreateProcessInfoOptions): ProcessInfo {
  return {
    pid: options.pid ?? Math.floor(Math.random() * 10000),
    name: options.name,
    status: options.status ?? 'online',
    pm_uptime: options.pm_uptime ?? 123456,
    ...(options.port !== undefined && { port: options.port }),
    ...(options.cwd !== undefined && { cwd: options.cwd }),
  };
}

/**
 * Create a goose process with default values
 */
export function createGooseProcess(overrides?: Partial<CreateProcessInfoOptions>): ProcessInfo {
  return createProcessInfo({
    pid: 5678,
    name: 'goose',
    status: 'online',
    pm_uptime: 123456,
    port: '15551',
    cwd: '/workspace/goose',
    ...overrides,
  });
}

/**
 * Create a frontend process with default values
 */
export function createFrontendProcess(overrides?: Partial<CreateProcessInfoOptions>): ProcessInfo {
  return createProcessInfo({
    pid: 1234,
    name: 'frontend',
    status: 'online',
    pm_uptime: 123456,
    port: '3000',
    cwd: '/workspace/app',
    ...overrides,
  });
}

/**
 * Create an API process with default values
 */
export function createApiProcess(overrides?: Partial<CreateProcessInfoOptions>): ProcessInfo {
  return createProcessInfo({
    pid: 9012,
    name: 'api',
    status: 'online',
    pm_uptime: 123456,
    port: '8080',
    cwd: '/workspace/api',
    ...overrides,
  });
}

/**
 * Create a process list with goose present
 */
export function createProcessListWithGoose(additionalProcesses: ProcessInfo[] = []): ProcessInfo[] {
  return [createGooseProcess(), ...additionalProcesses];
}

/**
 * Create a process list without goose
 */
export function createProcessListWithoutGoose(processes: ProcessInfo[] = []): ProcessInfo[] {
  return processes.length > 0 
    ? processes 
    : [createFrontendProcess(), createApiProcess()];
}
