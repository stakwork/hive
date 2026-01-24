/**
 * Integration test for GitHubStatusWidget component
 * Tests full render cycle with mocked API endpoint
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('GitHubStatusWidget - Integration', () => {
  const mockWorkspace = {
    id: 'workspace-123',
    name: 'Test Workspace',
    slug: 'test-workspace',
  };

  let fetchMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup fetch mock
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render complete flow from loading to displaying metrics', async () => {
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
      avgTimeToMerge: 3.2,
      prCount: 8,
      mergedCount: 6,
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockMetrics,
    });

    const { container } = render(
      <TestWrapper>
        <GitHubStatusWidget />
      </TestWrapper>
    );

    // Should show loading initially
    await waitFor(() => {
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    // Should fetch the correct endpoint
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/github/pr-metrics?workspaceId=workspace-123')
      );
    });

    // Should render metrics after loading
    await waitFor(() => {
      const greenIndicator = container.querySelector('.bg-green-500');
      expect(greenIndicator).toBeInTheDocument();
    });
  });

  it('should handle API error and display error state', async () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      slug: 'test-workspace',
    } as any);

    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
      hasTokens: true,
      isLoading: false,
    } as any);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { container } = render(
      <TestWrapper>
        <GitHubStatusWidget />
      </TestWrapper>
    );

    // Should show error state with red indicator
    await waitFor(() => {
      const redIndicator = container.querySelector('.bg-red-500');
      expect(redIndicator).toBeInTheDocument();
    });
  });

  it('should handle zero PR state correctly', async () => {
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

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockMetrics,
    });

    const { container } = render(
      <TestWrapper>
        <GitHubStatusWidget />
      </TestWrapper>
    );

    await waitFor(() => {
      // Icon should be muted (no indicator for zero state)
      const mutedIcon = container.querySelector('.text-muted-foreground');
      expect(mutedIcon).toBeInTheDocument();
    });
  });

  it('should not fetch metrics when GitHub is not connected', async () => {
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

    // Should show "Link GitHub" button
    expect(screen.getByText('Link GitHub')).toBeInTheDocument();

    // Should NOT call the API
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('should display below threshold state with red indicator', async () => {
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
      avgTimeToMerge: 1.5,
      prCount: 2,
      mergedCount: 1,
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockMetrics,
    });

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

  it('should use correct color indicators based on success rate thresholds', async () => {
    const testCases = [
      { successRate: 85, expectedColor: 'bg-green-500', description: '>70%' },
      { successRate: 60, expectedColor: 'bg-yellow-500', description: '50-70%' },
      { successRate: 30, expectedColor: 'bg-red-500', description: '<50%' },
    ];

    for (const testCase of testCases) {
      vi.clearAllMocks();

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
      } as any);

      vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({
        hasTokens: true,
        isLoading: false,
      } as any);

      const mockMetrics = {
        successRate: testCase.successRate,
        avgTimeToMerge: 2.0,
        prCount: 10,
        mergedCount: Math.round((testCase.successRate / 100) * 10),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetrics,
      });

      const { unmount } = render(
        <TestWrapper>
          <GitHubStatusWidget />
        </TestWrapper>
      );

      await waitFor(() => {
        const colorIndicator = document.querySelector(`.${testCase.expectedColor}`);
        expect(colorIndicator).toBeInTheDocument();
      }, { timeout: 1000 });

      unmount();
    }
  });
});
