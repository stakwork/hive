import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LongformArtifactPanel } from '@/app/w/[slug]/task/[...taskParams]/artifacts/longform';
import { ArtifactType } from '@prisma/client';
import type { LongformContent } from '@/types/artifact';

// Mock dependencies
vi.mock('@/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown-renderer">{children}</div>
  ),
}));

vi.mock('@/app/w/[slug]/task/[...taskParams]/components/WorkflowUrlLink', () => ({
  WorkflowUrlLink: ({ workflowUrl }: { workflowUrl: string }) => (
    <a href={workflowUrl} data-testid="workflow-url-link">
      Workflow Link
    </a>
  ),
}));

vi.mock('@/lib/icons', () => ({
  getArtifactIcon: () => <span data-testid="artifact-icon">Icon</span>,
}));

describe('LongformArtifactPanel', () => {
  const createLongformArtifact = (content: LongformContent, id = 'test-artifact-1') => ({
    id,
    type: ArtifactType.LONGFORM,
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
    chatMessageId: 'test-message-1',
    icon: null,
  });

  describe('Overflow Constraints', () => {
    it('applies max-w-full and explicit overflow classes to scroll container', () => {
      const artifact = createLongformArtifact({
        title: 'Test Title',
        text: 'Test content',
      });

      const { container } = render(
        <LongformArtifactPanel artifacts={[artifact]} />
      );

      // Find the scroll container by test ID
      const panel = screen.getByTestId('longform-artifact-panel');
      expect(panel).toBeInTheDocument();

      // Find the scroll div inside (the one with the classes we care about)
      const scrollContainer = container.querySelector('.max-h-80');
      expect(scrollContainer).toBeInTheDocument();
      expect(scrollContainer).toHaveClass('max-w-full');
      expect(scrollContainer).toHaveClass('overflow-x-auto');
      expect(scrollContainer).toHaveClass('overflow-y-auto');
    });

    it('renders content with long code blocks without exceeding parent width', () => {
      const longCommand = 'very-long-command-that-would-cause-overflow-if-not-constrained '.repeat(20);
      const longformContent: LongformContent = {
        title: 'Task with Long Code Block',
        text: `Here is a command that is very long:\n\n\`\`\`bash\n${longCommand}\n\`\`\`\n\nThis should scroll horizontally.`,
      };

      const artifact = createLongformArtifact(longformContent);

      const { container } = render(
        <LongformArtifactPanel artifacts={[artifact]} />
      );

      const scrollContainer = container.querySelector('.max-h-80');
      expect(scrollContainer).toBeInTheDocument();
      expect(scrollContainer).toHaveClass('max-w-full');
      expect(scrollContainer).toHaveClass('overflow-x-auto');
    });

    it('renders multiple code blocks with proper overflow handling', () => {
      const longformContent: LongformContent = {
        title: 'Multiple Code Blocks',
        text: `
First code block:

\`\`\`javascript
const veryLongVariableName = 'this-is-a-very-long-string-that-might-overflow'.repeat(10);
\`\`\`

Second code block:

\`\`\`bash
echo "another-very-long-command-line-that-needs-horizontal-scrolling" | grep "pattern"
\`\`\`

Plain text should wrap normally.
        `,
      };

      const artifact = createLongformArtifact(longformContent);

      const { container } = render(
        <LongformArtifactPanel artifacts={[artifact]} />
      );

      const scrollContainer = container.querySelector('.max-h-80');
      expect(scrollContainer).toHaveClass('max-w-full');
      expect(scrollContainer).toHaveClass('overflow-x-auto');
      expect(scrollContainer).toHaveClass('overflow-y-auto');
    });
  });

  describe('Basic Rendering', () => {
    it('renders artifact with title and text', () => {
      const artifact = createLongformArtifact({
        title: 'Test Title',
        text: 'Test content',
      });

      render(<LongformArtifactPanel artifacts={[artifact]} />);

      expect(screen.getByText('Test Title')).toBeInTheDocument();
      expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('renders artifact without title', () => {
      const artifact = createLongformArtifact({
        text: 'Content only',
      });

      render(<LongformArtifactPanel artifacts={[artifact]} />);

      expect(screen.getByText('Content only')).toBeInTheDocument();
    });

    it('renders multiple artifacts', () => {
      const artifacts = [
        createLongformArtifact({ title: 'First', text: 'Content 1' }, 'artifact-1'),
        createLongformArtifact({ title: 'Second', text: 'Content 2' }, 'artifact-2'),
      ];

      render(<LongformArtifactPanel artifacts={artifacts} />);

      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Content 1')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
      expect(screen.getByText('Content 2')).toBeInTheDocument();
    });
  });

  describe('Workflow URL', () => {
    it('renders workflow URL link when provided', () => {
      const artifact = createLongformArtifact({
        title: 'Test',
        text: 'Content',
      });

      const { container } = render(
        <LongformArtifactPanel 
          artifacts={[artifact]} 
          workflowUrl="https://example.com/workflow"
        />
      );

      // WorkflowUrlLink should be present
      const link = container.querySelector('a[href="https://example.com/workflow"]');
      expect(link).toBeInTheDocument();
    });

    it('does not render workflow URL link when not provided', () => {
      const artifact = createLongformArtifact({
        title: 'Test',
        text: 'Content',
      });

      const { container } = render(
        <LongformArtifactPanel artifacts={[artifact]} />
      );

      // No workflow link should be present
      const links = container.querySelectorAll('a');
      expect(links.length).toBe(0);
    });
  });

  describe('Markdown Rendering', () => {
    it('renders markdown formatted text', () => {
      const artifact = createLongformArtifact({
        title: 'Markdown Test',
        text: '**Bold text** and *italic text*',
      });

      render(<LongformArtifactPanel artifacts={[artifact]} />);

      expect(screen.getByText('Markdown Test')).toBeInTheDocument();
      // MarkdownRenderer will process the markdown
      expect(screen.getByTestId('longform-artifact-panel')).toBeInTheDocument();
    });

    it('renders code blocks with proper styling', () => {
      const artifact = createLongformArtifact({
        text: '```javascript\nconst x = 42;\n```',
      });

      const { container } = render(<LongformArtifactPanel artifacts={[artifact]} />);

      // Verify the scroll container has overflow classes
      const scrollContainer = container.querySelector('.max-h-80');
      expect(scrollContainer).toHaveClass('overflow-x-auto');
      expect(scrollContainer).toHaveClass('overflow-y-auto');
    });
  });
});
