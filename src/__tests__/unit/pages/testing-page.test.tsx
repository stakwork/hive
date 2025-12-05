import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Make React globally available for JSX transformation
globalThis.React = React;

// Mock the dependencies before importing the component
vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(),
}));

vi.mock('@/components/UserJourneys', () => ({
  default: () => <div data-testid="user-journeys-component">UserJourneys Component</div>,
}));

// Import the component after mocks are set up
const TestingPage = (await import('@/app/w/[slug]/testing/page')).default;
const mockUseFeatureFlag = vi.mocked(
  (await import('@/hooks/useFeatureFlag')).useFeatureFlag
);

describe('TestingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when feature flag is disabled', () => {
    it('should display feature unavailable message', () => {
      mockUseFeatureFlag.mockReturnValue(false);

      render(<TestingPage />);

      expect(
        screen.getByText('This feature is not available in your workspace.')
      ).toBeInTheDocument();
      expect(screen.queryByTestId('user-journeys-component')).not.toBeInTheDocument();
    });

    it('should center the unavailable message', () => {
      mockUseFeatureFlag.mockReturnValue(false);

      const { container } = render(<TestingPage />);
      const messageContainer = container.firstChild as HTMLElement;

      expect(messageContainer).toHaveClass('flex', 'items-center', 'justify-center', 'h-screen');
    });
  });

  describe('when feature flag is enabled', () => {
    beforeEach(() => {
      mockUseFeatureFlag.mockReturnValue(true);
    });

    it('should render UserJourneys component directly', () => {
      render(<TestingPage />);

      expect(screen.getByTestId('user-journeys-component')).toBeInTheDocument();
    });

    it('should NOT render PageHeader', () => {
      const { container } = render(<TestingPage />);

      // Verify no header with "Testing" title exists
      expect(screen.queryByRole('heading', { name: /testing/i })).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="page-header"]')).not.toBeInTheDocument();
    });

    it('should NOT render Tabs component', () => {
      const { container } = render(<TestingPage />);

      // Verify no tabs (Coverage/User Journeys) exist
      expect(screen.queryByRole('tab', { name: /coverage/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /user journeys/i })).not.toBeInTheDocument();
      expect(container.querySelector('[role="tablist"]')).not.toBeInTheDocument();
    });

    it('should wrap UserJourneys in a flex container for full height', () => {
      const { container } = render(<TestingPage />);
      const wrapper = container.firstChild as HTMLElement;

      expect(wrapper).toHaveClass('flex', 'flex-col', 'h-full');
    });

    it('should call useFeatureFlag with CODEBASE_RECOMMENDATION flag', () => {
      mockUseFeatureFlag.mockReturnValue(true);

      render(<TestingPage />);

      expect(mockUseFeatureFlag).toHaveBeenCalledWith('CODEBASE_RECOMMENDATION');
    });
  });

  describe('layout changes', () => {
    it('should maximize vertical space by removing header and tabs', () => {
      mockUseFeatureFlag.mockReturnValue(true);

      const { container } = render(<TestingPage />);

      // Verify the simplified structure
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.children.length).toBe(1); // Only UserJourneys component
      expect(wrapper.querySelector('[data-testid="user-journeys-component"]')).toBeInTheDocument();
    });
  });
});
