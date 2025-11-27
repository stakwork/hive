import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/features/check-duplicates/route';
import { NextRequest } from 'next/server';

// Mock NextAuth
const mockSession = {
  user: {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

// Mock getServerSession
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions
vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

describe('POST /api/features/check-duplicates', () => {
  let testWorkspaceId: string;
  let testUserId: string;

  beforeEach(async () => {
    // Create test user
    const user = await db.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
      },
    });
    testUserId = user.id;

    // Create test workspace
    const workspace = await db.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: 'test-workspace',
        ownerId: testUserId,
      },
    });
    testWorkspaceId = workspace.id;

    // Add user as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        role: 'OWNER',
      },
    });

    // Set mock session with test user
    vi.mocked(getServerSession).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, id: testUserId },
    } as any);
  });

  afterEach(async () => {
    // Clean up test data
    await db.feature.deleteMany({ where: { workspaceId: testWorkspaceId } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspaceId } });
    await db.workspace.deleteMany({ where: { id: testWorkspaceId } });
    await db.user.deleteMany({ where: { id: testUserId } });
    vi.clearAllMocks();
  });

  it('should return 401 when user is not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'Test Feature',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Unauthorized');
  });

  it('should return 400 when workspaceId is missing', async () => {
    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Feature',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('workspaceId is required');
  });

  it('should return 400 when title is missing', async () => {
    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('title is required');
  });

  it('should return 400 when title is empty string', async () => {
    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: '   ',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('title is required');
  });

  it('should return 403 when user does not have workspace access', async () => {
    // Create another user who will own the workspace
    const otherUser = await db.user.create({
      data: {
        email: 'other-owner@example.com',
        name: 'Other Owner',
      },
    });

    // Create another workspace owned by different user without adding testUser as member
    const otherWorkspace = await db.workspace.create({
      data: {
        name: 'Other Workspace',
        slug: 'other-workspace',
        ownerId: otherUser.id,
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: otherWorkspace.id,
        title: 'Test Feature',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Forbidden: No access to this workspace');

    // Clean up
    await db.workspace.delete({ where: { id: otherWorkspace.id } });
    await db.user.delete({ where: { id: otherUser.id } });
  });

  it('should return empty array when no similar features found', async () => {
    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'Unique Feature That Does Not Exist',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toEqual([]);
  });

  it('should find similar features by title case-insensitively', async () => {
    // Create test features
    await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'User Authentication System',
        brief: 'Add login functionality',
        status: 'BACKLOG',
        requirements: 'OAuth support',
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Payment Integration',
        brief: 'Stripe integration',
        status: 'PLANNED',
        requirements: 'Accept payments',
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'authentication',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toHaveLength(1);
    expect(data.data.duplicates[0].title).toBe('User Authentication System');
  });

  it('should search in brief field when provided', async () => {
    await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Payment System',
        brief: 'Implement Stripe OAuth integration',
        status: 'BACKLOG',
        requirements: 'Accept payments',
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'Other Feature',
        brief: 'OAuth',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toHaveLength(1);
    expect(data.data.duplicates[0].title).toBe('Payment System');
  });

  it('should search in requirements field when brief provided', async () => {
    await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Security Feature',
        brief: 'Add security',
        status: 'BACKLOG',
        createdById: testUserId,
        updatedById: testUserId,
        requirements: 'Must support OAuth and 2FA authentication',
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'Unrelated Title',
        brief: '2FA authentication',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toHaveLength(1);
    expect(data.data.duplicates[0].title).toBe('Security Feature');
  });

  it('should not return deleted features', async () => {
    await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Deleted Authentication Feature',
        brief: 'Old feature',
        status: 'BACKLOG',
        createdById: testUserId,
        updatedById: testUserId,
        requirements: 'OAuth',
        deleted: true,
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'authentication',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toEqual([]);
  });

  it('should limit results to 5 features', async () => {
    // Create 7 features with similar titles
    for (let i = 1; i <= 7; i++) {
      await db.feature.create({
        data: {
          workspaceId: testWorkspaceId,
          title: `Authentication Feature ${i}`,
          brief: `Feature ${i}`,
          status: 'BACKLOG',
          requirements: 'OAuth',
          createdById: testUserId,
          updatedById: testUserId,
        },
      });
    }

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'authentication',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toHaveLength(5);
  });

  it('should return features ordered by createdAt descending', async () => {
    // Create features with different timestamps
    const feature1 = await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Feature Old',
        brief: 'test feature',
        status: 'BACKLOG',
        createdById: testUserId,
        updatedById: testUserId,
        requirements: 'test',
        createdAt: new Date('2024-01-01'),
      },
    });

    const feature2 = await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Feature New',
        brief: 'test feature',
        status: 'PLANNED',
        requirements: 'test',
        createdAt: new Date('2024-12-01'),
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'feature',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toHaveLength(2);
    expect(data.data.duplicates[0].id).toBe(feature2.id);
    expect(data.data.duplicates[1].id).toBe(feature1.id);
  });

  it('should return features with correct fields', async () => {
    const createdFeature = await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Test Feature',
        brief: 'Test brief',
        status: 'BACKLOG',
        createdById: testUserId,
        updatedById: testUserId,
        requirements: 'Test requirements',
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'Test Feature',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toHaveLength(1);

    const feature = data.data.duplicates[0];
    expect(feature).toHaveProperty('id');
    expect(feature).toHaveProperty('title');
    expect(feature).toHaveProperty('brief');
    expect(feature).toHaveProperty('status');
    expect(feature).toHaveProperty('createdAt');
    expect(feature.id).toBe(createdFeature.id);
    expect(feature.title).toBe('Test Feature');
    expect(feature.brief).toBe('Test brief');
    expect(feature.status).toBe('BACKLOG');
  });

  it('should only return features from the specified workspace', async () => {
    // Create another workspace with a feature
    const otherUser = await db.user.create({
      data: {
        email: 'other@example.com',
        name: 'Other User',
      },
    });

    const otherWorkspace = await db.workspace.create({
      data: {
        name: 'Other Workspace',
        slug: 'other-workspace',
        ownerId: otherUser.id,
      },
    });

    await db.feature.create({
      data: {
        workspaceId: otherWorkspace.id,
        title: 'Authentication Feature',
        brief: 'Other workspace feature',
        status: 'BACKLOG',
        requirements: 'OAuth',
        createdById: otherUser.id,
        updatedById: otherUser.id,
      },
    });

    // Create feature in test workspace
    await db.feature.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Authentication Feature',
        brief: 'Test workspace feature',
        status: 'BACKLOG',
        requirements: 'OAuth',
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    const request = new NextRequest('http://localhost/api/features/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: 'authentication',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.duplicates).toHaveLength(1);
    expect(data.data.duplicates[0].brief).toBe('Test workspace feature');

    // Clean up
    await db.feature.deleteMany({ where: { workspaceId: otherWorkspace.id } });
    await db.workspace.delete({ where: { id: otherWorkspace.id } });
    await db.user.delete({ where: { id: otherUser.id } });
  });
});
