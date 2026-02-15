import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GitHubStatusWidget } from '@/components/dashboard/github-status-widget';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import * as useGithubAppModule from '@/hooks/useGithubApp';

vi.mock('@/hooks/useWorkspace');
vi.mock('@/hooks/useGithubApp');
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

describe('GitHubStatusWidget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading spinner while loading', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({ workspace: {}, slug: 'test' } as any);
    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({ hasTokens: false, isLoading: true } as any);
    render(<GitHubStatusWidget />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows Link GitHub button when not connected', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({ workspace: {}, slug: 'test' } as any);
    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({ hasTokens: false, isLoading: false } as any);
    render(<GitHubStatusWidget />);
    expect(screen.getByText('Link GitHub')).toBeInTheDocument();
  });

  it('shows green indicator for SYNCED status', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: { repositories: [{ status: 'SYNCED', updatedAt: new Date().toISOString() }] },
      slug: 'test',
    } as any);
    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({ hasTokens: true, isLoading: false } as any);
    const { container } = render(<GitHubStatusWidget />);
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument();
  });

  it('shows yellow indicator for PENDING status', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: { repositories: [{ status: 'PENDING' }] },
      slug: 'test',
    } as any);
    vi.mocked(useGithubAppModule.useGithubApp).mockReturnValue({ hasTokens: true, isLoading: false } as any);
    const { container } = render(<GitHubStatusWidget />);
    expect(container.querySelector('.bg-yellow-500')).toBeInTheDocument();
  });
});
