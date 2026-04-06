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

    // Owner WorkspaceMember record created
    const member = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: testUser.id } },
    });
    expect(member).not.toBeNull();
    expect(member!.role).toBe('OWNER');
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

    // Owner WorkspaceMember record created
    const member = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: testUser.id } },
    });
    expect(member).not.toBeNull();
    expect(member!.role).toBe('OWNER');
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

    // Owner WorkspaceMember record created
    const member = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: testUser.id } },
    });
    expect(member).not.toBeNull();
    expect(member!.role).toBe('OWNER');
  });

  test('returns 402 when no PAID payment exists for graph_mindset workspace', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const slug = generateUniqueSlug('graph-nopay');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'No Payment Graph',
      slug,
      workspaceKind: 'graph_mindset',
    });

    const response = await POST(request);
    expect(response.status).toBe(402);

    // Workspace must not have been created
    const workspace = await db.workspace.findFirst({ where: { slug } });
    expect(workspace).toBeNull();
  });

  test('does not link payment already attached to another workspace — returns 402 (no unlinked payment)', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const existingWorkspace = await db.workspace.create({
      data: { name: 'existing', slug: generateUniqueSlug('existing'), ownerId: testUser.id },
    });

    // Payment already linked to another workspace — no unlinked PAID payment available
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
    // Payment gate finds no unlinked PAID payment → 402
    expect(response.status).toBe(402);

    // Workspace must not have been created
    const workspace = await db.workspace.findFirst({ where: { slug } });
    expect(workspace).toBeNull();
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

    // testUser has a PAID payment so the gate passes
    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'my-payment',
      workspaceSlug: 'my-payment',
    });

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
  });

  test('returns 400 when repositoryUrl is not in ONBOARDING_FORK_REPOS', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'repo-check',
      workspaceSlug: 'repo-check',
    });

    vi.stubEnv('ONBOARDING_FORK_REPOS', 'https://github.com/allowed/repo');

    const slug = generateUniqueSlug('graph-badrepo');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'Bad Repo Graph',
      slug,
      workspaceKind: 'graph_mindset',
      repositoryUrl: 'https://github.com/evil/repo',
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    vi.unstubAllEnvs();
  });

  test('accepts repositoryUrl that matches ONBOARDING_FORK_REPOS', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'repo-check-ok',
      workspaceSlug: 'repo-check-ok',
    });

    vi.stubEnv('ONBOARDING_FORK_REPOS', 'https://github.com/allowed/repo');

    const slug = generateUniqueSlug('graph-goodrepo');
    const request = createPostRequest('http://localhost:3000/api/workspaces', {
      name: 'Good Repo Graph',
      slug,
      workspaceKind: 'graph_mindset',
      repositoryUrl: 'https://github.com/allowed/repo',
    });

    const response = await POST(request);
    const data = await expectSuccess(response, 201);
    expect(data.workspace.workspaceKind).toBe('graph_mindset');

    vi.unstubAllEnvs();
  });

  test('concurrent POSTs with same PAID payment — only one workspace links it', async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    await createTestFiatPayment({
      userId: testUser.id,
      status: 'PAID',
      workspaceName: 'concurrent-graph',
      workspaceSlug: 'concurrent-graph',
    });

    const slug1 = generateUniqueSlug('concurrent-a');
    const slug2 = generateUniqueSlug('concurrent-b');

    const [res1, res2] = await Promise.all([
      POST(
        createPostRequest('http://localhost:3000/api/workspaces', {
          name: 'Concurrent Graph A',
          slug: slug1,
          workspaceKind: 'graph_mindset',
        }),
      ),
      POST(
        createPostRequest('http://localhost:3000/api/workspaces', {
          name: 'Concurrent Graph B',
          slug: slug2,
          workspaceKind: 'graph_mindset',
        }),
      ),
    ]);

    const statuses = [res1.status, res2.status];

    // Exactly one request wins the payment CAS (201); the other loses (402)
    expect(statuses).toContain(201);
    expect(statuses).toContain(402);

    // Exactly one workspace was created and it has paymentStatus PAID
    const workspaces = await db.workspace.findMany({
      where: { slug: { in: [slug1, slug2] } },
    });
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].paymentStatus).toBe('PAID');
  });
});
