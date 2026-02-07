import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AITextareaSection } from '@/components/features/AITextareaSection';
import * as useAIGenerationModule from '@/hooks/useAIGeneration';
import * as useStakworkGenerationModule from '@/hooks/useStakworkGeneration';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import * as useImageUploadModule from '@/hooks/useImageUpload';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/hooks/useWorkspace');
vi.mock('@/hooks/useAIGeneration');
vi.mock('@/hooks/useStakworkGeneration');
vi.mock('@/hooks/useImageUpload');

vi.mock('@/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: any) => <div data-testid="markdown-renderer">{children}</div>,
}));

vi.mock('@/components/features/ClarifyingQuestionsPreview', () => ({
  ClarifyingQuestionsPreview: ({ questions, onSubmit, onCancel, isLoading }: any) => (
    <div data-testid="clarifying-questions-preview">
      <div>Clarifying Questions Preview</div>
      <div>Questions: {questions.length}</div>
      <button onClick={onCancel} disabled={isLoading}>
        Cancel
      </button>
      <button onClick={() => onSubmit('mock answers')} disabled={isLoading}>
        Submit
      </button>
    </div>
  ),
}));

vi.mock('@/components/features/GenerationControls', () => ({
  GenerationControls: () => <div data-testid="generation-controls">Controls</div>,
}));

vi.mock('@/components/features/GenerationPreview', () => ({
  GenerationPreview: () => <div data-testid="generation-preview">Preview</div>,
}));

vi.mock('@/components/features/DeepResearchProgress', () => ({
  DeepResearchProgress: () => <div data-testid="deep-research-progress">Progress</div>,
}));

vi.mock('@/components/features/DiagramViewer', () => ({
  DiagramViewer: () => <div data-testid="diagram-viewer">Diagram</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef(({ value, onChange, ...props }: any, ref: any) => (
    <textarea ref={ref} value={value} onChange={onChange} {...props} />
  )),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/image-preview', () => ({
  ImagePreview: () => <div data-testid="image-preview">Image Preview</div>,
}));

vi.mock('@/components/features/SaveIndicator', () => ({
  SaveIndicator: () => <div data-testid="save-indicator">Save Indicator</div>,
}));

vi.mock('lucide-react', () => ({
  Edit: () => <div data-testid="edit-icon">Edit</div>,
  Eye: () => <div data-testid="eye-icon">Eye</div>,
}));

describe('AITextareaSection - Cancel Clarifying Questions', () => {
  const mockClear = vi.fn();
  const mockAccept = vi.fn();
  const mockReject = vi.fn();
  const mockProvideFeedback = vi.fn();
  const mockRegenerate = vi.fn();
  const mockSetContent = vi.fn();
  const mockRefetch = vi.fn();
  const mockOnChange = vi.fn();
  const mockOnBlur = vi.fn();

  const clarifyingQuestionsContent = JSON.stringify({
    tool_use: 'ask_clarifying_questions',
    content: [
      { question: 'What is your primary goal?', type: 'text' },
      { question: 'What is your timeline?', type: 'text' },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock useWorkspace
    vi.spyOn(useWorkspaceModule, 'useWorkspace').mockReturnValue({
      workspace: { id: 'workspace-1', name: 'Test Workspace' },
      slug: 'test-workspace',
      role: 'ADMIN',
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      switchWorkspace: vi.fn(),
    } as any);

    // Mock useImageUpload
    vi.spyOn(useImageUploadModule, 'useImageUpload').mockReturnValue({
      isDragging: false,
      isUploading: false,
      error: null,
      handleDragEnter: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDragOver: vi.fn(),
      handleDrop: vi.fn(),
      handlePaste: vi.fn(),
      insertImageAtCursor: vi.fn(),
    });

    // Mock useStakworkGeneration with no active run initially
    vi.spyOn(useStakworkGenerationModule, 'useStakworkGeneration').mockReturnValue({
      latestRun: null,
      refetch: mockRefetch,
      isLoading: false,
    } as any);

    // Mock useAIGeneration with clarifying questions content
    vi.spyOn(useAIGenerationModule, 'useAIGeneration').mockReturnValue({
      content: clarifyingQuestionsContent,
      isLoading: false,
      source: 'deep',
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
      regenerate: mockRegenerate,
      setContent: mockSetContent,
      clear: mockClear,
    });
  });

  it('should clear clarifying questions and return to textarea when canceled', async () => {
    const user = userEvent.setup();

    render(
      <AITextareaSection
        id="test-requirements"
        label="Requirements"
        type="requirements"
        featureId="feature-1"
        value="Original textarea content"
        savedField="test-requirements"
        saving={false}
        saved={true}
        onChange={mockOnChange}
        onBlur={mockOnBlur}
      />
    );

    // Verify clarifying questions are displayed
    expect(screen.getByTestId('clarifying-questions-preview')).toBeInTheDocument();
    expect(screen.getByText('Clarifying Questions Preview')).toBeInTheDocument();

    // Click Cancel button
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // Verify clear() was called
    await waitFor(() => {
      expect(mockClear).toHaveBeenCalledTimes(1);
    });

    // Verify toast notification appears
    expect(toast.info).toHaveBeenCalledWith('Clarifying questions cancelled');
  });

  it('should verify component returns to textarea mode after cancel', async () => {
    const user = userEvent.setup();

    // Start with clarifying questions
    const { rerender } = render(
      <AITextareaSection
        id="test-architecture"
        label="Architecture"
        type="architecture"
        featureId="feature-1"
        value="Original architecture content"
        savedField="test-architecture"
        saving={false}
        saved={true}
        onChange={mockOnChange}
        onBlur={mockOnBlur}
      />
    );

    // Verify clarifying questions are displayed
    expect(screen.getByTestId('clarifying-questions-preview')).toBeInTheDocument();

    // Click Cancel
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // Wait for clear to be called
    await waitFor(() => {
      expect(mockClear).toHaveBeenCalled();
    });

    // Simulate state update after clear (content becomes null)
    vi.spyOn(useAIGenerationModule, 'useAIGeneration').mockReturnValue({
      content: null,
      isLoading: false,
      source: null,
      accept: mockAccept,
      reject: mockReject,
      provideFeedback: mockProvideFeedback,
      regenerate: mockRegenerate,
      setContent: mockSetContent,
      clear: mockClear,
    });

    // Re-render with updated state
    rerender(
      <AITextareaSection
        id="test-architecture"
        label="Architecture"
        type="architecture"
        featureId="feature-1"
        value="Original architecture content"
        savedField="test-architecture"
        saving={false}
        saved={true}
        onChange={mockOnChange}
        onBlur={mockOnBlur}
      />
    );

    // Verify component returns to normal mode (clarifying questions are gone)
    await waitFor(() => {
      expect(screen.queryByTestId('clarifying-questions-preview')).not.toBeInTheDocument();
    });

    // Component should return to showing normal content (Edit button or preview mode)
    // The original value is preserved in props
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('should allow canceling from any step in the flow', async () => {
    const user = userEvent.setup();

    render(
      <AITextareaSection
        id="test-requirements"
        label="Requirements"
        type="requirements"
        featureId="feature-1"
        value="Original content"
        savedField="test-requirements"
        saving={false}
        saved={true}
        onChange={mockOnChange}
        onBlur={mockOnBlur}
      />
    );

    // Verify clarifying questions are shown (step 2 in the mock has 2 questions)
    expect(screen.getByTestId('clarifying-questions-preview')).toBeInTheDocument();
    expect(screen.getByText('Questions: 2')).toBeInTheDocument();

    // Click Cancel from the question flow
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // Verify clear was called and toast shown
    await waitFor(() => {
      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledWith('Clarifying questions cancelled');
    });
  });

  it('should allow canceling from review screen without submitting answers', async () => {
    const user = userEvent.setup();

    render(
      <AITextareaSection
        id="test-requirements"
        label="Requirements"
        type="requirements"
        featureId="feature-1"
        value="Original content"
        savedField="test-requirements"
        saving={false}
        saved={true}
        onChange={mockOnChange}
        onBlur={mockOnBlur}
      />
    );

    // Verify clarifying questions preview is shown
    expect(screen.getByTestId('clarifying-questions-preview')).toBeInTheDocument();

    // Click Cancel instead of Submit
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // Verify no answers are submitted
    await waitFor(() => {
      expect(mockProvideFeedback).not.toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalledTimes(1);
    });

    // Verify toast notification
    expect(toast.info).toHaveBeenCalledWith('Clarifying questions cancelled');
  });

  it('should verify original textarea value is preserved after cancel', async () => {
    const user = userEvent.setup();
    const originalValue = 'This is my original requirement text that should be preserved';

    render(
      <AITextareaSection
        id="test-requirements"
        label="Requirements"
        type="requirements"
        featureId="feature-1"
        value={originalValue}
        savedField="test-requirements"
        saving={false}
        saved={true}
        onChange={mockOnChange}
        onBlur={mockOnBlur}
      />
    );

    // Cancel clarifying questions
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(mockClear).toHaveBeenCalled();
    });

    // The onChange handler should NOT be called when canceling
    // (original value prop remains unchanged)
    expect(mockOnChange).not.toHaveBeenCalled();
  });
});
