import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/chat/response/route';
import { db } from '@/lib/db';
import { ChatRole, ChatStatus } from '@/lib/chat';
import { createPostRequest } from '@/__tests__/support/helpers/request-builders';

// Mock S3 service before imports
const mockS3Service = {
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
  validateFileType: vi.fn(),
  validateFileSize: vi.fn(),
  validateImageBuffer: vi.fn(),
};

vi.mock('@/services/s3', () => ({
  getS3Service: () => mockS3Service,
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

function generateUniqueId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Helper to create a fake .webm buffer
function createFakeWebmBuffer(): Buffer {
  // WebM EBML header signature
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f]);
}

describe('POST /api/chat/response - recordings integration tests', () => {
  let testWorkspaceId: string;
  let testTaskId: string;

  async function createTestWorkspaceAndTask() {
    return await db.$transaction(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId('test-user'),
          email: `test-${generateUniqueId()}@example.com`,
          name: 'Test User',
        },
      });

      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId('workspace'),
          name: 'Test Workspace',
          slug: generateUniqueId('test-workspace'),
          description: 'Test workspace description',
          ownerId: testUser.id,
        },
      });

      const testTask = await tx.task.create({
        data: {
          id: generateUniqueId('task'),
          title: 'Test Task',
          description: 'Test task description',
          status: 'TODO',
          workspaceId: testWorkspace.id,
          workflowStatus: 'PENDING',
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      return { testUser, testWorkspace, testTask };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up test data
    const { testWorkspace, testTask } = await createTestWorkspaceAndTask();
    testWorkspaceId = testWorkspace.id;
    testTaskId = testTask.id;

    // Configure S3 mock for success
    mockS3Service.putObject.mockResolvedValue(undefined);
  });

  it('should process a single recording URL and create an attachment', async () => {
    const fakeWebmBuffer = createFakeWebmBuffer();
    const recordingUrl = 'https://example.com/recording1.webm';

    // Mock fetch to return fake .webm buffer
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => fakeWebmBuffer.buffer,
    });

    const request = createPostRequest('http://localhost/api/chat/response', {
      taskId: testTaskId,
      message: 'Test message with recording',
      recordings: [recordingUrl],
    });
    request.headers.set('x-api-token', process.env.API_TOKEN || 'test-api-token');

    const response = await POST(request);

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);

    // Verify S3 putObject was called once
    expect(mockS3Service.putObject).toHaveBeenCalledTimes(1);
    expect(mockS3Service.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^recordings\/.*\.webm$/),
      expect.any(Buffer),
      'video/webm'
    );

    // Verify attachment was created in DB
    const message = await db.chatMessage.findFirst({
      where: { taskId: testTaskId },
      include: { attachments: true },
    });

    expect(message).toBeTruthy();
    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments[0].mimeType).toBe('video/webm');
    expect(message?.attachments[0].filename).toMatch(/^recording-.*\.webm$/);
    expect(message?.attachments[0].path).toMatch(/^recordings\/.*\.webm$/);
    expect(message?.attachments[0].size).toBeGreaterThan(0);
  });

  it('should process multiple recording URLs and create multiple attachments', async () => {
    const fakeWebmBuffer1 = createFakeWebmBuffer();
    const fakeWebmBuffer2 = Buffer.concat([createFakeWebmBuffer(), Buffer.from([0xff, 0xee])]);
    const recordingUrl1 = 'https://example.com/recording1.webm';
    const recordingUrl2 = 'https://example.com/recording2.webm';

    // Mock fetch to return different buffers
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeWebmBuffer1.buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeWebmBuffer2.buffer,
      });

    const request = createPostRequest('http://localhost/api/chat/response', {
      taskId: testTaskId,
      message: 'Test message with multiple recordings',
      recordings: [recordingUrl1, recordingUrl2],
    });
    request.headers.set('x-api-token', process.env.API_TOKEN || 'test-api-token');

    const response = await POST(request);

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);

    // Verify S3 putObject was called twice
    expect(mockS3Service.putObject).toHaveBeenCalledTimes(2);

    // Verify two attachments were created
    const message = await db.chatMessage.findFirst({
      where: { taskId: testTaskId },
      include: { attachments: true },
    });

    expect(message?.attachments).toHaveLength(2);
    expect(message?.attachments[0].mimeType).toBe('video/webm');
    expect(message?.attachments[1].mimeType).toBe('video/webm');
  });

  it('should skip failed recording URL but still create message and other attachments', async () => {
    const fakeWebmBuffer = createFakeWebmBuffer();
    const failingUrl = 'https://example.com/missing.webm';
    const successUrl = 'https://example.com/success.webm';

    // Mock fetch: first fails, second succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeWebmBuffer.buffer,
      });

    const request = createPostRequest('http://localhost/api/chat/response', {
      taskId: testTaskId,
      message: 'Test message with one failing recording',
      recordings: [failingUrl, successUrl],
    });
    request.headers.set('x-api-token', process.env.API_TOKEN || 'test-api-token');

    const response = await POST(request);

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);

    // Verify S3 putObject was called only once (for successful upload)
    expect(mockS3Service.putObject).toHaveBeenCalledTimes(1);

    // Verify only one attachment was created
    const message = await db.chatMessage.findFirst({
      where: { taskId: testTaskId },
      include: { attachments: true },
    });

    expect(message).toBeTruthy();
    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments[0].mimeType).toBe('video/webm');
  });

  it('should not call S3 or create attachments when recordings array is empty', async () => {
    const request = createPostRequest('http://localhost/api/chat/response', {
      taskId: testTaskId,
      message: 'Test message with no recordings',
      recordings: [],
    });
    request.headers.set('x-api-token', process.env.API_TOKEN || 'test-api-token');

    const response = await POST(request);

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);

    // Verify S3 putObject was never called
    expect(mockS3Service.putObject).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();

    // Verify message was created but no attachments
    const message = await db.chatMessage.findFirst({
      where: { taskId: testTaskId },
      include: { attachments: true },
    });

    expect(message).toBeTruthy();
    expect(message?.attachments).toHaveLength(0);
  });

  it('should skip recordings processing when taskId is not provided (no workspaceId)', async () => {
    const recordingUrl = 'https://example.com/recording.webm';

    const request = createPostRequest('http://localhost/api/chat/response', {
      message: 'Test message without taskId',
      recordings: [recordingUrl],
    });
    request.headers.set('x-api-token', process.env.API_TOKEN || 'test-api-token');

    const response = await POST(request);

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);

    // Verify S3 putObject was never called (no workspaceId available)
    expect(mockS3Service.putObject).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should work alongside screenshots without interference', async () => {
    const fakeWebmBuffer = createFakeWebmBuffer();
    const recordingUrl = 'https://example.com/recording.webm';
    const screenshotDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

    // Mock fetch for recording
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => fakeWebmBuffer.buffer,
    });

    const request = createPostRequest('http://localhost/api/chat/response', {
      taskId: testTaskId,
      message: 'Test message with both screenshot and recording',
      screenshots: [screenshotDataUrl],
      recordings: [recordingUrl],
    });
    request.headers.set('x-api-token', process.env.API_TOKEN || 'test-api-token');

    const response = await POST(request);

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);

    // Verify both were processed
    expect(mockS3Service.putObject).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify both attachments were created
    const message = await db.chatMessage.findFirst({
      where: { taskId: testTaskId },
      include: { attachments: true },
    });

    expect(message?.attachments).toHaveLength(2);
    const mimeTypes = message?.attachments.map((a) => a.mimeType).sort();
    expect(mimeTypes).toEqual(['image/jpeg', 'video/webm']);
  });
});
