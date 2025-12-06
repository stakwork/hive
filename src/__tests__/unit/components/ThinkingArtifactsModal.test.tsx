import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThinkingArtifactsModal } from '@/components/features/ThinkingArtifactsModal';
import type { ThinkingArtifact } from '@/types/thinking';

describe('ThinkingArtifactsModal', () => {
  const mockOnOpenChange = vi.fn();

  const createMockArtifacts = (): ThinkingArtifact[] => [
    {
      stepId: '1',
      stepName: 'Initialize',
      stepState: 'complete',
      log: 'Initialization started',
      output: 'Initialization complete',
    },
    {
      stepId: '2',
      stepName: 'Processing',
      stepState: 'running',
      log: 'Processing data...',
    },
    {
      stepId: '3',
      stepName: 'Validation',
      stepState: 'pending',
    },
  ];

  it('renders modal with artifacts', () => {
    const artifacts = createMockArtifacts();
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    expect(screen.getByText('Thinking Process')).toBeInTheDocument();
    expect(screen.getByText('Initialize')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
  });

  it('renders state badges with correct colors', () => {
    const artifacts = createMockArtifacts();
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders failed state badge', () => {
    const artifacts: ThinkingArtifact[] = [
      {
        stepId: '1',
        stepName: 'Failed Step',
        stepState: 'failed',
        log: 'Error occurred',
      },
    ];
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows collapsible log section when log is present', async () => {
    const artifacts: ThinkingArtifact[] = [
      {
        stepId: '1',
        stepName: 'Test Step',
        log: 'This is a test log',
      },
    ];
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    const logButton = screen.getByText('Log');
    expect(logButton).toBeInTheDocument();

    // Log should be collapsed by default
    expect(screen.queryByText('This is a test log')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(logButton);
    await waitFor(() => {
      expect(screen.getByText('This is a test log')).toBeInTheDocument();
    });
  });

  it('shows collapsible output section when output is present', async () => {
    const artifacts: ThinkingArtifact[] = [
      {
        stepId: '1',
        stepName: 'Test Step',
        output: 'This is test output',
      },
    ];
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    const outputButton = screen.getByText('Output');
    expect(outputButton).toBeInTheDocument();

    // Output should be collapsed by default
    expect(screen.queryByText('This is test output')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(outputButton);
    await waitFor(() => {
      expect(screen.getByText('This is test output')).toBeInTheDocument();
    });
  });

  it('does not show log or output sections when not present', () => {
    const artifacts: ThinkingArtifact[] = [
      {
        stepId: '1',
        stepName: 'Minimal Step',
      },
    ];
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    expect(screen.queryByText('Log')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
    expect(screen.getByText('No additional details available')).toBeInTheDocument();
  });

  it('shows empty state when no artifacts', () => {
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={[]}
      />
    );

    expect(screen.getByText('No thinking artifacts available yet...')).toBeInTheDocument();
  });

  it('handles long content with proper text wrapping', () => {
    const artifacts: ThinkingArtifact[] = [
      {
        stepId: '1',
        stepName: 'Very Long Step Name That Should Wrap Properly Without Breaking Layout',
        stepState: 'complete',
        log: 'This is a very long log message that should wrap properly and not break the layout or overflow the container boundaries',
      },
    ];
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    const stepName = screen.getByTestId('artifact-step-name');
    expect(stepName).toHaveClass('break-words');
  });

  it('renders multiple artifacts in order', () => {
    const artifacts: ThinkingArtifact[] = [
      { stepId: '1', stepName: 'Step 1' },
      { stepId: '2', stepName: 'Step 2' },
      { stepId: '3', stepName: 'Step 3' },
    ];
    
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    const stepNames = screen.getAllByTestId('artifact-step-name');
    expect(stepNames).toHaveLength(3);
    expect(stepNames[0]).toHaveTextContent('Step 1');
    expect(stepNames[1]).toHaveTextContent('Step 2');
    expect(stepNames[2]).toHaveTextContent('Step 3');
  });

  it('calls onOpenChange when dialog is closed', () => {
    render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={[]}
      />
    );

    // Simulate ESC key press to close dialog
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ThinkingArtifactsModal - Auto-scroll', () => {
  const mockOnOpenChange = vi.fn();

  it('auto-scrolls to bottom when new artifacts are added', async () => {
    const initialArtifacts: ThinkingArtifact[] = [
      { stepId: '1', stepName: 'Step 1' },
    ];

    const { rerender } = render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={initialArtifacts}
      />
    );

    const container = screen.getByTestId('thinking-artifacts-container');
    const scrollToSpy = vi.fn();
    container.scrollTo = scrollToSpy;

    // Add new artifact
    const updatedArtifacts: ThinkingArtifact[] = [
      ...initialArtifacts,
      { stepId: '2', stepName: 'Step 2' },
    ];

    rerender(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={updatedArtifacts}
      />
    );

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: 'smooth',
        })
      );
    });
  });

  it('does not auto-scroll when artifacts length stays the same', async () => {
    const artifacts: ThinkingArtifact[] = [
      { stepId: '1', stepName: 'Step 1', stepState: 'running' },
    ];

    const { rerender } = render(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={artifacts}
      />
    );

    const container = screen.getByTestId('thinking-artifacts-container');
    const scrollToSpy = vi.fn();
    container.scrollTo = scrollToSpy;

    // Update artifact state without adding new ones
    const updatedArtifacts: ThinkingArtifact[] = [
      { stepId: '1', stepName: 'Step 1', stepState: 'complete' },
    ];

    rerender(
      <ThinkingArtifactsModal
        open={true}
        onOpenChange={mockOnOpenChange}
        artifacts={updatedArtifacts}
      />
    );

    await waitFor(() => {
      expect(scrollToSpy).not.toHaveBeenCalled();
    });
  });
});
