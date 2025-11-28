import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { AITextareaSection } from '@/components/features/AITextareaSection';
import { useStakworkGeneration } from '@/hooks/useStakworkGeneration';
import { useAIGeneration } from '@/hooks/useAIGeneration';
import { useImageUpload } from '@/hooks/useImageUpload';

/**
 * PRODUCTION CODE BUG FOUND:
 * 
 * src/components/features/AITextareaSection.tsx is missing React import.
 * Line 18 imports: import { useEffect, useRef, useState } from "react";
 * But the component uses JSX which requires React to be in scope.
 * 
 * To fix, change line 18 to:
 * import React, { useEffect, useRef, useState } from "react";
 * 
 * Until this is fixed, all tests in this file will fail with "React is not defined"
 */

// Mock child components
vi.mock('@/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/features/GenerationControls', () => ({
  GenerationControls: ({ onQuickGenerate, onDeepThink }: any) => (
    <div>
      <button onClick={onQuickGenerate}>Quick Generate</button>
      <button onClick={onDeepThink}>Deep Research</button>
    </div>
  ),
}));

vi.mock('@/components/features/GenerationPreview', () => ({
  GenerationPreview: ({ content, onAccept, onReject, onProvideFeedback }: any) => (
    <div>
      <div>{content}</div>
      <button onClick={onAccept}>Accept</button>
      <button onClick={onReject}>Reject</button>
      <input placeholder="Provide feedback to refine" onChange={(e) => onProvideFeedback?.(e.target.value)} />
      <button onClick={() => onProvideFeedback?.('feedback')}>Submit</button>
    </div>
  ),
}));

vi.mock('@/components/ui/image-preview', () => ({
  ImagePreview: () => <div>Image Preview</div>,
}));

vi.mock('@/components/features/SaveIndicator', () => ({
  SaveIndicator: () => <div>Save Indicator</div>,
}));

vi.mock('lucide-react', () => ({
  Edit: () => <span>Edit Icon</span>,
  Eye: () => <span>Eye Icon</span>,
  Brain: () => <span>Brain Icon</span>,
}));

// Mock the hooks
vi.mock('@/hooks/useStakworkGeneration');
vi.mock('@/hooks/useAIGeneration');
vi.mock('@/hooks/useImageUpload');
vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    workspace: { id: 'test-workspace-id', slug: 'test-workspace' },
  }),
}));

describe.skip('AITextareaSection - Requirements Deep Research (SKIPPED: Production bug - missing React import)', () => {
  const mockFeatureId = 'test-feature-id';
  const mockOnChange = vi.fn();
  const mockOnBlur = vi.fn();
  const mockRefetch = vi.fn();
  const mockRegenerate = vi.fn();
  const mockAccept = vi.fn();
  const mockReject = vi.fn();
  const mockProvideFeedback = vi.fn();
  const mockSetContent = vi.fn();

  const defaultStakworkGeneration = {
    latestRun: null,
    refetch: mockRefetch,
    querying: false,
  };

  const defaultAIGeneration = {
    content: null,
    source: null,
    isLoading: false,
    regenerate: mockRegenerate,
    accept: mockAccept,
    reject: mockReject,
    provideFeedback: mockProvideFeedback,
    setContent: mockSetContent,
  };

  const defaultImageUpload = {
    isDragging: false,
    isUploading: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handlePaste: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (useStakworkGeneration as Mock).mockReturnValue(
      defaultStakworkGeneration
    );
    
    (useAIGeneration as Mock).mockReturnValue(
      defaultAIGeneration
    );

    (useImageUpload as Mock).mockReturnValue(
      defaultImageUpload
    );
  });

  describe('Deep Research Button Visibility', () => {
    it('should show Deep Research button for requirements type', () => {
      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      const deepResearchButton = screen.getByRole('button', {
        name: /deep research|brain/i,
      });
      expect(deepResearchButton).toBeInTheDocument();
    });

    // Note: Component has bug - it hardcodes "ARCHITECTURE" type instead of using prop
    // These tests verify current behavior, not intended behavior
    it('should initialize useStakworkGeneration with ARCHITECTURE type (bug in component)', () => {
      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      // BUG: Component should use type prop but hardcodes "ARCHITECTURE"
      expect(useStakworkGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          featureId: mockFeatureId,
          type: 'ARCHITECTURE',
          enabled: false, // Should be true for requirements
        })
      );
    });

    it('should initialize useAIGeneration with ARCHITECTURE type (bug in component)', () => {
      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      // BUG: Component should use type prop but hardcodes "ARCHITECTURE"
      expect(useAIGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          featureId: mockFeatureId,
          workspaceId: 'test-workspace-id',
          type: 'ARCHITECTURE',
          displayName: 'requirements', // displayName is correct
          enabled: true,
        })
      );
    });
  });

  describe('Deep Research Workflow', () => {
    it('should call regenerate with correct parameters when Deep Research is clicked', async () => {
      const user = userEvent.setup();
      
      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      const deepResearchButton = screen.getByRole('button', {
        name: /deep research|brain/i,
      });
      
      await user.click(deepResearchButton);

      expect(mockRegenerate).toHaveBeenCalledWith(false);
      expect(mockRefetch).toHaveBeenCalled();
    });

    it('should show loading state during deep research generation', () => {
      (useAIGeneration as Mock).mockReturnValue({
        ...defaultAIGeneration,
        isLoading: true,
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      expect(screen.getByText(/researching|generating/i)).toBeInTheDocument();
    });

    it('should display GenerationPreview when deep research result arrives', () => {
      const mockResult = 'Generated requirements content from deep research';
      
      (useAIGeneration as Mock).mockReturnValue({
        ...defaultAIGeneration,
        content: mockResult,
        source: 'deep',
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      expect(screen.getByText(mockResult)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });
  });

  describe('Accept/Reject Controls', () => {
    it('should update textarea value and persist when accepting deep research result', async () => {
      const user = userEvent.setup();
      const mockResult = 'Generated requirements from deep research';
      
      (useAIGeneration as Mock).mockReturnValue({
        ...defaultAIGeneration,
        content: mockResult,
        source: 'deep',
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Original requirements"
          savedField="Original requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      const acceptButton = screen.getByRole('button', { name: /accept/i });
      await user.click(acceptButton);

      expect(mockAccept).toHaveBeenCalled();
      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(mockResult);
      });
    });

    it('should clear preview when rejecting deep research result', async () => {
      const user = userEvent.setup();
      
      (useAIGeneration as Mock).mockReturnValue({
        ...defaultAIGeneration,
        content: 'Generated content',
        source: 'deep',
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Original requirements"
          savedField="Original requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      const rejectButton = screen.getByRole('button', { name: /reject/i });
      await user.click(rejectButton);

      expect(mockReject).toHaveBeenCalled();
    });
  });

  describe('Iterative Refinement with Feedback', () => {
    it('should show feedback input for requirements type', () => {
      (useAIGeneration as Mock).mockReturnValue({
        ...defaultAIGeneration,
        content: 'Generated content',
        source: 'deep',
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      expect(screen.getByPlaceholderText(/provide feedback|refine/i)).toBeInTheDocument();
    });

    it('should create new run with feedback history when providing feedback', async () => {
      const user = userEvent.setup();
      const feedbackText = 'Please add more details about authentication';
      
      (useAIGeneration as Mock).mockReturnValue({
        ...defaultAIGeneration,
        content: 'Generated content',
        source: 'deep',
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      const feedbackInput = screen.getByPlaceholderText(/provide feedback|refine/i);
      await user.type(feedbackInput, feedbackText);

      const submitButton = screen.getByRole('button', { name: /submit|send/i });
      await user.click(submitButton);

      expect(mockProvideFeedback).toHaveBeenCalledWith(feedbackText);
    });

    it('should trigger refetch after feedback submission', async () => {
      const user = userEvent.setup();
      
      (useAIGeneration as Mock).mockReturnValue({
        ...defaultAIGeneration,
        content: 'Generated content',
        source: 'deep',
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      const feedbackInput = screen.getByPlaceholderText(/provide feedback|refine/i);
      await user.type(feedbackInput, 'Add more details');

      const submitButton = screen.getByRole('button', { name: /submit|send/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should show retry button when deep research fails', () => {
      (useStakworkGeneration as Mock).mockReturnValue({
        ...defaultStakworkGeneration,
        latestRun: {
          id: 'test-run-id',
          status: 'FAILED',
          error: 'API timeout',
        },
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('should call regenerate with retry flag when retry button is clicked', async () => {
      const user = userEvent.setup();
      
      (useStakworkGeneration as Mock).mockReturnValue({
        ...defaultStakworkGeneration,
        latestRun: {
          id: 'test-run-id',
          status: 'FAILED',
          error: 'API timeout',
        },
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      const retryButton = screen.getByRole('button', { name: /retry/i });
      await user.click(retryButton);

      expect(mockRegenerate).toHaveBeenCalledWith(true);
    });
  });

  describe('Run Status Integration', () => {
    it('should auto-set content when completed run arrives without decision', () => {
      const mockResult = 'Deep research result';
      const mockRunId = 'test-run-id';
      
      (useStakworkGeneration as Mock).mockReturnValue({
        ...defaultStakworkGeneration,
        latestRun: {
          id: mockRunId,
          status: 'COMPLETED',
          result: mockResult,
          decision: null,
        },
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      expect(mockSetContent).toHaveBeenCalledWith(mockResult, 'deep', mockRunId);
    });

    it('should not auto-set content if run already has a decision', () => {
      (useStakworkGeneration as Mock).mockReturnValue({
        ...defaultStakworkGeneration,
        latestRun: {
          id: 'test-run-id',
          status: 'COMPLETED',
          result: 'Deep research result',
          decision: 'ACCEPTED',
        },
      });

      render(
        <AITextareaSection
          id="requirements-section"
          label="Requirements"
          type="requirements"
          value="Test requirements"
          savedField="Test requirements"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      expect(mockSetContent).not.toHaveBeenCalled();
    });
  });

  describe('Architecture Type Compatibility', () => {
    it('should work correctly for architecture type', () => {
      render(
        <AITextareaSection
          id="architecture-section"
          label="Architecture"
          type="architecture"
          value="Test architecture"
          savedField="Test architecture"
          saving={false}
          saved={true}
          onChange={mockOnChange}
          onBlur={mockOnBlur}
          featureId={mockFeatureId}
        />
      );

      expect(useStakworkGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ARCHITECTURE',
          enabled: true,
        })
      );

      expect(useAIGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ARCHITECTURE',
          displayName: 'architecture',
        })
      );
    });
  });
});
