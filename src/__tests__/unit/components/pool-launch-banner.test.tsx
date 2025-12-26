import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PoolLaunchBanner } from '@/components/pool-launch-banner';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import * as useModalModule from '@/components/modals/ModlaProvider';

vi.mock('@/hooks/useWorkspace');
vi.mock('@/components/modals/ModlaProvider');

describe('PoolLaunchBanner Component', () => {
  const mockOpen = vi.fn();
  const mockWorkspaceSlug = 'test-workspace';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModalModule.useModal).mockReturnValue(mockOpen);
  });

  describe('Pool Complete State', () => {
    it('should return null when pool is complete', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'COMPLETE',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      const { container } = render(
        <PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Setting Up State', () => {
    it('should show "Setting up..." when containerFilesSetUp is false', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: false,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      expect(screen.getByText('Setting up...')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Your development environment is being prepared/i
        )
      ).toBeInTheDocument();
    });

    it('should display Server icon with orange pulsing indicator', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: false,
        },
        loading: false,
        error: null,
      } as any);

      const { container } = render(
        <PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />
      );

      // Check for pulsing indicator with orange background
      const pulsingIndicator = container.querySelector('.animate-pulse');
      expect(pulsingIndicator).toBeInTheDocument();
      expect(pulsingIndicator?.className).toContain('bg-yellow-500');
    });

    it('should not show Launch Pods button when setting up', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: false,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      expect(screen.queryByText('Launch Pods')).not.toBeInTheDocument();
    });
  });

  describe('Launch Pods State', () => {
    it('should show "Launch Pods" button when containerFilesSetUp is true and pool not complete', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      expect(screen.getByText('Launch Pods')).toBeInTheDocument();
    });

    it('should display custom title when provided', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      const customTitle = 'Complete Pool Setup to View Capacity';
      render(
        <PoolLaunchBanner
          workspaceSlug={mockWorkspaceSlug}
          title={customTitle}
        />
      );

      expect(screen.getByText(customTitle)).toBeInTheDocument();
    });

    it('should display custom description when provided', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      const customDescription =
        'Launch your development pods to monitor resource utilization.';
      render(
        <PoolLaunchBanner
          workspaceSlug={mockWorkspaceSlug}
          description={customDescription}
        />
      );

      expect(screen.getByText(customDescription)).toBeInTheDocument();
    });

    it('should display default title when not provided', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      expect(screen.getByText('Complete Pool Setup')).toBeInTheDocument();
    });

    it('should display default description when not provided', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      expect(
        screen.getByText('Launch your development pods to continue.')
      ).toBeInTheDocument();
    });

    it('should open ServicesWizard modal when Launch Pods button is clicked', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      const launchButton = screen.getByText('Launch Pods');
      fireEvent.click(launchButton);

      expect(mockOpen).toHaveBeenCalledWith('ServicesWizard');
      expect(mockOpen).toHaveBeenCalledTimes(1);
    });

    it('should prevent default event behavior when button is clicked', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      const launchButton = screen.getByText('Launch Pods');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');

      fireEvent(launchButton, clickEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Pool State Variations', () => {
    it('should show Launch Pods when poolState is NOT_STARTED and containerFilesSetUp is true', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'NOT_STARTED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      expect(screen.getByText('Launch Pods')).toBeInTheDocument();
    });

    it('should show Launch Pods when poolState is FAILED and containerFilesSetUp is true', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'FAILED',
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      expect(screen.getByText('Launch Pods')).toBeInTheDocument();
    });

    it('should return null when poolState is COMPLETE regardless of containerFilesSetUp', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'COMPLETE',
          containerFilesSetUp: false, // Even false, should still return null
        },
        loading: false,
        error: null,
      } as any);

      const { container } = render(
        <PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing workspace gracefully', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: null,
        loading: false,
        error: null,
      } as any);

      const { container } = render(
        <PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />
      );

      // Should return null when workspace is not available
      expect(container.firstChild).toBeNull();
    });

    it('should handle undefined poolState', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: undefined,
          containerFilesSetUp: true,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      // Should show Launch Pods button when poolState is undefined
      expect(screen.getByText('Launch Pods')).toBeInTheDocument();
    });

    it('should handle undefined containerFilesSetUp', () => {
      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: {
          id: 'workspace-1',
          slug: mockWorkspaceSlug,
          poolState: 'STARTED',
          containerFilesSetUp: undefined,
        },
        loading: false,
        error: null,
      } as any);

      render(<PoolLaunchBanner workspaceSlug={mockWorkspaceSlug} />);

      // Should show "Setting up..." when containerFilesSetUp is undefined (falsy)
      expect(screen.getByText('Setting up...')).toBeInTheDocument();
    });
  });
});
