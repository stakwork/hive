import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { db } from '@/lib/db';
import { POST } from '@/app/api/chat/message/route';
import { ChatRole, ChatStatus, WorkflowStatus, ArtifactType } from '@/lib/chat';
import { getGithubUsernameAndPAT } from '@/lib/auth/nextauth';
import { getS3Service } from '@/services/s3';
import { config } from '@/lib/env';

// Mock dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/db');
vi.mock('@/lib/auth/nextauth');
vi.mock('@/services/s3');
vi.mock('@/lib/env');

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);
const mockGetS3Service = vi.mocked(getS3Service);
const mockConfig = vi.mocked(config);

// Mock data
const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User'
};

const mockSession = {
  user: mockUser
};

const mockTask = {
  id: 'task-123',
  workspaceId: 'workspace-123',
  workspace: {
    ownerId: 'user-123',
    swarm: {
      swarmUrl: 'https://swarm.example.com/api',
      swarmSecretAlias: 'secret-alias',
      poolName: 'pool-1',
      name: 'Test Swarm',
      id: 'swarm-123'
    },
    members: [{ role: 'ADMIN' }]
  }
};

const mockChatMessage = {
  id: 'message-123',
  taskId: 'task-123',
  message: 'Test message',
  role: ChatRole.USER,
  contextTags: '[]',
  status: ChatStatus.SENT,
  sourceWebsocketID: null,
  replyId: null,
  artifacts: [],
  attachments: [],
  task: {
    id: 'task-123',
    title: 'Test Task'
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  timestamp: new Date(),
  workflowUrl: null
};

const mockGithubProfile = {
  username: 'testuser',
  pat: 'github-pat-token',
  appAccessToken: 'github-app-token'
};

const mockS3Service = {
  generatePresignedDownloadUrl: vi.fn().mockResolvedValue('https://s3.example.com/file.txt')
};

// Test fixtures
const validRequestBody = {
  taskId: 'task-123',
  message: 'Test message',
  contextTags: [],
  sourceWebsocketID: 'ws-123',
  artifacts: [],
  attachments: [],
  replyId: null,
  mode: 'live'
};

const artifactRequestBody = {
  ...validRequestBody,
  artifacts: [{
    type: ArtifactType.CODE,
    content: { content: 'console.log("test");', language: 'javascript' }
  }]
};

const attachmentRequestBody = {
  ...validRequestBody,
  attachments: [{
    path: 's3://bucket/file.jpg',
    filename: 'file.jpg',
    mimeType: 'image/jpeg',
    size: 1024
  }]
};

function createMockRequest(body: any, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/message', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'host': 'localhost:3000',
      ...headers
    }
  });
}

describe('/api/chat/message endpoint validation', () => {
  beforeAll(() => {
    // Setup global mocks
    global.fetch = vi.fn();
    mockGetS3Service.mockReturnValue(mockS3Service as any);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset environment variables
    delete process.env.CUSTOM_WEBHOOK_URL;
    
    // Default successful mocks
    mockGetServerSession.mockResolvedValue(mockSession);
    mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
    
    // Mock database operations
    (db.task as any) = {
      findFirst: vi.fn().mockResolvedValue(mockTask),
      update: vi.fn().mockResolvedValue({ id: 'task-123' })
    };
    
    (db.user as any) = {
      findUnique: vi.fn().mockResolvedValue(mockUser)
    };
    
    (db.chatMessage as any) = {
      create: vi.fn().mockResolvedValue(mockChatMessage)
    };

    // Mock config
    mockConfig.STAKWORK_API_KEY = 'test-api-key';
    mockConfig.STAKWORK_BASE_URL = 'https://stakwork.example.com';
    mockConfig.STAKWORK_WORKFLOW_ID = '123,456,789';
    
    // Mock environment variable
    process.env.CUSTOM_WEBHOOK_URL = undefined;
    
    // Ensure fetch is properly mocked
    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { project_id: 456 } })
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication and Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      mockGetServerSession.mockResolvedValue(null);
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should reject requests with invalid user session', async () => {
      mockGetServerSession.mockResolvedValue({ user: {} });
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid user session');
    });

    it('should reject access when user is not task owner or member', async () => {
      const taskWithoutAccess = {
        ...mockTask,
        workspace: {
          ...mockTask.workspace,
          ownerId: 'other-user',
          members: [] // No members
        }
      };
      
      (db.task as any).findFirst.mockResolvedValue(taskWithoutAccess);
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Access denied');
    });

    it('should allow access for task owner', async () => {
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should allow access for workspace members', async () => {
      const taskWithMember = {
        ...mockTask,
        workspace: {
          ...mockTask.workspace,
          ownerId: 'other-user',
          members: [{ role: 'MEMBER' }] // User is a member
        }
      };
      
      (db.task as any).findFirst.mockResolvedValue(taskWithMember);
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Input Validation', () => {
    it('should require message field', async () => {
      const invalidBody = { ...validRequestBody, message: '' };
      
      const request = createMockRequest(invalidBody);
      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Message is required');
    });

    it('should require taskId field', async () => {
      const invalidBody = { ...validRequestBody, taskId: '' };
      
      const request = createMockRequest(invalidBody);
      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('taskId is required');
    });

    it('should handle missing task', async () => {
      (db.task as any).findFirst.mockResolvedValue(null);
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Task not found');
    });

    it('should handle missing user', async () => {
      (db.user as any).findUnique.mockResolvedValue(null);
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('User not found');
    });

    it('should accept valid request with all fields', async () => {
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
    });
  });

  describe('Chat Message Creation', () => {
    it('should create chat message with correct data', async () => {
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: validRequestBody.taskId,
          message: validRequestBody.message,
          role: ChatRole.USER,
          contextTags: JSON.stringify(validRequestBody.contextTags),
          status: ChatStatus.SENT,
          sourceWebsocketID: validRequestBody.sourceWebsocketID,
          replyId: validRequestBody.replyId,
          artifacts: { create: [] },
          attachments: { create: [] }
        },
        include: {
          artifacts: true,
          attachments: true,
          task: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });
    });

    it('should handle reply messages', async () => {
      const replyBody = { ...validRequestBody, replyId: 'reply-123' };
      
      const request = createMockRequest(replyBody);
      await POST(request);
      
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            replyId: 'reply-123'
          })
        })
      );
    });

    it('should return properly formatted client message', async () => {
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      const data = await response.json();
      
      expect(data.message).toMatchObject({
        id: 'message-123',
        taskId: 'task-123',
        message: 'Test message',
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        contextTags: [],
        artifacts: [],
        attachments: []
      });
    });
  });

  describe('Artifact and Attachment Handling', () => {
    it('should process artifacts correctly', async () => {
      const request = createMockRequest(artifactRequestBody);
      await POST(request);
      
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [{
                type: ArtifactType.CODE,
                content: { content: 'console.log("test");', language: 'javascript' }
              }]
            }
          })
        })
      );
    });

    it('should process attachments correctly', async () => {
      const request = createMockRequest(attachmentRequestBody);
      await POST(request);
      
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: {
              create: [{
                path: 's3://bucket/file.jpg',
                filename: 'file.jpg',
                mimeType: 'image/jpeg',
                size: 1024
              }]
            }
          })
        })
      );
    });

    it('should generate presigned URLs for Stakwork attachments', async () => {
      // Mock specific message with attachments but ensure S3 call happens
      const mockMessageWithAttachments = {
        ...mockChatMessage,
        attachments: [{
          path: 's3://bucket/file.jpg',
          filename: 'file.jpg', 
          mimeType: 'image/jpeg',
          size: 1024
        }]
      };
      
      (db.chatMessage as any).create.mockResolvedValueOnce(mockMessageWithAttachments);
      
      const request = createMockRequest(attachmentRequestBody);
      
      // Mock successful Stakwork call - this ensures callStakwork runs
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 456 } })
      });
      
      await POST(request);
      
      // The S3 service should be called when callStakwork processes attachments
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith('s3://bucket/file.jpg');
    });
  });

  describe('Stakwork Integration', () => {
    it('should call Stakwork API with correct payload', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 456 } })
      });
      
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://stakwork.example.com/projects',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Token token=test-api-key',
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('"workflow_id":123')
        })
      );
    });

    it('should use correct workflow ID for different modes', async () => {
      const testCases = [
        { mode: 'live', expectedWorkflowId: 123 },
        { mode: 'unit', expectedWorkflowId: 789 },
        { mode: 'integration', expectedWorkflowId: 789 },
        { mode: 'test', expectedWorkflowId: 456 }
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { project_id: 456 } })
        });

        const bodyWithMode = { ...validRequestBody, mode: testCase.mode };
        const request = createMockRequest(bodyWithMode);
        await POST(request);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining(`"workflow_id":${testCase.expectedWorkflowId}`)
          })
        );
      }
    });

    it('should include GitHub credentials in Stakwork payload', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 456 } })
      });
      
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      const fetchCall = (global.fetch as any).mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      
      expect(payload.workflow_params.set_var.attributes.vars).toMatchObject({
        alias: 'testuser',
        username: 'testuser',
        accessToken: 'github-app-token'
      });
    });

    it('should fall back to mock when Stakwork is disabled', async () => {
      mockConfig.STAKWORK_API_KEY = '';
      
      // Mock the mock API call
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/mock',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"taskId":"task-123"')
        })
      );
    });
  });

  describe('Workflow Status Updates', () => {
    it('should update task status to IN_PROGRESS on successful Stakwork call', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 456 } })
      });
      
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 456
        }
      });
    });

    it('should update task status to FAILED on Stakwork failure', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error'
      });
      
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: {
          workflowStatus: WorkflowStatus.FAILED
        }
      });
    });

    it('should store Stakwork project ID when provided', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 999 } })
      });
      
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      expect(db.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stakworkProjectId: 999
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      (db.chatMessage as any).create.mockRejectedValue(new Error('Database error'));
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Failed to create chat message');
    });

    it('should handle Stakwork API errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      // Should still succeed but update task status to FAILED
      expect(response.status).toBe(201);
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: {
          workflowStatus: WorkflowStatus.FAILED
        }
      });
    });

    it('should handle missing GitHub credentials', async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 456 } })
      });
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      
      const fetchCall = (global.fetch as any).mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      
      expect(payload.workflow_params.set_var.attributes.vars).toMatchObject({
        alias: null,
        username: null,
        accessToken: null
      });
    });

    it('should handle missing Stakwork environment variables', async () => {
      mockConfig.STAKWORK_API_KEY = '';
      mockConfig.STAKWORK_BASE_URL = '';
      mockConfig.STAKWORK_WORKFLOW_ID = '';
      
      // Should fall back to mock
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      
      const request = createMockRequest(validRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/mock'),
        expect.any(Object)
      );
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete end-to-end flow', async () => {
      // Mock successful Stakwork response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 123 } })
      });
      
      const fullRequestBody = {
        taskId: 'task-123',
        message: 'Complete test message',
        contextTags: [{ type: 'FILE', id: 'file-123' }],
        sourceWebsocketID: 'ws-456',
        artifacts: [{
          type: ArtifactType.CODE,
          content: { content: 'function test() {}', language: 'javascript' }
        }],
        attachments: [{
          path: 's3://bucket/test.png',
          filename: 'test.png',
          mimeType: 'image/png',
          size: 2048
        }],
        webhook: 'https://custom-webhook.com',
        replyId: 'reply-456',
        mode: 'live'
      };

      // Mock specific message for this test
      const fullMockMessage = {
        ...mockChatMessage,
        message: 'Complete test message',
        sourceWebsocketID: 'ws-456',
        replyId: 'reply-456',
        artifacts: [{
          type: ArtifactType.CODE,
          content: { content: 'function test() {}', language: 'javascript' }
        }],
        attachments: [{
          path: 's3://bucket/test.png',
          filename: 'test.png',
          mimeType: 'image/png',
          size: 2048
        }]
      };
      
      (db.chatMessage as any).create.mockResolvedValueOnce(fullMockMessage);
      
      const request = createMockRequest(fullRequestBody);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      const data = await response.json();
      
      // Verify response structure (workflow data should match stakwork response)
      expect(data).toMatchObject({
        success: true,
        message: expect.objectContaining({
          id: expect.any(String),
          taskId: 'task-123',
          message: 'Complete test message',
          role: ChatRole.USER,
          status: ChatStatus.SENT
        }),
        workflow: { project_id: 123 }
      });
      
      // Verify database operations
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: 'task-123',
            message: 'Complete test message',
            artifacts: { create: expect.arrayContaining([expect.any(Object)]) },
            attachments: { create: expect.arrayContaining([expect.any(Object)]) }
          })
        })
      );
      
      // Verify Stakwork integration
      expect(global.fetch).toHaveBeenCalledWith(
        'https://custom-webhook.com',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Token token=test-api-key'
          })
        })
      );
      
      // Verify workflow status update
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 123
        }
      });
    });

    it('should handle webhook URL generation correctly', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { project_id: 123 } })
      });
      
      const request = createMockRequest(validRequestBody);
      await POST(request);
      
      const fetchCall = (global.fetch as any).mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      
      // Verify webhook URL is correctly generated
      expect(payload.webhook_url).toBe('http://localhost:3000/api/stakwork/webhook?task_id=task-123');
      expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBe('http://localhost:3000/api/chat/response');
    });
  });

  describe('Request Schema Validation', () => {
    it('should accept minimal valid request', async () => {
      const minimalBody = {
        taskId: 'task-123',
        message: 'Test'
      };
      
      const request = createMockRequest(minimalBody);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
    });

    it('should handle empty contextTags gracefully', async () => {
      const bodyWithEmptyTags = {
        ...validRequestBody,
        contextTags: undefined
      };
      
      const request = createMockRequest(bodyWithEmptyTags);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: '[]' // Should default to empty array
          })
        })
      );
    });

    it('should handle empty artifacts and attachments arrays', async () => {
      const bodyWithEmptyArrays = {
        ...validRequestBody,
        artifacts: undefined,
        attachments: undefined
      };
      
      const request = createMockRequest(bodyWithEmptyArrays);
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: { create: [] },
            attachments: { create: [] }
          })
        })
      );
    });
  });
});