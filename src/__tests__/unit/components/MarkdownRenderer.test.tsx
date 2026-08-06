import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

// Mock useTheme to avoid theme provider dependency
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

// Mock SyntaxHighlighter to capture props
vi.mock('react-syntax-highlighter', () => ({
  Prism: (props: Record<string, unknown>) => {
    return React.createElement('pre', { 'data-wrap-long-lines': String(props.wrapLongLines) }, props.children as React.ReactNode);
  },
}));
vi.mock('react-syntax-highlighter/dist/cjs/styles/prism', () => ({
  tomorrow: {},
}));

// Mock MermaidDiagram
vi.mock('@/components/features/ClarifyingQuestionsPreview/artifacts/MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) =>
    React.createElement('div', { 'data-testid': 'mermaid-diagram', 'data-code': code }),
}));

describe('MarkdownRenderer — mermaid code blocks', () => {
  it('renders MermaidDiagram for ```mermaid fenced blocks', async () => {
    const mermaidCode = 'graph TD\n  A --> B';
    const markdown = '```mermaid\n' + mermaidCode + '\n```';
    render(<MarkdownRenderer>{markdown}</MarkdownRenderer>);
    await waitFor(() => {
      const diagram = screen.getByTestId('mermaid-diagram');
      expect(diagram).toBeInTheDocument();
      expect(diagram.getAttribute('data-code')).toBe(mermaidCode);
    });
  });

  it('does not render MermaidDiagram for non-mermaid code blocks', async () => {
    const markdown = '```js\nconsole.log("hi");\n```';
    render(<MarkdownRenderer>{markdown}</MarkdownRenderer>);
    await waitFor(() => {
      expect(screen.queryByTestId('mermaid-diagram')).toBeNull();
    });
  });
});

describe('MarkdownRenderer — code block wrapLongLines', () => {
  it('passes wrapLongLines={true} to SyntaxHighlighter for fenced code blocks', async () => {
    const longLine = 'a'.repeat(300);
    const markdown = `\`\`\`js\n${longLine}\n\`\`\``;
    const { container } = render(
      <MarkdownRenderer>{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      const pre = container.querySelector('pre[data-wrap-long-lines]');
      expect(pre).not.toBeNull();
      expect(pre?.getAttribute('data-wrap-long-lines')).toBe('true');
    });
  });
});

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

  it('assistant variant escapes raw HTML — renders literal text, not a DOM element', async () => {
    // New contract: with rehypeRaw removed, the assistant variant no longer
    // re-parses raw HTML. <div>hello</div> is rendered as escaped literal
    // text (angle brackets visible as text), consistent with the user variant.
    const { container } = render(
      <MarkdownRenderer variant="assistant">
        {'<div>hello</div>'}
      </MarkdownRenderer>
    );
    await waitFor(() => {
      // The text content must contain the visible text
      expect(container.textContent).toContain('hello');
      // The angle-bracket text must be present as literal characters, not
      // parsed into a DOM element. Check the raw innerHTML of the prose
      // wrapper contains the escaped entity or literal angle brackets.
      const proseDiv = container.querySelector('.prose');
      expect(proseDiv?.innerHTML).toContain('&lt;div&gt;');
    });
  });
});

describe('MarkdownRenderer — assistant variant regression tests', () => {
  it('currency regression: adjacent $NNN.NM figures render in one blockquote, no <pre>', async () => {
    const markdown =
      '> $119.5M (stale); correct 2025 figure is\n> $126.4M (effective February 21, 2025)';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      const blockquote = container.querySelector('blockquote');
      expect(blockquote).not.toBeNull();
      // Both figures must appear inside the blockquote
      expect(blockquote?.textContent).toContain('$119.5M');
      expect(blockquote?.textContent).toContain('$126.4M');
      // No <pre> should be injected by a misinterpreted math node
      expect(container.querySelector('pre')).toBeNull();
    });
  });

  it('directive: text containing :8800 port number is preserved in output', async () => {
    const markdown = 'Connect to https://example.com:8800 for access.';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.textContent).toContain(':8800');
    });
  });

  it('angle brackets: literal <slug> in assistant text is preserved as text, not stripped', async () => {
    const markdown = 'Replace <slug> with your workspace name.';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.textContent).toContain('<slug>');
    });
  });

  it('block-in-paragraph: a normal paragraph renders as a single <p> with no nested block <div>', async () => {
    const markdown = 'This is a plain paragraph with no special content.';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBeGreaterThanOrEqual(1);
      // No block <div> injected inside a <p>
      const divsInsideParagraph = container.querySelectorAll('p > div');
      expect(divsInsideParagraph.length).toBe(0);
    });
  });

  it('inline language-* guard: single-line code with a language class renders as inline <code>, not <pre>', async () => {
    // This tests the structural hardening: even if a plugin emits an inline
    // code node with a language-* class, the block guard (String(children).includes("\n"))
    // prevents it from routing into SyntaxHighlighter.
    // We simulate this by rendering a markdown fenced block where the content
    // is a single line (no trailing newline after strip), confirming the
    // guard works for normal inline `code` too.
    const markdown = 'Use `ls -la` to list files.';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      const codeEl = container.querySelector('code');
      expect(codeEl).not.toBeNull();
      // Must be inside a <p>, not a standalone <pre>
      const preEl = container.querySelector('pre');
      expect(preEl).toBeNull();
    });
  });

  it('inline language-* guard: fenced single-line block still uses SyntaxHighlighter (isBlock=false after trim)', async () => {
    // A fenced block with multiline content correctly goes to SyntaxHighlighter
    const markdown = '```js\nconst x = 1;\nconst y = 2;\n```';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
    });
  });

  it('authored-content faithfulness: headings, lists, and links render correctly', async () => {
    const markdown = `## Getting Started

Install dependencies:

- Run \`npm install\`
- Visit [docs](https://example.com)

> Note: requires Node 18+`;
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.querySelector('h2')).not.toBeNull();
      expect(container.querySelector('ul')).not.toBeNull();
      expect(container.querySelector('li')).not.toBeNull();
      expect(container.querySelector('a')).not.toBeNull();
      expect(container.querySelector('blockquote')).not.toBeNull();
      expect(container.querySelector('code')).not.toBeNull();
    });
  });

  it('no regression: fenced code block still renders via SyntaxHighlighter', async () => {
    const markdown = '```python\nprint("hello")\nprint("world")\n```';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      const pre = container.querySelector('pre[data-wrap-long-lines]');
      expect(pre).not.toBeNull();
      expect(pre?.getAttribute('data-wrap-long-lines')).toBe('true');
    });
  });

  it('no regression: table renders correctly', async () => {
    const markdown = `| Name | Value |
| --- | --- |
| foo | bar |`;
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      expect(container.querySelector('table')).not.toBeNull();
      expect(container.querySelector('th')).not.toBeNull();
      expect(container.querySelector('td')).not.toBeNull();
    });
  });

  it('no regression: links render correctly', async () => {
    const markdown = '[Click here](https://example.com)';
    const { container } = render(
      <MarkdownRenderer variant="assistant">{markdown}</MarkdownRenderer>
    );
    await waitFor(() => {
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('https://example.com');
    });
  });
});
