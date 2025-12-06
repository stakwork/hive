import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/stakwork/runs/[runId]/thinking/route';
import { db } from '@/lib/db';
import * as auth from 'next-auth';
import { ServiceFactory } from '@/lib/service-factory';
import { generateUniqueSlug } from '@/__tests__/support/helpers';

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock service factory
vi.mock('@/lib/service-factory', () => ({
  ServiceFactory: {
    getStakworkService: vi.fn(),
  },
}));

describe('GET /api/stakwork/runs/[runId]/thinking', () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let testRun: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test user
    testUser = await db.user.create({
      data: {
        email: `thinking-test-${Date.now()}@example.com`,
        name: 'Thinking Test User',
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: 'Thinking Test Workspace',
        slug: generateUniqueSlug('thinking-test'),
        ownerId: testUser.id,
        members: {
          create: {
            userId: testUser.id,
            role: 'OWNER',
          },
        },
      },
    });

    // Create test task
    testTask = await db.task.create({
      data: {
        title: 'Test Task',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    // Create test run
    testRun = await db.stakworkRun.create({
      data: {
        type: 'ARCHITECTURE',
        workspaceId: testWorkspace.id,
        projectId: 123,
        status: 'IN_PROGRESS',
        webhookUrl: 'http://localhost:3000/api/stakwork/webhook',
      },
    });
  });

  afterEach(async () => {
    await db.stakworkRun.deleteMany();
    await db.task.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  it('returns 401 for unauthenticated requests', async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(null);

    const request = new Request(
      `http://localhost:3000/api/stakwork/runs/${testRun.id}/thinking`
    );

    const response = await GET(request, {
      params: Promise.resolve({ runId: testRun.id }),
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 404 for non-existent run', async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue({
      user: { id: testUser.id, email: testUser.email },
    } as any);

    const request = new Request(
      'http://localhost:3000/api/stakwork/runs/non-existent/thinking'
    );

    const response = await GET(request, {
      params: Promise.resolve({ runId: 'non-existent' }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Run not found');
  });

  it('returns 403 for users without workspace access', async () => {
    // Create another user without workspace access
    const otherUser = await db.user.create({
      data: {
        email: `other-user-${Date.now()}@example.com`,
        name: 'Other User',
      },
    });

    vi.mocked(auth.getServerSession).mockResolvedValue({
      user: { id: otherUser.id, email: otherUser.email },
    } as any);

    const request = new Request(
      `http://localhost:3000/api/stakwork/runs/${testRun.id}/thinking`
    );

    const response = await GET(request, {
      params: Promise.resolve({ runId: testRun.id }),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Forbidden');

    // Cleanup
    await db.user.delete({ where: { id: otherUser.id } });
  });

  it('returns empty artifacts when projectId is null', async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue({
      user: { id: testUser.id, email: testUser.email },
    } as any);

    // Create run without projectId
    const runWithoutProject = await db.stakworkRun.create({
      data: {
        type: 'ARCHITECTURE',
        workspaceId: testWorkspace.id,
        status: 'PENDING',
        webhookUrl: 'http://localhost:3000/api/stakwork/webhook',
      },
    });

    const request = new Request(
      `http://localhost:3000/api/stakwork/runs/${runWithoutProject.id}/thinking`
    );

    const response = await GET(request, {
      params: Promise.resolve({ runId: runWithoutProject.id }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.artifacts).toEqual([]);
    expect(data.runId).toBe(runWithoutProject.id);

    // Cleanup
    await db.stakworkRun.delete({ where: { id: runWithoutProject.id } });
  });

  it('extracts artifacts from Stakwork workflow transitions', async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue({
      user: { id: testUser.id, email: testUser.email },
    } as any);

    const mockWorkflowData = {
      workflowData: {
        data: {
          transitions: [
            {
              id: 'step-1',
              name: 'Initialize',
              log: 'Starting initialization',
              output: 'Init complete',
              step_state: 'complete',
            },
            {
              id: 'step-2',
              step_name: 'Process',
              log: 'Processing data',
              step_state: 'running',
            },
          ],
        },
      },
    };

    vi.mocked(ServiceFactory.getStakworkService).mockReturnValue({
      getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
    } as any);

    const request = new Request(
      `http://localhost:3000/api/stakwork/runs/${testRun.id}/thinking`
    );

    const response = await GET(request, {
      params: Promise.resolve({ runId: testRun.id }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    
    expect(data.artifacts).toHaveLength(2);
    expect(data.artifacts[0]).toEqual({
      stepId: 'step-1',
      stepName: 'Initialize',
      log: 'Starting initialization',
      output: 'Init complete',
      stepState: 'complete',
    });
    expect(data.artifacts[1]).toEqual({
      stepId: 'step-2',
      stepName: 'Process',
      log: 'Processing data',
      stepState: 'running',
    });
  });

  it('handles Stakwork API errors gracefully', async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue({
      user: { id: testUser.id, email: testUser.email },
    } as any);

    vi.mocked(ServiceFactory.getStakworkService).mockReturnValue({
      getWorkflowData: vi.fn().mockRejectedValue(new Error('API Error')),
    } as any);

    const request = new Request(
      `http://localhost:3000/api/stakwork/runs/${testRun.id}/thinking`
    );

    const response = await GET(request, {
      params: Promise.resolve({ runId: testRun.id }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Internal server error');
  });
});
