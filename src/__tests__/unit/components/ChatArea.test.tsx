import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { ChatArea } from '../../../app/w/[slug]/task/[...taskParams]/components/ChatArea'
import type { ChatMessage } from '@/lib/chat'

// Mock Next.js router
const mockPush = vi.fn()
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
    h2: ({ children, className, ...props }: any) => <h2 className={className} {...props}>{children}</h2>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// Mock child components
vi.mock('../../../app/w/[slug]/task/[...taskParams]/components/ChatMessage', () => ({
  ChatMessage: ({ message, replyMessage }: { message: ChatMessage; replyMessage?: ChatMessage }) => (
    <div data-testid={`chat-message-${message.id}`}>
      <div data-testid="message-content">{message.message}</div>
      {replyMessage && (
        <div data-testid="reply-message">{replyMessage.message}</div>
      )}
    </div>
  ),
}))

vi.mock('../../../app/w/[slug]/task/[...taskParams]/components/ChatInput', () => ({
  ChatInput: ({ onSend, disabled, isLoading, workflowStatus }: any) => (
    <div data-testid="chat-input">
      <button
        data-testid="send-button"
        onClick={() => onSend('test message')}
        disabled={disabled}
      >
        {isLoading ? 'Loading...' : 'Send'}
      </button>
      {workflowStatus && <div data-testid="workflow-status">{workflowStatus}</div>}
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, variant, size, className }: any) => (
    <button className={className} onClick={onClick} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}))

vi.mock('@/utils/cn', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/lib/icons', () => ({
  getAgentIcon: () => <span data-testid="agent-icon">🤖</span>,
}))

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left-icon">←</span>,
  ExternalLink: () => <span data-testid="external-link-icon">🔗</span>,
}))

// Create mock messages helper
const createMockMessage = (id: string, message: string, role: 'user' | 'assistant' = 'user', replyId?: string): ChatMessage => ({
  id,
  message,
  role: role as any,
  status: 'sent' as any,
  artifacts: [],
  contextTags: [],
  timestamp: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  taskId: null,
  workflowUrl: null,
  sourceWebsocketID: null,
  replyId: replyId || null,
  attachments: [],
})

describe('ChatArea', () => {
  const defaultProps = {
    messages: [],
    onSend: vi.fn(),
    onArtifactAction: vi.fn(),
    inputDisabled: false,
    isLoading: false,
    isChainVisible: false,
    lastLogLine: '',
    logs: [],
    pendingDebugAttachment: null,
    onRemoveDebugAttachment: vi.fn(),
    workflowStatus: undefined,
    taskTitle: undefined,
    stakworkProjectId: undefined,
    workspaceSlug: undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Setup router mock
    const mockRouter = {
      push: mockPush,
      back: mockBack,
    }
    vi.mocked(useRouter).mockReturnValue(mockRouter as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Rendering', () => {
    it('should render chat area with empty messages', () => {
      render(<ChatArea {...defaultProps} />)
      
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
      expect(screen.queryByTestId('message-content')).not.toBeInTheDocument()
    })

    it('should render messages correctly', () => {
      const messages = [
        createMockMessage('1', 'Hello world', 'user'),
        createMockMessage('2', 'Hi there!', 'assistant'),
      ]

      render(<ChatArea {...defaultProps} messages={messages} />)

      expect(screen.getByTestId('chat-message-1')).toBeInTheDocument()
      expect(screen.getByTestId('chat-message-2')).toBeInTheDocument()
      expect(screen.getAllByTestId('message-content')).toHaveLength(2)
    })

    it('should filter out reply messages from main chat', () => {
      const messages = [
        createMockMessage('1', 'Original message', 'user'),
        createMockMessage('2', 'Reply message', 'assistant', '1'), // This should be filtered out
        createMockMessage('3', 'Another message', 'user'),
      ]

      render(<ChatArea {...defaultProps} messages={messages} />)

      // Only messages without replyId should be shown
      expect(screen.getByTestId('chat-message-1')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-message-2')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-message-3')).toBeInTheDocument()
    })

    it('should show reply message as child of original message', () => {
      const messages = [
        createMockMessage('1', 'Original message', 'user'),
        createMockMessage('2', 'Reply message', 'assistant', '1'),
      ]

      render(<ChatArea {...defaultProps} messages={messages} />)

      expect(screen.getByTestId('chat-message-1')).toBeInTheDocument()
      expect(screen.getByTestId('reply-message')).toBeInTheDocument()
      expect(screen.getByTestId('reply-message')).toHaveTextContent('Reply message')
    })
  })

  describe('Task Title and Navigation', () => {
    it('should not show task title header when taskTitle is not provided', () => {
      render(<ChatArea {...defaultProps} />)
      
      expect(screen.queryByText('Back')).not.toBeInTheDocument()
    })

    it('should show task title header when taskTitle is provided', () => {
      const taskTitle = 'Test Task Title'
      render(<ChatArea {...defaultProps} taskTitle={taskTitle} />)

      expect(screen.getByText(taskTitle)).toBeInTheDocument()
      expect(screen.getByTestId('arrow-left-icon')).toBeInTheDocument()
    })

    it('should truncate long task titles', () => {
      const longTitle = 'a'.repeat(80) // Longer than 60 characters
      render(<ChatArea {...defaultProps} taskTitle={longTitle} />)

      const displayedTitle = screen.getByText(`${'a'.repeat(60)}...`)
      expect(displayedTitle).toBeInTheDocument()
    })

    it('should navigate back to tasks when back button is clicked with workspaceSlug', () => {
      const workspaceSlug = 'test-workspace'
      render(<ChatArea {...defaultProps} taskTitle="Test Task" workspaceSlug={workspaceSlug} />)

      const backButton = screen.getByTestId('arrow-left-icon').closest('button')
      expect(backButton).toBeInTheDocument()
      
      fireEvent.click(backButton!)
      expect(mockPush).toHaveBeenCalledWith(`/w/${workspaceSlug}/tasks`)
    })

    it('should use router.back() when no workspaceSlug is provided', () => {
      render(<ChatArea {...defaultProps} taskTitle="Test Task" />)

      const backButton = screen.getByTestId('arrow-left-icon').closest('button')
      fireEvent.click(backButton!)
      
      expect(mockBack).toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should show Stakwork project link when stakworkProjectId is provided', () => {
      const stakworkProjectId = 'project-123'
      render(<ChatArea {...defaultProps} taskTitle="Test Task" stakworkProjectId={stakworkProjectId} />)

      const workflowLink = screen.getByText('Workflow').closest('a')
      expect(workflowLink).toBeInTheDocument()
      expect(workflowLink).toHaveAttribute('href', `https://jobs.stakwork.com/admin/projects/${stakworkProjectId}`)
      expect(workflowLink).toHaveAttribute('target', '_blank')
      expect(screen.getByTestId('external-link-icon')).toBeInTheDocument()
    })
  })

  describe('Chain Visibility and Loading States', () => {
    it('should not show chain message when isChainVisible is false', () => {
      render(<ChatArea {...defaultProps} isChainVisible={false} />)
      
      expect(screen.queryByText('Communicating with workflow...')).not.toBeInTheDocument()
    })

    it('should show chain message when isChainVisible is true', () => {
      render(<ChatArea {...defaultProps} isChainVisible={true} />)

      expect(screen.getByText('Communicating with workflow...')).toBeInTheDocument()
      expect(screen.getByTestId('agent-icon')).toBeInTheDocument()
      expect(screen.getByText('Hive')).toBeInTheDocument()
      expect(screen.getByText('Processing...')).toBeInTheDocument()
    })

    it('should show lastLogLine when provided with chain visible', () => {
      const lastLogLine = 'Custom log message'
      render(<ChatArea {...defaultProps} isChainVisible={true} lastLogLine={lastLogLine} />)

      expect(screen.getByText(lastLogLine)).toBeInTheDocument()
      expect(screen.queryByText('Communicating with workflow...')).not.toBeInTheDocument()
    })
  })

  describe('Input Integration', () => {
    it('should pass correct props to ChatInput', () => {
      const props = {
        ...defaultProps,
        inputDisabled: true,
        isLoading: true,
        logs: ['log1', 'log2'],
        workflowStatus: 'running',
      }

      render(<ChatArea {...props} />)

      const chatInput = screen.getByTestId('chat-input')
      expect(chatInput).toBeInTheDocument()
      
      const sendButton = screen.getByTestId('send-button')
      expect(sendButton).toBeDisabled()
      expect(sendButton).toHaveTextContent('Loading...')
      
      expect(screen.getByTestId('workflow-status')).toHaveTextContent('running')
    })

    it('should handle onSend callback from ChatInput', () => {
      const onSend = vi.fn()
      render(<ChatArea {...defaultProps} onSend={onSend} />)

      const sendButton = screen.getByTestId('send-button')
      fireEvent.click(sendButton)

      expect(onSend).toHaveBeenCalledWith('test message')
    })

    it('should enable input when not loading and not disabled', () => {
      render(<ChatArea {...defaultProps} inputDisabled={false} isLoading={false} />)

      const sendButton = screen.getByTestId('send-button')
      expect(sendButton).not.toBeDisabled()
      expect(sendButton).toHaveTextContent('Send')
    })
  })

  describe('Message Sorting and Display', () => {
    it('should maintain message order', () => {
      const messages = [
        createMockMessage('1', 'First message', 'user'),
        createMockMessage('2', 'Second message', 'assistant'),
        createMockMessage('3', 'Third message', 'user'),
      ]

      render(<ChatArea {...defaultProps} messages={messages} />)

      const messageElements = screen.getAllByTestId(/chat-message-/)
      expect(messageElements[0]).toHaveAttribute('data-testid', 'chat-message-1')
      expect(messageElements[1]).toHaveAttribute('data-testid', 'chat-message-2')
      expect(messageElements[2]).toHaveAttribute('data-testid', 'chat-message-3')
    })

    it('should handle empty message list gracefully', () => {
      render(<ChatArea {...defaultProps} messages={[]} />)

      expect(screen.queryByTestId(/chat-message-/)).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    })
  })

  describe('Auto-scroll Behavior', () => {
    it('should contain scroll reference element', () => {
      render(<ChatArea {...defaultProps} />)
      
      // Check for scroll container with overflow-y-auto class
      const scrollContainer = document.querySelector('[class*="overflow-y-auto"]')
      expect(scrollContainer).toBeInTheDocument()
      
      // Verify chat input is present for auto-scrolling context
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    })
  })

  describe('Component Layout and Styling', () => {
    it('should apply correct CSS classes for layout', () => {
      render(<ChatArea {...defaultProps} taskTitle="Test" />)

      // Check that main container has proper flex classes
      const container = screen.getByTestId('chat-input').closest('[class*="flex"]')
      expect(container).toBeInTheDocument()
    })

    it('should handle missing optional props gracefully', () => {
      const minimalProps = {
        messages: [],
        onSend: vi.fn(),
        onArtifactAction: vi.fn(),
      }

      expect(() => render(<ChatArea {...minimalProps} />)).not.toThrow()
    })
  })

  describe('Accessibility', () => {
    it('should provide proper title attribute for long task titles', () => {
      const longTitle = 'a'.repeat(80)
      render(<ChatArea {...defaultProps} taskTitle={longTitle} />)

      const titleElement = screen.getByText(`${'a'.repeat(60)}...`)
      expect(titleElement).toHaveAttribute('title', longTitle)
    })

    it('should have proper external link attributes for Stakwork project', () => {
      render(<ChatArea {...defaultProps} taskTitle="Test" stakworkProjectId="123" />)

      const link = screen.getByText('Workflow').closest('a')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAttribute('target', '_blank')
    })
  })
})