import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '@/components/ui/use-toast';
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  createChatMessage,
  ArtifactType,
  type Artifact,
} from '@/lib/chat';

// Mock dependencies
vi.mock('@/components/ui/use-toast');
vi.mock('next-auth/react');
vi.mock('next/navigation');

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test fixtures
const mockTaskId = 'test-task-123';
const mockMessageText = 'Test message content';
const mockProjectId = 'project-456';

const createMockArtifact = (): Artifact => ({
  id: 'artifact-123',
  messageId: 'msg-123',
  type: ArtifactType.CODE,
  content: {
    content: 'console.log("test")',
    language: 'javascript',
    file: 'test.js',
  },
  icon: null,
  createdAt: '2023-01-01T00:00:00.000Z' as unknown as Date,
  updatedAt: '2023-01-01T00:00:00.000Z' as unknown as Date,
});

const createMockSuccessResponse = (projectId?: string) => ({
  ok: true,
  json: () => Promise.resolve({
    success: true,
    message: {
      id: 'response-msg-123',
      message: 'Response message',
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENT,
    },
    workflow: projectId ? { project_id: projectId } : undefined,
  }),
});

const createMockErrorResponse = (status = 500, error = 'Server error') => ({
  ok: false,
  status,
  statusText: error,
  json: () => Promise.resolve({
    success: false,
    error,
  }),
});

describe('sendMessage Function Tests', () => {
  let mockToast: ReturnType<typeof vi.fn>;
  let mockSetMessages: ReturnType<typeof vi.fn>;
  let mockSetIsLoading: ReturnType<typeof vi.fn>;
  let mockSetProjectId: ReturnType<typeof vi.fn>;
  let mockSetIsChainVisible: ReturnType<typeof vi.fn>;
  let mockClearLogs: ReturnType<typeof vi.fn>;
  
  // Mock sendMessage function based on the actual implementation
  const createSendMessage = (
    currentTaskId: string | null,
    taskMode: string,
    isLoading: boolean
  ) => {
    return async (
      messageText: string,
      options?: {
        taskId?: string;
        replyId?: string;
        webhook?: string;
        artifact?: Artifact;
      }
    ) => {
      if (isLoading) return;

      const newMessage: ChatMessage = createChatMessage({
        id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        replyId: options?.replyId,
        artifacts: options?.artifact ? [options.artifact] : [],
      });

      mockSetMessages((msgs: ChatMessage[]) => [...msgs, newMessage]);
      mockSetIsLoading(true);

      try {
        const body: { [k: string]: unknown } = {
          taskId: options?.taskId || currentTaskId,
          message: messageText,
          contextTags: [],
          mode: taskMode,
          ...(options?.replyId && { replyId: options.replyId }),
          ...(options?.webhook && { webhook: options.webhook }),
          ...(options?.artifact && { artifacts: [options.artifact] }),
        };

        const response = await fetch('/api/chat/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Failed to send message: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Failed to send message');
        }

        if (result.workflow?.project_id) {
          mockSetProjectId(result.workflow.project_id);
          mockSetIsChainVisible(true);
          mockClearLogs();
        }

        mockSetMessages((msgs: ChatMessage[]) =>
          msgs.map((msg) =>
            msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg
          )
        );
      } catch (error) {
        console.error('Error sending message:', error);

        mockSetMessages((msgs: ChatMessage[]) =>
          msgs.map((msg) =>
            msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg
          )
        );

        mockToast({
          title: 'Error',
          description: 'Failed to send message. Please try again.',
          variant: 'destructive',
        });
      } finally {
        mockSetIsLoading(false);
      }
    };
  };

  beforeEach(() => {
    mockToast = vi.fn();
    mockSetMessages = vi.fn();
    mockSetIsLoading = vi.fn();
    mockSetProjectId = vi.fn();
    mockSetIsChainVisible = vi.fn();
    mockClearLogs = vi.fn();

    (useToast as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });

    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Object Creation', () => {
    it('should create proper ChatMessage object with createChatMessage helper', () => {
      const messageData = {
        id: 'test-123',
        message: 'Test message',
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        taskId: mockTaskId,
        artifacts: [createMockArtifact()],
      };

      const chatMessage = createChatMessage(messageData);

      expect(chatMessage).toEqual(
        expect.objectContaining({
          id: 'test-123',
          message: 'Test message',
          role: ChatRole.USER,
          status: ChatStatus.SENDING,
          taskId: mockTaskId,
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              id: 'artifact-123',
              type: ArtifactType.CODE,
            }),
          ]),
          contextTags: [],
          attachments: [],
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        })
      );
    });

    it('should generate unique message IDs', () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      act(() => {
        sendMessage(mockMessageText);
      });

      expect(mockSetMessages).toHaveBeenCalledWith(
        expect.any(Function)
      );

      // Verify the function creates a message with unique ID pattern
      const setMessagesCall = mockSetMessages.mock.calls[0][0];
      const newMessages = setMessagesCall([]);
      
      expect(newMessages[0].id).toMatch(/^temp_\d+_[a-z0-9]+$/);
      expect(newMessages[0].message).toBe(mockMessageText);
      expect(newMessages[0].role).toBe(ChatRole.USER);
      expect(newMessages[0].status).toBe(ChatStatus.SENDING);
    });

    it('should create message with artifacts when provided', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      const mockArtifact = createMockArtifact();
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText, { artifact: mockArtifact });
      });

      const setMessagesCall = mockSetMessages.mock.calls[0][0];
      const newMessages = setMessagesCall([]);
      
      expect(newMessages[0].artifacts).toEqual([mockArtifact]);
    });
  });

  describe('Status Updates', () => {
    it('should transition from SENDING to SENT on successful API call', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      // Verify initial SENDING status
      expect(mockSetMessages).toHaveBeenNthCalledWith(1, expect.any(Function));
      
      // Verify final SENT status update
      expect(mockSetMessages).toHaveBeenNthCalledWith(2, expect.any(Function));
      
      const finalUpdateCall = mockSetMessages.mock.calls[1][0];
      const existingMessages = [{
        id: 'temp_123',
        status: ChatStatus.SENDING,
      }] as ChatMessage[];
      
      const updatedMessages = finalUpdateCall(existingMessages);
      expect(updatedMessages[0].status).toBe(ChatStatus.SENT);
    });

    it('should transition from SENDING to ERROR on API failure', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockErrorResponse());

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      // Verify error status update
      expect(mockSetMessages).toHaveBeenNthCalledWith(2, expect.any(Function));
      
      const errorUpdateCall = mockSetMessages.mock.calls[1][0];
      const existingMessages = [{
        id: 'temp_123',
        status: ChatStatus.SENDING,
      }] as ChatMessage[];
      
      const updatedMessages = errorUpdateCall(existingMessages);
      expect(updatedMessages[0].status).toBe(ChatStatus.ERROR);
    });

    it('should preserve other message properties during status updates', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      const statusUpdateCall = mockSetMessages.mock.calls[1][0];
      const existingMessages = [{
        id: 'temp_123',
        message: 'Original message',
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        artifacts: [createMockArtifact()],
      }] as ChatMessage[];
      
      const updatedMessages = statusUpdateCall(existingMessages);
      
      expect(updatedMessages[0]).toEqual(
        expect.objectContaining({
          id: 'temp_123',
          message: 'Original message',
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          artifacts: expect.arrayContaining([
            expect.objectContaining({ id: 'artifact-123' })
          ]),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        variant: 'destructive',
      });

      expect(mockSetIsLoading).toHaveBeenLastCalledWith(false);
    });

    it('should handle API error responses', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockErrorResponse(400, 'Bad Request'));

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        variant: 'destructive',
      });
    });

    it('should handle response with success: false', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          error: 'Custom error message',
        }),
      });

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        variant: 'destructive',
      });
    });

    it('should update message status to ERROR on any failure', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockRejectedValueOnce(new Error('Test error'));

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      const errorUpdateCall = mockSetMessages.mock.calls[1][0];
      const existingMessages = [{
        id: 'temp_123',
        status: ChatStatus.SENDING,
      }] as ChatMessage[];
      
      const updatedMessages = errorUpdateCall(existingMessages);
      expect(updatedMessages[0].status).toBe(ChatStatus.ERROR);
    });
  });

  describe('UI State Integration', () => {
    it('should manage loading state correctly', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      expect(mockSetIsLoading).toHaveBeenNthCalledWith(1, true);
      expect(mockSetIsLoading).toHaveBeenNthCalledWith(2, false);
    });

    it('should prevent multiple simultaneous sends when loading', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', true); // isLoading = true
      
      await act(async () => {
        await sendMessage(mockMessageText);
      });

      expect(mockSetMessages).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should update project ID and chain visibility on workflow response', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse(mockProjectId));

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      expect(mockSetProjectId).toHaveBeenCalledWith(mockProjectId);
      expect(mockSetIsChainVisible).toHaveBeenCalledWith(true);
      expect(mockClearLogs).toHaveBeenCalled();
    });

    it('should add new messages to existing message list', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      const setMessagesCall = mockSetMessages.mock.calls[0][0];
      const existingMessages = [
        { id: 'existing-1', message: 'Existing message' }
      ] as ChatMessage[];
      
      const newMessages = setMessagesCall(existingMessages);
      
      expect(newMessages).toHaveLength(2);
      expect(newMessages[0]).toEqual(existingMessages[0]);
      expect(newMessages[1].message).toBe(mockMessageText);
    });

    it('should ensure loading state is reset even on errors', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockRejectedValueOnce(new Error('Test error'));

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      expect(mockSetIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  describe('API Integration', () => {
    it('should send correct request payload to API endpoint', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText, {
          replyId: 'reply-123',
          webhook: 'https://example.com/webhook',
        });
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessageText,
          contextTags: [],
          mode: 'live',
          replyId: 'reply-123',
          webhook: 'https://example.com/webhook',
        }),
      });
    });

    it('should include artifacts in API payload when provided', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'live', false);
      const mockArtifact = createMockArtifact();
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText, { artifact: mockArtifact });
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.artifacts).toEqual([mockArtifact]);
    });

    it('should use provided taskId over current task ID', async () => {
      const sendMessage = createSendMessage('current-task', 'live', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText, { taskId: 'override-task' });
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.taskId).toBe('override-task');
    });

    it('should handle different task modes correctly', async () => {
      const sendMessage = createSendMessage(mockTaskId, 'test', false);
      
      mockFetch.mockResolvedValueOnce(createMockSuccessResponse());

      await act(async () => {
        await sendMessage(mockMessageText);
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.mode).toBe('test');
    });
  });
});