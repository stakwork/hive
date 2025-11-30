import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AgentChatMessage } from '@/app/w/[slug]/task/[...taskParams]/components/AgentChatMessage';
import { ChatMessage, ChatRole, Artifact, ArtifactType } from '@/lib/chat';
import type { AgentStreamingMessage } from '@/types/agent';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock MarkdownRenderer
vi.mock('@/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children, variant }: { children: string; variant?: 'user' | 'assistant' }) => (
    <div data-testid="markdown-renderer" data-variant={variant}>
      {children}
    </div>
  ),
}));

// Mock StreamingMessage
vi.mock('@/components/streaming', () => ({
  StreamingMessage: ({ message }: { message: AgentStreamingMessage }) => (
    <div data-testid="streaming-message">Streaming...</div>
  ),
  StreamErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock ThinkingIndicator
vi.mock('@/components/ThinkingIndicator', () => ({
  ThinkingIndicator: () => <div data-testid="thinking-indicator">Thinking...</div>,
}));

// Mock PullRequestArtifact
vi.mock('@/app/w/[slug]/task/[...taskParams]/artifacts/pull-request', () => ({
  PullRequestArtifact: ({ artifact }: { artifact: Artifact }) => (
    <div data-testid="pull-request-artifact" data-artifact-id={artifact.id}>
      Pull Request Artifact
    </div>
  ),
}));

// Helper function to create test ChatMessage
const createTestChatMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'test-message-1',
  taskId: 'test-task-1',
  message: 'Test message content',
  workflowUrl: null,
  role: ChatRole.ASSISTANT,
  timestamp: new Date(),
  contextTags: [],
  status: 'SENT' as any,
  sourceWebsocketID: null,
  replyId: null,
  artifacts: [],
  ...overrides,
});

// Helper function to create test AgentStreamingMessage
const createTestStreamingMessage = (overrides: Partial<AgentStreamingMessage> = {}): AgentStreamingMessage => ({
  id: 'test-streaming-1',
  role: 'assistant',
  content: 'Streaming content',
  isStreaming: false,
  textParts: [],
  toolCalls: [],
  reasoningParts: [],
  ...overrides,
});

describe('AgentChatMessage', () => {
  describe('Regular Chat Messages', () => {
    it('renders assistant message with content', () => {
      const message = createTestChatMessage({
        message: 'Hello from assistant',
        role: ChatRole.ASSISTANT,
      });

      render(<AgentChatMessage message={message} />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('Hello from assistant');
      expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-variant', 'assistant');
    });

    it('renders user message with content', () => {
      const message = createTestChatMessage({
        message: 'Hello from user',
        role: ChatRole.USER,
      });

      render(<AgentChatMessage message={message} />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('Hello from user');
      expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-variant', 'user');
    });

    it('renders pull request artifact', () => {
      const prArtifact: Artifact = {
        id: 'artifact-1',
        type: ArtifactType.PULL_REQUEST,
        content: {
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/1',
          repo: 'test/repo',
        },
        icon: 'git-pull-request',
      };

      const message = createTestChatMessage({
        message: 'Created a PR',
        artifacts: [prArtifact],
      });

      render(<AgentChatMessage message={message} />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('pull-request-artifact')).toBeInTheDocument();
    });
  });

  describe('Empty Message with Artifacts', () => {
    it('does not render message bubble when message is empty but has PR artifact', () => {
      const prArtifact: Artifact = {
        id: 'artifact-1',
        type: ArtifactType.PULL_REQUEST,
        content: {
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/1',
          repo: 'test/repo',
        },
        icon: 'git-pull-request',
      };

      const message = createTestChatMessage({
        message: '', // Empty message
        artifacts: [prArtifact],
      });

      render(<AgentChatMessage message={message} />);

      // Message bubble should NOT be rendered
      expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();

      // But PR artifact should still be rendered
      expect(screen.getByTestId('pull-request-artifact')).toBeInTheDocument();
    });

    it('does not render message bubble when message is empty without artifacts', () => {
      const message = createTestChatMessage({
        message: '', // Empty message
        artifacts: [],
      });

      render(<AgentChatMessage message={message} />);

      // Message bubble should NOT be rendered
      expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
    });
  });

  describe('Streaming Messages', () => {
    it('renders thinking indicator for streaming message with no visible content', () => {
      const message = createTestStreamingMessage({
        content: '',
        isStreaming: true,
        textParts: [],
        toolCalls: [],
      });

      render(<AgentChatMessage message={message} />);

      expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
    });

    it('renders streaming message component for message with tool calls', () => {
      const message = createTestStreamingMessage({
        content: 'Processing...',
        isStreaming: true,
        toolCalls: [
          {
            id: 'tool-1',
            name: 'search',
            input: { query: 'test' },
          },
        ],
      });

      render(<AgentChatMessage message={message} />);

      expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
    });

    it('renders markdown for completed streaming message', () => {
      const message = createTestStreamingMessage({
        content: 'Completed message',
        isStreaming: false,
        textParts: [],
        toolCalls: [],
      });

      render(<AgentChatMessage message={message} />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('Completed message');
    });
  });

  describe('Edge Cases', () => {
    it('handles multiple PR artifacts with empty message', () => {
      const prArtifact1: Artifact = {
        id: 'artifact-1',
        type: ArtifactType.PULL_REQUEST,
        content: {
          title: 'Test PR 1',
          url: 'https://github.com/test/repo/pull/1',
          repo: 'test/repo',
        },
        icon: 'git-pull-request',
      };

      const prArtifact2: Artifact = {
        id: 'artifact-2',
        type: ArtifactType.PULL_REQUEST,
        content: {
          title: 'Test PR 2',
          url: 'https://github.com/test/repo/pull/2',
          repo: 'test/repo',
        },
        icon: 'git-pull-request',
      };

      const message = createTestChatMessage({
        message: '',
        artifacts: [prArtifact1, prArtifact2],
      });

      render(<AgentChatMessage message={message} />);

      // Message bubble should NOT be rendered
      expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();

      // Both PR artifacts should be rendered
      const artifacts = screen.getAllByTestId('pull-request-artifact');
      expect(artifacts).toHaveLength(2);
    });

    it('filters out non-PR artifacts', () => {
      const prArtifact: Artifact = {
        id: 'artifact-1',
        type: ArtifactType.PULL_REQUEST,
        content: {
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/1',
          repo: 'test/repo',
        },
        icon: 'git-pull-request',
      };

      const formArtifact: Artifact = {
        id: 'artifact-2',
        type: ArtifactType.FORM,
        content: {
          description: 'Test form',
          options: [],
          webhook: 'https://example.com',
        },
        icon: 'form',
      };

      const message = createTestChatMessage({
        message: 'Check out this PR',
        artifacts: [prArtifact, formArtifact],
      });

      render(<AgentChatMessage message={message} />);

      // Only PR artifact should be rendered
      expect(screen.getByTestId('pull-request-artifact')).toBeInTheDocument();
      expect(screen.queryByTestId('form-artifact')).not.toBeInTheDocument();
    });
  });
});
