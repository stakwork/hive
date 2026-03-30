import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/stripe/webhook/route';
import { db } from '@/lib/db';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestSwarmPayment } from '@/__tests__/support/factories/swarm-payment.factory';
import { NextRequest } from 'next/server';
import type Stripe from 'stripe';

// Mock constructStripeEvent so no real Stripe SDK calls are needed
const mockConstructStripeEvent = vi.fn<() => Stripe.Event>();

vi.mock('@/services/stripe', () => ({
  getStripeClient: vi.fn(),
  constructStripeEvent: (...args: unknown[]) => mockConstructStripeEvent(...args as []),
}));

function buildWebhookRequest(body: string, sig = 'test-sig'): NextRequest {
  return new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': sig,
      'Content-Type': 'application/json',
    },
    body,
  });
}

function buildCheckoutCompletedEvent(
  sessionId: string,
  workspaceId: string,
  paymentIntentId = 'pi_test_abc123',
): Stripe.Event {
  return {
    id: 'evt_test_completed',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_intent: paymentIntentId,
        metadata: { workspaceId },
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

function buildCheckoutExpiredEvent(sessionId: string): Stripe.Event {
  return {
    id: 'evt_test_expired',
    type: 'checkout.session.expired',
    data: {
      object: {
        id: sessionId,
        metadata: {},
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

describe('Stripe Webhook Handler Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/stripe/webhook', () => {
    test('checkout.session.completed: updates SwarmPayment to PAID and Workspace.paymentStatus to PAID', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestSwarmPayment({
        workspaceId: workspace.id,
        stripeSessionId: 'cs_test_completed_session',
        status: 'PENDING',
      });

      const event = buildCheckoutCompletedEvent(
        payment.stripeSessionId,
        workspace.id,
        'pi_test_intent_123',
      );
      mockConstructStripeEvent.mockReturnValue(event);

      const req = buildWebhookRequest(JSON.stringify({}));
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ received: true });

      const updatedPayment = await db.swarmPayment.findUnique({
        where: { stripeSessionId: payment.stripeSessionId },
      });
      expect(updatedPayment!.status).toBe('PAID');
      expect(updatedPayment!.stripePaymentIntentId).toBe('pi_test_intent_123');

      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace!.paymentStatus).toBe('PAID');
    });

    test('checkout.session.expired: updates SwarmPayment to EXPIRED', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestSwarmPayment({
        workspaceId: workspace.id,
        stripeSessionId: 'cs_test_expired_session',
        status: 'PENDING',
      });

      const event = buildCheckoutExpiredEvent(payment.stripeSessionId);
      mockConstructStripeEvent.mockReturnValue(event);

      const req = buildWebhookRequest(JSON.stringify({}));
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ received: true });

      const updatedPayment = await db.swarmPayment.findUnique({
        where: { stripeSessionId: payment.stripeSessionId },
      });
      expect(updatedPayment!.status).toBe('EXPIRED');
    });

    test('returns 401 on invalid Stripe signature', async () => {
      mockConstructStripeEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      const req = buildWebhookRequest('{}', 'bad-sig');
      const response = await POST(req);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid signature');
    });

    test('unknown event type: returns 200 with no DB writes', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestSwarmPayment({
        workspaceId: workspace.id,
        stripeSessionId: 'cs_test_unknown_event_session',
        status: 'PENDING',
      });

      const unknownEvent = {
        id: 'evt_test_unknown',
        type: 'payment_intent.created',
        data: { object: {} },
      } as unknown as Stripe.Event;
      mockConstructStripeEvent.mockReturnValue(unknownEvent);

      const req = buildWebhookRequest(JSON.stringify({}));
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ received: true });

      // Payment record should be unchanged
      const unchanged = await db.swarmPayment.findUnique({
        where: { stripeSessionId: payment.stripeSessionId },
      });
      expect(unchanged!.status).toBe('PENDING');
    });
  });
});
