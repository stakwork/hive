import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAuthenticatedPostRequest,
  createAuthenticatedGetRequest,
  createPostRequest,
  createGetRequest,
} from '@/__tests__/support/helpers/request-builders';
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from '@/__tests__/support/fixtures';
import { generateUniqueId } from '@/__tests__/support/helpers/ids';
import { WorkspaceRole } from '@prisma/client';
import { POST } from '@/app/api/w/[slug]/chat/share/route';
import { GET } from '@/app/api/w/[slug]/chat/shared/[shareId]/route';
import { db } from '@/lib/db';
import {
  CreateSharedConversationRequest,
  CreateSharedConversationResponse,
  GetSharedConversationResponse,
} from '@/types/shared-conversation';

describe('Shared Conversation API - Integration Tests', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let sharedConversationId: string;

  beforeEach(async () => {
    // Create test user and workspace
    testUser = await createTestUser({
      email: generateUniqueId('user') + '@example.com',
    });

    testWorkspace = await createTestWorkspace({
      slug: generateUniqueId('workspace'),
      ownerId: testUser.id,
    });
  });

  afterEach(async () => {
    // Clean up shared conversations
    if (sharedConversationId) {
      await db.sharedConversation.deleteMany({
        where: { id: sharedConversationId },
      });
    }
  });

  describe('POST /api/w/[slug]/chat/share - Create Shared Conversation', () => {
    describe('Successful Share Creation', () => {
      it('should create a shared conversation with valid data', async () => {
        const requestBody: CreateSharedConversationRequest = {
          messages: [
            { role: 'user', content: 'What is the task management feature?' },
            { role: 'assistant', content: 'The task management feature allows you to create and manage tasks...' },
          ],
          provenanceData: {
            sourceType: 'quick_ask',
            sourceId: 'test-source-123',
            metadata: { timestamp: new Date().toISOString() },
          },
          followUpQuestions: [
            'How do I create a task?',
            'What are the different task statuses?',
          ],
        };

        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          requestBody,
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);

        const data: CreateSharedConversationResponse = await response.json();
        expect(data.shareId).toBeDefined();
        expect(data.url).toBe(`/w/${testWorkspace.slug}/chat/shared/${data.shareId}`);

        // Store for cleanup
        sharedConversationId = data.shareId;

        // Verify in database
        const conversation = await db.sharedConversation.findUnique({
          where: { id: data.shareId },
        });

        expect(conversation).toBeDefined();
        expect(conversation?.workspaceId).toBe(testWorkspace.id);
        expect(conversation?.userId).toBe(testUser.id);
        expect(conversation?.title).toBe('What is the task management feature?');
        expect(conversation?.messages).toEqual(requestBody.messages);
        expect(conversation?.provenanceData).toEqual(requestBody.provenanceData);
        expect(conversation?.followUpQuestions).toEqual(requestBody.followUpQuestions);
      });

      it('should generate title from first user message (truncated to 100 chars)', async () => {
        const longContent = 'A'.repeat(150);
        const requestBody: CreateSharedConversationRequest = {
          messages: [
            { role: 'user', content: longContent },
            { role: 'assistant', content: 'Response' },
          ],
        };

        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          requestBody,
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);

        const data: CreateSharedConversationResponse = await response.json();
        sharedConversationId = data.shareId;

        const conversation = await db.sharedConversation.findUnique({
          where: { id: data.shareId },
        });

        expect(conversation?.title).toBeDefined();
        expect(conversation!.title!.length).toBeLessThanOrEqual(103); // 100 + "..."
        expect(conversation?.title).toContain('...');
      });

      it('should create conversation without optional fields', async () => {
        const requestBody: CreateSharedConversationRequest = {
          messages: [
            { role: 'user', content: 'Simple question' },
            { role: 'assistant', content: 'Simple answer' },
          ],
        };

        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          requestBody,
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);

        const data: CreateSharedConversationResponse = await response.json();
        sharedConversationId = data.shareId;

        const conversation = await db.sharedConversation.findUnique({
          where: { id: data.shareId },
        });

        expect(conversation?.provenanceData).toBeNull();
        expect(conversation?.followUpQuestions).toEqual([]);
      });
    });

    describe('Validation Failures', () => {
      it('should return 401 for unauthenticated requests', async () => {
        const requestBody: CreateSharedConversationRequest = {
          messages: [{ role: 'user', content: 'Test' }],
        };

        const request = createPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          requestBody
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(401);
      });

      it('should return 404 for non-existent workspace', async () => {
        const requestBody: CreateSharedConversationRequest = {
          messages: [{ role: 'user', content: 'Test' }],
        };

        const request = createAuthenticatedPostRequest(
          '/api/w/non-existent-workspace/chat/share',
          requestBody,
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: 'non-existent-workspace' }),
        });

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toContain('Workspace not found');
      });

      it('should return 404 for workspace user is not member of', async () => {
        const otherUser = await createTestUser({
          email: generateUniqueId('other') + '@example.com',
        });

        const requestBody: CreateSharedConversationRequest = {
          messages: [{ role: 'user', content: 'Test' }],
        };

        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          requestBody,
          otherUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(404);
      });

      it('should return 400 for missing messages array', async () => {
        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          {},
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('messages array is required');
      });

      it('should return 400 for empty messages array', async () => {
        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          { messages: [] },
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('must not be empty');
      });

      it('should return 400 for invalid message structure', async () => {
        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          { messages: [{ role: 'user' }] }, // missing content
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('role and content fields');
      });

      it('should return 400 for invalid message role', async () => {
        const request = createAuthenticatedPostRequest(
          `/api/w/${testWorkspace.slug}/chat/share`,
          { messages: [{ role: 'system', content: 'test' }] },
          testUser
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain("role must be 'user' or 'assistant'");
      });
    });
  });

  describe('GET /api/w/[slug]/chat/shared/[shareId] - Retrieve Shared Conversation', () => {
    beforeEach(async () => {
      // Create a shared conversation for testing retrieval
      const conversation = await db.sharedConversation.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: testUser.id,
          title: 'Test Conversation',
          messages: [
            { role: 'user', content: 'Question' },
            { role: 'assistant', content: 'Answer' },
          ],
          provenanceData: { sourceType: 'quick_ask' },
          followUpQuestions: ['Follow up 1', 'Follow up 2'],
        },
      });
      sharedConversationId = conversation.id;
    });

    describe('Successful Retrieval', () => {
      it('should retrieve shared conversation for workspace member', async () => {
        const request = createAuthenticatedGetRequest(
          `/api/w/${testWorkspace.slug}/chat/shared/${sharedConversationId}`,
          testUser
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConversationId,
          }),
        });

        expect(response.status).toBe(200);

        const data: GetSharedConversationResponse = await response.json();
        expect(data.conversation).toBeDefined();
        expect(data.conversation.id).toBe(sharedConversationId);
        expect(data.conversation.workspaceId).toBe(testWorkspace.id);
        expect(data.conversation.title).toBe('Test Conversation');
        expect(data.conversation.messages).toHaveLength(2);
        expect(data.conversation.followUpQuestions).toHaveLength(2);
        expect(data.conversation.createdAt).toBeDefined();
        expect(data.conversation.updatedAt).toBeDefined();
      });

      it('should retrieve conversation for non-owner workspace member', async () => {
        // Create another user and add them to workspace
        const member = await createTestUser({
          email: generateUniqueId('member') + '@example.com',
        });

        await createTestMembership({
          workspaceId: testWorkspace.id,
          userId: member.id,
          role: WorkspaceRole.DEVELOPER,
        });

        const request = createAuthenticatedGetRequest(
          `/api/w/${testWorkspace.slug}/chat/shared/${sharedConversationId}`,
          member
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConversationId,
          }),
        });

        expect(response.status).toBe(200);

        const data: GetSharedConversationResponse = await response.json();
        expect(data.conversation.id).toBe(sharedConversationId);
      });
    });

    describe('Access Denied Scenarios', () => {
      it('should return 401 for unauthenticated requests', async () => {
        const request = createGetRequest(
          `/api/w/${testWorkspace.slug}/chat/shared/${sharedConversationId}`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConversationId,
          }),
        });

        expect(response.status).toBe(401);
      });

      it('should return 403 for non-workspace members', async () => {
        const otherUser = await createTestUser({
          email: generateUniqueId('other') + '@example.com',
        });

        const request = createAuthenticatedGetRequest(
          `/api/w/${testWorkspace.slug}/chat/shared/${sharedConversationId}`,
          otherUser
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConversationId,
          }),
        });

        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.error).toContain('access denied');
      });

      it('should return 404 for non-existent shared conversation', async () => {
        const request = createAuthenticatedGetRequest(
          `/api/w/${testWorkspace.slug}/chat/shared/non-existent-id`,
          testUser
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: 'non-existent-id',
          }),
        });

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toContain('not found');
      });

      it('should return 404 when conversation belongs to different workspace', async () => {
        // Create another workspace
        const otherWorkspace = await createTestWorkspace({
          slug: generateUniqueId('other-workspace'),
          ownerId: testUser.id,
        });

        const request = createAuthenticatedGetRequest(
          `/api/w/${otherWorkspace.slug}/chat/shared/${sharedConversationId}`,
          testUser
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: otherWorkspace.slug,
            shareId: sharedConversationId,
          }),
        });

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toContain('not found');
      });

      it('should return 403 for non-existent workspace', async () => {
        const request = createAuthenticatedGetRequest(
          `/api/w/non-existent/chat/shared/${sharedConversationId}`,
          testUser
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: 'non-existent',
            shareId: sharedConversationId,
          }),
        });

        expect(response.status).toBe(403);
      });
    });
  });
});
