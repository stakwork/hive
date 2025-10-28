import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeatureSearch } from '@/components/features/FeatureSearch';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/hooks/useWorkspace';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: vi.fn(),
}));

global.fetch = vi.fn();

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

const mockWorkspace = {
  id: 'workspace-1',
  slug: 'test-workspace',
  name: 'Test Workspace',
  workspace: { id: 'workspace-1', slug: 'test-workspace', name: 'Test Workspace' },
  role: 'OWNER' as const,
  workspaces: [],
  loading: false,
  error: null,
  hasAccess: true,
};

const mockFeatures = [
  {
    id: 'feature-1',
    title: 'Add User Authentication',
    status: 'IN_PROGRESS' as const,
    brief: 'Implement JWT-based authentication system',
  },
  {
    id: 'feature-2',
    title: 'Create Dashboard Layout',
    status: 'COMPLETED' as const,
    brief: 'Build responsive dashboard with navigation',
  },
  {
    id: 'feature-3',
    title: 'Add User Profile Page',
    status: 'NOT_STARTED' as const,
    brief: 'User profile with settings and preferences',
  },
  {
    id: 'feature-4',
    title: 'Implement Search Functionality',
    status: 'PLANNED' as const,
    brief: null,
  },
];

describe('FeatureSearch Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue(mockRouter);
    (useWorkspace as any).mockReturnValue(mockWorkspace);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockFeatures }),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Component Rendering', () => {
    it('should render search button trigger by default', () => {
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      expect(button).toBeInTheDocument();
    });

    it('should not render button when trigger is "auto"', () => {
      render(<FeatureSearch trigger="auto" />);
      
      const button = screen.queryByRole('button', { name: /search features/i });
      expect(button).not.toBeInTheDocument();
    });

    it('should not render anything if workspace is missing', () => {
      (useWorkspace as any).mockReturnValue({ workspace: null });
      
      const { container } = render(<FeatureSearch />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Dialog Opening and Closing', () => {
    it('should open dialog when button is clicked', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search features by title/i)).toBeInTheDocument();
      });
    });

    it('should close dialog and clear query when Escape is pressed', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      const input = await screen.findByPlaceholderText(/search features by title/i);
      await user.type(input, 'test');
      
      await user.keyboard('{Escape}');
      
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/search features by title/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Feature Loading', () => {
    it('should fetch features when dialog opens', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/test-workspace/features');
      });
    });

    it('should display loading state while fetching features', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: async () => ({ data: mockFeatures }),
        }), 100))
      );
      
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      expect(await screen.findByRole('img', { hidden: true })).toBeInTheDocument();
    });

    it('should display all features initially', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
        expect(screen.getByText('Create Dashboard Layout')).toBeInTheDocument();
        expect(screen.getByText('Add User Profile Page')).toBeInTheDocument();
        expect(screen.getByText('Implement Search Functionality')).toBeInTheDocument();
      });
    });
  });

  describe('Search Functionality', () => {
    it('should show minimum character message when query is less than 2 characters', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      const input = await screen.findByPlaceholderText(/search features by title/i);
      
      // Wait for features to load first
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      await user.type(input, 'a');
      
      // When query < 2 chars, all features still show AND the message appears
      await waitFor(() => {
        expect(screen.getByText(/type at least 2 characters to search/i)).toBeInTheDocument();
      });
    });

    it('should filter features by title after debounce delay', async () => {
      vi.useFakeTimers();
      const user = userEvent.setup({ delay: null });
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      // Wait for initial features to load (using real timers for the fetch)
      await vi.runOnlyPendingTimersAsync();
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      const input = screen.getByPlaceholderText(/search features by title/i);
      await user.type(input, 'user');
      
      // Advance timers for debounce
      await vi.advanceTimersByTimeAsync(300);
      
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
        expect(screen.getByText('Add User Profile Page')).toBeInTheDocument();
        expect(screen.queryByText('Create Dashboard Layout')).not.toBeInTheDocument();
        expect(screen.queryByText('Implement Search Functionality')).not.toBeInTheDocument();
      });
      
      vi.useRealTimers();
    });

    it('should perform case-insensitive search', async () => {
      vi.useFakeTimers();
      const user = userEvent.setup({ delay: null });
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      // Wait for initial features to load
      await vi.runOnlyPendingTimersAsync();
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      const input = screen.getByPlaceholderText(/search features by title/i);
      await user.type(input, 'DASHBOARD');
      
      await vi.advanceTimersByTimeAsync(300);
      
      await waitFor(() => {
        expect(screen.getByText('Create Dashboard Layout')).toBeInTheDocument();
        expect(screen.queryByText('Add User Authentication')).not.toBeInTheDocument();
      });
      
      vi.useRealTimers();
    });

    it('should show empty state when no features match', async () => {
      vi.useFakeTimers();
      const user = userEvent.setup({ delay: null });
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      // Wait for initial features to load
      await vi.runOnlyPendingTimersAsync();
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      const input = screen.getByPlaceholderText(/search features by title/i);
      await user.type(input, 'nonexistent');
      
      await vi.advanceTimersByTimeAsync(300);
      
      await waitFor(() => {
        expect(screen.getByText(/no features found matching "nonexistent"/i)).toBeInTheDocument();
      });
      
      vi.useRealTimers();
    });

    it('should debounce search input correctly', async () => {
      vi.useFakeTimers();
      const user = userEvent.setup({ delay: null });
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      // Wait for initial features to load
      await vi.runOnlyPendingTimersAsync();
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      const input = screen.getByPlaceholderText(/search features by title/i);
      
      await user.type(input, 'u');
      await vi.advanceTimersByTimeAsync(100);
      await user.type(input, 's');
      await vi.advanceTimersByTimeAsync(100);
      await user.type(input, 'e');
      await vi.advanceTimersByTimeAsync(100);
      await user.type(input, 'r');
      
      await vi.advanceTimersByTimeAsync(300);
      
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      vi.useRealTimers();
    });
  });

  describe('Feature Selection', () => {
    it('should navigate to selected feature', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      const featureItem = screen.getByText('Add User Authentication');
      await user.click(featureItem);
      
      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/w/test-workspace/roadmap/feature-1');
      });
    });

    it('should close dialog after feature selection', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
      
      const featureItem = screen.getByText('Add User Authentication');
      await user.click(featureItem);
      
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/search features by title/i)).not.toBeInTheDocument();
      });
    });

    it('should disable current feature in results', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch currentFeatureId="feature-1" />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        const currentFeature = screen.getByText('Add User Authentication').closest('[role="option"]');
        expect(currentFeature).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('(current)')).toBeInTheDocument();
      });
    });
  });

  describe('Status Display', () => {
    it('should display correct status icons for each feature', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        const commandGroup = screen.getByRole('group');
        const items = within(commandGroup).getAllByRole('option');
        
        expect(items).toHaveLength(4);
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when fetch fails', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockRejectedValue(new Error('Network error'));
      
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
    });

    it('should display error message when response is not ok', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });
      
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText(/failed to fetch features/i)).toBeInTheDocument();
      });
    });

    it('should clear error when dialog is closed', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockRejectedValue(new Error('Network error'));
      
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
      
      await user.keyboard('{Escape}');
      
      await waitFor(() => {
        expect(screen.queryByText(/network error/i)).not.toBeInTheDocument();
      });
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockFeatures }),
      });
      
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.queryByText(/network error/i)).not.toBeInTheDocument();
        expect(screen.getByText('Add User Authentication')).toBeInTheDocument();
      });
    });
  });

  describe('Brief Display', () => {
    it('should display feature brief when available', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Implement JWT-based authentication system')).toBeInTheDocument();
        expect(screen.getByText('Build responsive dashboard with navigation')).toBeInTheDocument();
      });
    });

    it('should not display brief when it is null', async () => {
      const user = userEvent.setup();
      render(<FeatureSearch />);
      
      const button = screen.getByRole('button', { name: /search features/i });
      await user.click(button);
      
      await waitFor(() => {
        const searchFeature = screen.getByText('Implement Search Functionality');
        const parentElement = searchFeature.closest('[role="option"]');
        
        const briefElements = within(parentElement!).queryAllByText(/./);
        expect(briefElements.some(el => el.textContent?.includes('null'))).toBe(false);
      });
    });
  });
});