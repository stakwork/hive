import express from 'express';

const app = express();
const PORT = process.env.MOCK_SERVER_PORT || 3010;

app.use(express.json());

// Mock auth endpoint
app.post('/oauth/access_token', (req, res) => {
  res.json({
    access_token: 'mock_access_token_' + Date.now(),
    token_type: 'bearer',
    scope: 'repo,user',
  });
});

// Pool Manager endpoints
// Get pool status - shows 2 pods in use, 3 available
app.get('/pools/:id', (req, res) => {
  res.json({
    id: req.params.id,
    name: `pool-${req.params.id}`,
    description: 'Mock pool for testing',
    owner_id: 'mock-owner',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: {
      running: 5,
      pending: 0,
      failed: 0,
      used: 2,
      unused: 3,
    },
  });
});

// Get pool workspaces - returns 5 pods (2 in use, 3 available)
app.get('/pools/:id/workspaces', (req, res) => {
  const workspaces = [
    // 2 pods in use
    {
      subdomain: 'pod-1',
      state: 'running',
      usage_status: 'in-use',
      flagged_for_recreation: false,
      fqdn: 'pod-1.mock-pool.com',
      url: 'https://pod-1.mock-pool.com',
      password: 'mock-password-1',
      portMappings: {
        '3000': 'https://pod-1.mock-pool.com:3000',
        '3355': 'https://pod-1.mock-pool.com:3355',
      },
      repositories: [
        {
          name: 'test-repo',
          branch: 'main',
        },
      ],
      branches: ['main'],
      resource_usage: {
        cpu_percent: 45.2,
        memory_percent: 62.8,
        disk_percent: 38.5,
      },
    },
    {
      subdomain: 'pod-2',
      state: 'running',
      usage_status: 'in-use',
      flagged_for_recreation: false,
      fqdn: 'pod-2.mock-pool.com',
      url: 'https://pod-2.mock-pool.com',
      password: 'mock-password-2',
      portMappings: {
        '3000': 'https://pod-2.mock-pool.com:3000',
        '3355': 'https://pod-2.mock-pool.com:3355',
      },
      repositories: [
        {
          name: 'test-repo',
          branch: 'develop',
        },
      ],
      branches: ['develop'],
      resource_usage: {
        cpu_percent: 52.1,
        memory_percent: 71.3,
        disk_percent: 42.1,
      },
    },
    // 3 available pods
    {
      subdomain: 'pod-3',
      state: 'running',
      usage_status: 'available',
      flagged_for_recreation: false,
      fqdn: 'pod-3.mock-pool.com',
      url: 'https://pod-3.mock-pool.com',
      password: 'mock-password-3',
      portMappings: {
        '3000': 'https://pod-3.mock-pool.com:3000',
        '3355': 'https://pod-3.mock-pool.com:3355',
      },
      repositories: [],
      branches: [],
      resource_usage: {
        cpu_percent: 5.2,
        memory_percent: 12.8,
        disk_percent: 15.5,
      },
    },
    {
      subdomain: 'pod-4',
      state: 'running',
      usage_status: 'available',
      flagged_for_recreation: false,
      fqdn: 'pod-4.mock-pool.com',
      url: 'https://pod-4.mock-pool.com',
      password: 'mock-password-4',
      portMappings: {
        '3000': 'https://pod-4.mock-pool.com:3000',
        '3355': 'https://pod-4.mock-pool.com:3355',
      },
      repositories: [],
      branches: [],
      resource_usage: {
        cpu_percent: 3.8,
        memory_percent: 10.2,
        disk_percent: 12.3,
      },
    },
    {
      subdomain: 'pod-5',
      state: 'running',
      usage_status: 'available',
      flagged_for_recreation: false,
      fqdn: 'pod-5.mock-pool.com',
      url: 'https://pod-5.mock-pool.com',
      password: 'mock-password-5',
      portMappings: {
        '3000': 'https://pod-5.mock-pool.com:3000',
        '3355': 'https://pod-5.mock-pool.com:3355',
      },
      repositories: [],
      branches: [],
      resource_usage: {
        cpu_percent: 4.1,
        memory_percent: 11.5,
        disk_percent: 13.8,
      },
    },
  ];

  res.json(workspaces);
});

app.listen(PORT, () => {
  console.log(`Mock server running on http://localhost:${PORT}`);
});
