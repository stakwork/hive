import { describe, test, expect, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from '@/__tests__/support/factories';
import {
  createAuthenticatedSession,
  getMockedSession,
  generateUniqueSlug,
} from '@/__tests__/support/helpers';
import { NextRequest } from 'next/server';

const mockCreateSwarm = vi.fn();
const mockCreateCustomer = vi.fn();
const mockCreateSecret = vi.fn();

const { mockSetGraphTitle } = vi.hoisted(() => ({
  mockSetGraphTitle: vi.fn(),
}));

vi.mock('@/services/swarm/graph-title', () => ({
  setGraphTitle: mockSetGraphTitle,
}));

vi.mock('@/lib/runtime', () => ({
  isSwarmFakeModeEnabled: vi.fn(() => false),
  isDevelopmentMode: vi.fn(() => false),
}));

vi.mock('@/services/swarm', () => ({
  SwarmService: vi.fn().mockImplementation(() => ({
    createSwarm: mockCreateSwarm,
  })),
}));

vi.mock('@/lib/service-factory', () => ({
  stakworkService: vi.fn(() => ({
    createCustomer: mockCreateCustomer,
    createSecret: mockCreateSecret,
  })),
}));

vi.mock('@/config/services', () => ({
  getServiceConfig: vi.fn(() => ({
    url: 'http://mock-swarm.test',
    apiKey: 'mock-key',
  })),
}));

import { POST } from '@/app/api/swarm/route';

function buildRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/swarm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockSession(user: { id: string; email: string | null }, extra?: Record<string, unknown>) {
  const session = createAuthenticatedSession(user);
  if (extra) Object.assign(session.user!, extra);
  getMockedSession().mockResolvedValue(session);
}

function defaultSwarmResponse() {
  return {
    data: {
      swarm_id: 'swarm-abc123',
      address: 'my-graph.sphinx.chat',
      x_api_key: 'api-key-xyz',
      ec2_id: 'i-0abc123',
    },
  };
}

describe('POST /api/swarm — graph_mindset', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    testUser = await createTestUser();
    workspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: generateUniqueSlug('gm-swarm'),
    });

    mockCreateSwarm.mockResolvedValue(defaultSwarmResponse());
    mockCreateSecret.mockResolvedValue({ success: true });
    mockSetGraphTitle.mockResolvedValue(undefined);
  });

  // ── Happy path: full DB state after successful graph_mindset creation ──

  test('creates swarm + repository in DB and transitions to ACTIVE', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 42, token: 'stk-token', workflow_id: 99 },
    });

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/my-repo',
      vanity_address: 'my-graph.sphinx.chat',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Swarm: placeholder was created then updated to ACTIVE with external data
    const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
    expect(swarm).not.toBeNull();
    expect(swarm!.status).toBe('ACTIVE');
    expect(swarm!.swarmId).toBe('swarm-abc123');
    expect(swarm!.swarmUrl).toBe('https://my-graph.sphinx.chat/api');
    expect(swarm!.ec2Id).toBe('i-0abc123');
    // Encrypted fields should be populated (non-null)
    expect(swarm!.swarmApiKey).not.toBeNull();
    expect(swarm!.swarmPassword).not.toBeNull();

    // Repository: created in the same transaction as the placeholder
    const repo = await db.repository.findFirst({ where: { workspaceId: workspace.id } });
    expect(repo).not.toBeNull();
    expect(repo!.repositoryUrl).toBe('https://github.com/user/my-repo');
    expect(repo!.name).toBe('my-repo');
    expect(repo!.branch).toBe('main');
    expect(repo!.status).toBe('PENDING');
    expect(repo!.codeIngestionEnabled).toBe(true);
    expect(repo!.docsEnabled).toBe(true);
    expect(repo!.mocksEnabled).toBe(false);

    // Stakwork customer was called for this workspace
    expect(mockCreateCustomer).toHaveBeenCalledWith(workspace.id);

    // Both secrets were registered after swarm save
    expect(mockCreateSecret).toHaveBeenCalledTimes(2);
    expect(mockCreateSecret).toHaveBeenCalledWith('swarm-abc123_API_KEY', 'api-key-xyz', 'stk-token');
    expect(mockCreateSecret).toHaveBeenCalledWith('SWARM_-abc123_API_KEY', 'api-key-xyz', 'stk-token', '42');
  });

  // ── SourceControlOrg linking ──

  test('links workspace to SourceControlOrg when org exists', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 1, token: 'tok', workflow_id: null },
    });

    // Pre-create a SourceControlOrg for the github owner
    const org = await db.sourceControlOrg.create({
      data: { githubLogin: 'myorg', name: 'myorg', githubInstallationId: 12345 },
    });

    await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/myorg/repo',
      workspace_type: 'graph_mindset',
    }));

    // Workspace should now be linked to the org
    const updatedWorkspace = await db.workspace.findUnique({ where: { id: workspace.id } });
    expect(updatedWorkspace!.sourceControlOrgId).toBe(org.id);
  });

  // ── Error paths: verify DB state after failures ──

  test('no swarm created when Stakwork returns no token', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: null, token: null, workflow_id: null },
    });

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/repo',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);

    // Customer fails before placeholder is created — no swarm record at all
    const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
    expect(swarm).toBeNull();
  });

  test('placeholder stays FAILED when SwarmService throws', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 1, token: 'tok', workflow_id: null },
    });
    mockCreateSwarm.mockRejectedValue(new Error('EC2 provisioning failed'));

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/repo',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(500);

    const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
    expect(swarm!.status).toBe('FAILED');
    expect(swarm!.swarmId).toBeNull();
    // Encrypted fields should NOT be populated since external call failed
    expect(swarm!.swarmApiKey).toBeNull();
  });

  // ── createSecret failure is non-fatal ──

  test('createSecret failure is non-fatal — swarm still returns success', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 42, token: 'stk-token', workflow_id: 99 },
    });
    mockCreateSecret.mockRejectedValue(new Error('secret fail'));

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/my-repo',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Swarm should be ACTIVE despite secret failure
    const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
    expect(swarm!.status).toBe('ACTIVE');
  });

  // ── Idempotency: existing swarm is returned, nothing new created ──

  test('returns existing swarm without creating duplicate records', async () => {
    mockSession(testUser);

    const existingSwarm = await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: 'existing-swarm',
        instanceType: 'XL',
        status: 'ACTIVE',
        swarmId: 'existing-id',
      },
    });

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/repo',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.swarmId).toBe('existing-id');

    // No duplicate swarms created
    const swarms = await db.swarm.findMany({ where: { workspaceId: workspace.id } });
    expect(swarms).toHaveLength(1);
    expect(swarms[0].id).toBe(existingSwarm.id);

    // No repository created either (transaction was skipped)
    const repos = await db.repository.findMany({ where: { workspaceId: workspace.id } });
    expect(repos).toHaveLength(0);

    // External services never called (early return on existing swarm)
    expect(mockCreateCustomer).not.toHaveBeenCalled();
    expect(mockCreateSwarm).not.toHaveBeenCalled();
  });

  // ── createCustomer now runs for ALL workspace types ──

  test('normal workspace type: creates customer and swarm without graphmindset ENVs', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 1, token: 'stk-token', workflow_id: null },
    });

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/repo',
      // no workspace_type
    }));

    expect(response.status).toBe(200);

    // Swarm should exist and be ACTIVE
    const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
    expect(swarm!.status).toBe('ACTIVE');

    // Stakwork customer IS called for all types now
    expect(mockCreateCustomer).toHaveBeenCalledWith(workspace.id);

    // Both secrets are registered after swarm save
    expect(mockCreateSecret).toHaveBeenCalledTimes(2);
    expect(mockCreateSecret).toHaveBeenCalledWith('swarm-abc123_API_KEY', 'api-key-xyz', 'stk-token');
    expect(mockCreateSecret).toHaveBeenCalledWith('SWARM_-abc123_API_KEY', 'api-key-xyz', 'stk-token', '1');
  });

  // ── Auth & access control (real DB permission checks) ──

  test('returns 401 when unauthenticated', async () => {
    getMockedSession().mockResolvedValue(null);

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/repo',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(401);

    // Nothing created in DB
    const swarms = await db.swarm.findMany({ where: { workspaceId: workspace.id } });
    expect(swarms).toHaveLength(0);
  });

  test('returns 403 for viewer — no swarm created', async () => {
    const viewer = await createTestUser();
    await createTestMembership({
      workspaceId: workspace.id,
      userId: viewer.id,
      role: 'VIEWER',
    });
    mockSession(viewer);

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/repo',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(403);

    // Nothing created in DB
    const swarms = await db.swarm.findMany({ where: { workspaceId: workspace.id } });
    expect(swarms).toHaveLength(0);
  });

  test('returns 400 when workspaceId is missing', async () => {
    mockSession(testUser);

    const response = await POST(buildRequest({
      repositoryUrl: 'https://github.com/user/repo',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(400);
  });

  // ── setGraphTitle fire-and-forget ─────────────────────────────────────────

  test('calls setGraphTitle fire-and-forget for graph_mindset workspace', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 42, token: 'stk-token', workflow_id: 99 },
    });

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/my-repo',
      vanity_address: 'my-graph.sphinx.chat',
      workspace_type: 'graph_mindset',
    }));

    expect(response.status).toBe(200);

    // Allow fire-and-forget microtask to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSetGraphTitle).toHaveBeenCalledTimes(1);
    expect(mockSetGraphTitle).toHaveBeenCalledWith(
      'https://my-graph.sphinx.chat/api',
      expect.any(String), // swarmPassword (generated)
      'my-graph', // vanity_address with .sphinx.chat stripped
    );
  });

  test('uses swarm_id as slug when no vanity_address provided', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 42, token: 'stk-token', workflow_id: 99 },
    });

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/my-repo',
      workspace_type: 'graph_mindset',
      // no vanity_address
    }));

    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSetGraphTitle).toHaveBeenCalledTimes(1);
    const [, , slug] = mockSetGraphTitle.mock.calls[0];
    expect(slug).toBe('swarm-abc123'); // defaultSwarmResponse swarm_id
  });

  test('does NOT call setGraphTitle for non-graph_mindset workspace type', async () => {
    mockSession(testUser);
    mockCreateCustomer.mockResolvedValue({
      data: { id: 1, token: 'stk-token', workflow_id: null },
    });

    const response = await POST(buildRequest({
      workspaceId: workspace.id,
      repositoryUrl: 'https://github.com/user/repo',
      // no workspace_type (standard workspace)
    }));

    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSetGraphTitle).not.toHaveBeenCalled();
  });
});
