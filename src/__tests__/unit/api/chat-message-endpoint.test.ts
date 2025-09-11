import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { ChatRole, ChatStatus } from '@/lib/chat';

// Mock dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/services/s3');
vi.mock('@/lib/utils');
vi.mock('@/lib/utils/swarm');

// Mock the database module
vi.mock('@/lib/db', () => ({
  db: {
    task: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

// Import the actual endpoint function
import { POST } from '@/app/api/chat/message/route';
import { db } from '@/lib/db';

// Mock data
const mockUser = {
  id: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
};

const mockTask = {
  id: 'task-456',
  workspaceId: 'workspace-789',
  workspace: {
    ownerId: 'user-123',
    swarm: {
      id: 'swarm-123',
      swarmUrl: 'https://swarm.example.com/api',
      swarmSecretAlias: 'secret-alias',
      poolName: 'test-pool',
      name: 'Test Swarm',
    },
    members: [{ role: 'MEMBER' }],
  },
};

const mockChatMessage = {
  id: 'msg-789',
  taskId: 'task-456',
  message: 'Test message',
  role: ChatRole.USER,
  status: ChatStatus.SENT,
  contextTags: '[]',
  artifacts: [],
  attachments: [],
  task: {
    id: 'task-456',
    title: 'Test Task',
  },
};

describe('POST /api/chat/message Endpoint Tests', () => {
  let mockRequest: Partial<NextRequest>;

  beforeEach(() => {
    mockRequest = {
      json: vi.fn(),
      headers: {
        get: vi.fn().mockReturnValue('localhost:3000'),
      } as any,
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
      });

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 when user session is invalid', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: { email: 'test@example.com' }, // Missing id
      });
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
      });

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid user session');
    });

    it('should return 403 when user is not workspace owner or member', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: { id: 'different-user' },
      });
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
      });

      const mockTaskWithoutAccess = {
        ...mockTask,
        workspace: {
          ...mockTask.workspace,
          ownerId: 'other-user',
          members: [], // User is not a member
        },
      };

      (db.task.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTaskWithoutAccess);
      (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUser);

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Access denied');
    });
  });

  describe('Request Validation', () => {
    beforeEach(() => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: mockUser,
      });
      (db.task.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTask);
      (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUser);
    });

    it('should return 400 when message is missing', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        // message is missing
      });

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message is required');
    });

    it('should return 400 when taskId is missing', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        message: 'Test message',
        // taskId is missing
      });

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('taskId is required');
    });

    it('should return 400 when message is empty string', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: '',
      });

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message is required');
    });

    it('should return 404 when task is not found', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'nonexistent-task',
        message: 'Test message',
      });

      (db.task.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Task not found');
    });

    it('should return 404 when user is not found', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
      });

      (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('User not found');
    });
  });

  describe('Message Creation', () => {
    beforeEach(() => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: mockUser,
      });
      (db.task.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTask);
      (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUser);
      (db.chatMessage.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockChatMessage);
    });

    it('should create chat message with basic data', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
      });

      // Mock external service calls
      vi.doMock('@/app/api/chat/message/route', async () => {
        const actual = await vi.importActual('@/app/api/chat/message/route');
        return {
          ...actual,
          callMock: vi.fn().mockResolvedValue({ success: true, data: {} }),
        };
      });

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toEqual(
        expect.objectContaining({
          id: 'msg-789',
          message: 'Test message',
          role: ChatRole.USER,
          status: ChatStatus.SENT,
        })
      );

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: 'task-456',
          message: 'Test message',
          role: ChatRole.USER,
          contextTags: JSON.stringify([]),
          status: ChatStatus.SENT,
          sourceWebsocketID: undefined,
          replyId: undefined,
          artifacts: { create: [] },
          attachments: { create: [] },
        },
        include: {
          artifacts: true,
          attachments: true,
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
    });

    it('should create chat message with artifacts', async () => {
      const artifacts = [
        {
          type: 'CODE',
          content: { content: 'console.log("test")', language: 'javascript' },
        },
      ];

      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message with artifacts',
        artifacts,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: artifacts.map(artifact => ({
                type: artifact.type,
                content: artifact.content,
              })),
            },
          }),
        })
      );
    });

    it('should create chat message with attachments', async () => {
      const attachments = [
        {
          path: '/uploads/test.png',
          filename: 'test.png',
          mimeType: 'image/png',
          size: 1024,
        },
      ];

      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message with attachments',
        attachments,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: {
              create: attachments.map(attachment => ({
                path: attachment.path,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
              })),
            },
          }),
        })
      );
    });

    it('should handle optional fields correctly', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
        contextTags: [{ type: 'REPO', id: 'repo-123' }],
        sourceWebsocketID: 'ws-789',
        replyId: 'reply-123',
        webhook: 'https://example.com/webhook',
        mode: 'test',
      });

      const response = await POST(mockRequest as NextRequest);

      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify([{ type: 'REPO', id: 'repo-123' }]),
            sourceWebsocketID: 'ws-789',
            replyId: 'reply-123',
          }),
        })
      );
    });
  });

  describe('Client Message Conversion', () => {
    beforeEach(() => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: mockUser,
      });
      (db.task.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTask);
      (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUser);
    });

    it('should convert database message to client format correctly', async () => {
      const contextTags = [{ type: 'REPO', id: 'repo-123' }];
      const mockDbMessage = {
        ...mockChatMessage,
        contextTags: JSON.stringify(contextTags),
        artifacts: [
          {
            id: 'artifact-123',
            type: 'CODE',
            content: { content: 'test code', language: 'js' },
            icon: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      (db.chatMessage.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockDbMessage);
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
      });

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(data.message.contextTags).toEqual(contextTags);
      expect(data.message.artifacts).toEqual([
        expect.objectContaining({
          id: 'artifact-123',
          type: 'CODE',
          content: { content: 'test code', language: 'js' },
        }),
      ]);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: mockUser,
      });
      (mockRequest.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-456',
        message: 'Test message',
      });
    });

    it('should handle database errors gracefully', async () => {
      (db.task.findFirst as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create chat message');
    });

    it('should handle JSON parsing errors', async () => {
      (mockRequest.json as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Invalid JSON')
      );

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create chat message');
    });

    it('should handle message creation errors', async () => {
      (db.task.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTask);
      (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUser);
      (db.chatMessage.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Failed to create message')
      );

      const response = await POST(mockRequest as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create chat message');
    });
  });
});