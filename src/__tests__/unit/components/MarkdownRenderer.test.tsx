import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

// Mock useTheme to avoid theme provider dependency
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

describe('MarkdownRenderer — feature image URL resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should resolve a /api/features/.../image?path= URL and render the img with the fresh URL', async () => {
    const featureImageSrc = '/api/features/feature-abc/image?path=features%2Fws%2Fswarm%2Ffeat%2Ffile.png';
    const freshUrl = 'https://s3.example.com/fresh';

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: freshUrl }),
    });

    render(
      <MarkdownRenderer>{`![Bug Screenshot](${featureImageSrc})`}</MarkdownRenderer>
    );

    // While resolving, a loading placeholder should be shown (no img yet)
    expect(screen.queryByRole('img')).toBeNull();

    // Wait for the resolved img to appear
    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', freshUrl);
    });

    expect(global.fetch).toHaveBeenCalledWith(featureImageSrc);
  });

  it('should show a loading placeholder while the URL is being resolved', async () => {
    const featureImageSrc = '/api/features/feature-abc/image?path=features%2Ffile.png';

    let resolveFetch: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    global.fetch = vi.fn().mockReturnValueOnce(fetchPromise);

    render(
      <MarkdownRenderer>{`![Screenshot](${featureImageSrc})`}</MarkdownRenderer>
    );

    // Placeholder should be visible while loading
    const placeholder = screen.getByLabelText('Loading image...');
    expect(placeholder).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();

    // Now resolve the fetch
    await act(async () => {
      resolveFetch!({
        ok: true,
        json: async () => ({ url: 'https://s3.example.com/fresh' }),
      });
      await fetchPromise;
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('Loading image...')).toBeNull();
      expect(screen.getByRole('img')).toHaveAttribute('src', 'https://s3.example.com/fresh');
    });
  });

  it('should show a broken-image fallback when fetch rejects', async () => {
    const featureImageSrc = '/api/features/feature-abc/image?path=features%2Ffile.png';

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    render(
      <MarkdownRenderer>{`![Screenshot](${featureImageSrc})`}</MarkdownRenderer>
    );

    await waitFor(() => {
      expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    });

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('should show a broken-image fallback when the endpoint returns a non-ok response', async () => {
    const featureImageSrc = '/api/features/feature-abc/image?path=features%2Ffile.png';

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Forbidden' }),
    });

    render(
      <MarkdownRenderer>{`![Screenshot](${featureImageSrc})`}</MarkdownRenderer>
    );

    await waitFor(() => {
      expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    });
  });

  it('should render non-feature images normally without fetching', () => {
    const regularSrc = 'https://example.com/image.png';

    global.fetch = vi.fn();

    render(
      <MarkdownRenderer>{`![Regular Image](${regularSrc})`}</MarkdownRenderer>
    );

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', regularSrc);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('MarkdownRenderer — user variant special character rendering', () => {
  it('renders URL with angle-bracket template fully including port', async () => {
    const { container } = render(
      <MarkdownRenderer variant="user">
        {'https://<slug>.sphinx.chat:8800'}
      </MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.textContent).toContain('https://<slug>.sphinx.chat:8800');
    });
  });

  it('renders bare ampersand in query string correctly', async () => {
    const { container } = render(
      <MarkdownRenderer variant="user">
        {'https://example.com?foo=1&bar=2'}
      </MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.textContent).toContain('&');
      expect(container.textContent).not.toContain('&amp;');
    });
  });

  it('renders standalone angle brackets literally', async () => {
    const { container } = render(
      <MarkdownRenderer variant="user">
        {'<some-value>'}
      </MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.textContent).toContain('<some-value>');
    });
  });

  it('still renders markdown bold and code in user messages', async () => {
    const { container } = render(
      <MarkdownRenderer variant="user">
        {'**bold** and `code`'}
      </MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.querySelector('strong')).not.toBeNull();
      expect(container.querySelector('code')).not.toBeNull();
    });
  });

  it('assistant variant is unaffected — renders HTML without escaping', async () => {
    const { container } = render(
      <MarkdownRenderer variant="assistant">
        {'<div>hello</div>'}
      </MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.textContent).toContain('hello');
    });
  });
});
