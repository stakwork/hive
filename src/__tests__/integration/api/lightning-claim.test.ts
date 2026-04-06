import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/lightning/claim/route';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/factories/user.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import { createTestWorkspaceTransaction } from '@/__tests__/support/factories/workspace-transaction.factory';
import {
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
} from '@/__tests__/support/helpers/auth';
import { createPostRequest } from '@/__tests__/support/helpers/request-builders';

describe('Lightning Claim API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/lightning/claim', () => {
    test('returns 401 when unauthenticated', async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: 'any-hash',
      });
      const response = await POST(req);
      expect(response.status).toBe(401);
    });

    test('returns 404 for unknown paymentHash', async () => {
      const user = await createTestUser({ name: 'Claimant' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: 'nonexistent-hash-xyz',
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
      });
      const response = await POST(req);
      expect(response.status).toBe(402);
    });

    test('links userId on payment and returns redirect on successful claim', async () => {
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
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.redirect).toBe('/onboarding/graphmindset?paymentType=lightning');

      // Verify LightningPayment updated with userId
      const updatedPayment = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(updatedPayment!.userId).toBe(user.id);
    });

    test('links userId on payment and returns redirect even when a WorkspaceTransaction exists', async () => {
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
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.redirect).toBe('/onboarding/graphmindset?paymentType=lightning');

      const updatedPayment = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(updatedPayment!.userId).toBe(user.id);
    });

    test('returns redirect immediately for already-claimed invoice (idempotency)', async () => {
      const user = await createTestUser({ name: 'Claimant Idempotent' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const payment = await createTestLightningPayment({
        userId: user.id,
        workspaceName: 'Already Claimed',
        workspaceSlug: 'already-claimed',
        paymentHash: 'claim_test_already_claimed_hash',
        status: 'PAID',
      });

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: payment.paymentHash,
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.redirect).toBe('/onboarding/graphmindset?paymentType=lightning');
    });

    test('returns 403 when a different user tries to claim an already-claimed payment', async () => {
      const originalUser = await createTestUser({ name: 'Original Claimant' });
      const thief = await createTestUser({ name: 'Thief' });

      const payment = await createTestLightningPayment({
        userId: originalUser.id,
        workspaceName: 'Stolen Attempt',
        workspaceSlug: 'stolen-attempt',
        paymentHash: 'claim_test_cross_user_hash',
        status: 'PAID',
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(thief));

      const req = createPostRequest('/api/lightning/claim', {
        paymentHash: payment.paymentHash,
      });
      const response = await POST(req);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toMatch(/already claimed/i);

      // Original userId unchanged
      const unchanged = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(unchanged!.userId).toBe(originalUser.id);
    });

    test('returns 400 when paymentHash is missing', async () => {
      const user = await createTestUser({ name: 'Claimant' });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const req = createPostRequest('/api/lightning/claim', {});
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    test('concurrent claims: only one user succeeds, the other gets 403', async () => {
      const userA = await createTestUser({ name: 'Concurrent User A' });
      const userB = await createTestUser({ name: 'Concurrent User B' });

      const payment = await createTestLightningPayment({
        workspaceName: 'Concurrent Workspace',
        workspaceSlug: 'concurrent-ws',
        paymentHash: 'claim_test_concurrent_hash',
        status: 'PAID',
      });

      // Simulate two concurrent requests from different users
      const [resA, resB] = await Promise.all([
        (async () => {
          getMockedSession().mockResolvedValueOnce(createAuthenticatedSession(userA));
          const req = createPostRequest('/api/lightning/claim', { paymentHash: payment.paymentHash });
          return POST(req);
        })(),
        (async () => {
          getMockedSession().mockResolvedValueOnce(createAuthenticatedSession(userB));
          const req = createPostRequest('/api/lightning/claim', { paymentHash: payment.paymentHash });
          return POST(req);
        })(),
      ]);

      const statuses = [resA.status, resB.status].sort();
      // Exactly one succeeds (200) and one is rejected (403)
      expect(statuses).toEqual([200, 403]);

      // The payment must be linked to exactly one user
      const updated = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(updated!.userId).not.toBeNull();
      expect([userA.id, userB.id]).toContain(updated!.userId);
    });
  });
});
