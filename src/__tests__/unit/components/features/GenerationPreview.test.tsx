import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GenerationPreview from '@/components/features/GenerationPreview';

describe('GenerationPreview Component', () => {
  const defaultProps = {
    content: 'Generated content for testing',
    source: 'quick' as const,
    onAccept: vi.fn(),
    onReject: vi.fn(),
    isLoading: false,
  };

  describe('Layout Structure', () => {
    it('should render two-row button layout when feedback is enabled', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      // Verify feedback input exists (row 1)
      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      expect(feedbackInput).toBeInTheDocument();

      // Verify Submit Feedback button exists (row 1)
      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });
      expect(submitButton).toBeInTheDocument();

      // Verify Accept button exists (row 2)
      const acceptButton = screen.getByRole('button', { name: /accept/i });
      expect(acceptButton).toBeInTheDocument();

      // Verify Reject button exists (row 2)
      const rejectButton = screen.getByRole('button', { name: /reject/i });
      expect(rejectButton).toBeInTheDocument();
    });

    it('should render only Accept/Reject buttons when feedback is disabled', () => {
      render(<GenerationPreview {...defaultProps} />);

      // Verify feedback input does not exist
      const feedbackInput = screen.queryByPlaceholderText(
        'Provide feedback...'
      );
      expect(feedbackInput).not.toBeInTheDocument();

      // Verify Submit Feedback button does not exist
      const submitButton = screen.queryByRole('button', {
        name: /submit feedback/i,
      });
      expect(submitButton).not.toBeInTheDocument();

      // Verify Accept/Reject buttons still exist
      expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });

    it('should display content in scrollable area', () => {
      render(<GenerationPreview {...defaultProps} />);

      const content = screen.getByText(defaultProps.content);
      expect(content).toBeInTheDocument();
    });

    it('should render icon based on source type', () => {
      const { container: quickContainer } = render(
        <GenerationPreview {...defaultProps} source="quick" />
      );
      expect(quickContainer.querySelector('svg')).toBeInTheDocument();

      const { container: deepContainer } = render(
        <GenerationPreview {...defaultProps} source="deep" />
      );
      expect(deepContainer.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Feedback Submission', () => {
    it('should call onProvideFeedback when Submit Feedback button is clicked', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });

      // Type feedback
      fireEvent.change(feedbackInput, {
        target: { value: 'This needs improvement' },
      });

      // Click submit button
      fireEvent.click(submitButton);

      expect(onProvideFeedback).toHaveBeenCalledWith('This needs improvement');
    });

    it('should call onProvideFeedback when Enter key is pressed in feedback input', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');

      // Type feedback
      fireEvent.change(feedbackInput, {
        target: { value: 'This needs improvement' },
      });

      // Press Enter key - use keyPress event as defined in component
      fireEvent.keyPress(feedbackInput, { key: 'Enter', code: 'Enter', charCode: 13 });

      expect(onProvideFeedback).toHaveBeenCalledWith('This needs improvement');
    });

    it('should not submit feedback when input is empty', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });

      // Try to click submit with empty input
      fireEvent.click(submitButton);

      expect(onProvideFeedback).not.toHaveBeenCalled();
    });

    it('should not submit feedback when input contains only whitespace', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });

      // Type only whitespace
      fireEvent.change(feedbackInput, { target: { value: '   ' } });

      // Try to submit
      fireEvent.click(submitButton);

      expect(onProvideFeedback).not.toHaveBeenCalled();
    });

    it('should clear feedback input after successful submission', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      const feedbackInput = screen.getByPlaceholderText(
        'Provide feedback...'
      ) as HTMLInputElement;
      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });

      // Type feedback
      fireEvent.change(feedbackInput, {
        target: { value: 'This needs improvement' },
      });

      // Submit
      fireEvent.click(submitButton);

      // Input should be cleared
      expect(feedbackInput.value).toBe('');
    });
  });

  describe('Accept/Reject Button Interactions', () => {
    it('should call onAccept when Accept button is clicked', () => {
      const onAccept = vi.fn();
      render(<GenerationPreview {...defaultProps} onAccept={onAccept} />);

      const acceptButton = screen.getByRole('button', { name: /accept/i });
      fireEvent.click(acceptButton);

      expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it('should call onReject when Reject button is clicked', () => {
      const onReject = vi.fn();
      render(<GenerationPreview {...defaultProps} onReject={onReject} />);

      const rejectButton = screen.getByRole('button', { name: /reject/i });
      fireEvent.click(rejectButton);

      expect(onReject).toHaveBeenCalledTimes(1);
    });

    it('should work independently from feedback submission', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          {...defaultProps}
          onAccept={onAccept}
          onReject={onReject}
          onProvideFeedback={onProvideFeedback}
        />
      );

      // Click Accept button
      const acceptButton = screen.getByRole('button', { name: /accept/i });
      fireEvent.click(acceptButton);

      // Only Accept should be called
      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onReject).not.toHaveBeenCalled();
      expect(onProvideFeedback).not.toHaveBeenCalled();

      // Click Reject button
      const rejectButton = screen.getByRole('button', { name: /reject/i });
      fireEvent.click(rejectButton);

      // Only Reject should be called (Accept count stays at 1)
      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onProvideFeedback).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('should disable all buttons when isLoading is true', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
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

    it('should disable feedback input when isLoading is true', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
          isLoading={true}
        />
      );

      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      expect(feedbackInput).toBeDisabled();
    });

    it('should not call handlers when buttons are disabled', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          {...defaultProps}
          onAccept={onAccept}
          onReject={onReject}
          onProvideFeedback={onProvideFeedback}
          isLoading={true}
        />
      );

      // Try to click all buttons
      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });
      const acceptButton = screen.getByRole('button', { name: /accept/i });
      const rejectButton = screen.getByRole('button', { name: /reject/i });

      fireEvent.click(submitButton);
      fireEvent.click(acceptButton);
      fireEvent.click(rejectButton);

      // No handlers should be called
      expect(onProvideFeedback).not.toHaveBeenCalled();
      expect(onAccept).not.toHaveBeenCalled();
      expect(onReject).not.toHaveBeenCalled();
    });

    it('should enable all buttons when isLoading is false', () => {
      const onProvideFeedback = vi.fn();
      render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
          isLoading={false}
        />
      );

      const acceptButton = screen.getByRole('button', { name: /accept/i });
      const rejectButton = screen.getByRole('button', { name: /reject/i });

      expect(acceptButton).not.toBeDisabled();
      expect(rejectButton).not.toBeDisabled();

      // Submit button should only be enabled if feedback is not empty
      const feedbackInput = screen.getByPlaceholderText('Provide feedback...');
      fireEvent.change(feedbackInput, { target: { value: 'Test feedback' } });

      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('Button Icons and Text', () => {
    it('should display Submit Feedback button with ArrowUp icon and text label', () => {
      const onProvideFeedback = vi.fn();
      const { container } = render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      const submitButton = screen.getByRole('button', {
        name: /submit feedback/i,
      });

      // Verify button text exists
      expect(submitButton).toHaveTextContent('Submit Feedback');

      // Verify ArrowUp icon exists (SVG element inside button)
      const svg = submitButton.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should display Accept button with Check icon and text label', () => {
      render(<GenerationPreview {...defaultProps} />);

      const acceptButton = screen.getByRole('button', { name: /accept/i });

      // Verify button text
      expect(acceptButton).toHaveTextContent('Accept');

      // Verify Check icon exists
      const svg = acceptButton.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should display Reject button with X icon and text label', () => {
      render(<GenerationPreview {...defaultProps} />);

      const rejectButton = screen.getByRole('button', { name: /reject/i });

      // Verify button text
      expect(rejectButton).toHaveTextContent('Reject');

      // Verify X icon exists
      const svg = rejectButton.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Responsive Layout', () => {
    it('should maintain proper spacing between rows', () => {
      const onProvideFeedback = vi.fn();
      const { container } = render(
        <GenerationPreview
          {...defaultProps}
          onProvideFeedback={onProvideFeedback}
        />
      );

      // Verify flex column with gap exists
      const buttonContainer = container.querySelector('.flex.flex-col.gap-3');
      expect(buttonContainer).toBeInTheDocument();
    });

    it('should align Accept/Reject buttons to the right in row 2', () => {
      const { container } = render(<GenerationPreview {...defaultProps} />);

      // Find the second row container
      const rows = container.querySelectorAll('.flex');
      const secondRow = Array.from(rows).find((row) =>
        row.className.includes('justify-end')
      );

      expect(secondRow).toBeInTheDocument();
    });
  });
});
