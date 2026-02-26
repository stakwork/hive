import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatInput } from '@/app/w/[slug]/task/[...taskParams]/components/ChatInput';

// Mock dependencies
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: '',
    isSupported: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock('@/hooks/useControlKeyHold', () => ({
  useControlKeyHold: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// Mock UI components
vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, any>(({ placeholder, disabled, ...props }, ref) => (
    <textarea
      ref={ref}
      placeholder={placeholder}
      disabled={disabled}
      data-testid="chat-message-input"
      {...props}
    />
  )),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge', () => ({
  WorkflowStatusBadge: () => <div>Status Badge</div>,
}));

vi.mock('@/app/w/[slug]/task/[...taskParams]/components/InputDebugAttachment', () => ({
  InputDebugAttachment: () => <div>Debug Attachment</div>,
}));

vi.mock('@/app/w/[slug]/task/[...taskParams]/components/InputStepAttachment', () => ({
  InputStepAttachment: () => <div>Step Attachment</div>,
}));

describe('ChatInput', () => {
  const mockOnSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'live'),
        setItem: vi.fn(),
      },
      writable: true,
    });
  });

  describe('placeholder prop behavior', () => {
    it('renders with default placeholder when no placeholder prop is provided', () => {
      render(
        <ChatInput
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).toHaveAttribute('placeholder', 'Type your message...');
    });

    it('renders with custom placeholder when placeholder prop is provided', () => {
      render(
        <ChatInput
          onSend={mockOnSend}
          placeholder="Answer the questions above to continue"
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).toHaveAttribute('placeholder', 'Answer the questions above to continue');
    });

    it('renders with custom placeholder and disabled=true', () => {
      render(
        <ChatInput
          onSend={mockOnSend}
          placeholder="Answer the questions above to continue"
          disabled={true}
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).toHaveAttribute('placeholder', 'Answer the questions above to continue');
      expect(textarea).toBeDisabled();
    });

    it('uses undefined placeholder to fall back to default', () => {
      render(
        <ChatInput
          onSend={mockOnSend}
          placeholder={undefined}
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).toHaveAttribute('placeholder', 'Type your message...');
    });
  });

  describe('isListening precedence', () => {
    beforeEach(() => {
      // Mock speech recognition as listening
      vi.resetModules();
      vi.doMock('@/hooks/useSpeechRecognition', () => ({
        useSpeechRecognition: () => ({
          isListening: true,
          transcript: '',
          isSupported: true,
          startListening: vi.fn(),
          stopListening: vi.fn(),
          resetTranscript: vi.fn(),
        }),
      }));
    });

    it('shows "Listening..." when isListening=true, overriding default placeholder', async () => {
      // We need to re-import the component after mocking
      const { ChatInput: ChatInputWithListening } = await import(
        '@/app/w/[slug]/task/[...taskParams]/components/ChatInput'
      );

      render(
        <ChatInputWithListening
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).toHaveAttribute('placeholder', 'Listening...');
    });

    it('shows "Listening..." when isListening=true, overriding custom placeholder', async () => {
      const { ChatInput: ChatInputWithListening } = await import(
        '@/app/w/[slug]/task/[...taskParams]/components/ChatInput'
      );

      render(
        <ChatInputWithListening
          onSend={mockOnSend}
          placeholder="Answer the questions above to continue"
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).toHaveAttribute('placeholder', 'Listening...');
    });
  });

  describe('disabled prop', () => {
    it('disables textarea when disabled=true', () => {
      render(
        <ChatInput
          onSend={mockOnSend}
          disabled={true}
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).toBeDisabled();
    });

    it('enables textarea when disabled=false', () => {
      render(
        <ChatInput
          onSend={mockOnSend}
          disabled={false}
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).not.toBeDisabled();
    });

    it('enables textarea when disabled is not provided', () => {
      render(
        <ChatInput
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByTestId('chat-message-input');
      expect(textarea).not.toBeDisabled();
    });
  });
});
