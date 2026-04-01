import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WorkspacePRStats from '@/app/admin/workspaces/[slug]/WorkspacePRStats';

const twoRepoResponse = {
  repos: [
    {
      repoUrl: 'https://github.com/stakwork/hive',
      repoName: 'stakwork/hive',
      windows: {
        '24h': { hiveCount: 3, githubTotal: 7, percentage: 43 },
        '48h': { hiveCount: 5, githubTotal: 10, percentage: 50 },
        '1w':  { hiveCount: 8, githubTotal: 20, percentage: 40 },
        '2w':  { hiveCount: 10, githubTotal: 25, percentage: 40 },
        '1mo': { hiveCount: 15, githubTotal: 40, percentage: 38 },
      },
    },
    {
      repoUrl: 'https://github.com/stakwork/staklink',
      repoName: 'stakwork/staklink',
      windows: {
        '24h': { hiveCount: 1, githubTotal: 2, percentage: 50 },
        '48h': { hiveCount: 2, githubTotal: 4, percentage: 50 },
        '1w':  { hiveCount: 3, githubTotal: 8, percentage: 38 },
        '2w':  { hiveCount: 4, githubTotal: 12, percentage: 33 },
        '1mo': { hiveCount: 6, githubTotal: 18, percentage: 33 },
      },
    },
  ],
  totals: {
    windows: {
      '24h': { hiveCount: 4, githubTotal: 9, percentage: 44 },
      '48h': { hiveCount: 7, githubTotal: 14, percentage: 50 },
      '1w':  { hiveCount: 11, githubTotal: 28, percentage: 39 },
      '2w':  { hiveCount: 14, githubTotal: 37, percentage: 38 },
      '1mo': { hiveCount: 21, githubTotal: 58, percentage: 36 },
    },
  },
};

const nullGithubResponse = {
  repos: [
    {
      repoUrl: 'https://github.com/stakwork/hive',
      repoName: 'stakwork/hive',
      windows: {
        '24h': { hiveCount: 2, githubTotal: null, percentage: null },
        '48h': { hiveCount: 3, githubTotal: null, percentage: null },
        '1w':  { hiveCount: 5, githubTotal: null, percentage: null },
        '2w':  { hiveCount: 7, githubTotal: null, percentage: null },
        '1mo': { hiveCount: 9, githubTotal: null, percentage: null },
      },
    },
  ],
  totals: {
    windows: {
      '24h': { hiveCount: 2, githubTotal: null, percentage: null },
      '48h': { hiveCount: 3, githubTotal: null, percentage: null },
      '1w':  { hiveCount: 5, githubTotal: null, percentage: null },
      '2w':  { hiveCount: 7, githubTotal: null, percentage: null },
      '1mo': { hiveCount: 9, githubTotal: null, percentage: null },
    },
  },
};

describe('WorkspacePRStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeletons before fetch resolves', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<WorkspacePRStats workspaceId="ws-1" />);
    // Skeleton elements render while pending
    const skeletons = document.querySelectorAll('.animate-pulse, [class*="skeleton"], [data-slot="skeleton"]');
    // The h-8 skeletons should be present — check there are multiple
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders column headers for all 5 windows', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => twoRepoResponse,
    }) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getByText('24h')).toBeInTheDocument());
    expect(screen.getByText('48h')).toBeInTheDocument();
    expect(screen.getByText('1 week')).toBeInTheDocument();
    expect(screen.getByText('2 weeks')).toBeInTheDocument();
    expect(screen.getByText('1 month')).toBeInTheDocument();
    expect(screen.getByText('Repo')).toBeInTheDocument();
  });

  it('renders one data row per repo', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => twoRepoResponse,
    }) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getByText('stakwork/hive')).toBeInTheDocument());
    expect(screen.getByText('stakwork/staklink')).toBeInTheDocument();
  });

  it('formats cells as "hiveCount / githubTotal (percentage%)"', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => twoRepoResponse,
    }) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getByText('3 / 7 (43%)')).toBeInTheDocument());
    expect(screen.getByText('1 / 2 (50%)')).toBeInTheDocument();
  });

  it('shows totals row when there are >1 repos', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => twoRepoResponse,
    }) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getByText('Total')).toBeInTheDocument());
    expect(screen.getByText('4 / 9 (44%)')).toBeInTheDocument();
  });

  it('does not show totals row when there is only 1 repo', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => nullGithubResponse,
    }) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getByText('stakwork/hive')).toBeInTheDocument());
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('renders "hiveCount / —" when githubTotal is null', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => nullGithubResponse,
    }) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getAllByText(/\/ —/).length).toBeGreaterThan(0));
    expect(screen.getByText('2 / —')).toBeInTheDocument();
  });

  it('shows error message when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error')) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() =>
      expect(screen.getByText('Failed to load PR statistics.')).toBeInTheDocument()
    );
  });

  it('shows error message when response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Forbidden' }),
    }) as unknown as typeof fetch;

    render(<WorkspacePRStats workspaceId="ws-1" />);

    await waitFor(() =>
      expect(screen.getByText('Failed to load PR statistics.')).toBeInTheDocument()
    );
  });
});
