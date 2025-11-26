import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';

describe('Pool Manager Mock Server Endpoints', () => {
  const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || 'http://localhost:3010';
  const POOL_ID = 'test-pool-123';
  let mockServerProcess: ChildProcess | null = null;

  // Helper function to fetch and parse JSON from mock server
  const fetchJson = async (endpoint: string) => {
    const response = await fetch(`${MOCK_SERVER_URL}${endpoint}`);
    const data = await response.json();
    return { response, data };
  };

  beforeAll(async () => {
    // Start the mock server
    mockServerProcess = spawn('npx', ['tsx', 'scripts/mock-server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, MOCK_SERVER_PORT: '3010' },
      stdio: 'ignore',
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Mock server failed to start within 5 seconds'));
      }, 5000);

      const checkServer = async () => {
        try {
          const response = await fetch(`${MOCK_SERVER_URL}/pools/${POOL_ID}`);
          if (response.ok) {
            clearTimeout(timeout);
            resolve();
          } else {
            // Server responded but with error, retry
            setTimeout(checkServer, 100);
          }
        } catch {
          // Server not ready yet, retry in 100ms
          setTimeout(checkServer, 100);
        }
      };
      checkServer();
    });
  });

  afterAll(async () => {
    // Stop the mock server
    if (mockServerProcess) {
      mockServerProcess.kill('SIGTERM');
      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  describe('GET /pools/:id - Pool Status', () => {
    it('should return pool status with 2 pods in use and 3 available', async () => {
      const { response, data } = await fetchJson(`/pools/${POOL_ID}`);

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        id: POOL_ID,
        name: `pool-${POOL_ID}`,
        status: {
          running: 5,
          pending: 0,
          failed: 0,
          used: 2,
          unused: 3,
        },
      });
    });

    it('should have valid pool status structure', async () => {
      const { data } = await fetchJson(`/pools/${POOL_ID}`);

      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('name');
      expect(data).toHaveProperty('status');
      expect(data.status).toHaveProperty('running');
      expect(data.status).toHaveProperty('used');
      expect(data.status).toHaveProperty('unused');
    });
  });

  describe('GET /pools/:id/workspaces - Pod Availability', () => {
    it('should return 5 total pods', async () => {
      const { response, data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      expect(response.status).toBe(200);
      expect(workspaces).toHaveLength(5);
    });

    it('should have 2 pods with usage_status "in-use"', async () => {
      const { data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      const inUsePods = workspaces.filter((ws: any) => ws.usage_status === 'in-use');
      expect(inUsePods).toHaveLength(2);

      // Verify in-use pods have repositories
      inUsePods.forEach((pod: any) => {
        expect(pod.repositories).toBeTruthy();
        expect(pod.repositories.length).toBeGreaterThan(0);
      });
    });

    it('should have 3 pods with usage_status "available"', async () => {
      const { data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      const availablePods = workspaces.filter((ws: any) => ws.usage_status === 'available');
      expect(availablePods).toHaveLength(3);

      // Verify available pods have no repositories
      availablePods.forEach((pod: any) => {
        expect(pod.repositories).toHaveLength(0);
      });
    });

    it('should have all pods in running state', async () => {
      const { data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      workspaces.forEach((pod: any) => {
        expect(pod.state).toBe('running');
        expect(pod.flagged_for_recreation).toBe(false);
      });
    });

    it('should have valid pod structure with required fields', async () => {
      const { data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      workspaces.forEach((pod: any) => {
        expect(pod).toHaveProperty('subdomain');
        expect(pod).toHaveProperty('state');
        expect(pod).toHaveProperty('usage_status');
        expect(pod).toHaveProperty('fqdn');
        expect(pod).toHaveProperty('url');
        expect(pod).toHaveProperty('password');
        expect(pod).toHaveProperty('portMappings');
        expect(pod).toHaveProperty('repositories');
        expect(pod).toHaveProperty('branches');
        expect(pod).toHaveProperty('resource_usage');
      });
    });

    it('should have port mappings for frontend and graph services', async () => {
      const { data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      workspaces.forEach((pod: any) => {
        expect(pod.portMappings).toHaveProperty('3000'); // Frontend
        expect(pod.portMappings).toHaveProperty('3355'); // Graph service
      });
    });

    it('should have resource usage metrics', async () => {
      const { data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      workspaces.forEach((pod: any) => {
        expect(pod.resource_usage).toHaveProperty('cpu_percent');
        expect(pod.resource_usage).toHaveProperty('memory_percent');
        expect(pod.resource_usage).toHaveProperty('disk_percent');
        expect(typeof pod.resource_usage.cpu_percent).toBe('number');
        expect(typeof pod.resource_usage.memory_percent).toBe('number');
        expect(typeof pod.resource_usage.disk_percent).toBe('number');
      });
    });

    it('should show higher resource usage for in-use pods', async () => {
      const { data: workspaces } = await fetchJson(`/pools/${POOL_ID}/workspaces`);

      const inUsePods = workspaces.filter((ws: any) => ws.usage_status === 'in-use');
      const availablePods = workspaces.filter((ws: any) => ws.usage_status === 'available');

      const avgInUseMemory = inUsePods.reduce((sum: number, pod: any) => sum + pod.resource_usage.memory_percent, 0) / inUsePods.length;
      const avgAvailableMemory = availablePods.reduce((sum: number, pod: any) => sum + pod.resource_usage.memory_percent, 0) / availablePods.length;

      // In-use pods should have higher memory usage than available pods
      expect(avgInUseMemory).toBeGreaterThan(avgAvailableMemory);
    });
  });
});
