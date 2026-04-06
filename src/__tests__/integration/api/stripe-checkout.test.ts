import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/stripe/checkout/route';
import { getStripeClient } from '@/services/stripe';
import {
  createPostRequest,
} from '@/__tests__/support/helpers/request-builders';
import { db } from '@/lib/db';
import { upsertTestPlatformConfig } from '@/__tests__/support/factories';

// Mock Stripe service so no real API calls are made
vi.mock('@/services/stripe', () => ({
  getStripeClient: vi.fn(() => ({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_mock_session_id',
          url: 'https://checkout.stripe.com/pay/cs_test_mock_session_id',
        }),
      },
    },
  })),
  constructStripeEvent: vi.fn(),
}));

describe('Stripe Checkout API Integration Tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SUCCESS_URL', 'https://example.com/success');
    vi.stubEnv('STRIPE_CANCEL_URL', 'https://example.com/cancel');
    await upsertTestPlatformConfig('hiveAmountUsd', '50');
  });

  afterEach(async () => {
    await db.fiatPayment.deleteMany({
      where: {
        OR: [
          { stripeSessionId: 'cs_test_mock_session_id' },
          { workspaceSlug: 'my-graph' },
          { workspaceSlug: 'my-hive' },
        ],
      },
    });
  });

  describe('POST /api/stripe/checkout', () => {
    test('returns sessionUrl and sessionId for valid name and slug (no auth required)', async () => {
      const req = createPostRequest('/api/stripe/checkout', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessionUrl).toBe('https://checkout.stripe.com/pay/cs_test_mock_session_id');
      expect(data.sessionId).toBe('cs_test_mock_session_id');
    });

    test('returns 400 when workspaceName is missing', async () => {
      const req = createPostRequest('/api/stripe/checkout', { workspaceSlug: 'my-graph' });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    test('returns 400 when workspaceSlug is missing', async () => {
      const req = createPostRequest('/api/stripe/checkout', { workspaceName: 'My Graph' });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    test('returns 400 when body is empty', async () => {
      const req = createPostRequest('/api/stripe/checkout', {});
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    test('creates a PENDING FiatPayment with session ID, workspaceName, and workspaceSlug on success', async () => {
      const req = createPostRequest('/api/stripe/checkout', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);
      expect(response.status).toBe(200);

      const payment = await db.fiatPayment.findUnique({
        where: { stripeSessionId: 'cs_test_mock_session_id' },
      });
      expect(payment).not.toBeNull();
      expect(payment!.status).toBe('PENDING');
      expect(payment!.workspaceName).toBe('My Graph');
      expect(payment!.workspaceSlug).toBe('my-graph');
      expect(payment!.workspaceId).toBeNull();
      expect(payment!.password).toBeTruthy();
    });

    test('forwards workspaceType and repositoryUrl into Stripe session metadata when provided', async () => {
      const req = createPostRequest('/api/stripe/checkout', {
        workspaceName: 'My Hive',
        workspaceSlug: 'my-hive',
        workspaceType: 'hive',
        repositoryUrl: 'https://github.com/org/my-repo',
      });
      const response = await POST(req);

      expect(response.status).toBe(200);

      // Use the client instance the route actually received (factory returns a new object per call)
      const stripe = vi.mocked(getStripeClient).mock.results[0].value;
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            workspaceType: 'hive',
            repositoryUrl: 'https://github.com/org/my-repo',
          }),
        })
      );
    });

    test('workspaceType and repositoryUrl default to empty string when not provided', async () => {
      const req = createPostRequest('/api/stripe/checkout', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);

      expect(response.status).toBe(200);

      // Use the client instance the route actually received (factory returns a new object per call)
      const stripe = vi.mocked(getStripeClient).mock.results[0].value;
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            workspaceType: '',
            repositoryUrl: '',
          }),
        })
      );
    });

    test('creates a PENDING FiatPayment with stripe_failed_<uuid> when Stripe is down, still returns 500', async () => {
      vi.mocked(getStripeClient).mockReturnValueOnce({
        checkout: { sessions: { create: vi.fn().mockRejectedValue(new Error('Stripe down')) } },
      } as any);

      const req = createPostRequest('/api/stripe/checkout', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);
      expect(response.status).toBe(500);

      const payments = await db.fiatPayment.findMany({
        where: { workspaceSlug: 'my-graph' },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0].stripeSessionId).toMatch(/^stripe_failed_/);
      expect(payments[0].status).toBe('PENDING');
      expect(payments[0].workspaceName).toBe('My Graph');
      expect(payments[0].workspaceId).toBeNull();
      expect(payments[0].password).toBeTruthy();
    });

    test('uses price_data with unit_amount equal to hiveAmountUsd * 100 in Stripe session', async () => {
      await upsertTestPlatformConfig('hiveAmountUsd', '75');

      const req = createPostRequest('/api/stripe/checkout', {
        workspaceName: 'My Hive',
        workspaceSlug: 'my-hive',
      });
      const response = await POST(req);
      expect(response.status).toBe(200);

      const stripe = vi.mocked(getStripeClient).mock.results[0].value;
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              price_data: expect.objectContaining({
                currency: 'usd',
                unit_amount: 7500,
                product_data: { name: 'Hive Environment' },
              }),
              quantity: 1,
            }),
          ],
        })
      );
    });

    test('returns 503 when hiveAmountUsd PlatformConfig record is missing', async () => {
      await db.platformConfig.deleteMany({ where: { key: 'hiveAmountUsd' } });

      const req = createPostRequest('/api/stripe/checkout', {
        workspaceName: 'My Hive',
        workspaceSlug: 'my-hive',
      });
      const response = await POST(req);
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe('Payment price not configured');
    });
  });
});
