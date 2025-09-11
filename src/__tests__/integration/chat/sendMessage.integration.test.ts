import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ToastProvider } from '@/components/ui/toast-provider';
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  ArtifactType,
  createChatMessage,
} from '@/lib/chat';

// Mock external dependencies
vi.mock('next-auth/react');
vi.mock('next/navigation');
vi.mock('@/hooks/usePusherConnection');
vi.mock('@/hooks/useProjectLogWebSocket');
vi.mock('@/hooks/useTaskMode');
vi.mock('@/hooks/useChatForm');

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock component for testing sendMessage in isolation
const MockChatComponent = () => {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [isChainVisible, setIsChainVisible] = React.useState(false);

  const sendMessage = async (messageText: string) => {
    if (isLoading) return;

    const newMessage: ChatMessage = createChatMessage({
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      message: messageText,
      role: ChatRole.USER,
      status: ChatStatus.SENDING,
    });

    setMessages((msgs) => [...msgs, newMessage]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: 'test-task-123',
          message: messageText,
          contextTags: [],
          mode: 'test',
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to send message');
      }

      if (result.workflow?.project_id) {
        setProjectId(result.workflow.project_id);
        setIsChainVisible(true);
      }

      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg
        )
      );
    } catch (error) {
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div data-testid="message-count">{messages.length}</div>
      <div data-testid="loading-state">{isLoading ? 'loading' : 'idle'}</div>
      <div data-testid="project-id">{projectId || 'none'}</div>
      <div data-testid="chain-visible">{isChainVisible ? 'visible' : 'hidden'}</div>
      
      {messages.map((msg, index) => (
        <div key={msg.id} data-testid={`message-${index}`}>
          <span data-testid={`message-${index}-status`}>{msg.status}</span>
          <span data-testid={`message-${index}-content`}>{msg.message}</span>
          <span data-testid={`message-${index}-role`}>{msg.role}</span>
        </div>
      ))}
      
      <button
        data-testid="send-button"
        onClick={() => sendMessage('Test message')}
        disabled={isLoading}
      >
        Send Message
      </button>
    </div>
  );
};

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <ToastProvider>
      {component}
    </ToastProvider>
  );
};

describe('SendMessage Integration Tests', () => {
  beforeEach(() => {
    // Mock session
    (useSession as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: {
          id: 'test-user-123',
          name: 'Test User',
          email: 'test@example.com',
        },
      },
      status: 'authenticated',
    });

    // Mock router
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      refresh: vi.fn(),
    });

    // Mock other hooks
    vi.doMock('@/hooks/usePusherConnection', () => ({
      usePusherConnection: () => ({
        isConnected: true,
        error: null,
      }),
    }));

    vi.doMock('@/hooks/useProjectLogWebSocket', () => ({
      useProjectLogWebSocket: () => ({
        logs: [],
        lastLogLine: null,
        clearLogs: vi.fn(),
      }),
    }));

    vi.doMock('@/hooks/useTaskMode', () => ({
      useTaskMode: () => ({
        taskMode: 'test',
        setTaskMode: vi.fn(),
      }),
    }));

    vi.doMock('@/hooks/useChatForm', () => ({
      useChatForm: () => ({
        hasActiveChatForm: false,
        webhook: null,
      }),
    }));

    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete Workflow Integration', () => {
    it('should handle successful message sending workflow', async () => {
      const mockSuccessResponse = {
        ok: true,
        json: () => Promise.resolve({
          success: true,
          message: {
            id: 'response-msg-123',
            message: 'Response message',
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
          },
          workflow: {
            project_id: 'project-456',
          },
        }),
      };

      mockFetch.mockResolvedValueOnce(mockSuccessResponse);

      renderWithProviders(<MockChatComponent />);

      // Initial state
      expect(screen.getByTestId('message-count')).toHaveTextContent('0');
      expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');
      expect(screen.getByTestId('project-id')).toHaveTextContent('none');
      expect(screen.getByTestId('chain-visible')).toHaveTextContent('hidden');

      // Send message
      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Check loading state
      expect(screen.getByTestId('loading-state')).toHaveTextContent('loading');
      expect(screen.getByTestId('message-count')).toHaveTextContent('1');

      // Check initial message state
      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.SENDING);
      expect(screen.getByTestId('message-0-content')).toHaveTextContent('Test message');
      expect(screen.getByTestId('message-0-role')).toHaveTextContent(ChatRole.USER);

      // Wait for API call completion
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');
      });

      // Check final state
      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.SENT);
      expect(screen.getByTestId('project-id')).toHaveTextContent('project-456');
      expect(screen.getByTestId('chain-visible')).toHaveTextContent('visible');

      // Verify API call
      expect(mockFetch).toHaveBeenCalledWith('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: 'test-task-123',
          message: 'Test message',
          contextTags: [],
          mode: 'test',
        }),
      });
    });

    it('should handle API error scenarios', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({
          success: false,
          error: 'Server error occurred',
        }),
      };

      mockFetch.mockResolvedValueOnce(mockErrorResponse);

      renderWithProviders(<MockChatComponent />);

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Wait for error handling
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');
      });

      // Check error state
      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.ERROR);
      expect(screen.getByTestId('project-id')).toHaveTextContent('none');
      expect(screen.getByTestId('chain-visible')).toHaveTextContent('hidden');
    });

    it('should handle network failure scenarios', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      renderWithProviders(<MockChatComponent />);

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');
      });

      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.ERROR);
    });

    it('should prevent multiple simultaneous sends', async () => {
      const mockResponse = {
        ok: true,
        json: () => new Promise(resolve => setTimeout(resolve, 100)), // Delayed response
      };

      mockFetch.mockResolvedValue(mockResponse);

      renderWithProviders(<MockChatComponent />);

      const sendButton = screen.getByTestId('send-button');
      
      // First click
      fireEvent.click(sendButton);
      expect(screen.getByTestId('loading-state')).toHaveTextContent('loading');
      expect(screen.getByTestId('message-count')).toHaveTextContent('1');

      // Second click while loading - should be prevented
      fireEvent.click(sendButton);
      expect(screen.getByTestId('message-count')).toHaveTextContent('1'); // Still only 1 message
    });
  });

  describe('Message Status Transitions', () => {
    it('should properly transition message status from SENDING to SENT', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          success: true,
          message: {},
        }),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      renderWithProviders(<MockChatComponent />);

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Initial SENDING status
      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.SENDING);

      // Wait for SENT status
      await waitFor(() => {
        expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.SENT);
      });
    });

    it('should transition message status to ERROR on API failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API Error'));

      renderWithProviders(<MockChatComponent />);

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.SENDING);

      await waitFor(() => {
        expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.ERROR);
      });
    });
  });

  describe('UI State Management', () => {
    it('should manage loading state throughout the workflow', async () => {
      let resolveResponse: (value: any) => void;
      const responsePromise = new Promise(resolve => {
        resolveResponse = resolve;
      });

      const mockResponse = {
        ok: true,
        json: () => responsePromise,
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      renderWithProviders(<MockChatComponent />);

      // Initial idle state
      expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Loading state during API call
      expect(screen.getByTestId('loading-state')).toHaveTextContent('loading');

      // Resolve the API response
      resolveResponse!({ success: true, message: {} });

      // Back to idle state
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');
      });
    });

    it('should update project ID and chain visibility on workflow response', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          success: true,
          message: {},
          workflow: {
            project_id: 'workflow-project-123',
          },
        }),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      renderWithProviders(<MockChatComponent />);

      expect(screen.getByTestId('project-id')).toHaveTextContent('none');
      expect(screen.getByTestId('chain-visible')).toHaveTextContent('hidden');

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByTestId('project-id')).toHaveTextContent('workflow-project-123');
        expect(screen.getByTestId('chain-visible')).toHaveTextContent('visible');
      });
    });

    it('should maintain message list integrity during operations', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          success: true,
          message: {},
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      renderWithProviders(<MockChatComponent />);

      // Send first message
      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');
      });

      expect(screen.getByTestId('message-count')).toHaveTextContent('1');
      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.SENT);

      // Send second message
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('idle');
      });

      expect(screen.getByTestId('message-count')).toHaveTextContent('2');
      expect(screen.getByTestId('message-0-status')).toHaveTextContent(ChatStatus.SENT);
      expect(screen.getByTestId('message-1-status')).toHaveTextContent(ChatStatus.SENT);
    });
  });
});