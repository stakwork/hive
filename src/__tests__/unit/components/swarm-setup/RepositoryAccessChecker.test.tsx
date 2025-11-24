import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { RepositoryAccessChecker } from '@/components/swarm-setup/RepositoryAccessChecker';

describe('RepositoryAccessChecker Component', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let mockCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    mockCallback = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('successful access checks', () => {
    it('should call callback with hasAccess=true when API returns push access', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasPushAccess: true }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(true, undefined);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/github/app/check?repositoryUrl=https%3A%2F%2Fgithub.com%2Fowner%2Frepo'
      );
    });

    it('should call callback with hasAccess=true for HTTPS URLs with .git suffix', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasPushAccess: true }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo.git"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(true, undefined);
      });
    });

    it('should call callback with hasAccess=true for SSH URLs', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasPushAccess: true }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="git@github.com:owner/repo.git"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(true, undefined);
      });
    });
  });

  describe('failed access checks', () => {
    it('should call callback with hasAccess=false when API returns no push access', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: false,
          error: 'Insufficient permissions',
        }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(false, 'Insufficient permissions');
      });
    });

    it('should call callback with hasAccess=false when API returns error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'Repository not found in installation',
        }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/private-repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(false, 'Repository not found in installation');
      });
    });

    it('should call callback with hasAccess=false on fetch failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(false, 'Failed to check repository access');
      });
    });

    it('should call callback with hasAccess=false when API returns 500 status', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(false, 'Internal server error');
      });
    });

    it('should call callback with hasAccess=false when requiresReauth is true', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: false,
          error: 'Token expired',
          requiresReauth: true,
        }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(false, 'Token expired');
      });
    });

    it('should call callback with hasAccess=false when requiresInstallationUpdate is true', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: false,
          error: 'Repository not in installation',
          requiresInstallationUpdate: true,
          installationId: 12345,
        }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/new-repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(false, 'Repository not in installation');
      });
    });
  });

  describe('edge cases', () => {
    it('should not call API when repositoryUrl is empty', () => {
      render(
        <RepositoryAccessChecker
          repositoryUrl=""
          onAccessResult={mockCallback}
        />
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should not call API when repositoryUrl is undefined', () => {
      render(
        <RepositoryAccessChecker
          repositoryUrl={undefined as unknown as string}
          onAccessResult={mockCallback}
        />
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should handle URLs with special characters', async () => {
      const urlWithSpecialChars = 'https://github.com/owner/repo-with-dashes_and_underscores';
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasPushAccess: true }),
      });

      render(
        <RepositoryAccessChecker
          repositoryUrl={urlWithSpecialChars}
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(true, undefined);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(urlWithSpecialChars))
      );
    });
  });

  describe('useEffect dependency tracking', () => {
    it('should trigger new check when repositoryUrl changes', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ hasPushAccess: true }),
      });

      const { rerender } = render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo1"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      // Change repository URL
      rerender(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo2"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      expect(mockCallback).toHaveBeenCalledTimes(2);
    });

    it('should not trigger new check when callback reference changes but URL stays same', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ hasPushAccess: true }),
      });

      const { rerender } = render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      // Change callback but keep same URL
      const newCallback = vi.fn();
      rerender(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={newCallback}
        />
      );

      await waitFor(() => {
        // Should trigger again because onAccessResult is in dependency array
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('component rendering', () => {
    it('should render null (no visible output)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasPushAccess: true }),
      });

      const { container } = render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('error logging', () => {
    it('should log errors to console on fetch failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockRejectedValueOnce(new Error('Network timeout'));

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to check repository access:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('should log errors to console on API error response', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockRejectedValueOnce(new Error('Failed to parse JSON'));

      render(
        <RepositoryAccessChecker
          repositoryUrl="https://github.com/owner/repo"
          onAccessResult={mockCallback}
        />
      );

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });
  });
});