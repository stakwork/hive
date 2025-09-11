import { describe, it, expect } from 'vitest';
import {
  createChatMessage,
  createArtifact,
  ChatRole,
  ChatStatus,
  ArtifactType,
  type ChatMessage,
  type Artifact,
  type ContextTag,
  type CodeContent,
  type FormContent,
} from '@/lib/chat';

describe('Chat Message Creation Tests', () => {
  describe('createChatMessage', () => {
    it('should create a basic ChatMessage with required fields', () => {
      const messageData = {
        id: 'msg-123',
        message: 'Hello, world!',
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      };

      const chatMessage = createChatMessage(messageData);

      expect(chatMessage).toEqual({
        id: 'msg-123',
        taskId: null,
        message: 'Hello, world!',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: expect.any(Date),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        artifacts: [],
        attachments: [],
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should create ChatMessage with all optional fields', () => {
      const contextTags: ContextTag[] = [
        { type: 'REPO', id: 'repo-123' },
        { type: 'FILE', id: 'file-456' },
      ];

      const artifact: Artifact = {
        id: 'artifact-123',
        messageId: 'msg-123',
        type: ArtifactType.CODE,
        content: { content: 'console.log("test")', language: 'javascript' },
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const messageData = {
        id: 'msg-123',
        message: 'Test message',
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENDING,
        taskId: 'task-456',
        workflowUrl: 'https://example.com/workflow',
        contextTags,
        artifacts: [artifact],
        sourceWebsocketID: 'ws-789',
        replyId: 'reply-123',
      };

      const chatMessage = createChatMessage(messageData);

      expect(chatMessage).toEqual({
        id: 'msg-123',
        taskId: 'task-456',
        message: 'Test message',
        workflowUrl: 'https://example.com/workflow',
        role: ChatRole.ASSISTANT,
        timestamp: expect.any(Date),
        contextTags,
        status: ChatStatus.SENDING,
        sourceWebsocketID: 'ws-789',
        replyId: 'reply-123',
        artifacts: [artifact],
        attachments: [],
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should handle empty arrays for optional array fields', () => {
      const messageData = {
        id: 'msg-123',
        message: 'Test',
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        contextTags: [],
        artifacts: [],
        attachments: [],
      };

      const chatMessage = createChatMessage(messageData);

      expect(chatMessage.contextTags).toEqual([]);
      expect(chatMessage.artifacts).toEqual([]);
      expect(chatMessage.attachments).toEqual([]);
    });

    it('should set timestamps correctly', () => {
      const before = new Date();
      
      const chatMessage = createChatMessage({
        id: 'msg-123',
        message: 'Test',
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      });
      
      const after = new Date();

      expect(chatMessage.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(chatMessage.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(chatMessage.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(chatMessage.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(chatMessage.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(chatMessage.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('createArtifact', () => {
    it('should create a basic Artifact with required fields', () => {
      const artifactData = {
        id: 'artifact-123',
        messageId: 'msg-456',
        type: ArtifactType.CODE,
      };

      const artifact = createArtifact(artifactData);

      expect(artifact).toEqual({
        id: 'artifact-123',
        messageId: 'msg-456',
        type: ArtifactType.CODE,
        content: undefined,
        icon: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should create Artifact with code content', () => {
      const codeContent: CodeContent = {
        content: 'function test() { return "hello"; }',
        language: 'typescript',
        file: 'test.ts',
        change: 'Add test function',
        action: 'create',
      };

      const artifactData = {
        id: 'artifact-123',
        messageId: 'msg-456',
        type: ArtifactType.CODE,
        content: codeContent,
        icon: 'Code' as const,
      };

      const artifact = createArtifact(artifactData);

      expect(artifact).toEqual({
        id: 'artifact-123',
        messageId: 'msg-456',
        type: ArtifactType.CODE,
        content: codeContent,
        icon: 'Code',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should create Artifact with form content', () => {
      const formContent: FormContent = {
        actionText: 'Please confirm your action',
        webhook: 'https://example.com/webhook',
        options: [
          {
            actionType: 'button',
            optionLabel: 'Confirm',
            optionResponse: 'confirmed',
          },
          {
            actionType: 'chat',
            optionLabel: 'More Info',
            optionResponse: 'need_more_info',
          },
        ],
      };

      const artifactData = {
        id: 'artifact-123',
        messageId: 'msg-456',
        type: ArtifactType.FORM,
        content: formContent,
      };

      const artifact = createArtifact(artifactData);

      expect(artifact.content).toEqual(formContent);
      expect(artifact.type).toBe(ArtifactType.FORM);
    });

    it('should set timestamps correctly for artifacts', () => {
      const before = new Date();
      
      const artifact = createArtifact({
        id: 'artifact-123',
        messageId: 'msg-456',
        type: ArtifactType.CODE,
      });
      
      const after = new Date();

      expect(artifact.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(artifact.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(artifact.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(artifact.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Message Status and Role Enums', () => {
    it('should have correct ChatRole values', () => {
      expect(ChatRole.USER).toBe('USER');
      expect(ChatRole.ASSISTANT).toBe('ASSISTANT');
    });

    it('should have correct ChatStatus values', () => {
      expect(ChatStatus.SENDING).toBe('SENDING');
      expect(ChatStatus.SENT).toBe('SENT');
      expect(ChatStatus.ERROR).toBe('ERROR');
    });

    it('should support all ArtifactType values', () => {
      const supportedTypes = [
        ArtifactType.CODE,
        ArtifactType.FORM,
        ArtifactType.BROWSER,
        ArtifactType.LONGFORM,
        ArtifactType.BUG_REPORT,
      ];

      supportedTypes.forEach(type => {
        const artifact = createArtifact({
          id: `artifact-${type}`,
          messageId: 'msg-123',
          type,
        });

        expect(artifact.type).toBe(type);
      });
    });
  });

  describe('Message ID Generation Patterns', () => {
    it('should support temporary message ID pattern', () => {
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const message = createChatMessage({
        id: tempId,
        message: 'Test',
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
      });

      expect(message.id).toMatch(/^temp_\d+_[a-z0-9]+$/);
    });

    it('should support UUID-style message IDs', () => {
      const uuidStyle = 'msg-550e8400-e29b-41d4-a716-446655440000';
      
      const message = createChatMessage({
        id: uuidStyle,
        message: 'Test',
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      });

      expect(message.id).toBe(uuidStyle);
    });
  });

  describe('Message Relationships', () => {
    it('should support reply relationships', () => {
      const originalMessage = createChatMessage({
        id: 'original-123',
        message: 'Original question',
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      });

      const replyMessage = createChatMessage({
        id: 'reply-456',
        message: 'Reply to original',
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        replyId: originalMessage.id,
      });

      expect(replyMessage.replyId).toBe(originalMessage.id);
    });

    it('should support task relationships', () => {
      const taskId = 'task-789';
      
      const message = createChatMessage({
        id: 'msg-123',
        message: 'Task message',
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        taskId,
      });

      expect(message.taskId).toBe(taskId);
    });

    it('should support websocket source tracking', () => {
      const websocketId = 'ws-connection-123';
      
      const message = createChatMessage({
        id: 'msg-123',
        message: 'Websocket message',
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        sourceWebsocketID: websocketId,
      });

      expect(message.sourceWebsocketID).toBe(websocketId);
    });
  });
});