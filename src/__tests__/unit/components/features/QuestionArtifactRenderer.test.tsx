// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionArtifactRenderer } from '@/components/features/ClarifyingQuestionsPreview/artifacts/QuestionArtifactRenderer';
import type { QuestionArtifact } from '@/types/stakwork';

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => {
  const React = require('react');
  return {
    Check: ({ className }: any) => React.createElement('div', { 'data-testid': 'check-icon', className }),
    X: ({ className }: any) => React.createElement('div', { 'data-testid': 'x-icon', className }),
    Minus: ({ className }: any) => React.createElement('div', { 'data-testid': 'minus-icon', className }),
  };
});

// Mock MermaidDiagram (uses browser APIs)
vi.mock('@/components/features/ClarifyingQuestionsPreview/artifacts/MermaidDiagram', () => {
  const React = require('react');
  return {
    MermaidDiagram: ({ code, className }: any) =>
      React.createElement('div', { 'data-testid': 'mermaid-diagram', className }, code),
  };
});

// Mock ComparisonTable to capture props
const mockComparisonTable = vi.fn();
vi.mock('@/components/features/ClarifyingQuestionsPreview/artifacts/ComparisonTable', () => {
  const React = require('react');
  return {
    ComparisonTable: (props: any) => {
      mockComparisonTable(props);
      return React.createElement('div', { 'data-testid': 'comparison-table' }, 'comparison-table');
    },
  };
});

const comparisonTableArtifact: QuestionArtifact = {
  type: 'comparison_table',
  data: {
    columns: ['Pros', 'Cons'],
    rows: [
      { label: 'SSE', cells: { Pros: ['Simple'], Cons: ['One-way'] } },
      { label: 'WebSockets', cells: { Pros: ['Bidirectional'], Cons: ['Complex'] } },
    ],
  } as any,
};

const mermaidArtifact: QuestionArtifact = {
  type: 'mermaid',
  data: 'flowchart TD\n  A --> B',
};

describe('QuestionArtifactRenderer', () => {
  beforeEach(() => {
    mockComparisonTable.mockClear();
  });

  describe('comparison_table type', () => {
    it('renders ComparisonTable for comparison_table artifact', () => {
      render(<QuestionArtifactRenderer artifact={comparisonTableArtifact} />);
      expect(screen.getByTestId('comparison-table')).toBeInTheDocument();
    });

    it('forwards selectedOptions to ComparisonTable', () => {
      render(
        <QuestionArtifactRenderer
          artifact={comparisonTableArtifact}
          selectedOptions={['SSE']}
          onSelect={vi.fn()}
          questionType="single_choice"
        />
      );
      expect(mockComparisonTable).toHaveBeenCalledWith(
        expect.objectContaining({ selectedOptions: ['SSE'] })
      );
    });

    it('forwards onSelect to ComparisonTable', async () => {
      const onSelect = vi.fn();
      render(
        <QuestionArtifactRenderer
          artifact={comparisonTableArtifact}
          selectedOptions={[]}
          onSelect={onSelect}
          questionType="single_choice"
        />
      );
      expect(mockComparisonTable).toHaveBeenCalledWith(
        expect.objectContaining({ onSelect })
      );
    });

    it('forwards questionType to ComparisonTable', () => {
      render(
        <QuestionArtifactRenderer
          artifact={comparisonTableArtifact}
          selectedOptions={[]}
          onSelect={vi.fn()}
          questionType="multiple_choice"
        />
      );
      expect(mockComparisonTable).toHaveBeenCalledWith(
        expect.objectContaining({ questionType: 'multiple_choice' })
      );
    });

    it('forwards className to ComparisonTable', () => {
      render(
        <QuestionArtifactRenderer
          artifact={comparisonTableArtifact}
          className="h-full"
        />
      );
      expect(mockComparisonTable).toHaveBeenCalledWith(
        expect.objectContaining({ className: 'h-full' })
      );
    });

    it('renders ComparisonTable without selection props when not provided', () => {
      render(<QuestionArtifactRenderer artifact={comparisonTableArtifact} />);
      expect(mockComparisonTable).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedOptions: undefined,
          onSelect: undefined,
          questionType: undefined,
        })
      );
    });
  });

  describe('mermaid type', () => {
    it('renders MermaidDiagram for mermaid artifact', () => {
      render(<QuestionArtifactRenderer artifact={mermaidArtifact} />);
      expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument();
    });

    it('does NOT pass selection props to MermaidDiagram (selection props ignored)', () => {
      // Selection props should not affect mermaid rendering — no error expected
      render(
        <QuestionArtifactRenderer
          artifact={mermaidArtifact}
          selectedOptions={['SSE']}
          onSelect={vi.fn()}
          questionType="single_choice"
        />
      );
      // ComparisonTable is not rendered
      expect(screen.queryByTestId('comparison-table')).not.toBeInTheDocument();
      // MermaidDiagram is rendered
      expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument();
      // ComparisonTable mock was never called
      expect(mockComparisonTable).not.toHaveBeenCalled();
    });
  });

  describe('color_swatch type', () => {
    it('returns null for color_swatch type', () => {
      const colorArtifact: QuestionArtifact = {
        type: 'color_swatch',
        data: [{ label: 'Red', value: '#ff0000' }] as any,
      };
      const { container } = render(<QuestionArtifactRenderer artifact={colorArtifact} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
