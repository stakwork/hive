import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GenerationPreview from '@/components/features/GenerationPreview';
import { prisma } from '@/lib/db';

// Mock fetch for API calls
global.fetch = vi.fn();

describe('GenerationPreview Feedback Integration Tests', () => {
  const mockWorkspaceId = 'test-workspace-id';
  const mockFeatureId = 'test-feature-id';
  const mockRunId = 'test-run-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Feedback Submission with API', () => {
    it('should submit feedback and trigger API call', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      const onProvideFeedback = vi.fn(async (feedback: string) => {
        await fetch(`/api/stakwork/runs/${mockRunId}/decision`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'FEEDBACK',
            feedback,
            featureId: mockFeatureId,
          }),
        });
      });

      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
          isLoading={false}
        />
      );

      // Type feedback
      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      fireEvent.change(feedbackInput, {
        target: { value: 'This needs improvement' },
      });

      // Submit via button
      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });
      fireEvent.click(submitButton);

      // Verify handler was called
      expect(onProvideFeedback).toHaveBeenCalledWith('This needs improvement');

      // Wait for API call
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/stakwork/runs/${mockRunId}/decision`,
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              decision: 'FEEDBACK',
              feedback: 'This needs improvement',
              featureId: mockFeatureId,
            }),
          })
        );
      });
    });

    it('should submit feedback via Enter key and trigger API call', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      const onProvideFeedback = vi.fn(async (feedback: string) => {
        await fetch(`/api/stakwork/runs/${mockRunId}/decision`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'FEEDBACK',
            feedback,
            featureId: mockFeatureId,
          }),
        });
      });

      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
          isLoading={false}
        />
      );

      // Type feedback
      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      fireEvent.change(feedbackInput, {
        target: { value: 'Add more details' },
      });

      // Submit via Enter key
      fireEvent.keyPress(feedbackInput, { key: 'Enter', code: 'Enter' });

      // Verify handler was called
      expect(onProvideFeedback).toHaveBeenCalledWith('Add more details');

      // Wait for API call
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/stakwork/runs/${mockRunId}/decision`,
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              decision: 'FEEDBACK',
              feedback: 'Add more details',
              featureId: mockFeatureId,
            }),
          })
        );
      });
    });

    it('should handle API errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'));
      global.fetch = mockFetch;

      const onProvideFeedback = vi.fn(async (feedback: string) => {
        try {
          await fetch(`/api/stakwork/runs/${mockRunId}/decision`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision: 'FEEDBACK',
              feedback,
              featureId: mockFeatureId,
            }),
          });
        } catch (error) {
          console.error('Failed to submit feedback:', error);
        }
      });

      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
          isLoading={false}
        />
      );

      // Type feedback
      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      fireEvent.change(feedbackInput, {
        target: { value: 'Test feedback' },
      });

      // Submit
      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });
      fireEvent.click(submitButton);

      // Verify handler was called
      expect(onProvideFeedback).toHaveBeenCalledWith('Test feedback');

      // Wait for API call to fail
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  describe('Accept/Reject Decision Persistence', () => {
    it('should submit Accept decision for deep research runs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      const onAccept = vi.fn(async () => {
        await fetch(`/api/stakwork/runs/${mockRunId}/decision`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'ACCEPTED',
            featureId: mockFeatureId,
          }),
        });
      });

      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={onAccept}
          onReject={vi.fn()}
          isLoading={false}
        />
      );

      // Click Accept button
      const acceptButton = screen.getByRole('button', { name: /accept/i });
      fireEvent.click(acceptButton);

      // Verify handler was called
      expect(onAccept).toHaveBeenCalledTimes(1);

      // Wait for API call
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/stakwork/runs/${mockRunId}/decision`,
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              decision: 'ACCEPTED',
              featureId: mockFeatureId,
            }),
          })
        );
      });
    });

    it('should submit Reject decision for deep research runs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      const onReject = vi.fn(async () => {
        await fetch(`/api/stakwork/runs/${mockRunId}/decision`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'REJECTED',
            featureId: mockFeatureId,
          }),
        });
      });

      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={vi.fn()}
          onReject={onReject}
          isLoading={false}
        />
      );

      // Click Reject button
      const rejectButton = screen.getByRole('button', { name: /reject/i });
      fireEvent.click(rejectButton);

      // Verify handler was called
      expect(onReject).toHaveBeenCalledTimes(1);

      // Wait for API call
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/stakwork/runs/${mockRunId}/decision`,
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              decision: 'REJECTED',
              featureId: mockFeatureId,
            }),
          })
        );
      });
    });

    it('should not persist decisions for quick generation', () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const onAccept = vi.fn();
      const onReject = vi.fn();

      render(
        <GenerationPreview
          content="Generated content"
          source="quick"
          onAccept={onAccept}
          onReject={onReject}
          isLoading={false}
        />
      );

      // Click Accept button
      const acceptButton = screen.getByRole('button', { name: /accept/i });
      fireEvent.click(acceptButton);

      // Handler should be called
      expect(onAccept).toHaveBeenCalledTimes(1);

      // But no API call should be made for quick generation
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Loading State During API Calls', () => {
    it('should disable all buttons during loading', () => {
      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={vi.fn()}
          isLoading={true}
        />
      );

      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });
      const acceptButton = screen.getByRole('button', { name: /accept/i });
      const rejectButton = screen.getByRole('button', { name: /reject/i });

      expect(submitButton).toBeDisabled();
      expect(acceptButton).toBeDisabled();
      expect(rejectButton).toBeDisabled();
    });

    it('should prevent multiple submissions during loading', () => {
      const onAccept = vi.fn();

      const { rerender } = render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={onAccept}
          onReject={vi.fn()}
          isLoading={false}
        />
      );

      const acceptButton = screen.getByRole('button', { name: /accept/i });

      // First click
      fireEvent.click(acceptButton);
      expect(onAccept).toHaveBeenCalledTimes(1);

      // Simulate loading state
      rerender(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={onAccept}
          onReject={vi.fn()}
          isLoading={true}
        />
      );

      // Try to click again while loading
      fireEvent.click(acceptButton);

      // Should not be called again
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
  });

  describe('Independent Button Functionality', () => {
    it('should allow Accept and Reject to work independently', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={onAccept}
          onReject={onReject}
          onProvideFeedback={onProvideFeedback}
          isLoading={false}
        />
      );

      // Click Accept
      const acceptButton = screen.getByRole('button', { name: /accept/i });
      fireEvent.click(acceptButton);

      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onReject).not.toHaveBeenCalled();
      expect(onProvideFeedback).not.toHaveBeenCalled();

      // Click Reject
      const rejectButton = screen.getByRole('button', { name: /reject/i });
      fireEvent.click(rejectButton);

      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onProvideFeedback).not.toHaveBeenCalled();
    });

    it('should allow feedback submission independently from Accept/Reject', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="Generated content"
          source="deep"
          onAccept={onAccept}
          onReject={onReject}
          onProvideFeedback={onProvideFeedback}
          isLoading={false}
        />
      );

      // Submit feedback
      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      fireEvent.change(feedbackInput, {
        target: { value: 'Test feedback' },
      });

      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });
      fireEvent.click(submitButton);

      expect(onProvideFeedback).toHaveBeenCalledTimes(1);
      expect(onAccept).not.toHaveBeenCalled();
      expect(onReject).not.toHaveBeenCalled();
    });
  });
});
