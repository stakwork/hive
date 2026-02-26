import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { motion } from 'framer-motion';
import { ChatMessage } from '@/app/w/[slug]/task/[...taskParams]/components/ChatMessage';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { WorkflowUrlLink } from '@/app/w/[slug]/task/[...taskParams]/components/WorkflowUrlLink';
import { FormArtifact } from '@/app/w/[slug]/task/[...taskParams]/artifacts/form';
import { LongformArtifactPanel } from '@/app/w/[slug]/task/[...taskParams]/artifacts/longform';
import { ChatMessage as ChatMessageType, ChatRole, Option, Artifact, ArtifactType, FormContent, LongformContent } from '@/lib/chat';

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

// Mock WorkflowUrlLink
vi.mock('@/app/w/[slug]/task/[...taskParams]/components/WorkflowUrlLink', () => ({
  WorkflowUrlLink: ({ workflowUrl, className }: { workflowUrl: string; className?: string }) => (
    <div data-testid="workflow-url-link" data-url={workflowUrl} className={className}>
      Workflow Link
    </div>
  ),
}));

// Mock FormArtifact
vi.mock('@/app/w/[slug]/task/[...taskParams]/artifacts/form', () => ({
  FormArtifact: ({ 
    messageId, 
    artifact, 
    onAction, 
    selectedOption, 
    isDisabled 
  }: {
    messageId: string;
    artifact: Artifact;
    onAction: (messageId: string, action: Option, webhook: string) => void;
    selectedOption?: Option | null;
    isDisabled?: boolean;
  }) => (
    <div 
      data-testid="form-artifact" 
      data-message-id={messageId}
      data-disabled={isDisabled}
    >
      Form Artifact
      {(artifact.content as FormContent)?.options?.map((option, index) => (
        <button
          key={index}
          data-testid={`form-option-${index}`}
          onClick={() => onAction(messageId, option, (artifact.content as FormContent).webhook)}
          disabled={isDisabled}
        >
          {option.optionLabel}
        </button>
      ))}
    </div>
  ),
}));

// Mock LongformArtifactPanel
vi.mock('@/app/w/[slug]/task/[...taskParams]/artifacts/longform', () => ({
  LongformArtifactPanel: ({ artifacts, workflowUrl }: { artifacts: Artifact[]; workflowUrl?: string }) => (
    <div data-testid="longform-artifact-panel" data-workflow-url={workflowUrl}>
      Longform Artifact
      {artifacts.map((artifact) => (
        <div key={artifact.id} data-testid={`longform-artifact-${artifact.id}`}>
          {(artifact.content as LongformContent)?.title && (
            <h3>{(artifact.content as LongformContent).title}</h3>
          )}
          <p>{(artifact.content as LongformContent)?.text}</p>
        </div>
      ))}
    </div>
  ),
}));

// Mock Avatar component
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="avatar" className={className}>{children}</div>
  ),
  AvatarImage: ({ src }: { src?: string }) => (
    <img data-testid="avatar-image" src={src} alt="" />
  ),
  AvatarFallback: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="avatar-fallback" className={className}>{children}</div>
  ),
}));

// Mock Tooltip component
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (
    <div data-testid="tooltip-trigger">{children}</div>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// Helper function to create test message
const createTestMessage = (overrides: Partial<ChatMessageType> = {}): ChatMessageType => ({
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
  attachments: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Helper function to create test artifact
const createTestArtifact = (type: ArtifactType, content: any, id = 'test-artifact-1'): Artifact => ({
  id,
  messageId: 'test-message-1',
  type,
  content,
  icon: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('ChatMessage', () => {
  const mockOnArtifactAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Rendering', () => {
    it('renders assistant message correctly', () => {
      const message = createTestMessage({
        role: ChatRole.ASSISTANT,
        message: 'Hello from assistant',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByText('Hello from assistant')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-variant', 'assistant');
    });

    it('renders user message correctly', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'Hello from user',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByText('Hello from user')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-variant', 'user');
    });

    it('applies correct styling for assistant messages', () => {
      const message = createTestMessage({
        role: ChatRole.ASSISTANT,
        message: 'Assistant message',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const markdownRenderer = screen.getByTestId('markdown-renderer');
      const messageContainer = markdownRenderer.parentElement;
      expect(messageContainer).toHaveClass('bg-background', 'text-foreground', 'rounded-bl-md', 'border');
    });

    it('applies correct styling for user messages', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'User message',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const markdownRenderer = screen.getByTestId('markdown-renderer');
      const messageContainer = markdownRenderer.parentElement;
      expect(messageContainer).toHaveClass('bg-primary', 'text-primary-foreground', 'rounded-br-md');
    });

    it('positions assistant messages on the left', () => {
      const message = createTestMessage({
        role: ChatRole.ASSISTANT,
        message: 'Left-aligned message',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const messageWrapper = screen.getByText('Left-aligned message').closest('.flex');
      expect(messageWrapper).toHaveClass('justify-start');
    });

    it('positions user messages on the right', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'Right-aligned message',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const messageWrapper = screen.getByText('Right-aligned message').closest('.flex');
      expect(messageWrapper).toHaveClass('justify-end');
    });
  });

  describe('Workflow URL Link', () => {
    it('renders workflow URL link when workflowUrl is provided', () => {
      const message = createTestMessage({
        workflowUrl: 'https://example.com/workflow',
        message: 'Message with workflow',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('workflow-url-link')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-url-link')).toHaveAttribute('data-url', 'https://example.com/workflow');
    });

    it('does not render workflow URL link when workflowUrl is null', () => {
      const message = createTestMessage({
        workflowUrl: null,
        message: 'Message without workflow',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.queryByTestId('workflow-url-link')).not.toBeInTheDocument();
    });
  });

  describe('Form Artifacts', () => {
    it('renders form artifacts correctly', () => {
      const formContent: FormContent = {
        actionText: 'Choose an option',
        webhook: 'https://example.com/webhook',
        options: [
          { actionType: 'button', optionLabel: 'Option 1', optionResponse: 'response1' },
          { actionType: 'button', optionLabel: 'Option 2', optionResponse: 'response2' },
        ],
      };

      const formArtifact = createTestArtifact(ArtifactType.FORM, formContent);
      const message = createTestMessage({
        artifacts: [formArtifact],
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('form-artifact')).toBeInTheDocument();
      expect(screen.getByTestId('form-option-0')).toBeInTheDocument();
      expect(screen.getByTestId('form-option-1')).toBeInTheDocument();
    });

    it('handles form artifact interactions', () => {
      const formContent: FormContent = {
        actionText: 'Choose an option',
        webhook: 'https://example.com/webhook',
        options: [
          { actionType: 'button', optionLabel: 'Click me', optionResponse: 'clicked' },
        ],
      };

      const formArtifact = createTestArtifact(ArtifactType.FORM, formContent);
      const message = createTestMessage({
        artifacts: [formArtifact],
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      fireEvent.click(screen.getByTestId('form-option-0'));
      
      expect(mockOnArtifactAction).toHaveBeenCalledWith(
        'test-message-1',
        { actionType: 'button', optionLabel: 'Click me', optionResponse: 'clicked' },
        'https://example.com/webhook'
      );
    });

    it('shows selected option when reply message matches', () => {
      const formContent: FormContent = {
        actionText: 'Choose an option',
        webhook: 'https://example.com/webhook',
        options: [
          { actionType: 'button', optionLabel: 'Selected Option', optionResponse: 'selected_response' },
        ],
      };

      const formArtifact = createTestArtifact(ArtifactType.FORM, formContent);
      const message = createTestMessage({
        artifacts: [formArtifact],
      });

      const replyMessage = createTestMessage({
        id: 'reply-1',
        message: 'selected_response',
        replyId: 'test-message-1',
      });

      render(
        <ChatMessage 
          message={message} 
          replyMessage={replyMessage}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const formArtifactElement = screen.getByTestId('form-artifact');
      expect(formArtifactElement).toHaveAttribute('data-disabled', 'true');
    });
  });

  describe('Longform Artifacts', () => {
    it('renders longform artifacts correctly', () => {
      const longformContent: LongformContent = {
        title: 'Test Article',
        text: 'This is the article content.',
      };

      const longformArtifact = createTestArtifact(ArtifactType.LONGFORM, longformContent);
      const message = createTestMessage({
        artifacts: [longformArtifact],
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('longform-artifact-panel')).toBeInTheDocument();
      expect(screen.getByText('Test Article')).toBeInTheDocument();
      expect(screen.getByText('This is the article content.')).toBeInTheDocument();
    });

    it('passes workflow URL to longform artifacts', () => {
      const longformContent: LongformContent = {
        text: 'Content with workflow',
      };

      const longformArtifact = createTestArtifact(ArtifactType.LONGFORM, longformContent);
      const message = createTestMessage({
        artifacts: [longformArtifact],
        workflowUrl: 'https://example.com/workflow',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('longform-artifact-panel')).toHaveAttribute(
        'data-workflow-url',
        'https://example.com/workflow'
      );
    });
  });

  describe('Mixed Content', () => {
    it('renders message with both text and artifacts', () => {
      const formContent: FormContent = {
        actionText: 'Choose an option',
        webhook: 'https://example.com/webhook',
        options: [
          { actionType: 'button', optionLabel: 'Option 1', optionResponse: 'response1' },
        ],
      };

      const formArtifact = createTestArtifact(ArtifactType.FORM, formContent);
      const message = createTestMessage({
        message: 'Here are your options:',
        artifacts: [formArtifact],
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByText('Here are your options:')).toBeInTheDocument();
      expect(screen.getByTestId('form-artifact')).toBeInTheDocument();
    });

    it('renders multiple artifacts of different types', () => {
      const formContent: FormContent = {
        actionText: 'Form artifact',
        webhook: 'https://example.com/webhook',
        options: [{ actionType: 'button', optionLabel: 'Button', optionResponse: 'response' }],
      };

      const longformContent: LongformContent = {
        title: 'Longform Title',
        text: 'Longform content',
      };

      const formArtifact = createTestArtifact(ArtifactType.FORM, formContent, 'form-1');
      const longformArtifact = createTestArtifact(ArtifactType.LONGFORM, longformContent, 'longform-1');

      const message = createTestMessage({
        artifacts: [formArtifact, longformArtifact],
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('form-artifact')).toBeInTheDocument();
      expect(screen.getByTestId('longform-artifact-panel')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles message without content gracefully', () => {
      const message = createTestMessage({
        message: '',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      // Should not crash and should not render message bubble
      expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
    });

    it('handles empty artifacts array', () => {
      const message = createTestMessage({
        artifacts: [],
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.queryByTestId('form-artifact')).not.toBeInTheDocument();
      expect(screen.queryByTestId('longform-artifact-panel')).not.toBeInTheDocument();
    });

    it('filters out non-FORM and non-LONGFORM artifacts', () => {
      const codeContent = { content: 'console.log("hello")', language: 'javascript' };
      const codeArtifact = createTestArtifact(ArtifactType.CODE, codeContent);

      const message = createTestMessage({
        artifacts: [codeArtifact],
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      // Should not render CODE artifacts in chat
      expect(screen.queryByTestId('form-artifact')).not.toBeInTheDocument();
      expect(screen.queryByTestId('longform-artifact-panel')).not.toBeInTheDocument();
    });

    it('handles null artifacts gracefully', () => {
      const message = createTestMessage({
        artifacts: undefined,
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.queryByTestId('form-artifact')).not.toBeInTheDocument();
      expect(screen.queryByTestId('longform-artifact-panel')).not.toBeInTheDocument();
    });
  });

  describe('Hover Interactions', () => {
    it('shows workflow link on hover', async () => {
      const message = createTestMessage({
        workflowUrl: 'https://example.com/workflow',
        message: 'Hoverable message',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const messageElement = screen.getByText('Hoverable message').closest('div');
      
      // Initially hidden (opacity-0)
      expect(screen.getByTestId('workflow-url-link')).toHaveClass('opacity-0');

      // Simulate hover
      fireEvent.mouseEnter(messageElement!);
      
      await waitFor(() => {
        expect(screen.getByTestId('workflow-url-link')).toHaveClass('opacity-100');
      });

      // Simulate mouse leave
      fireEvent.mouseLeave(messageElement!);
      
      await waitFor(() => {
        expect(screen.getByTestId('workflow-url-link')).toHaveClass('opacity-0');
      });
    });

    it('maintains hover state during parent re-renders (memoization test)', async () => {
      const message = createTestMessage({
        workflowUrl: 'https://example.com/workflow/123',
        message: 'Test message content',
      });

      const { rerender } = render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const messageElement = screen.getByText(/test message content/i).closest('div');
      expect(messageElement).toBeInTheDocument();

      // Hover over the element
      fireEvent.mouseEnter(messageElement!);
      
      await waitFor(() => {
        expect(screen.getByTestId('workflow-url-link')).toHaveClass('opacity-100');
      });

      // Simulate parent re-render with identical props (should not reset hover state)
      rerender(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      // Verify hover state is still active after re-render
      await waitFor(() => {
        expect(screen.getByTestId('workflow-url-link')).toHaveClass('opacity-100');
      });

      // Simulate another parent re-render (e.g., from polling)
      rerender(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      // Verify hover state persists
      expect(screen.getByTestId('workflow-url-link')).toHaveClass('opacity-100');

      // Verify hover out still works
      fireEvent.mouseLeave(messageElement!);
      await waitFor(() => {
        expect(screen.getByTestId('workflow-url-link')).toHaveClass('opacity-0');
      });
    });
  });

  describe('Animation Integration', () => {
    it('applies motion animation properties', () => {
      const message = createTestMessage();

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      // motion.div should be rendered (mocked as regular div)
      const motionContainer = screen.getByText('Test message content').closest('.space-y-3');
      expect(motionContainer).toBeInTheDocument();
    });
  });

  describe('User Avatar Display', () => {
    it('renders avatar for USER messages with createdBy data', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'User message with avatar',
        createdBy: {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          image: 'https://example.com/avatar.jpg',
          githubAuth: null,
        },
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('avatar')).toBeInTheDocument();
      expect(screen.getByTestId('avatar-image')).toHaveAttribute('src', 'https://example.com/avatar.jpg');
      expect(screen.getByTestId('tooltip-trigger')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('shows fallback avatar when image is not provided', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'User message without image',
        createdBy: {
          id: 'user-456',
          name: 'Jane Smith',
          email: 'jane@example.com',
          image: null,
          githubAuth: null,
        },
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('avatar')).toBeInTheDocument();
      expect(screen.getByTestId('avatar-fallback')).toBeInTheDocument();
    });

    it('displays github username in tooltip when name is not available', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'User message',
        createdBy: {
          id: 'user-789',
          name: null,
          email: 'dev@example.com',
          image: null,
          githubAuth: {
            githubUsername: 'devuser123',
          },
        },
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('avatar')).toBeInTheDocument();
      expect(screen.getByText('devuser123')).toBeInTheDocument();
    });

    it('displays "User" fallback when no name or github username available', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'User message',
        createdBy: {
          id: 'user-999',
          name: null,
          email: 'anonymous@example.com',
          image: null,
          githubAuth: null,
        },
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('avatar')).toBeInTheDocument();
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    it('does not render avatar for USER messages without createdBy', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'User message without creator',
        createdBy: undefined,
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.queryByTestId('avatar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tooltip-trigger')).not.toBeInTheDocument();
    });

    it('does not render avatar for ASSISTANT messages', () => {
      const message = createTestMessage({
        role: ChatRole.ASSISTANT,
        message: 'Assistant message',
        createdBy: {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          image: 'https://example.com/avatar.jpg',
          githubAuth: null,
        },
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.queryByTestId('avatar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tooltip-trigger')).not.toBeInTheDocument();
    });

    it('re-renders when createdBy changes (memoization test)', () => {
      const message1 = createTestMessage({
        role: ChatRole.USER,
        message: 'User message',
        createdBy: {
          id: 'user-1',
          name: 'User One',
          email: 'user1@example.com',
          image: null,
          githubAuth: null,
        },
      });

      const { rerender } = render(
        <ChatMessage 
          message={message1} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByText('User One')).toBeInTheDocument();

      const message2 = createTestMessage({
        role: ChatRole.USER,
        message: 'User message',
        createdBy: {
          id: 'user-2',
          name: 'User Two',
          email: 'user2@example.com',
          image: null,
          githubAuth: null,
        },
      });

      rerender(
        <ChatMessage 
          message={message2} 
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByText('User Two')).toBeInTheDocument();
      expect(screen.queryByText('User One')).not.toBeInTheDocument();
    });
  });

  describe('Quick Reply Chip', () => {
    it('renders "Looks good →" chip when isLatestAwaitingReply=true, isPlanComplete=false, role is ASSISTANT', () => {
      const message = createTestMessage({
        role: ChatRole.ASSISTANT,
        message: 'What do you think?',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
          isLatestAwaitingReply={true}
          isPlanComplete={false}
        />
      );

      const chip = screen.getByRole('button', { name: /looks good/i });
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveTextContent('Looks good →');
    });

    it('does not render chip when isLatestAwaitingReply=false', () => {
      const message = createTestMessage({
        role: ChatRole.ASSISTANT,
        message: 'What do you think?',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
          isLatestAwaitingReply={false}
          isPlanComplete={false}
        />
      );

      expect(screen.queryByRole('button', { name: /looks good/i })).not.toBeInTheDocument();
    });

    it('does not render chip when isPlanComplete=true', () => {
      const message = createTestMessage({
        role: ChatRole.ASSISTANT,
        message: 'What do you think?',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
          isLatestAwaitingReply={true}
          isPlanComplete={true}
        />
      );

      expect(screen.queryByRole('button', { name: /looks good/i })).not.toBeInTheDocument();
    });

    it('does not render chip when role is USER', () => {
      const message = createTestMessage({
        role: ChatRole.USER,
        message: 'User message',
        createdBy: {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          image: null,
          githubAuth: null,
        },
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
          isLatestAwaitingReply={true}
          isPlanComplete={false}
        />
      );

      expect(screen.queryByRole('button', { name: /looks good/i })).not.toBeInTheDocument();
    });

    it('clicking chip calls onArtifactAction with correct args', () => {
      const message = createTestMessage({
        id: 'msg-123',
        role: ChatRole.ASSISTANT,
        message: 'What do you think?',
      });

      render(
        <ChatMessage 
          message={message} 
          onArtifactAction={mockOnArtifactAction}
          isLatestAwaitingReply={true}
          isPlanComplete={false}
        />
      );

      const chip = screen.getByRole('button', { name: /looks good/i });
      fireEvent.click(chip);

      expect(mockOnArtifactAction).toHaveBeenCalledWith(
        'msg-123',
        { actionType: 'button', optionLabel: 'Looks good', optionResponse: 'Looks good' },
        ''
      );
    });
  });
});
