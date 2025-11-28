import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { UserStoriesSection } from '@/components/features/UserStoriesSection'
import * as useStakworkGenerationModule from '@/hooks/useStakworkGeneration'
import * as useAIGenerationModule from '@/hooks/useAIGeneration'
import * as useWorkspaceModule from '@/hooks/useWorkspace'

// Mock the hooks
vi.mock('@/hooks/useStakworkGeneration')
vi.mock('@/hooks/useAIGeneration')
vi.mock('@/hooks/useWorkspace')

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/w/test-workspace/plan/test-feature',
}))

describe('UserStoriesSection - Deep Research Integration', () => {
  const mockFeatureId = 'test-feature-id'
  const mockWorkspace = {
    id: 'test-workspace-id',
    name: 'Test Workspace',
    slug: 'test-workspace',
  }
  
  const mockRefetch = vi.fn()
  const mockSetContent = vi.fn()
  const mockRegenerate = vi.fn()
  const mockAccept = vi.fn()
  const mockReject = vi.fn()
  const mockProvideFeedback = vi.fn()

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    mockRefetch.mockResolvedValue(undefined)
    mockSetContent.mockImplementation(() => {})
    mockRegenerate.mockResolvedValue(undefined)
    mockAccept.mockResolvedValue(undefined)
    mockReject.mockImplementation(() => {})
    mockProvideFeedback.mockResolvedValue(undefined)

    // Mock workspace hook
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    } as any)

    // Mock stakwork generation hook with default values
    vi.mocked(useStakworkGenerationModule.useStakworkGeneration).mockReturnValue({
      latestRun: null,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    })

    // Mock AI generation hook with default values
    vi.mocked(useAIGenerationModule.useAIGeneration).mockReturnValue({
      content: null,
      source: null,
      isLoading: false,
      error: null,
      setContent: mockSetContent,
      regenerate: mockRegenerate,
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
    })
  })

  it('should display Deep Research button', () => {
    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    render(<UserStoriesSection {...mockProps} />)

    // Deep Research button should be visible
    const deepThinkButton = screen.getByRole('button', { name: /deep research/i })
    expect(deepThinkButton).toBeInTheDocument()
  })

  it('should trigger stakwork generation when Deep Research button is clicked', async () => {
    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    const userInteraction = userEvent.setup()
    render(<UserStoriesSection {...mockProps} />)

    const deepThinkButton = screen.getByRole('button', { name: /deep research/i })
    await userInteraction.click(deepThinkButton)

    await waitFor(() => {
      expect(mockRegenerate).toHaveBeenCalledWith(false)
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('should display GenerationPreview when deep research content is available', () => {
    const mockContent = JSON.stringify([
      { title: 'User can login with email' },
      { title: 'User can reset password' },
      { title: 'User can update profile' },
    ])

    vi.mocked(useAIGenerationModule.useAIGeneration).mockReturnValue({
      content: mockContent,
      source: 'deep',
      isLoading: false,
      error: null,
      setContent: mockSetContent,
      regenerate: mockRegenerate,
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    render(<UserStoriesSection {...mockProps} />)

    // GenerationPreview should be visible with content
    expect(screen.getByText(/User can login with email/i)).toBeInTheDocument()
  })

  it('should accept bulk user stories and reload page', async () => {
    const mockContent = JSON.stringify([
      { title: 'User can login with email' },
      { title: 'User can reset password' },
    ])

    vi.mocked(useAIGenerationModule.useAIGeneration).mockReturnValue({
      content: mockContent,
      source: 'deep',
      isLoading: false,
      error: null,
      setContent: mockSetContent,
      regenerate: mockRegenerate,
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    // Mock window.location.reload
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    })

    const userInteraction = userEvent.setup()
    render(<UserStoriesSection {...mockProps} />)

    const acceptButton = screen.getByRole('button', { name: /accept/i })
    await userInteraction.click(acceptButton)

    await waitFor(() => {
      expect(mockAccept).toHaveBeenCalled()
      expect(reloadMock).toHaveBeenCalled()
    })
  })

  it('should provide feedback and create new run with history', async () => {
    const mockContent = JSON.stringify([
      { title: 'User can login with email' },
    ])

    vi.mocked(useAIGenerationModule.useAIGeneration).mockReturnValue({
      content: mockContent,
      source: 'deep',
      isLoading: false,
      error: null,
      setContent: mockSetContent,
      regenerate: mockRegenerate,
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    const userInteraction = userEvent.setup()
    render(<UserStoriesSection {...mockProps} />)

    // Find feedback input and type feedback
    const feedbackInput = screen.getByPlaceholderText(/provide feedback/i)
    await userInteraction.type(feedbackInput, 'Please add more edge cases')
    
    // Find and click the submit button (ArrowUp icon button next to the input)
    const submitButton = feedbackInput.nextElementSibling as HTMLElement
    await userInteraction.click(submitButton)

    await waitFor(() => {
      expect(mockProvideFeedback).toHaveBeenCalledWith('Please add more edge cases')
    })
  })

  it('should clear preview when rejecting deep research results', async () => {
    const mockContent = JSON.stringify([
      { title: 'User can login with email' },
    ])

    vi.mocked(useAIGenerationModule.useAIGeneration).mockReturnValue({
      content: mockContent,
      source: 'deep',
      isLoading: false,
      error: null,
      setContent: mockSetContent,
      regenerate: mockRegenerate,
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    const userInteraction = userEvent.setup()
    render(<UserStoriesSection {...mockProps} />)

    const rejectButton = screen.getByRole('button', { name: /reject/i })
    await userInteraction.click(rejectButton)

    await waitFor(() => {
      expect(mockReject).toHaveBeenCalled()
    })
  })

  it('should show retry button when stakwork run encounters error', () => {
    vi.mocked(useStakworkGenerationModule.useStakworkGeneration).mockReturnValue({
      latestRun: {
        id: 'run-1',
        status: 'ERROR',
        type: 'USER_STORIES',
        featureId: mockFeatureId,
        result: null,
        decision: null,
        feedback: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isLoading: false,
      error: new Error('Generation failed'),
      refetch: mockRefetch,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    render(<UserStoriesSection {...mockProps} />)

    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()
  })

  it('should handle retry when error state is active', async () => {
    vi.mocked(useStakworkGenerationModule.useStakworkGeneration).mockReturnValue({
      latestRun: {
        id: 'run-1',
        status: 'ERROR',
        type: 'USER_STORIES',
        featureId: mockFeatureId,
        result: null,
        decision: null,
        feedback: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isLoading: false,
      error: new Error('Generation failed'),
      refetch: mockRefetch,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    const userInteraction = userEvent.setup()
    render(<UserStoriesSection {...mockProps} />)

    const retryButton = screen.getByRole('button', { name: /retry/i })
    await userInteraction.click(retryButton)

    await waitFor(() => {
      expect(mockRegenerate).toHaveBeenCalledWith(true)
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('should populate deep research content when completed run is available', () => {
    const mockResult = JSON.stringify([
      { title: 'User can login with email' },
      { title: 'User can reset password' },
    ])

    vi.mocked(useStakworkGenerationModule.useStakworkGeneration).mockReturnValue({
      latestRun: {
        id: 'run-1',
        status: 'COMPLETED',
        type: 'USER_STORIES',
        featureId: mockFeatureId,
        result: mockResult,
        decision: null,
        feedback: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    render(<UserStoriesSection {...mockProps} />)

    // The useEffect should trigger setContent
    expect(mockSetContent).toHaveBeenCalledWith(mockResult, 'deep', 'run-1')
  })

  it('should show loading state during deep research generation', () => {
    vi.mocked(useAIGenerationModule.useAIGeneration).mockReturnValue({
      content: null,
      source: null,
      isLoading: true,
      error: null,
      setContent: mockSetContent,
      regenerate: mockRegenerate,
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
    })

    const shouldFocusRef = { current: false }
    const mockProps = {
      featureId: mockFeatureId,
      userStories: [],
      newStoryTitle: '',
      creatingStory: false,
      onAddUserStory: vi.fn(),
      onDeleteUserStory: vi.fn(),
      onUpdateUserStory: vi.fn(),
      onReorderUserStories: vi.fn(),
      onAcceptGeneratedStory: vi.fn(),
      onNewStoryTitleChange: vi.fn(),
      shouldFocusRef,
    }

    render(<UserStoriesSection {...mockProps} />)

    const deepThinkButton = screen.getByRole('button', { name: /deep research/i })
    expect(deepThinkButton).toBeDisabled()
  })
})
