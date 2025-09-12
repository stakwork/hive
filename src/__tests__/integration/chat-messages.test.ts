import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { GET } from '@/app/api/chat/messages/[messageId]/route';
import { db } from '@/lib/db';

// Mock NextAuth session - this is the only thing we mock in integration tests
vi.mock('next-auth/next');

const mockGetServerSession = vi.mocked(getServerSession);

describe('GET /api/chat/messages/[messageId] Integration Tests', () => {
  let testUserId: string;
  let testWorkspaceId: string;
  let testTaskId: string;
  let testMessageId: string;
  let memberUserId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test user
    const testUser = await db.user.create({
      data: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
      },
    });
    testUserId = testUser.id;

    // Create member user
    const memberUser = await db.user.create({
      data: {
        id: 'member-user-id',
        email: 'member@example.com',
        name: 'Member User',
      },
    });
    memberUserId = memberUser.id;

    // Create test workspace
    const testWorkspace = await db.workspace.create({
      data: {
        id: 'test-workspace-id',
        name: 'Test Workspace',
        slug: 'test-workspace',
        ownerId: testUserId,
      },
    });
    testWorkspaceId = testWorkspace.id;

    // Create test task
    const testTask = await db.task.create({
      data: {
        id: 'test-task-id',
        title: 'Test Task',
        workspace: {
          connect: {
            id: testWorkspaceId,
          },
        },
        createdBy: {
          connect: {
            id: testUserId,
          },
        },
        updatedBy: {
          connect: {
            id: testUserId,
          },
        },
      },
    });
    testTaskId = testTask.id;

    // Create test message with artifacts and attachments
    const testMessage = await db.chatMessage.create({
      data: {
        id: 'test-message-id',
        message: 'Test message content',
        role: 'USER',
        status: 'SENT',
        contextTags: '[]',
        taskId: testTaskId,
        artifacts: {
          create: [
            {
              id: 'artifact-1',
              type: 'CODE',
              content: { code: 'console.log("test");', language: 'javascript' },
            },
          ],
        },
        attachments: {
          create: [
            {
              id: 'attachment-1',
              filename: 'test.txt',
              path: '/test/path.txt',
              mimeType: 'text/plain',
              size: 100,
            },
          ],
        },
      },
    });
    testMessageId = testMessage.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully retrieve message for workspace owner', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: testUserId },
    } as any);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testMessageId}`);
    const params = Promise.resolve({ messageId: testMessageId });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(responseData.success).toBe(true);
    expect(responseData.data.id).toBe(testMessageId);
    expect(responseData.data.message).toBe('Test message content');
    expect(responseData.data.artifacts).toHaveLength(1);
    expect(responseData.data.attachments).toHaveLength(1);
  });

  it('should successfully retrieve message for workspace member', async () => {
    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        userId: memberUserId,
        workspaceId: testWorkspaceId,
        role: 'DEVELOPER',
      },
    });

    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: memberUserId },
    } as any);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testMessageId}`);
    const params = Promise.resolve({ messageId: testMessageId });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(responseData.success).toBe(true);
    expect(responseData.data.id).toBe(testMessageId);
  });

  it('should return 401 when user is not authenticated', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue(null);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testMessageId}`);
    const params = Promise.resolve({ messageId: testMessageId });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(responseData.error).toBe('Unauthorized');
  });

  it('should return 401 when session has no user ID', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: {},
    } as any);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testMessageId}`);
    const params = Promise.resolve({ messageId: testMessageId });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(responseData.error).toBe('Invalid user session');
  });

  it('should return 400 when messageId is missing', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: testUserId },
    } as any);

    const request = new NextRequest('http://localhost:3000/api/chat/messages/');
    const params = Promise.resolve({ messageId: '' });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(responseData.error).toBe('Message ID is required');
  });

  it('should return 404 when message does not exist', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: testUserId },
    } as any);

    const request = new NextRequest('http://localhost:3000/api/chat/messages/nonexistent');
    const params = Promise.resolve({ messageId: 'nonexistent' });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(responseData.error).toBe('Message not found');
  });

  it('should return 404 when message has no associated task', async () => {
    // Create message without task
    const messageWithoutTask = await db.chatMessage.create({
      data: {
        id: 'message-no-task',
        message: 'Orphaned message',
        role: 'USER',
        status: 'SENT',
        contextTags: '[]',
        taskId: null, // No task
      },
    });

    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: testUserId },
    } as any);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${messageWithoutTask.id}`);
    const params = Promise.resolve({ messageId: messageWithoutTask.id });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(responseData.error).toBe('Message not found');
  });

  it('should return 403 when user is neither workspace owner nor member', async () => {
    // Create unauthorized user
    const unauthorizedUser = await db.user.create({
      data: {
        id: 'unauthorized-user',
        email: 'unauthorized@example.com',
        name: 'Unauthorized User',
      },
    });

    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: unauthorizedUser.id },
    } as any);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testMessageId}`);
    const params = Promise.resolve({ messageId: testMessageId });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(403);
    expect(responseData.error).toBe('Access denied');
  });

  it('should properly parse contextTags JSON and format artifacts', async () => {
    // Create message with complex contextTags and multiple artifacts
    const complexMessage = await db.chatMessage.create({
      data: {
        id: 'complex-message',
        message: 'Complex message',
        role: 'USER',
        status: 'SENT',
        contextTags: '[{"type": "file", "value": "test.js"}]',
        taskId: testTaskId,
        artifacts: {
          create: [
            {
              id: 'artifact-code',
              type: 'CODE',
              content: { code: 'console.log("complex test");', language: 'typescript' },
            },
            {
              id: 'artifact-form',
              type: 'FORM',
              content: { fields: [{ name: 'test', type: 'text' }] },
            },
          ],
        },
      },
    });

    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: testUserId },
    } as any);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${complexMessage.id}`);
    const params = Promise.resolve({ messageId: complexMessage.id });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(responseData.data.contextTags).toEqual([{ type: 'file', value: 'test.js' }]);
    expect(responseData.data.artifacts).toHaveLength(2);
    expect(responseData.data.artifacts[0].type).toBe('CODE');
    expect(responseData.data.artifacts[1].type).toBe('FORM');
  });

  it('should verify workspace access control for owner without explicit membership', async () => {
    // Owner should have access even without explicit workspace membership
    const ownerUser = await db.user.create({
      data: {
        id: 'owner-user',
        email: 'owner@example.com',
        name: 'Owner User',
      },
    });

    const ownerWorkspace = await db.workspace.create({
      data: {
        id: 'owner-workspace',
        name: 'Owner Workspace',
        slug: 'owner-workspace',
        ownerId: ownerUser.id,
      },
    });

    const ownerTask = await db.task.create({
      data: {
        id: 'owner-task',
        title: 'Owner Task',
        workspace: {
          connect: {
            id: ownerWorkspace.id,
          },
        },
        createdBy: {
          connect: {
            id: ownerUser.id,
          },
        },
        updatedBy: {
          connect: {
            id: ownerUser.id,
          },
        },
      },
    });

    const ownerMessage = await db.chatMessage.create({
      data: {
        id: 'owner-message',
        message: 'Owner message',
        role: 'USER',
        status: 'SENT',
        contextTags: '[]',
        taskId: ownerTask.id,
      },
    });

    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: ownerUser.id },
    } as any);

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${ownerMessage.id}`);
    const params = Promise.resolve({ messageId: ownerMessage.id });

    // Act
    const response = await GET(request, { params });
    const responseData = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(responseData.success).toBe(true);
    expect(responseData.data.id).toBe(ownerMessage.id);
  });
});
