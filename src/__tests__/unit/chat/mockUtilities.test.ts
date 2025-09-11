import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateFormResponse,
  generateChatFormResponse,
  generateCodeResponse,
  generateBugReportResponse,
} from '@/app/api/mock/responses';
import {
  createChatMessage,
  createArtifact,
  ChatRole,
  ChatStatus,
  ArtifactType,
} from '@/lib/chat';

describe('Mock Utilities for sendMessage Testing', () => {
  describe('Mock Response Generators', () => {
    it('should generate form response with proper structure', () => {
      const response = generateFormResponse();

      expect(response).toEqual({
        message: 'I\'ll help you build a connection leak monitor. Here\'s my plan:',
        contextTags: [],
        sourceWebsocketID: null,
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            type: ArtifactType.FORM,
            content: expect.objectContaining({
              actionText: 'Here\'s my plan to implement the connection leak monitor:',
              webhook: 'https://stakwork.com/api/chat/confirm',
              options: expect.arrayContaining([
                expect.objectContaining({
                  actionType: 'button',
                  optionLabel: '✓ Confirm Plan',
                  optionResponse: 'confirmed',
                }),
                expect.objectContaining({
                  actionType: 'button',
                  optionLabel: '✗ Modify Plan',
                  optionResponse: 'modify',
                }),
              ]),
            }),
          }),
        ]),
      });
    });

    it('should generate chat form response for user input collection', () => {
      const response = generateChatFormResponse();

      expect(response).toEqual({
        message: 'I need some additional information to proceed with your request:',
        contextTags: [],
        sourceWebsocketID: null,
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            type: ArtifactType.FORM,
            content: expect.objectContaining({
              actionText: 'Please provide more details about what you\'d like me to help you with. You can type your response in the input field below.',
              webhook: 'https://stakwork.com/api/chat/details',
              options: expect.arrayContaining([
                expect.objectContaining({
                  actionType: 'chat',
                  optionLabel: 'Provide Details',
                  optionResponse: 'user_details_provided',
                }),
              ]),
            }),
          }),
        ]),
      });
    });

    it('should generate code response with multiple artifacts', () => {
      const response = generateCodeResponse();

      expect(response).toEqual({
        message: 'Perfect! I\'ve created the connection leak monitor implementation. Here\'s what I\'ve built:',
        contextTags: [],
        sourceWebsocketID: null,
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            type: ArtifactType.CODE,
            content: expect.objectContaining({
              file: 'stakwork/senza-lnd/lib/connection_leak_monitor.rb',
              change: 'Create main connection leak monitor class',
              action: 'create',
            }),
          }),
          expect.objectContaining({
            type: ArtifactType.CODE,
            content: expect.objectContaining({
              file: 'stakwork/senza-lnd/config/database.json',
              change: 'Add Aurora Postgres database configuration with connection leak monitoring settings',
              action: 'create',
            }),
          }),
        ]),
      });
      
      expect(response.artifacts).toHaveLength(2);
    });

    it('should generate bug report response from artifacts', () => {
      const mockBugReportArtifacts = [
        {
          type: 'BUG_REPORT',
          content: {
            sourceFiles: [
              {
                file: 'components/Button.tsx',
                message: '🐛 Found issue in Button component: missing onClick handler',
                context: 'Button component analysis',
              },
            ],
          },
        },
      ];

      const response = generateBugReportResponse(mockBugReportArtifacts);

      expect(response).toEqual({
        message: '🐛 Found issue in Button component: missing onClick handler',
        contextTags: [],
        sourceWebsocketID: null,
        artifacts: [],
      });
    });

    it('should handle empty bug report artifacts gracefully', () => {
      const response = generateBugReportResponse([]);

      expect(response).toEqual({
        message: 'No debug information found in the request.',
        contextTags: [],
        sourceWebsocketID: null,
        artifacts: [],
      });
    });
  });

  describe('Message and Artifact Creation Utilities', () => {
    it('should create mock chat message for testing', () => {
      const mockData = {
        id: 'test-msg-123',
        message: 'Test message content',
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        taskId: 'test-task-456',
      };

      const chatMessage = createChatMessage(mockData);

      expect(chatMessage).toEqual(
        expect.objectContaining({
          id: 'test-msg-123',
          message: 'Test message content',
          role: ChatRole.USER,
          status: ChatStatus.SENDING,
          taskId: 'test-task-456',
          contextTags: [],
          artifacts: [],
          attachments: [],
        })
      );
    });

    it('should create mock artifact for testing', () => {
      const mockData = {
        id: 'test-artifact-123',
        messageId: 'test-msg-456',
        type: ArtifactType.CODE,
        content: {
          content: 'function test() { return "mock"; }',
          language: 'javascript',
          file: 'test.js',
        },
        icon: 'Code' as const,
      };

      const artifact = createArtifact(mockData);

      expect(artifact).toEqual(
        expect.objectContaining({
          id: 'test-artifact-123',
          messageId: 'test-msg-456',
          type: ArtifactType.CODE,
          content: {
            content: 'function test() { return "mock"; }',
            language: 'javascript',
            file: 'test.js',
          },
          icon: 'Code',
        })
      );
    });
  });

  describe('Test Fixture Creation', () => {
    let testFixtures: {
      userMessage: ReturnType<typeof createChatMessage>;
      assistantMessage: ReturnType<typeof createChatMessage>;
      codeArtifact: ReturnType<typeof createArtifact>;
      formArtifact: ReturnType<typeof createArtifact>;
    };

    beforeEach(() => {
      testFixtures = {
        userMessage: createChatMessage({
          id: 'user-msg-1',
          message: 'Create a login form',
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          taskId: 'task-123',
        }),
        assistantMessage: createChatMessage({
          id: 'assistant-msg-1',
          message: 'I\'ll create a login form for you.',
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          taskId: 'task-123',
          replyId: 'user-msg-1',
        }),
        codeArtifact: createArtifact({
          id: 'code-artifact-1',
          messageId: 'assistant-msg-1',
          type: ArtifactType.CODE,
          content: {
            content: '<form><input type="email" /><button>Login</button></form>',
            language: 'html',
            file: 'login.html',
            action: 'create',
          },
        }),
        formArtifact: createArtifact({
          id: 'form-artifact-1',
          messageId: 'assistant-msg-1',
          type: ArtifactType.FORM,
          content: {
            actionText: 'Would you like me to add validation?',
            webhook: 'https://example.com/webhook',
            options: [
              {
                actionType: 'button',
                optionLabel: 'Yes, add validation',
                optionResponse: 'add_validation',
              },
              {
                actionType: 'button',
                optionLabel: 'No, keep it simple',
                optionResponse: 'keep_simple',
              },
            ],
          },
        }),
      };
    });

    it('should create complete message conversation fixtures', () => {
      const { userMessage, assistantMessage } = testFixtures;

      expect(userMessage.role).toBe(ChatRole.USER);
      expect(assistantMessage.role).toBe(ChatRole.ASSISTANT);
      expect(assistantMessage.replyId).toBe(userMessage.id);
      expect(assistantMessage.taskId).toBe(userMessage.taskId);
    });

    it('should create artifact fixtures with proper message relationships', () => {
      const { assistantMessage, codeArtifact, formArtifact } = testFixtures;

      expect(codeArtifact.messageId).toBe(assistantMessage.id);
      expect(formArtifact.messageId).toBe(assistantMessage.id);
      expect(codeArtifact.type).toBe(ArtifactType.CODE);
      expect(formArtifact.type).toBe(ArtifactType.FORM);
    });

    it('should support message status transitions in fixtures', () => {
      const sendingMessage = createChatMessage({
        ...testFixtures.userMessage,
        id: 'sending-msg',
        status: ChatStatus.SENDING,
      });

      const sentMessage = { ...sendingMessage, status: ChatStatus.SENT };
      const errorMessage = { ...sendingMessage, status: ChatStatus.ERROR };

      expect(sendingMessage.status).toBe(ChatStatus.SENDING);
      expect(sentMessage.status).toBe(ChatStatus.SENT);
      expect(errorMessage.status).toBe(ChatStatus.ERROR);
    });
  });

  describe('Mock API Response Simulation', () => {
    it('should simulate successful sendMessage API response', () => {
      const mockResponse = {
        success: true,
        message: createChatMessage({
          id: 'response-msg-123',
          message: 'Message received successfully',
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          taskId: 'task-456',
        }),
        workflow: {
          project_id: 'project-789',
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.message.status).toBe(ChatStatus.SENT);
      expect(mockResponse.workflow.project_id).toBe('project-789');
    });

    it('should simulate error sendMessage API response', () => {
      const mockErrorResponse = {
        success: false,
        error: 'Failed to process message',
      };

      expect(mockErrorResponse.success).toBe(false);
      expect(mockErrorResponse.error).toBe('Failed to process message');
    });

    it('should simulate network error scenarios', () => {
      const networkError = new Error('Network request failed');
      const timeoutError = new Error('Request timeout');
      const serverError = new Error('Internal server error');

      expect(networkError.message).toBe('Network request failed');
      expect(timeoutError.message).toBe('Request timeout');
      expect(serverError.message).toBe('Internal server error');
    });
  });
});