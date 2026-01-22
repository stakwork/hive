import { renderHook, waitFor } from '@testing-library/react';
import { useFavicon } from '@/hooks/useFavicon';

// Mock the runtime module
jest.mock('@/lib/runtime', () => ({
  isDevelopmentMode: jest.fn(() => false),
}));

describe('useFavicon', () => {
  let mockFaviconLinks: HTMLLinkElement[];

  beforeEach(() => {
    // Clear any existing favicon links
    document.querySelectorAll('link[rel*="icon"]').forEach((el) => el.remove());

    // Create mock favicon links
    mockFaviconLinks = [
      createFaviconLink('icon', '/favicon-16x16.png', '16x16'),
      createFaviconLink('icon', '/favicon-32x32.png', '32x32'),
      createFaviconLink('icon', '/favicon.ico'),
      createFaviconLink('apple-touch-icon', '/apple-touch-icon.png', '180x180'),
    ];

    mockFaviconLinks.forEach((link) => document.head.appendChild(link));
  });

  afterEach(() => {
    // Cleanup
    mockFaviconLinks.forEach((link) => link.remove());
  });

  function createFaviconLink(rel: string, href: string, sizes?: string): HTMLLinkElement {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    if (sizes) {
      link.sizes.add(sizes);
    }
    return link;
  }

  it('should update favicon with workspace logo URL', async () => {
    const workspaceLogoUrl = 'https://example.com/workspace-logo.png';

    renderHook(() => useFavicon({ workspaceLogoUrl, enabled: true }));

    await waitFor(() => {
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
      links.forEach((link) => {
        expect(link.href).toBe(workspaceLogoUrl);
        expect(link.dataset.originalHref).toBeDefined();
      });
    });
  });

  it('should restore default favicon when workspaceLogoUrl is null', async () => {
    const workspaceLogoUrl = 'https://example.com/workspace-logo.png';

    // First set a workspace logo
    const { rerender } = renderHook(
      ({ url }) => useFavicon({ workspaceLogoUrl: url, enabled: true }),
      { initialProps: { url: workspaceLogoUrl } }
    );

    await waitFor(() => {
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
      links.forEach((link) => {
        expect(link.href).toBe(workspaceLogoUrl);
      });
    });

    // Then revert to default
    rerender({ url: null });

    await waitFor(() => {
      const icon16 = document.querySelector<HTMLLinkElement>('link[rel="icon"][sizes="16x16"]');
      const icon32 = document.querySelector<HTMLLinkElement>('link[rel="icon"][sizes="32x32"]');
      const iconDefault = document.querySelector<HTMLLinkElement>('link[rel="icon"]:not([sizes])');
      const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');

      expect(icon16?.href).toContain('favicon-16x16.png');
      expect(icon32?.href).toContain('favicon-32x32.png');
      expect(iconDefault?.href).toContain('favicon.ico');
      expect(apple?.href).toContain('apple-touch-icon.png');
    });
  });

  it('should not update favicon when enabled is false', async () => {
    const workspaceLogoUrl = 'https://example.com/workspace-logo.png';
    const originalHref = '/favicon-16x16.png';

    renderHook(() => useFavicon({ workspaceLogoUrl, enabled: false }));

    // Wait a bit to ensure no updates happen
    await new Promise((resolve) => setTimeout(resolve, 100));

    const link = document.querySelector<HTMLLinkElement>('link[sizes="16x16"]');
    expect(link?.href).toContain(originalHref);
    expect(link?.href).not.toBe(workspaceLogoUrl);
  });

  it('should handle transitions between different workspace logos', async () => {
    const logo1 = 'https://example.com/logo1.png';
    const logo2 = 'https://example.com/logo2.png';

    const { rerender } = renderHook(
      ({ url }) => useFavicon({ workspaceLogoUrl: url, enabled: true }),
      { initialProps: { url: logo1 } }
    );

    await waitFor(() => {
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
      links.forEach((link) => {
        expect(link.href).toBe(logo1);
      });
    });

    // Switch to second workspace logo
    rerender({ url: logo2 });

    await waitFor(() => {
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
      links.forEach((link) => {
        expect(link.href).toBe(logo2);
      });
    });
  });
});
