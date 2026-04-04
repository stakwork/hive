import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/workspaces/route';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/factories';
import { createTestFiatPayment } from '@/__tests__/support/factories/fiat-payment.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import {
  createAuthenticatedSession,
  getMockedSession,
  generateUniqueSlug,
  createPostRequest,
  expectSuccess,
} from '@/__tests__/support/helpers';

describe('POST /api/workspaces — graph_mindset payment linking', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    testUser = await createTestUser();
  });

  test('links PAID fiat payment and sets paymentStatus to PAID', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const payment = await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'my-graph',
      workspaceSlug: 'my-graph',
    });

    const slug = generateUniqueSlug('graph');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'Graph Workspace',
      slug,
      workspaceKind: 'graph_mindset',
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);

    // Workspace has correct kind and payment status
    expect(data.workspace.workspaceKind).toBe('graph_mindset');

    const workspace = await db.workspace.findUnique({ where: { id: data.workspace.id } });
    expect(workspace!.paymentStatus).toBe('PAID');

    // Payment is linked to workspace
    const updatedPayment = await db.fiatPayment.findUnique({ where: { id: payment.id } });
    expect(updatedPayment!.workspaceId).toBe(data.workspace.id);
  });

  test('falls back to lightning payment when no fiat payment exists', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const lightning = await createTestLightningPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'lightning-graph',
      workspaceSlug: 'lightning-graph',
    });

    const slug = generateUniqueSlug('graph-ln');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'Lightning Graph',
      slug,
      workspaceKind: 'graph_mindset',
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);

    const workspace = await db.workspace.findUnique({ where: { id: data.workspace.id } });
    expect(workspace!.paymentStatus).toBe('PAID');

    const updatedPayment = await db.lightningPayment.findUnique({ where: { id: lightning.id } });
    expect(updatedPayment!.workspaceId).toBe(data.workspace.id);
  });

  test('prefers fiat over lightning when both exist', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const fiat = await createTestFiatPayment({
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

    const slug = generateUniqueSlug('graph-both');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'Both Payment Graph',
      slug,
      workspaceKind: 'graph_mindset',
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);

    // Fiat should be linked, lightning untouched
    const updatedFiat = await db.fiatPayment.findUnique({ where: { id: fiat.id } });
    expect(updatedFiat!.workspaceId).toBe(data.workspace.id);

    const updatedLightning = await db.lightningPayment.findUnique({ where: { id: lightning.id } });
    expect(updatedLightning!.workspaceId).toBeNull();
  });

  test('workspace created with PENDING paymentStatus when no payment exists', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const slug = generateUniqueSlug('graph-nopay');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'No Payment Graph',
      slug,
      workspaceKind: 'graph_mindset',
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);

    const workspace = await db.workspace.findUnique({ where: { id: data.workspace.id } });
    expect(workspace!.paymentStatus).toBe('PENDING');
    expect(workspace!.workspaceKind).toBe('graph_mindset');
  });

  test('does not link payment already attached to another workspace', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const existingWorkspace = await db.workspace.create({
      data: { name: 'existing', slug: generateUniqueSlug('existing'), ownerId: testUser.id },
    });

    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceId: existingWorkspace.id,
      workspaceName: 'used',
      workspaceSlug: 'used',
    });

    const slug = generateUniqueSlug('graph-nolink');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'New Graph',
      slug,
      workspaceKind: 'graph_mindset',
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);

    // No unlinked payment found — paymentStatus stays PENDING
    const workspace = await db.workspace.findUnique({ where: { id: data.workspace.id } });
    expect(workspace!.paymentStatus).toBe('PENDING');
  });

  test('does not link payment when workspaceKind is not graph_mindset', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const payment = await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'regular',
      workspaceSlug: 'regular',
    });

    const slug = generateUniqueSlug('regular-ws');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'Regular Workspace',
      slug,
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);

    // Payment should remain unlinked
    const updatedPayment = await db.fiatPayment.findUnique({ where: { id: payment.id } });
    expect(updatedPayment!.workspaceId).toBeNull();

    const workspace = await db.workspace.findUnique({ where: { id: data.workspace.id } });
    expect(workspace!.paymentStatus).toBe('PENDING');
  });

  test('only links payments belonging to the authenticated user', async () => {
    const otherUser = await createTestUser();
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const otherPayment = await createTestFiatPayment({
      userId: otherUser.id,
      status: 'PAID',
      workspaceName: 'other-user',
      workspaceSlug: 'other-user',
    });

    const slug = generateUniqueSlug('graph-other');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'My Graph',
      slug,
      workspaceKind: 'graph_mindset',
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);

    // Other user's payment stays unlinked
    const untouched = await db.fiatPayment.findUnique({ where: { id: otherPayment.id } });
    expect(untouched!.workspaceId).toBeNull();

    const workspace = await db.workspace.findUnique({ where: { id: data.workspace.id } });
    expect(workspace!.paymentStatus).toBe('PENDING');
  });
});
