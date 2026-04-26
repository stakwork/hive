// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useFavicon } from '@/hooks/useFavicon';

// Mock the runtime module
vi.mock('@/lib/runtime', () => ({
  isDevelopmentMode: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFaviconLink(rel: string, href: string, sizes?: string): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (sizes) link.setAttribute('sizes', sizes);
  return link;
}

/** Mock Image so onload fires synchronously (or on next tick). */
function mockImageSuccess() {
  const OriginalImage = window.Image;
  (window as any).Image = class extends OriginalImage {
    constructor() {
      super();
      setTimeout(() => this.onload?.(new Event('load')), 0);
    }
  };
  return () => {
    window.Image = OriginalImage;
  };
}

/** Mock canvas context and toDataURL. */
function mockCanvas() {
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mockBase64');
  const mockCtx = {
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx as any);
  return mockCtx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFavicon', () => {
  let mockFaviconLinks: HTMLLinkElement[];

  beforeEach(() => {
    document.querySelectorAll('link[rel*="icon"]').forEach((el) => el.remove());

    mockFaviconLinks = [
      createFaviconLink('icon', '/favicon-16x16.png', '16x16'),
      createFaviconLink('icon', '/favicon-32x32.png', '32x32'),
      createFaviconLink('icon', '/favicon.ico'),
      createFaviconLink('apple-touch-icon', '/apple-touch-icon.png', '180x180'),
    ];
    mockFaviconLinks.forEach((link) => document.head.appendChild(link));
  });

  afterEach(() => {
    mockFaviconLinks.forEach((link) => link.remove());
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic workspace logo tests (unchanged behaviour)
  // -------------------------------------------------------------------------

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

    const { rerender } = renderHook(
      ({ url }: { url: string | null }) => useFavicon({ workspaceLogoUrl: url, enabled: true }),
      { initialProps: { url: workspaceLogoUrl } }
    );

    await waitFor(() => {
      document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]').forEach((link) => {
        expect(link.href).toBe(workspaceLogoUrl);
      });
    });

    rerender({ url: null });

    await waitFor(() => {
      const icon32 = document.querySelector<HTMLLinkElement>('link[rel="icon"][sizes="32x32"]');
      expect(icon32?.href).toContain('favicon-32x32.png');
    });
  });

  it('should not update favicon when enabled is false', async () => {
    const workspaceLogoUrl = 'https://example.com/workspace-logo.png';
    renderHook(() => useFavicon({ workspaceLogoUrl, enabled: false }));

    await new Promise((r) => setTimeout(r, 100));

    const link = document.querySelector<HTMLLinkElement>('link[sizes="16x16"]');
    expect(link?.href).toContain('favicon-16x16.png');
    expect(link?.href).not.toBe(workspaceLogoUrl);
  });

  it('should handle transitions between different workspace logos', async () => {
    const logo1 = 'https://example.com/logo1.png';
    const logo2 = 'https://example.com/logo2.png';

    const { rerender } = renderHook(
      ({ url }: { url: string }) => useFavicon({ workspaceLogoUrl: url, enabled: true }),
      { initialProps: { url: logo1 } }
    );

    await waitFor(() => {
      document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]').forEach((link) => {
        expect(link.href).toBe(logo1);
      });
    });

    rerender({ url: logo2 });

    await waitFor(() => {
      document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]').forEach((link) => {
        expect(link.href).toBe(logo2);
      });
    });
  });

  // -------------------------------------------------------------------------
  // querySelector fallback: no existing favicon links
  // -------------------------------------------------------------------------

  it('should create a fallback link element when no favicon links exist in DOM', async () => {
    // Remove all favicon links
    mockFaviconLinks.forEach((link) => link.remove());
    mockFaviconLinks = [];

    renderHook(() => useFavicon({ workspaceLogoUrl: 'https://example.com/logo.png', enabled: true }));

    await waitFor(() => {
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
      expect(links.length).toBeGreaterThan(0);
      links.forEach((link) => {
        expect(link.href).toBe('https://example.com/logo.png');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Legacy showNotificationDot (backward compat)
  // -------------------------------------------------------------------------

  describe('showNotificationDot (legacy)', () => {
    it('should display notification dot on default favicon when showNotificationDot is true', async () => {
      mockCanvas();
      const restore = mockImageSuccess();

      renderHook(() => useFavicon({ workspaceLogoUrl: null, enabled: true, showNotificationDot: true }));

      await waitFor(() => {
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
        links.forEach((link) => {
          expect(link.href).toMatch(/^data:image\/png/);
        });
      });

      restore();
    });

    it('should NOT display notification dot when showNotificationDot is false', async () => {
      const workspaceLogoUrl = 'https://example.com/workspace-logo.png';
      renderHook(() => useFavicon({ workspaceLogoUrl, enabled: true, showNotificationDot: false }));

      await waitFor(() => {
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
        links.forEach((link) => {
          expect(link.href).toBe(workspaceLogoUrl);
          expect(link.href).not.toMatch(/^data:image\/png/);
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // New overlayType tests
  // -------------------------------------------------------------------------

  describe('overlayType', () => {
    let restoreImage: () => void;

    beforeEach(() => {
      mockCanvas();
      restoreImage = mockImageSuccess();
    });

    afterEach(() => {
      restoreImage();
    });

    it('overlayType "busy" renders yellow dot on default favicon', async () => {
      renderHook(() => useFavicon({ workspaceLogoUrl: null, enabled: true, overlayType: 'busy' }));

      await waitFor(() => {
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
        links.forEach((link) => {
          expect(link.href).toMatch(/^data:image\/png/);
        });
      });
    });

    it('overlayType "waiting" renders blue ? badge on default favicon', async () => {
      const ctx = mockCanvas();
      renderHook(() =>
        useFavicon({ workspaceLogoUrl: null, enabled: true, overlayType: 'waiting' })
      );

      await waitFor(() => {
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
        links.forEach((link) => {
          expect(link.href).toMatch(/^data:image\/png/);
        });
      });

      // Verify '?' was drawn
      expect(ctx.fillText).toHaveBeenCalledWith('?', expect.any(Number), expect.any(Number));
    });

    it('overlayType "done" renders green ✓ badge on default favicon', async () => {
      const ctx = mockCanvas();
      renderHook(() =>
        useFavicon({ workspaceLogoUrl: null, enabled: true, overlayType: 'done' })
      );

      await waitFor(() => {
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
        links.forEach((link) => {
          expect(link.href).toMatch(/^data:image\/png/);
        });
      });

      // Verify '✓' was drawn
      expect(ctx.fillText).toHaveBeenCalledWith('✓', expect.any(Number), expect.any(Number));
    });

    it('overlayType "none" reverts to plain default favicon (no overlay)', async () => {
      // First render with 'busy' overlay, then switch to 'none'
      const { rerender } = renderHook(
        ({ type }: { type: 'busy' | 'none' }) =>
          useFavicon({ workspaceLogoUrl: null, enabled: true, overlayType: type }),
        { initialProps: { type: 'busy' as const } }
      );

      await waitFor(() => {
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
        links.forEach((link) => {
          expect(link.href).toMatch(/^data:image\/png/);
        });
      });

      rerender({ type: 'none' });

      await waitFor(() => {
        const icon32 = document.querySelector<HTMLLinkElement>('link[rel="icon"][sizes="32x32"]');
        // Should revert to the stored original or default path
        expect(icon32?.href).toContain('favicon-32x32.png');
        expect(icon32?.href).not.toMatch(/^data:image\/png/);
      });
    });

    it('overlayType takes precedence over showNotificationDot for canvas text', async () => {
      const ctx = mockCanvas();
      // showNotificationDot=true but overlayType='waiting' — 'waiting' should win
      renderHook(() =>
        useFavicon({
          workspaceLogoUrl: null,
          enabled: true,
          showNotificationDot: true,
          overlayType: 'waiting',
        })
      );

      await waitFor(() => {
        expect(ctx.fillText).toHaveBeenCalledWith('?', expect.any(Number), expect.any(Number));
      });
    });

    it('uses local default favicon path for canvas (never an S3 URL)', async () => {
      // Spy on Image src to confirm it never receives an S3 URL
      const srcValues: string[] = [];
      const OriginalImage = window.Image;
      (window as any).Image = class extends OriginalImage {
        set src(val: string) {
          srcValues.push(val);
          super.src = val;
          setTimeout(() => this.onload?.(new Event('load')), 0);
        }
      };

      renderHook(() =>
        useFavicon({
          workspaceLogoUrl: 'https://s3.amazonaws.com/bucket/logo.png',
          enabled: true,
          overlayType: 'busy',
        })
      );

      await waitFor(() => {
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
        links.forEach((link) => expect(link.href).toMatch(/^data:image\/png/));
      });

      // Image.src should only have been set to a local path, not the S3 URL
      srcValues.forEach((src) => {
        expect(src).not.toContain('s3.amazonaws.com');
      });

      window.Image = OriginalImage;
    });
  });
});
