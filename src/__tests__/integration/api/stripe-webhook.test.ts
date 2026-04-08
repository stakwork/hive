import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/stripe/webhook/route';
import { db } from '@/lib/db';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestFiatPayment } from '@/__tests__/support/factories/fiat-payment.factory';
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
  amountTotal = 2000,
  currency = 'usd',
): Stripe.Event {
  return {
    id: 'evt_test_completed',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_intent: paymentIntentId,
        amount_total: amountTotal,
        currency,
        metadata: { workspaceId },
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

function buildPaymentFailedEvent(
  paymentIntentId: string,
  declineCode = 'insufficient_funds',
  message = 'Your card has insufficient funds.',
): Stripe.Event {
  return {
    id: 'evt_test_failed',
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: paymentIntentId,
        last_payment_error: { decline_code: declineCode, code: declineCode, message },
      } as unknown as Stripe.PaymentIntent,
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
    test('checkout.session.completed: updates FiatPayment to PAID', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestFiatPayment({
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

      const updatedPayment = await db.fiatPayment.findUnique({
        where: { stripeSessionId: payment.stripeSessionId },
      });
      expect(updatedPayment!.status).toBe('PAID');
      expect(updatedPayment!.stripePaymentIntentId).toBe('pi_test_intent_123');
    });

    test('checkout.session.expired: updates FiatPayment to EXPIRED', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestFiatPayment({
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

      const updatedPayment = await db.fiatPayment.findUnique({
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

    test('payment_intent.payment_failed: updates FiatPayment to FAILED with failureCode/failureMessage', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestFiatPayment({
        workspaceId: workspace.id,
        stripePaymentIntentId: 'pi_test_declined',
        status: 'PENDING',
      });

      const event = buildPaymentFailedEvent('pi_test_declined');
      mockConstructStripeEvent.mockReturnValue(event);

      const req = buildWebhookRequest(JSON.stringify({}));
      const response = await POST(req);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });

      const updatedPayment = await db.fiatPayment.findUnique({
        where: { id: payment.id },
      });
      expect(updatedPayment!.status).toBe('FAILED');
      expect(updatedPayment!.failureCode).toBe('insufficient_funds');
      expect(updatedPayment!.failureMessage).toBe('Your card has insufficient funds.');
    });

    test('payment_intent.payment_failed: does not downgrade a PAID FiatPayment to FAILED', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestFiatPayment({
        workspaceId: workspace.id,
        stripePaymentIntentId: 'pi_test_already_paid',
        status: 'PAID',
      });

      const event = buildPaymentFailedEvent('pi_test_already_paid');
      mockConstructStripeEvent.mockReturnValue(event);

      const req = buildWebhookRequest(JSON.stringify({}));
      const response = await POST(req);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });

      const unchanged = await db.fiatPayment.findUnique({ where: { id: payment.id } });
      expect(unchanged!.status).toBe('PAID');
    });

    test('payment_intent.payment_failed: no matching FiatPayment returns 200 with no DB writes', async () => {
      const event = buildPaymentFailedEvent('pi_unknown_intent_xyz');
      mockConstructStripeEvent.mockReturnValue(event);

      const req = buildWebhookRequest(JSON.stringify({}));
      const response = await POST(req);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });

      // Confirm no FiatPayment was created or modified
      const payment = await db.fiatPayment.findFirst({
        where: { stripePaymentIntentId: 'pi_unknown_intent_xyz' },
      });
      expect(payment).toBeNull();
    });

    test('unknown event type: returns 200 with no DB writes', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestFiatPayment({
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
      const unchanged = await db.fiatPayment.findUnique({
        where: { stripeSessionId: payment.stripeSessionId },
      });
      expect(unchanged!.status).toBe('PENDING');
    });
  });
});
