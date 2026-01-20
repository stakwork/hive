import { renderHook, waitFor } from '@testing-library/react';
import { useWorkspaceFavicon } from '@/hooks/useWorkspaceFavicon';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { isDevelopmentMode } from '@/lib/runtime';

// Mock dependencies
jest.mock('@/hooks/useFeatureFlag');
jest.mock('@/lib/runtime');

const mockUseFeatureFlag = useFeatureFlag as jest.MockedFunction<typeof useFeatureFlag>;
const mockIsDevelopmentMode = isDevelopmentMode as jest.MockedFunction<typeof isDevelopmentMode>;

describe('useWorkspaceFavicon', () => {
  // Mock fetch globally
  const mockFetch = jest.fn();
  global.fetch = mockFetch as any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockUseFeatureFlag.mockReturnValue(true);
    mockIsDevelopmentMode.mockReturnValue(false);

    // Mock DOM
    document.head.innerHTML = '';
    document.querySelectorAll = jest.fn().mockReturnValue([]);
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('should not update favicon when feature flag is disabled', () => {
    mockUseFeatureFlag.mockReturnValue(false);

    renderHook(() => useWorkspaceFavicon('test-workspace', 'logo-key-123'));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should not update favicon when workspace has no logo', () => {
    renderHook(() => useWorkspaceFavicon('test-workspace', null));

    expect(mockFetch).not.toHaveBeenCalled();
    // Should restore default favicons
    const links = document.head.querySelectorAll('link[rel*="icon"]');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should fetch and update favicon when workspace has logo', async () => {
    const mockPresignedUrl = 'https://s3.example.com/workspace-logo.png';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ presignedUrl: mockPresignedUrl }),
    } as Response);

    renderHook(() => useWorkspaceFavicon('test-workspace', 'logo-key-123'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/test-workspace/image');
    });

    await waitFor(() => {
      const links = document.head.querySelectorAll('link[rel*="icon"]');
      const iconLink = Array.from(links).find(
        (link) => (link as HTMLLinkElement).href === mockPresignedUrl
      );
      expect(iconLink).toBeDefined();
    });
  });

  it('should restore default favicon on API error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    renderHook(() => useWorkspaceFavicon('test-workspace', 'logo-key-123'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/test-workspace/image');
    });

    await waitFor(() => {
      // Should have restored default favicons
      const links = document.head.querySelectorAll('link[rel*="icon"]');
      expect(links.length).toBeGreaterThan(0);
    });
  });

  it('should use dev favicon paths in development mode', () => {
    mockIsDevelopmentMode.mockReturnValue(true);

    renderHook(() => useWorkspaceFavicon(null, null));

    const links = document.head.querySelectorAll('link[rel*="icon"]');
    const hasDevPath = Array.from(links).some((link) =>
      (link as HTMLLinkElement).href.includes('/dev/')
    );
    expect(hasDevPath).toBe(true);
  });

  it('should cleanup and restore default favicon on unmount', async () => {
    const mockPresignedUrl = 'https://s3.example.com/workspace-logo.png';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ presignedUrl: mockPresignedUrl }),
    } as Response);

    const { unmount } = renderHook(() =>
      useWorkspaceFavicon('test-workspace', 'logo-key-123')
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Unmount the hook
    unmount();

    // Should have restored default favicons
    const links = document.head.querySelectorAll('link[rel*="icon"]');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should update favicon when workspace changes', async () => {
    const mockUrl1 = 'https://s3.example.com/workspace-1-logo.png';
    const mockUrl2 = 'https://s3.example.com/workspace-2-logo.png';

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ presignedUrl: mockUrl1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ presignedUrl: mockUrl2 }),
      } as Response);

    const { rerender } = renderHook(
      ({ slug, logoKey }: { slug: string; logoKey: string }) =>
        useWorkspaceFavicon(slug, logoKey),
      {
        initialProps: { slug: 'workspace-1', logoKey: 'logo-1' },
      }
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/workspace-1/image');
    });

    // Change workspace
    rerender({ slug: 'workspace-2', logoKey: 'logo-2' });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/workspace-2/image');
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
