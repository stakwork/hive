/**
 * Pod test fixtures
 * 
 * Shared test data for pod management tests including ProcessInfo, PodWorkspace, and related structures.
 */

/**
 * Process information returned from pod control port
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
 * Pod workspace structure returned from Pool Manager API
 */
export interface PodWorkspace {
  branches: string[];
  created: string;
  customImage: boolean;
  flagged_for_recreation: boolean;
  fqdn: string;
  id: string;
  image: string;
  marked_at: string | null;
  password: string;
  portMappings: Record<string, string>;
  primaryRepo: string | null;
  repoName: string | null;
  repositories: string[];
  state: string;
  subdomain: string;
  url: string;
  usage_status: string;
  useDevContainer: boolean;
}

/**
 * Creates a mock ProcessInfo object
 */
export function createMockProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid: 1234,
    name: 'frontend',
    status: 'online',
    pm_uptime: 123456,
    port: '3000',
    cwd: '/workspace/app',
    ...overrides,
  };
}

/**
 * Creates a mock PodWorkspace object
 */
export function createMockPodWorkspace(overrides: Partial<PodWorkspace> = {}): PodWorkspace {
  return {
    id: 'workspace-abc123',
    password: 'secure-pod-password',
    fqdn: 'workspace.pool.example.com',
    portMappings: {
      '15552': 'https://control-abc123.example.com',
      '3000': 'https://app-abc123.example.com',
      '8080': 'https://api-abc123.example.com',
    },
    state: 'running',
    url: 'https://ide-abc123.example.com',
    subdomain: 'workspace-abc123',
    image: 'stakwork/hive:latest',
    customImage: false,
    created: '2024-01-15T10:30:00Z',
    marked_at: null,
    usage_status: 'available',
    flagged_for_recreation: false,
    primaryRepo: null,
    repoName: null,
    repositories: [],
    branches: [],
    useDevContainer: false,
    ...overrides,
  };
}

/**
 * Creates a list of mock processes
 */
export function createMockProcessList(processes: Array<Partial<ProcessInfo>> = []): ProcessInfo[] {
  if (processes.length === 0) {
    // Default process list with frontend and api
    return [
      createMockProcess({
        pid: 1234,
        name: 'frontend',
        port: '3000',
        cwd: '/workspace/app',
      }),
      createMockProcess({
        pid: 5678,
        name: 'api',
        status: 'online',
        pm_uptime: 123456,
        port: '8080',
        cwd: '/workspace/api',
      }),
    ];
  }
  
  return processes.map((proc, index) => createMockProcess({ pid: 1000 + index, ...proc }));
}
