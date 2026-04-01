import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/lightning/claim/route';
import { db } from '@/lib/db';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestUser } from '@/__tests__/support/factories/user.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import { createTestWorkspaceTransaction } from '@/__tests__/support/factories/workspace-transaction.factory';
import {
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
} from '@/__tests__/support/helpers/auth';
import { createPostRequest } from '@/__tests__/support/helpers/request-builders';

const mockCreateSwarm = vi.fn();

vi.mock('@/services/swarm', () => ({
  SwarmService: vi.fn().mockImplementation(() => ({
    createSwarm: mockCreateSwarm,
  })),
}));

vi.mock('@/services/swarm/db', () => ({
  saveOrUpdateSwarm: vi.fn().mockResolvedValue({}),
}));

describe('Lightning Claim API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSwarm.mockResolvedValue({
      data: {
        swarm_id: 'mock-swarm-id',
        address: 'mock.swarm.address',
        x_api_key: 'mock-api-key',
        ec2_id: 'mock-ec2-id',
      },
    });
  });

  describe('POST /api/lightning/claim', () => {
    test('returns 401 when unauthenticated', async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: 'any-hash',
        password: 'any-password',
      });
      const response = await POST(req);
      expect(response.status).toBe(401);
    });

    test('returns 404 for unknown paymentHash', async () => {
      const user = await createTestUser({ name: 'Claimant' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: 'nonexistent-hash-xyz',
        password: 'my-password',
      });
      const response = await POST(req);
      expect(response.status).toBe(404);
    });

    test('returns 402 when invoice status is UNPAID', async () => {
      const user = await createTestUser({ name: 'Claimant' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const payment = await createTestLightningPayment({
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph-unpaid',
        paymentHash: 'claim_test_unpaid_hash',
        status: 'UNPAID',
      });

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: payment.paymentHash,
        password: 'my-password',
      });
      const response = await POST(req);
      expect(response.status).toBe(402);
    });

    test('creates workspace and updates payment on successful claim', async () => {
      const user = await createTestUser({ name: 'Claimant' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const payment = await createTestLightningPayment({
        workspaceName: 'Lightning Workspace',
        workspaceSlug: 'lightning-ws',
        paymentHash: 'claim_test_paid_hash',
        status: 'PAID',
      });

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: payment.paymentHash,
        password: 'my-password',
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.workspace).toBeDefined();
      expect(data.workspace.name).toBe('Lightning Workspace');

      // Verify LightningPayment updated with workspaceId
      const updatedPayment = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(updatedPayment!.workspaceId).toBe(data.workspace.id);

      // Verify workspace paymentStatus is PAID
      const workspace = await db.workspace.findUnique({ where: { id: data.workspace.id } });
      expect(workspace!.paymentStatus).toBe('PAID');
    });

    test('backfills workspaceId on existing WorkspaceTransaction after successful claim', async () => {
      const user = await createTestUser({ name: 'Claimant Backfill' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const payment = await createTestLightningPayment({
        workspaceName: 'Backfill Workspace',
        workspaceSlug: 'backfill-ws',
        paymentHash: 'claim_test_backfill_hash',
        status: 'PAID',
      });

      // Simulate a transaction created at webhook time (workspaceId is null)
      await createTestWorkspaceTransaction({
        lightningPaymentId: payment.id,
        type: 'LIGHTNING',
        amountSats: payment.amount,
        workspaceId: null,
      });

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: payment.paymentHash,
        password: 'my-password',
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.workspace).toBeDefined();

      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.workspaceId).toBe(data.workspace.id);
    });

    test('returns existing workspace for already-claimed invoice (idempotency)', async () => {
      const user = await createTestUser({ name: 'Claimant Idempotent' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { workspace: existingWorkspace } = await createTestWorkspaceScenario();

      const payment = await createTestLightningPayment({
        workspaceId: existingWorkspace.id,
        workspaceName: 'Already Claimed',
        workspaceSlug: 'already-claimed',
        paymentHash: 'claim_test_already_claimed_hash',
        status: 'PAID',
      });

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: payment.paymentHash,
        password: 'my-password',
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.workspace.id).toBe(existingWorkspace.id);
    });

    test('returns 400 when paymentHash is missing', async () => {
      const user = await createTestUser({ name: 'Claimant' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const req = createPostRequest('/api/lightning/claim', {
        password: 'my-password',
      });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });
  });
});
