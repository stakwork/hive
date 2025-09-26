import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ChatMessage } from '@/app/w/[slug]/task/[...taskParams]/components/ChatMessage';
import { ChatMessage as ChatMessageType, ChatRole, ChatStatus, FormContent, LongformContent, Option, Artifact } from '@/lib/chat';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock MarkdownRenderer
vi.mock('@/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div data-testid="markdown">{children}</div>,
}));

// Mock WorkflowUrlLink
vi.mock('@/app/w/[slug]/task/[...taskParams]/components/WorkflowUrlLink', () => ({
  WorkflowUrlLink: ({ workflowUrl, className }: any) => (
    <div data-testid="workflow-link" data-url={workflowUrl} className={className}>
      Workflow Link
    </div>
  ),
}));

// Mock artifacts module
vi.mock('@/app/w/[slug]/task/[...taskParams]/artifacts', () => ({
  ...vi.importActual('@/app/w/[slug]/task/[...taskParams]/artifacts'),
  FormArtifact: ({ 
    messageId, 
    artifact, 
    onAction, 
    selectedOption, 
    isDisabled 
  }: any) => (
    <div 
      data-testid="form-artifact"
      data-message-id={messageId}
      data-artifact-id={artifact.id}
      data-selected-option={selectedOption?.optionResponse}
      data-disabled={isDisabled}
    >
      <div data-testid="form-content">{(artifact.content as FormContent).actionText}</div>
      {(artifact.content as FormContent).options.filter(opt => opt.actionType === 'button').map((option: Option, index: number) => (
        <button
          key={index}
          data-testid={`form-button-${index}`}
          onClick={() => onAction(messageId, option, (artifact.content as FormContent).webhook)}
          disabled={isDisabled}
        >
          {option.optionLabel}
        </button>
      ))}
    </div>
  ),
  LongformArtifactPanel: ({ artifacts, workflowUrl }: any) => (
    <div data-testid="longform-artifact-panel" data-workflow-url={workflowUrl}>
      {artifacts.map((artifact: any) => (
        <div key={artifact.id} data-testid={`longform-${artifact.id}`}>
          {(artifact.content as LongformContent).title && (
            <div data-testid="longform-title">{(artifact.content as LongformContent).title}</div>
          )}
          <div data-testid="longform-text">{(artifact.content as LongformContent).text}</div>
        </div>
      ))}
    </div>
  ),
}));

// Test Factories
const createMessage = (
  role: ChatRole,
  message: string,
  artifacts: Artifact[] = []
): ChatMessageType => ({
  id: 'test-message-1',
  message,
  role,
  status: ChatStatus.COMPLETE,
  taskId: 'task-123',
  createdAt: new Date(),
  updatedAt: new Date(),
  artifacts,
  contextTags: [],
  attachments: [],
});

const createFormArtifact = (options: Option[] = [
  { optionLabel: 'Yes', optionResponse: 'yes', actionType: 'button' },
  { optionLabel: 'No', optionResponse: 'no', actionType: 'button' }
]): Artifact => ({
  id: 'form-artifact-1',
  messageId: 'test-message-1',
  type: 'FORM' as any,
  content: {
    actionText: 'Please choose an option:',
    webhook: 'https://webhook.url',
    options,
  } as FormContent,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const createLongformArtifact = (): Artifact => ({
  id: 'longform-artifact-1',
  messageId: 'test-message-1',
  type: 'LONGFORM' as any,
  content: {
    title: 'Test Title',
    text: 'Test longform content',
  } as LongformContent,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('ChatMessage', () => {
  const mockOnArtifactAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render user message correctly', () => {
      const message = createMessage('USER', 'Hello world');

      render(
        <ChatMessage
          message={message}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('markdown')).toHaveTextContent('Hello world');
    });

    it('should render assistant message correctly', () => {
      const message = createMessage('ASSISTANT', 'Hello! How can I help?');

      render(
        <ChatMessage
          message={message}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      expect(screen.getByTestId('markdown')).toHaveTextContent('Hello! How can I help?');
    });

    it('should render workflow URL link when present', () => {
      const message = createMessage('ASSISTANT', 'Check this out');
      message.workflowUrl = 'https://workflow.example.com';

      render(
        <ChatMessage
          message={message}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const workflowLink = screen.getByTestId('workflow-link');
      expect(workflowLink).toHaveAttribute('data-url', 'https://workflow.example.com');
    });
  });

  describe('Artifact Rendering', () => {
    it('should render form artifacts correctly', () => {
      const formArtifact = createFormArtifact();
      const message = createMessage('ASSISTANT', 'Choose:', [formArtifact]);

      render(
        <ChatMessage
          message={message}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const formElement = screen.getByTestId('form-artifact');
      expect(formElement).toBeInTheDocument();
      expect(formElement).toHaveAttribute('data-message-id', 'test-message-1');
      expect(formElement).toHaveAttribute('data-artifact-id', 'form-artifact-1');
      
      expect(screen.getByTestId('form-content')).toHaveTextContent('Please choose an option:');
      expect(screen.getByTestId('form-button-0')).toHaveTextContent('Yes');
      expect(screen.getByTestId('form-button-1')).toHaveTextContent('No');
    });

    it('should render longform artifacts correctly', () => {
      const longformArtifact = createLongformArtifact();
      const message = createMessage('ASSISTANT', '', [longformArtifact]);

      render(
        <ChatMessage
          message={message}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const longformPanel = screen.getByTestId('longform-artifact-panel');
      expect(longformPanel).toBeInTheDocument();
      
      expect(screen.getByTestId('longform-title')).toHaveTextContent('Test Title');
      expect(screen.getByTestId('longform-text')).toHaveTextContent('Test longform content');
    });
  });

  describe('Interaction Handling', () => {
    it('should handle form button clicks', () => {
      const formArtifact = createFormArtifact();
      const message = createMessage('ASSISTANT', 'Choose:', [formArtifact]);

      render(
        <ChatMessage
          message={message}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const yesButton = screen.getByTestId('form-button-0');
      fireEvent.click(yesButton);

      expect(mockOnArtifactAction).toHaveBeenCalledWith(
        'test-message-1',
        { optionLabel: 'Yes', optionResponse: 'yes', actionType: 'button' },
        'https://webhook.url'
      );
    });

    it('should disable form when reply message exists', () => {
      const formArtifact = createFormArtifact();
      const message = createMessage('ASSISTANT', 'Choose:', [formArtifact]);
      const replyMessage = createMessage('USER', 'yes');

      render(
        <ChatMessage
          message={message}
          replyMessage={replyMessage}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      const formElement = screen.getByTestId('form-artifact');
      expect(formElement).toHaveAttribute('data-disabled', 'true');
      
      const buttons = screen.getAllByTestId(/form-button-/);
      buttons.forEach(button => {
        expect(button).toBeDisabled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle messages without content', () => {
      const message = createMessage('ASSISTANT', '');

      render(
        <ChatMessage
          message={message}
          onArtifactAction={mockOnArtifactAction}
        />
      );

      // Should render the container but not the message bubble
      expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
    });

    it('should handle multiple artifacts', () => {
      const formArtifact = createFormArtifact();
      const longformArtifact = createLongformArtifact();
      const message = createMessage('ASSISTANT', 'Multiple artifacts', [formArtifact, longformArtifact]);

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
});