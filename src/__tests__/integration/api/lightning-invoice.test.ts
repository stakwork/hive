import { describe, test, expect, beforeEach, vi } from 'vitest';
import { GET, POST } from '@/app/api/lightning/invoice/route';
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
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';

// Mock LND service so no real API calls are made
vi.mock('@/services/lightning', () => ({
  createLndInvoice: vi.fn().mockResolvedValue({
    payment_hash: 'mock_hash_abc123',
    payment_request: 'lnbc1000umock_invoice_abc123',
  }),
}));

describe('Lightning Invoice API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/lightning/invoice', () => {
    test('creates LightningPayment record with UNPAID status and returns invoice', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createPostRequest('/api/lightning/invoice', {
        workspaceId: workspace.id,
        amount: 1000,
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.invoice).toBe('lnbc1000umock_invoice_abc123');
      expect(data.paymentHash).toBe('mock_hash_abc123');
      expect(data.amount).toBe(1000);

      const payment = await db.lightningPayment.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(payment).not.toBeNull();
      expect(payment!.status).toBe('UNPAID');
      expect(payment!.paymentHash).toBe('mock_hash_abc123');
      expect(payment!.invoice).toBe('lnbc1000umock_invoice_abc123');
      expect(payment!.amount).toBe(1000);
    });

    test('returns 400 when workspaceId is missing', async () => {
      const { owner } = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createPostRequest('/api/lightning/invoice', { amount: 1000 });
      const response = await POST(req);

      expect(response.status).toBe(400);
    });

    test('returns 400 when amount is missing', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createPostRequest('/api/lightning/invoice', { workspaceId: workspace.id });
      const response = await POST(req);

      expect(response.status).toBe(400);
    });

    test('returns 401 when unauthenticated', async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const req = createPostRequest('/api/lightning/invoice', {
        workspaceId: 'any-workspace-id',
        amount: 1000,
      });
      const response = await POST(req);

      expect(response.status).toBe(401);
    });

    test('returns 403 when caller is not workspace owner', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonOwner = await createTestUser({ name: 'Non Owner' });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonOwner));

      const req = createPostRequest('/api/lightning/invoice', {
        workspaceId: workspace.id,
        amount: 1000,
      });
      const response = await POST(req);

      expect(response.status).toBe(403);
    });

    test('returns 404 when workspace not found', async () => {
      const { owner } = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createPostRequest('/api/lightning/invoice', {
        workspaceId: 'nonexistent-workspace-id',
        amount: 1000,
      });
      const response = await POST(req);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/lightning/invoice', () => {
    test('returns latest LightningPayment for workspace owner', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'hash_older',
        amount: 500,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      });
      await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'hash_latest',
        amount: 1000,
        createdAt: new Date('2024-01-02T00:00:00Z'),
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createGetRequest('/api/lightning/invoice', { workspaceId: workspace.id });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.payment).not.toBeNull();
      expect(data.payment.paymentHash).toBe('hash_latest');
      expect(data.payment.amount).toBe(1000);
    });

    test('returns null payment when no records exist', async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const req = createGetRequest('/api/lightning/invoice', { workspaceId: workspace.id });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.payment).toBeNull();
    });

    test('returns 401 when unauthenticated', async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const req = createGetRequest('/api/lightning/invoice', {
        workspaceId: 'any-workspace-id',
      });
      const response = await GET(req);

      expect(response.status).toBe(401);
    });

    test('returns 403 for non-owner', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonOwner = await createTestUser({ name: 'Non Owner' });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonOwner));

      const req = createGetRequest('/api/lightning/invoice', { workspaceId: workspace.id });
      const response = await GET(req);

      expect(response.status).toBe(403);
    });
  });
});
