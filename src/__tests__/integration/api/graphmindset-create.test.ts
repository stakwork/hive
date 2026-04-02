import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/graphmindset/create/route';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/factories';
import { createTestSwarmPayment } from '@/__tests__/support/factories/swarm-payment.factory';
import { createPostRequest } from '@/__tests__/support/helpers/request-builders';
import { getServerSession } from 'next-auth/next';
import { EncryptionService } from '@/lib/encryption';

// Mock next-auth
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

// Mock stakwork service
vi.mock('@/lib/service-factory', () => ({
  stakworkService: vi.fn(() => ({
    createCustomer: vi.fn().mockResolvedValue({
      data: { id: 42, token: 'mock-stakwork-token', workflow_id: 99 },
    }),
  })),
}));

// Mock environment config
vi.mock('@/config/env', () => ({
  config: {},
  optionalEnvVars: {
    SWARM_SUPER_ADMIN_URL: 'https://swarm-admin.test',
  },
}));

// Mock fetch for the swarm admin API
global.fetch = vi.fn();

describe('GraphMindset Create Route Integration Tests', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let createdPaymentIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    testUser = await createTestUser();
    createdPaymentIds = [];

    // Default successful swarm admin response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, id: 123 }),
      text: async () => '',
    });
  });

  afterEach(async () => {
    if (createdPaymentIds.length > 0) {
      await db.swarmPayment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  describe('POST /api/graphmindset/create', () => {
    test('returns 401 when unauthenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(401);
    });

    test('returns 400 when no PAID SwarmPayment exists for user', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('No valid payment found');
    });

    test('returns 400 when SwarmPayment exists but password is null', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      // Create a PAID payment with no password
      const payment = await createTestSwarmPayment({
        userId: testUser.id,
        status: 'PAID',
        workspaceId: undefined,
        password: null,
      });
      createdPaymentIds.push(payment.id);

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('No valid payment found');
    });

    test('returns 400 when SwarmPayment is PAID but workspaceId is already set (already claimed)', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      // Create a workspace to link to
      const workspace = await db.workspace.create({
        data: {
          id: `ws_test_${Date.now()}`,
          name: 'Existing Workspace',
          slug: `existing-ws-${Date.now()}`,
          ownerId: testUser.id,
        },
      });

      const payment = await createTestSwarmPayment({
        userId: testUser.id,
        status: 'PAID',
        workspaceId: workspace.id, // already linked
      });
      createdPaymentIds.push(payment.id);

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('No valid payment found');

      // Cleanup
      await db.workspace.delete({ where: { id: workspace.id } });
    });

    test('decrypts stored password and forwards it to swarm admin API', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const knownPassword = 'MyKnownTestPassword123!';

      const payment = await createTestSwarmPayment({
        userId: testUser.id,
        status: 'PAID',
        workspaceId: undefined,
        password: knownPassword,
      });
      createdPaymentIds.push(payment.id);

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify the correct password was forwarded in the swarm API call
      expect(global.fetch).toHaveBeenCalledOnce();
      const [, fetchOptions] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.password).toBe(knownPassword);
    });

    test('returns 400 for invalid name format', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const req = createPostRequest('/api/graphmindset/create', { name: 'invalid name with spaces' });
      const response = await POST(req);

      expect(response.status).toBe(400);
    });

    test('forwards GRAPHMINDSET_STAKWORK_WORKFLOW_ID to swarm admin API when workflow_id is present', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const payment = await createTestSwarmPayment({
        userId: testUser.id,
        status: 'PAID',
        workspaceId: undefined,
        password: 'TestPassword123!',
      });
      createdPaymentIds.push(payment.id);

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(200);

      const [, fetchOptions] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.env.GRAPHMINDSET_STAKWORK_WORKFLOW_ID).toBe('99');
    });

    test('stores encrypted xApiToken and customerToken on SwarmPayment after successful create', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const payment = await createTestSwarmPayment({
        userId: testUser.id,
        status: 'PAID',
        workspaceId: undefined,
        password: 'TestPassword123!',
      });
      createdPaymentIds.push(payment.id);

      // Mock swarm admin to return x_api_key
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 123, data: { x_api_key: 'swarm-x-api-key-abc' } }),
        text: async () => '',
      });

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Fetch the updated SwarmPayment from the DB
      const updated = await db.swarmPayment.findUnique({ where: { id: payment.id } });
      expect(updated?.xApiToken).not.toBeNull();
      expect(updated?.customerToken).not.toBeNull();

      // Verify both fields decrypt correctly
      const enc = EncryptionService.getInstance();
      const decryptedXApiToken = enc.decryptField('swarmPaymentXApiToken', updated!.xApiToken!);
      const decryptedCustomerToken = enc.decryptField('swarmPaymentCustomerToken', updated!.customerToken!);
      expect(decryptedXApiToken).toBe('swarm-x-api-key-abc');
      expect(decryptedCustomerToken).toBe('mock-stakwork-token');
    });

    test('still returns 200 when SwarmPayment token update fails', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const payment = await createTestSwarmPayment({
        userId: testUser.id,
        status: 'PAID',
        workspaceId: undefined,
        password: 'TestPassword123!',
      });
      createdPaymentIds.push(payment.id);

      // Force db.swarmPayment.update to throw
      const updateSpy = vi.spyOn(db.swarmPayment, 'update').mockRejectedValueOnce(new Error('DB error'));

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      updateSpy.mockRestore();
    });

    test('omits GRAPHMINDSET_STAKWORK_WORKFLOW_ID from swarm env when workflow_id is null', async () => {
      const { stakworkService } = await import('@/lib/service-factory');
      vi.mocked(stakworkService).mockReturnValue({
        createCustomer: vi.fn().mockResolvedValue({
          data: { id: 42, token: 'mock-stakwork-token', workflow_id: null },
        }),
      } as any);

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const payment = await createTestSwarmPayment({
        userId: testUser.id,
        status: 'PAID',
        workspaceId: undefined,
        password: 'TestPassword123!',
      });
      createdPaymentIds.push(payment.id);

      const req = createPostRequest('/api/graphmindset/create', { name: 'my-graph' });
      const response = await POST(req);

      expect(response.status).toBe(200);

      const [, fetchOptions] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.env).not.toHaveProperty('GRAPHMINDSET_STAKWORK_WORKFLOW_ID');
    });
  });
});
