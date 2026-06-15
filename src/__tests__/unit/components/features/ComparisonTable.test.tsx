// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComparisonTable } from '@/components/features/ClarifyingQuestionsPreview/artifacts/ComparisonTable';

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

const tableData = {
  columns: ['Pros', 'Cons'],
  rows: [
    {
      label: 'SSE',
      description: 'Server-Sent Events',
      cells: { Pros: ['Simple', 'Native HTTP'], Cons: ['One-way only'] },
    },
    {
      label: 'WebSockets',
      description: 'Full-duplex',
      cells: { Pros: ['Bidirectional'], Cons: ['Complex setup'] },
    },
    {
      label: 'Polling',
      cells: { Pros: ['Universal'], Cons: ['High overhead'] },
    },
  ],
};

describe('ComparisonTable', () => {
  describe('Non-interactive mode (no onSelect)', () => {
    it('renders rows and columns without selection indicators', () => {
      render(<ComparisonTable data={tableData} />);
      expect(screen.getByText('SSE')).toBeInTheDocument();
      expect(screen.getByText('WebSockets')).toBeInTheDocument();
      expect(screen.getByText('Polling')).toBeInTheDocument();
      // No selection indicator divs (radio/checkbox)
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('renders column headers with icons', () => {
      render(<ComparisonTable data={tableData} />);
      expect(screen.getByText('Pros')).toBeInTheDocument();
      expect(screen.getByText('Cons')).toBeInTheDocument();
    });

    it('renders cell items as list items', () => {
      render(<ComparisonTable data={tableData} />);
      expect(screen.getByText('Simple')).toBeInTheDocument();
      expect(screen.getByText('One-way only')).toBeInTheDocument();
    });

    it('does not apply cursor-pointer to rows', () => {
      const { container } = render(<ComparisonTable data={tableData} />);
      const rows = container.querySelectorAll('tbody tr');
      rows.forEach((row) => {
        expect(row.className).not.toContain('cursor-pointer');
      });
    });
  });

  describe('Interactive mode (with onSelect)', () => {
    it('applies cursor-pointer class to rows when onSelect is provided', () => {
      const onSelect = vi.fn();
      const { container } = render(
        <ComparisonTable data={tableData} onSelect={onSelect} questionType="single_choice" selectedOptions={[]} />
      );
      const rows = container.querySelectorAll('tbody tr');
      rows.forEach((row) => {
        expect(row.className).toContain('cursor-pointer');
      });
    });

    it('calls onSelect with row label when row is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <ComparisonTable data={tableData} onSelect={onSelect} questionType="single_choice" selectedOptions={[]} />
      );

      const sseRow = screen.getByText('SSE').closest('tr');
      await user.click(sseRow!);
      expect(onSelect).toHaveBeenCalledWith('SSE');
    });

    it('calls onSelect with the correct label for each row', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <ComparisonTable data={tableData} onSelect={onSelect} questionType="multiple_choice" selectedOptions={[]} />
      );

      const wsRow = screen.getByText('WebSockets').closest('tr');
      await user.click(wsRow!);
      expect(onSelect).toHaveBeenCalledWith('WebSockets');

      const pollingRow = screen.getByText('Polling').closest('tr');
      await user.click(pollingRow!);
      expect(onSelect).toHaveBeenCalledWith('Polling');
    });

    describe('Radio indicator (single_choice)', () => {
      it('renders rounded-full indicator for single_choice', () => {
        const { container } = render(
          <ComparisonTable data={tableData} onSelect={vi.fn()} questionType="single_choice" selectedOptions={[]} />
        );
        // The radio indicator divs should have rounded-full
        const indicators = container.querySelectorAll('[class*="rounded-full"][class*="border-2"]');
        expect(indicators.length).toBeGreaterThan(0);
      });

      it('renders unselected indicator without bg-primary when option is not selected', () => {
        const { container } = render(
          <ComparisonTable data={tableData} onSelect={vi.fn()} questionType="single_choice" selectedOptions={[]} />
        );
        const indicators = container.querySelectorAll('[class*="border-muted-foreground"]');
        expect(indicators.length).toBe(tableData.rows.length);
      });

      it('renders selected indicator with bg-primary and check icon for selected row', () => {
        const { container } = render(
          <ComparisonTable
            data={tableData}
            onSelect={vi.fn()}
            questionType="single_choice"
            selectedOptions={['SSE']}
          />
        );
        // Check icons exist (column header + selection indicator)
        const checkIcons = screen.getAllByTestId('check-icon');
        expect(checkIcons.length).toBeGreaterThanOrEqual(1);
        // Selected row indicator has bg-primary (in tbody)
        const tbody = container.querySelector('tbody');
        const selectedIndicator = tbody?.querySelector('[class*="bg-primary"][class*="border-primary"]');
        expect(selectedIndicator).not.toBeNull();
      });
    });

    describe('Checkbox indicator (multiple_choice)', () => {
      it('renders rounded-sm indicator for multiple_choice', () => {
        const { container } = render(
          <ComparisonTable data={tableData} onSelect={vi.fn()} questionType="multiple_choice" selectedOptions={[]} />
        );
        const indicators = container.querySelectorAll('[class*="rounded-sm"][class*="border-2"]');
        expect(indicators.length).toBeGreaterThan(0);
      });

      it('renders check icons for each selected row in multiple_choice', () => {
        // SSE and WebSockets selected → 2 selection indicators
        // The "Pros" column header also has a Check icon, so total = 3
        const { container } = render(
          <ComparisonTable
            data={tableData}
            onSelect={vi.fn()}
            questionType="multiple_choice"
            selectedOptions={['SSE', 'WebSockets']}
          />
        );
        // Count check icons inside tbody only (selection indicators)
        const tbody = container.querySelector('tbody');
        const selectionCheckIcons = tbody?.querySelectorAll('[data-testid="check-icon"]');
        expect(selectionCheckIcons?.length).toBe(2);
      });
    });

    describe('Selected row highlighting', () => {
      it('applies bg-primary/10 and border-primary/60 to selected row', () => {
        const { container } = render(
          <ComparisonTable
            data={tableData}
            onSelect={vi.fn()}
            questionType="single_choice"
            selectedOptions={['WebSockets']}
          />
        );
        const rows = container.querySelectorAll('tbody tr');
        // Find selected row (WebSockets is index 1)
        const selectedRow = rows[1];
        expect(selectedRow.className).toContain('bg-primary/10');
        expect(selectedRow.className).toContain('border-primary/60');
      });

      it('does not apply highlight classes to unselected rows', () => {
        const { container } = render(
          <ComparisonTable
            data={tableData}
            onSelect={vi.fn()}
            questionType="single_choice"
            selectedOptions={['WebSockets']}
          />
        );
        const rows = container.querySelectorAll('tbody tr');
        // SSE (index 0) and Polling (index 2) are not selected
        expect(rows[0].className).not.toContain('bg-primary/10');
        expect(rows[2].className).not.toContain('bg-primary/10');
      });

      it('highlights multiple selected rows for multiple_choice', () => {
        const { container } = render(
          <ComparisonTable
            data={tableData}
            onSelect={vi.fn()}
            questionType="multiple_choice"
            selectedOptions={['SSE', 'Polling']}
          />
        );
        const rows = container.querySelectorAll('tbody tr');
        expect(rows[0].className).toContain('bg-primary/10');
        expect(rows[1].className).not.toContain('bg-primary/10');
        expect(rows[2].className).toContain('bg-primary/10');
      });

      it('highlights no rows when selectedOptions is empty', () => {
        const { container } = render(
          <ComparisonTable
            data={tableData}
            onSelect={vi.fn()}
            questionType="single_choice"
            selectedOptions={[]}
          />
        );
        const rows = container.querySelectorAll('tbody tr');
        rows.forEach((row) => {
          expect(row.className).not.toContain('bg-primary/10');
        });
      });
    });

    it('renders row description when provided', () => {
      render(
        <ComparisonTable data={tableData} onSelect={vi.fn()} questionType="single_choice" selectedOptions={[]} />
      );
      expect(screen.getByText('Server-Sent Events')).toBeInTheDocument();
      expect(screen.getByText('Full-duplex')).toBeInTheDocument();
    });
  });
});
