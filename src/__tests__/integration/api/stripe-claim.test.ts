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
) {
  return {
    id: sessionId,
    payment_status: 'paid',
    payment_intent: paymentIntentId,
    metadata: { workspaceName: 'Test Workspace', workspaceSlug: 'test-workspace' },
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

      // Stripe was only called once (idempotency skips it on second call)
      expect(mockRetrieveSession).toHaveBeenCalledTimes(1);
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
  });
});
