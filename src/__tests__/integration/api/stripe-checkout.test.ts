import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/stripe/checkout/route';
import {
  createPostRequest,
} from '@/__tests__/support/helpers/request-builders';

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SUCCESS_URL', 'https://example.com/success');
    vi.stubEnv('STRIPE_CANCEL_URL', 'https://example.com/cancel');
    vi.stubEnv('STRIPE_PRICE_ID', 'price_test_123');
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
  });
});
