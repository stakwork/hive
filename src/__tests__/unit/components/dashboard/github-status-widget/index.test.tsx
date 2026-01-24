import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { GitHubStatusWidget } from '@/components/dashboard/github-status-widget';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import * as useGithubAppModule from '@/hooks/useGithubApp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the hooks
vi.mock('@/hooks/useWorkspace');
vi.mock('@/hooks/useGithubApp');

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// Create a test QueryClient for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

// Wrapper component to provide QueryClient
const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

describe('GitHubStatusWidget', () => {
  const mockWorkspace = {
    id: 'workspace-123',
    name: 'Test Workspace',
    slug: 'test-workspace',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('Loading States', () => {
    it('should show loading spinner while GitHub app status is loading', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: false,
        isLoading: true,
      } as any);

      render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      // Check for the loading spinner by class
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should show loading spinner while metrics are being fetched', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      // Delay the fetch to keep loading state
      vi.mocked(global.fetch).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      // Should show loading spinner while fetching
      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe('No Connection State', () => {
    it('should show "Link GitHub" button when no tokens are available', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: false,
        isLoading: false,
      } as any);

      render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      expect(screen.getByText('Link GitHub')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error state with red indicator when API fails', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        const redIndicator = document.querySelector('.bg-red-500');
        expect(redIndicator).toBeInTheDocument();
      });
    });
  });

  describe('Zero State', () => {
    it('should render zero state when prCount is 0', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: null,
        avgTimeToMerge: null,
        prCount: 0,
        mergedCount: 0,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        // Should render the GitHub icon in muted color (no indicator dot)
        const mutedIcon = container.querySelector('.text-muted-foreground');
        expect(mutedIcon).toBeInTheDocument();
      });
    });
  });

  describe('Metrics Display with Data', () => {
    it('should render with metrics data and correct color indicators', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: 85,
        avgTimeToMerge: 3.5,
        prCount: 10,
        mergedCount: 8,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        // Should have green indicator for >70% success rate
        const greenIndicator = container.querySelector('.bg-green-500');
        expect(greenIndicator).toBeInTheDocument();
      });
    });

    it('should show yellow indicator for success rate between 50-70%', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: 60,
        avgTimeToMerge: 2.5,
        prCount: 10,
        mergedCount: 6,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        const yellowIndicator = container.querySelector('.bg-yellow-500');
        expect(yellowIndicator).toBeInTheDocument();
      });
    });

    it('should show red indicator for success rate below 50%', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: 30,
        avgTimeToMerge: 5.0,
        prCount: 10,
        mergedCount: 3,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        const redIndicator = container.querySelector('.bg-red-500');
        expect(redIndicator).toBeInTheDocument();
      });
    });

    it('should show red indicator when success rate is null', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: null, // Below threshold of 3 PRs
        avgTimeToMerge: 2.0,
        prCount: 2,
        mergedCount: 1,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        const redIndicator = container.querySelector('.bg-red-500');
        expect(redIndicator).toBeInTheDocument();
      });
    });
  });

  describe('Below Threshold Display', () => {
    it('should render with red indicator when success rate is null', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: null,
        avgTimeToMerge: 1.5,
        prCount: 2,
        mergedCount: 1,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        // Should show red indicator for null success rate
        const redIndicator = container.querySelector('.bg-red-500');
        expect(redIndicator).toBeInTheDocument();
      });
    });

    it('should render when avgTimeToMerge is null', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: 50,
        avgTimeToMerge: null,
        prCount: 4,
        mergedCount: 2,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        // Should show yellow indicator for 50% success rate
        const yellowIndicator = container.querySelector('.bg-yellow-500');
        expect(yellowIndicator).toBeInTheDocument();
      });
    });
  });

  describe('Time Formatting', () => {
    it('should render with metrics when avgTimeToMerge is in hours', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: 80,
        avgTimeToMerge: 2.5, // 2.5 hours
        prCount: 10,
        mergedCount: 8,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        // Should have green indicator for >70% success rate
        const greenIndicator = container.querySelector('.bg-green-500');
        expect(greenIndicator).toBeInTheDocument();
      });
    });

    it('should render with metrics when avgTimeToMerge is in days', async () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: 75,
        avgTimeToMerge: 30, // 30 hours = 1.25 days
        prCount: 8,
        mergedCount: 6,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      } as Response);

      const { container } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        // Should have green indicator for >70% success rate
        const greenIndicator = container.querySelector('.bg-green-500');
        expect(greenIndicator).toBeInTheDocument();
      });
    });
  });
});
