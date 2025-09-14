import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { GET } from '@/app/api/chat/messages/[messageId]/route';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';

// Mock NextAuth
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

// Mock auth options
vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

const mockGetServerSession = vi.mocked(getServerSession);

describe('GET /api/chat/messages/[messageId] - Integration Tests', () => {
  let prisma: PrismaClient;
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let testChatMessage: any;
  let unauthorizedUser: any;
  let unauthorizedWorkspace: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Create test user and workspace with proper relationships
    testUser = await prisma.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
      },
    });

    testWorkspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: 'test-workspace',
        description: 'Test workspace for integration tests',
        ownerId: testUser.id,
      },
    });

    // Create workspace member relationship
    await prisma.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: 'OWNER',
      },
    });

    testTask = await prisma.task.create({
      data: {
        title: 'Test Task',
        description: 'Test task for message integration tests',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        sourceType: 'USER',
        workflowStatus: 'PENDING',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    testChatMessage = await prisma.chatMessage.create({
      data: {
        message: 'Test sensitive chat message with confidential information',
        role: 'ASSISTANT',
        contextTags: JSON.stringify([
          { type: 'file', value: '/sensitive/config.json' },
          { type: 'api_key', value: 'sk-test-key-123' }
        ]),
        taskId: testTask.id,
      },
    });

    // Create artifacts with sensitive content
    await prisma.artifact.create({
      data: {
        type: 'CODE',
        content: {
          code: 'const apiKey = "sk-sensitive-123"; const dbPassword = "secret-pass";',
          language: 'javascript',
          filename: 'config.js'
        },
        messageId: testChatMessage.id,
      },
    });

    // Create file attachment with sensitive information
    await prisma.attachment.create({
      data: {
        filename: 'secrets.env',
        mimeType: 'text/plain',
        size: 256,
        path: 'workspace/task/secrets-uuid.env',
        messageId: testChatMessage.id,
      },
    });

    // Create unauthorized user and workspace for access control tests
    unauthorizedUser = await prisma.user.create({
      data: {
        email: 'unauthorized@example.com',
        name: 'Unauthorized User',
      },
    });

    unauthorizedWorkspace = await prisma.workspace.create({
      data: {
        name: 'Unauthorized Workspace',
        slug: 'unauthorized-workspace',
        description: 'Workspace for unauthorized access tests',
        ownerId: unauthorizedUser.id,
      },
    });
  });

  afterEach(async () => {
    // Clean up test data in correct order to handle foreign key constraints
    await prisma.attachment.deleteMany({});
    await prisma.artifact.deleteMany({});
    await prisma.chatMessage.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.user.deleteMany({});
  });

  test('should return 401 when user is not authenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost:3000/api/chat/messages/test-id');
    const params = Promise.resolve({ messageId: testChatMessage.id });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('should return 401 when user session is invalid', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: {} // Missing required id field
    });

    const request = new NextRequest('http://localhost:3000/api/chat/messages/test-id');
    const params = Promise.resolve({ messageId: testChatMessage.id });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Invalid user session');
  });

  test('should return 400 when messageId is missing', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: testUser.id }
    });

    const request = new NextRequest('http://localhost:3000/api/chat/messages/');
    const params = Promise.resolve({ messageId: '' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Message ID is required');
  });

  test('should return 404 when message does not exist', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: testUser.id }
    });

    const request = new NextRequest('http://localhost:3000/api/chat/messages/nonexistent');
    const params = Promise.resolve({ messageId: 'nonexistent-message-id' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Message not found');
  });

  test('should return 403 when user lacks access to workspace', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: unauthorizedUser.id }
    });

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testChatMessage.id}`);
    const params = Promise.resolve({ messageId: testChatMessage.id });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Access denied');
  });

  test('should successfully return message with sensitive data when user is workspace owner', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: testUser.id }
    });

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testChatMessage.id}`);
    const params = Promise.resolve({ messageId: testChatMessage.id });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();

    // Validate message structure and sensitive data handling
    const message = data.data;
    expect(message.id).toBe(testChatMessage.id);
    expect(message.message).toBe('Test sensitive chat message with confidential information');
    expect(message.role).toBe('ASSISTANT');
    
    // Verify context tags with sensitive information are included
    expect(message.contextTags).toBeInstanceOf(Array);
    expect(message.contextTags).toHaveLength(2);
    expect(message.contextTags[0]).toEqual({ type: 'file', value: '/sensitive/config.json' });
    expect(message.contextTags[1]).toEqual({ type: 'api_key', value: 'sk-test-key-123' });

    // Verify artifacts with sensitive code are included
    expect(message.artifacts).toBeInstanceOf(Array);
    expect(message.artifacts).toHaveLength(1);
    const artifact = message.artifacts[0];
    expect(artifact.type).toBe('CODE');
    expect(artifact.content.code).toContain('sk-sensitive-123');
    expect(artifact.content.code).toContain('secret-pass');

    // Verify sensitive file attachments are included
    expect(message.attachments).toBeInstanceOf(Array);
    expect(message.attachments).toHaveLength(1);
    const attachment = message.attachments[0];
    expect(attachment.filename).toBe('secrets.env');
    expect(attachment.path).toBe('workspace/task/secrets-uuid.env');
  });

  test('should successfully return message when user is workspace member', async () => {
    // Create a regular member (not owner)
    const memberUser = await prisma.user.create({
      data: {
        email: 'member@example.com',
        name: 'Member User',
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: memberUser.id,
        role: 'DEVELOPER',
      },
    });

    mockGetServerSession.mockResolvedValueOnce({
      user: { id: memberUser.id }
    });

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testChatMessage.id}`);
    const params = Promise.resolve({ messageId: testChatMessage.id });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe(testChatMessage.id);

    // Clean up
    await prisma.workspaceMember.deleteMany({ where: { userId: memberUser.id } });
    await prisma.user.delete({ where: { id: memberUser.id } });
  });

  test('should handle database errors gracefully', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: testUser.id }
    });

    // Use an invalid message ID format that might cause DB issues
    const request = new NextRequest('http://localhost:3000/api/chat/messages/invalid-uuid-format-that-might-cause-db-error');
    const params = Promise.resolve({ messageId: 'invalid-uuid-format-that-might-cause-db-error' });

    const response = await GET(request, { params });
    const data = await response.json();

    // Should handle gracefully with 500 or 404, not crash
    expect([404, 500]).toContain(response.status);
    expect(data.error).toBeDefined();
  });

  test('should not expose sensitive data structure in error responses', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: unauthorizedUser.id }
    });

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${testChatMessage.id}`);
    const params = Promise.resolve({ messageId: testChatMessage.id });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Access denied');
    
    // Verify no sensitive information is leaked in error response
    expect(data).not.toHaveProperty('data');
    expect(data).not.toHaveProperty('message');
    expect(data).not.toHaveProperty('artifacts');
    expect(data).not.toHaveProperty('attachments');
    expect(data).not.toHaveProperty('contextTags');
  });

  test('should properly serialize complex artifact content', async () => {
    // Create message with complex artifact content
    const complexMessage = await prisma.chatMessage.create({
      data: {
        message: 'Complex artifact test',
        role: 'ASSISTANT',
        contextTags: JSON.stringify([]),
        taskId: testTask.id,
      },
    });

    await prisma.artifact.create({
      data: {
        type: 'BROWSER',
        content: {
          screenshot: 'base64-image-data',
          url: 'https://sensitive-internal.company.com/admin',
          elements: [
            { type: 'input', name: 'password', value: 'hidden-value' },
            { type: 'token', value: 'jwt-abc123' }
          ],
          cookies: ['session=secret-session-id', 'auth=token-xyz']
        },
        messageId: complexMessage.id,
      },
    });

    mockGetServerSession.mockResolvedValueOnce({
      user: { id: testUser.id }
    });

    const request = new NextRequest(`http://localhost:3000/api/chat/messages/${complexMessage.id}`);
    const params = Promise.resolve({ messageId: complexMessage.id });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    const artifact = data.data.artifacts[0];
    expect(artifact.type).toBe('BROWSER');
    expect(artifact.content.url).toBe('https://sensitive-internal.company.com/admin');
    expect(artifact.content.elements).toBeInstanceOf(Array);
    expect(artifact.content.cookies).toBeInstanceOf(Array);
    expect(artifact.content.cookies).toContain('session=secret-session-id');

    // Clean up
    await prisma.artifact.deleteMany({ where: { messageId: complexMessage.id } });
    await prisma.chatMessage.delete({ where: { id: complexMessage.id } });
  });
});