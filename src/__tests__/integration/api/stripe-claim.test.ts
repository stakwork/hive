import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/stripe/claim/route';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/factories';
import { createTestFiatPayment } from '@/__tests__/support/factories/fiat-payment.factory';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';

// Mock next-auth
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

// Mock Stripe client
const mockRetrieveSession = vi.fn();

vi.mock('@/services/stripe', () => ({
  getStripeClient: vi.fn(() => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => mockRetrieveSession(...args),
      },
    },
  })),
}));

function buildClaimRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/stripe/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildPaidStripeSession(
  sessionId: string,
  paymentIntentId = 'pi_test_intent_123',
  extraMetadata: Record<string, string> = {},
) {
  return {
    id: sessionId,
    payment_status: 'paid',
    payment_intent: paymentIntentId,
    metadata: { workspaceName: 'Test Workspace', workspaceSlug: 'test-workspace', ...extraMetadata },
  };
}

describe('Stripe Claim Route Integration Tests', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    testUser = await createTestUser();
  });

  describe('POST /api/stripe/claim', () => {
    test('returns 401 when unauthenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const req = buildClaimRequest({ sessionId: 'cs_test_123' });
      const response = await POST(req);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    test('returns 400 when no sessionId in body or cookie', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      // Empty body and no cookie
      const req = buildClaimRequest({});
      const response = await POST(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('No payment session found');
    });

    test('returns 400 when Stripe session retrieval throws', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      mockRetrieveSession.mockRejectedValue(new Error('No such checkout.session'));

      const req = buildClaimRequest({ sessionId: 'cs_test_invalid' });
      const response = await POST(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid payment session');
    });

    test('returns 402 when payment_status is not paid', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      mockRetrieveSession.mockResolvedValue({
        id: 'cs_test_unpaid',
        payment_status: 'unpaid',
        payment_intent: null,
        metadata: {},
      });

      const req = buildClaimRequest({ sessionId: 'cs_test_unpaid' });
      const response = await POST(req);

      expect(response.status).toBe(402);
      const data = await response.json();
      expect(data.error).toBe('Payment not completed');
    });

    test('first call: creates FiatPayment with status PAID and workspaceId null, returns { payment }', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const sessionId = `cs_test_claim_first_${Date.now()}`;
      mockRetrieveSession.mockResolvedValue(buildPaidStripeSession(sessionId, 'pi_test_first_123'));

      const req = buildClaimRequest({ sessionId });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.payment).toBeDefined();
      expect(data.payment.status).toBe('PAID');
      expect(data.payment.workspaceId).toBeNull();
      expect(data.payment.stripeSessionId).toBe(sessionId);
      expect(data.payment.stripePaymentIntentId).toBe('pi_test_first_123');

      // Verify DB record
      const dbPayment = await db.fiatPayment.findUnique({ where: { stripeSessionId: sessionId } });
      expect(dbPayment).not.toBeNull();
      expect(dbPayment!.status).toBe('PAID');
      expect(dbPayment!.workspaceId).toBeNull();
    });

    test('idempotency: second call with same sessionId returns existing FiatPayment without duplicate', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const sessionId = `cs_test_claim_idem_${Date.now()}`;
      mockRetrieveSession.mockResolvedValue(buildPaidStripeSession(sessionId, 'pi_test_idem_456'));

      // First call
      const req1 = buildClaimRequest({ sessionId });
      const response1 = await POST(req1);
      expect(response1.status).toBe(200);
      const data1 = await response1.json();
      const firstPaymentId = data1.payment.id;
      expect(data1.payment.status).toBe('PAID');

      // Second call — already PAID so idempotency short-circuits before Stripe
      const req2 = buildClaimRequest({ sessionId });
      const response2 = await POST(req2);
      expect(response2.status).toBe(200);
      const data2 = await response2.json();

      // Same payment record returned
      expect(data2.payment.id).toBe(firstPaymentId);
      expect(data2.payment.status).toBe('PAID');
      expect(data2.payment.workspaceId).toBeNull();

      // Only one DB record exists
      const allPayments = await db.fiatPayment.findMany({ where: { stripeSessionId: sessionId } });
      expect(allPayments).toHaveLength(1);

      // Stripe is called on every request (needed to read metadata for response)
      expect(mockRetrieveSession).toHaveBeenCalledTimes(2);
    });

    test('updates existing PENDING FiatPayment to PAID when checkout record already exists', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const sessionId = `cs_test_claim_update_${Date.now()}`;
      // Pre-create the PENDING record as checkout would (with encrypted password)
      const pendingPayment = await createTestFiatPayment({
        stripeSessionId: sessionId,
        workspaceName: 'Test Workspace',
        workspaceSlug: 'test-workspace',
        status: 'PENDING',
        workspaceId: undefined,
      });

      mockRetrieveSession.mockResolvedValue(buildPaidStripeSession(sessionId, 'pi_test_update_789'));

      const req = buildClaimRequest({ sessionId });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Same record updated, not a new one
      expect(data.payment.id).toBe(pendingPayment.id);
      expect(data.payment.status).toBe('PAID');
      expect(data.payment.stripePaymentIntentId).toBe('pi_test_update_789');
      expect(data.payment.workspaceId).toBeNull();

      // No duplicates
      const allPayments = await db.fiatPayment.findMany({ where: { stripeSessionId: sessionId } });
      expect(allPayments).toHaveLength(1);
    });

    test('returns workspaceType and repositoryUrl from Stripe metadata when present (hive flow)', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const sessionId = `cs_test_claim_hive_${Date.now()}`;
      mockRetrieveSession.mockResolvedValue(
        buildPaidStripeSession(sessionId, 'pi_test_hive_123', {
          workspaceType: 'hive',
          repositoryUrl: 'https://github.com/org/my-repo',
        })
      );

      const req = buildClaimRequest({ sessionId });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.payment).toBeDefined();
      expect(data.workspaceType).toBe('hive');
      expect(data.repositoryUrl).toBe('https://github.com/org/my-repo');
    });

    test('returns 403 when a different user tries to claim an already-claimed payment', async () => {
      const otherUser = await createTestUser();

      // First user claims
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const sessionId = `cs_test_cross_user_${Date.now()}`;
      mockRetrieveSession.mockResolvedValue(buildPaidStripeSession(sessionId, 'pi_cross_user'));

      const req1 = buildClaimRequest({ sessionId });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      // Second user tries to claim the same session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: otherUser.id, email: otherUser.email, name: otherUser.name },
      } as any);

      const req2 = buildClaimRequest({ sessionId });
      const res2 = await POST(req2);

      expect(res2.status).toBe(403);
      const data = await res2.json();
      expect(data.error).toMatch(/already claimed/i);

      // Cookie must be cleared to prevent infinite retry loops
      const setCookie = res2.headers.get('set-cookie');
      expect(setCookie).toMatch(/stripe_session_id=;/);

      // Original user's claim should be untouched
      const payment = await db.fiatPayment.findUnique({ where: { stripeSessionId: sessionId } });
      expect(payment!.userId).toBe(testUser.id);
    });

    test('returns 403 when claiming a PENDING payment already owned by another user', async () => {
      const otherUser = await createTestUser();

      const sessionId = `cs_test_pending_owned_${Date.now()}`;
      await createTestFiatPayment({
        stripeSessionId: sessionId,
        status: 'PENDING',
        userId: otherUser.id,
        workspaceName: 'Owned Pending',
        workspaceSlug: 'owned-pending',
      });

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      mockRetrieveSession.mockResolvedValue(buildPaidStripeSession(sessionId, 'pi_owned'));

      const req = buildClaimRequest({ sessionId });
      const response = await POST(req);

      expect(response.status).toBe(403);

      // Cookie must be cleared to prevent infinite retry loops
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toMatch(/stripe_session_id=;/);

      // Payment userId unchanged
      const payment = await db.fiatPayment.findUnique({ where: { stripeSessionId: sessionId } });
      expect(payment!.userId).toBe(otherUser.id);
    });

    test('concurrent claims: only one user succeeds, the other gets 403', async () => {
      const userA = testUser;
      const userB = await createTestUser();

      const sessionId = `cs_test_concurrent_${Date.now()}`;
      // Pre-create PENDING record as checkout would
      await createTestFiatPayment({
        stripeSessionId: sessionId,
        workspaceName: 'Concurrent Workspace',
        workspaceSlug: 'concurrent-ws',
        status: 'PENDING',
        workspaceId: undefined,
      });

      mockRetrieveSession.mockResolvedValue(
        buildPaidStripeSession(sessionId, 'pi_concurrent_123')
      );

      // Simulate two concurrent requests from different users
      const [resA, resB] = await Promise.all([
        (async () => {
          vi.mocked(getServerSession).mockResolvedValueOnce({
            user: { id: userA.id, email: userA.email, name: userA.name },
          } as any);
          const req = buildClaimRequest({ sessionId });
          return POST(req);
        })(),
        (async () => {
          vi.mocked(getServerSession).mockResolvedValueOnce({
            user: { id: userB.id, email: userB.email, name: userB.name },
          } as any);
          const req = buildClaimRequest({ sessionId });
          return POST(req);
        })(),
      ]);

      const statuses = [resA.status, resB.status].sort();
      // Exactly one succeeds (200) and one is rejected (403)
      expect(statuses).toEqual([200, 403]);

      // The payment must be linked to exactly one user
      const payment = await db.fiatPayment.findUnique({ where: { stripeSessionId: sessionId } });
      expect(payment!.userId).not.toBeNull();
      expect([userA.id, userB.id]).toContain(payment!.userId);
      expect(payment!.status).toBe('PAID');
    });

    test('returns null for workspaceType and repositoryUrl when absent (GraphMindset / legacy sessions)', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
      } as any);

      const sessionId = `cs_test_claim_gm_${Date.now()}`;
      mockRetrieveSession.mockResolvedValue(
        buildPaidStripeSession(sessionId, 'pi_test_gm_123')
      );

      const req = buildClaimRequest({ sessionId });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.payment).toBeDefined();
      expect(data.workspaceType).toBeNull();
      expect(data.repositoryUrl).toBeNull();
    });
  });
});
