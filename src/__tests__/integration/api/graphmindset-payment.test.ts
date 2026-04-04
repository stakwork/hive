import { describe, test, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/graphmindset/payment/route';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/factories';
import { createTestFiatPayment } from '@/__tests__/support/factories/fiat-payment.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import {
  createAuthenticatedSession,
  getMockedSession,
} from '@/__tests__/support/helpers';
import { NextRequest } from 'next/server';

function buildGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/graphmindset/payment');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url);
}

describe('GET /api/graphmindset/payment', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    testUser = await createTestUser();
  });

  test('returns 401 when unauthenticated', async () => {
    getMockedSession().mockResolvedValue(null);

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  test('returns PAID fiat payment with no workspace linked', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const payment = await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'my-graph',
      workspaceSlug: 'my-graph',
    });

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.payment).toMatchObject({
      id: payment.id,
      workspaceName: 'my-graph',
      workspaceSlug: 'my-graph',
      status: 'PAID',
    });
  });

  test('returns most recent PAID fiat payment when multiple exist', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'old-graph',
      workspaceSlug: 'old-graph',
    });

    // Small delay to ensure ordering
    const newer = await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'new-graph',
      workspaceSlug: 'new-graph',
    });

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.payment.id).toBe(newer.id);
    expect(data.payment.workspaceName).toBe('new-graph');
  });

  test('skips fiat payments already linked to a workspace', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const workspace = await db.workspace.create({
      data: { name: 'linked', slug: `linked-${Date.now()}`, ownerId: testUser.id },
    });

    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceId: workspace.id,
      workspaceName: 'linked',
      workspaceSlug: 'linked',
    });

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('No pending payment found');
  });

  test('falls back to lightning payment when no fiat payment exists (no type param)', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const lightning = await createTestLightningPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'lightning-graph',
      workspaceSlug: 'lightning-graph',
    });

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.payment.id).toBe(lightning.id);
    expect(data.payment.workspaceName).toBe('lightning-graph');
  });

  test('type=fiat returns 404 when no fiat payment exists (no lightning fallback)', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    await createTestLightningPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'lightning-only',
      workspaceSlug: 'lightning-only',
    });

    const response = await GET(buildGetRequest({ type: 'fiat' }));

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('No pending payment found');
  });

  test('type=lightning returns lightning payment directly', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    // Create both types — lightning filter should skip fiat
    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'fiat-graph',
      workspaceSlug: 'fiat-graph',
    });

    const lightning = await createTestLightningPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'lightning-graph',
      workspaceSlug: 'lightning-graph',
    });

    const response = await GET(buildGetRequest({ type: 'lightning' }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.payment.id).toBe(lightning.id);
  });

  test('returns 404 when no payments exist for user', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('No pending payment found');
  });

  test('ignores PENDING fiat payments', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PENDING',
      workspaceName: 'pending-graph',
      workspaceSlug: 'pending-graph',
    });

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(404);
  });

  test('does not return payments belonging to a different user', async () => {
    const otherUser = await createTestUser();

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    await createTestFiatPayment({
      userId: otherUser.id,
      status: 'PAID',
      workspaceName: 'other-graph',
      workspaceSlug: 'other-graph',
    });

    const response = await GET(buildGetRequest());

    expect(response.status).toBe(404);
  });
});
