import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PRMetricsWidget } from '@/components/dashboard/pr-metrics-widget';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import * as useGithubAppModule from '@/hooks/useGithubApp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useWorkspace');
vi.mock('@/hooks/useGithubApp');

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('PRMetricsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns null when no GitHub connection', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({ workspace: { id: '1' }, slug: 'test' } as any);
    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({ hasTokens: false, isLoading: false } as any);
    const { container } = render(<PRMetricsWidget />, { wrapper });
    expect(container.firstChild).toBeNull();
  });

  it('shows loading spinner while fetching', async () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({ workspace: { id: '1' }, slug: 'test' } as any);
    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({ hasTokens: true, isLoading: false } as any);
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}));
    render(<PRMetricsWidget />, { wrapper });
    await waitFor(() => expect(document.querySelector('.animate-spin')).toBeInTheDocument());
  });

  it('renders widget with PR data', async () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({ workspace: { id: '1' }, slug: 'test' } as any);
    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({ hasTokens: true, isLoading: false } as any);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ successRate: 80, avgTimeToMerge: 2, prCount: 10, mergedCount: 8 }),
    } as Response);
    const { container } = render(<PRMetricsWidget />, { wrapper });
    await waitFor(() => expect(container.querySelector('.rounded-lg')).toBeInTheDocument());
  });
});
