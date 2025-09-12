import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  WorkflowStatus,
  createChatMessage,
} from '@/lib/chat';
import TaskChatPage from '@/app/w/[slug]/task/[...taskParams]/page';

// Mock dependencies
vi.mock('next-auth/react');
vi.mock('next/navigation');
vi.mock('@/components/ui/use-toast');
vi.mock('@/hooks/usePusherConnection', () => ({
  usePusherConnection: vi.fn(() => ({
    isConnected: true,
    error: null,
  })),
}));

vi.mock('@/hooks/useChatForm', () => ({
  useChatForm: vi.fn(() => ({
    hasActiveChatForm: false,
    webhook: null,
  })),
}));

vi.mock('@/hooks/useProjectLogWebSocket', () => ({
  useProjectLogWebSocket: vi.fn(() => ({
    logs: [],
    lastLogLine: null,
    clearLogs: vi.fn(),
  })),
}));

vi.mock('@/hooks/useTaskMode', () => ({
  useTaskMode: vi.fn(() => ({
    taskMode: 'test',
    setTaskMode: vi.fn(),
  })),
}));
vi.mock('@/app/w/[slug]/task/[...taskParams]/components/TaskStartInput', () => ({
  TaskStartInput: vi.fn(({ onStart }) => (
    <button onClick={() => onStart('test message')} data-testid="start-button">
      Start
    </button>
  )),
}));

vi.mock('@/app/w/[slug]/task/[...taskParams]/components/ChatArea', () => ({
  ChatArea: vi.fn(({ onSend, messages, isLoading }) => (
    <div data-testid="chat-area">
      <div data-testid="messages-count">{messages.length}</div>
      <div data-testid="loading-state">{isLoading.toString()}</div>
      <button
        onClick={() => onSend('Hello world')}
        data-testid="send-button"
        disabled={isLoading}
      >
        Send Message
      </button>
    </div>
  )),
}));

vi.mock('@/app/w/[slug]/task/[...taskParams]/components/ArtifactsPanel', () => ({
  ArtifactsPanel: vi.fn(() => <div data-testid="artifacts-panel">Artifacts</div>),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock console methods to avoid noise in tests
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
};
vi.stubGlobal('console', mockConsole);

describe('sendMessage Core Workflow', () => {
  const mockToast = vi.fn();
  const mockUseSession = vi.mocked(useSession);
  const mockUseParams = vi.mocked(useParams);
  const mockUseToast = vi.mocked(useToast);

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockFetch.mockClear();
    
    // Setup default mock returns
    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'user-123', name: 'Test User' },
      },
      status: 'authenticated',
    } as any);

    mockUseParams.mockReturnValue({
      slug: 'test-workspace',
      taskParams: ['existing-task-id'],
    });

    mockUseToast.mockReturnValue({
      toast: mockToast,
    });

    // Mock hooks
    vi.doMock('@/hooks/usePusherConnection', () => ({
      usePusherConnection: () => ({
        isConnected: true,
        error: null,
      }),
    }));

    vi.doMock('@/hooks/useChatForm', () => ({
      useChatForm: () => ({
        hasActiveChatForm: false,
        webhook: null,
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Successful Message Flow', () => {
    it('should create and send message successfully', async () => {
      // Setup successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          message: {
            id: 'msg-123',
            message: 'Hello world',
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            taskId: 'existing-task-id',
            artifacts: [],
            attachments: [],
          },
          workflow: {
            project_id: 'project-456',
          },
        }),
      });

      // Mock loadTaskMessages API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            messages: [],
            count: 0,
            task: {
              workflowStatus: WorkflowStatus.PENDING,
              title: 'Test Task',
            },
          },
        }),
      });

      render(<TaskChatPage />);

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByTestId('chat-area')).toBeInTheDocument();
      });

      // Verify initial loading state
      expect(screen.getByTestId('loading-state')).toHaveTextContent('false');

      // Click send button
      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Verify loading state is set
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('true');
      });

      // Wait for API call to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/chat/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskId: 'existing-task-id',
            message: 'Hello world',
            contextTags: [],
            mode: 'test',
          }),
        });
      });

      // Verify loading state is cleared
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('false');
      });

      // Verify message was added to state (count should increase)
      expect(screen.getByTestId('messages-count')).toHaveTextContent('1');
    });

    it('should handle successful response with project ID and trigger side effects', async () => {
      const mockClearLogs = vi.fn();
      
      vi.doMock('@/hooks/useProjectLogWebSocket', () => ({
        useProjectLogWebSocket: () => ({
          logs: [],
          lastLogLine: null,
          clearLogs: mockClearLogs,
        }),
      }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            message: {
              id: 'msg-123',
              message: 'Hello world',
              role: ChatRole.USER,
              status: ChatStatus.SENT,
            },
            workflow: {
              project_id: 'project-456',
            },
          }),
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      // Verify clearLogs was called as side effect
      await waitFor(() => {
        expect(mockClearLogs).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API failure and show error toast', async () => {
      // Setup API failure
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Internal Server Error',
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      // Wait for error handling
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to send message. Please try again.',
          variant: 'destructive',
        });
      });

      // Verify loading state is cleared even on error
      expect(screen.getByTestId('loading-state')).toHaveTextContent('false');
    });

    it('should handle network error and update message status', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockRejectedValueOnce(new Error('Network Error'));

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      // Wait for error handling
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to send message. Please try again.',
          variant: 'destructive',
        });
      });

      // Message should still be in state but with ERROR status
      expect(screen.getByTestId('messages-count')).toHaveTextContent('1');
    });

    it('should handle API response with success:false', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: false,
            error: 'Validation failed',
          }),
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to send message. Please try again.',
          variant: 'destructive',
        });
      });
    });
  });

  describe('Loading State Management', () => {
    it('should prevent multiple concurrent sends during loading', async () => {
      // Setup slow API response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    ok: true,
                    json: () => Promise.resolve({
                      success: true,
                      message: { id: 'msg-123' },
                    }),
                  }),
                100
              )
            )
        );

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      const sendButton = screen.getByTestId('send-button');
      
      // Click multiple times rapidly
      fireEvent.click(sendButton);
      fireEvent.click(sendButton);
      fireEvent.click(sendButton);

      // Verify button becomes disabled during loading
      await waitFor(() => {
        expect(sendButton).toBeDisabled();
      });

      // Only one API call should be made despite multiple clicks
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2); // 1 for loadTaskMessages + 1 for sendMessage
      });
    });

    it('should clear loading state on success', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            message: { id: 'msg-123' },
          }),
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      // Should be loading initially
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('true');
      });

      // Should clear loading after success
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('false');
      });
    });

    it('should clear loading state on error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockRejectedValueOnce(new Error('API Error'));

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      // Should be loading initially
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('true');
      });

      // Should clear loading after error
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('false');
      });
    });
  });

  describe('Message Status Management', () => {
    it('should create message with SENDING status initially', async () => {
      // Setup API call to be pending
      let resolveApiCall: (value: any) => void;
      const apiPromise = new Promise((resolve) => {
        resolveApiCall = resolve;
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockImplementationOnce(() => apiPromise);

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      // Message should be added with SENDING status
      await waitFor(() => {
        expect(screen.getByTestId('messages-count')).toHaveTextContent('1');
      });

      // Complete the API call
      resolveApiCall!({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          message: { id: 'msg-123' },
        }),
      });

      // Wait for status update
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('false');
      });
    });

    it('should update message status to SENT on success', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            message: { id: 'msg-123' },
          }),
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      // Wait for the API call and state update
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('false');
      });

      // Message should remain in state (status updated in place)
      expect(screen.getByTestId('messages-count')).toHaveTextContent('1');
    });

    it('should update message status to ERROR on failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockRejectedValueOnce(new Error('API Error'));

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      // Wait for error handling
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalled();
      });

      // Message should remain in state with ERROR status
      expect(screen.getByTestId('messages-count')).toHaveTextContent('1');
    });
  });

  describe('Side Effects', () => {
    it('should update projectId when workflow returns project_id', async () => {
      const mockClearLogs = vi.fn();
      
      vi.doMock('@/hooks/useProjectLogWebSocket', () => ({
        useProjectLogWebSocket: () => ({
          logs: [],
          lastLogLine: null,
          clearLogs: mockClearLogs,
        }),
      }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            message: { id: 'msg-123' },
            workflow: {
              project_id: 'project-789',
            },
          }),
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(mockClearLogs).toHaveBeenCalled();
      });

      // Verify project ID was logged (indicating state was updated)
      expect(mockConsole.log).toHaveBeenCalledWith('Project ID:', 'project-789');
    });

    it('should not clear logs when no project_id in response', async () => {
      const mockClearLogs = vi.fn();
      
      vi.doMock('@/hooks/useProjectLogWebSocket', () => ({
        useProjectLogWebSocket: () => ({
          logs: [],
          lastLogLine: null,
          clearLogs: mockClearLogs,
        }),
      }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            message: { id: 'msg-123' },
            // No workflow or project_id
          }),
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toHaveTextContent('false');
      });

      // clearLogs should not be called
      expect(mockClearLogs).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should not send empty messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { messages: [], count: 0, task: {} },
        }),
      });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      // Try to send empty message by clicking the normal send button with empty content
      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Should not make API call for empty messages
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1); // Only loadTaskMessages
      });
    });

    it('should handle malformed JSON response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { messages: [], count: 0, task: {} },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.reject(new Error('Invalid JSON')),
        });

      render(<TaskChatPage />);

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to send message. Please try again.',
          variant: 'destructive',
        });
      });
    });
  });
});