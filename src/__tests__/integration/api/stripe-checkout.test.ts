import { describe, test, expect, beforeEach, vi } from 'vitest';
import { GET, POST } from '@/app/api/stripe/checkout/route';
import { db } from '@/lib/db';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestUser } from '@/__tests__/support/factories/user.factory';
import {
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
} from '@/__tests__/support/helpers/auth';
import {
  createPostRequest,
  createGetRequest,
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
  });

  describe('POST /api/stripe/checkout', () => {
    test('returns sessionUrl and creates SwarmPayment record with PENDING status', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createPostRequest('/api/stripe/checkout', { workspaceId: workspace.id });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessionUrl).toBe(
        'https://checkout.stripe.com/pay/cs_test_mock_session_id',
      );

      const payment = await db.swarmPayment.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(payment).not.toBeNull();
      expect(payment!.status).toBe('PENDING');
      expect(payment!.stripeSessionId).toBe('cs_test_mock_session_id');
    });

    test('returns 403 when caller is not workspace owner', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonOwner = await createTestUser({ name: 'Non Owner' });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonOwner));

      const req = createPostRequest('/api/stripe/checkout', { workspaceId: workspace.id });
      const response = await POST(req);

      expect(response.status).toBe(403);
    });

    test('returns 409 when workspace is already paid', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Mark workspace as paid
      await db.workspace.update({
        where: { id: workspace.id },
        data: { paymentStatus: 'PAID' },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createPostRequest('/api/stripe/checkout', { workspaceId: workspace.id });
      const response = await POST(req);

      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toBe('Workspace already paid');
    });

    test('returns 401 when unauthenticated', async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const req = createPostRequest('/api/stripe/checkout', {
        workspaceId: 'any-workspace-id',
      });
      const response = await POST(req);

      expect(response.status).toBe(401);
    });

    test('returns 400 when workspaceId is missing', async () => {
      const { owner } = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createPostRequest('/api/stripe/checkout', {});
      const response = await POST(req);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/stripe/checkout', () => {
    test('returns latest SwarmPayment and paymentStatus for workspace owner', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create a payment record
      await db.swarmPayment.create({
        data: {
          workspaceId: workspace.id,
          stripeSessionId: 'cs_test_existing_session',
          status: 'PENDING',
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createGetRequest('/api/stripe/checkout', {
        workspaceId: workspace.id,
      });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.paymentStatus).toBe('PENDING');
      expect(data.payment).not.toBeNull();
      expect(data.payment.stripeSessionId).toBe('cs_test_existing_session');
    });

    test('returns null payment when no records exist', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createGetRequest('/api/stripe/checkout', {
        workspaceId: workspace.id,
      });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.paymentStatus).toBe('PENDING');
      expect(data.payment).toBeNull();
    });

    test('returns 403 for non-owner', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonOwner = await createTestUser({ name: 'Non Owner' });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonOwner));

      const req = createGetRequest('/api/stripe/checkout', {
        workspaceId: workspace.id,
      });
      const response = await GET(req);

      expect(response.status).toBe(403);
    });

    test('returns 401 when unauthenticated', async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const req = createGetRequest('/api/stripe/checkout', {
        workspaceId: 'any-workspace-id',
      });
      const response = await GET(req);

      expect(response.status).toBe(401);
    });
  });
});
