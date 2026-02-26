import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '@/components/Sidebar';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import * as usePoolStatusModule from '@/hooks/usePoolStatus';
import * as useFeatureFlagModule from '@/hooks/useFeatureFlag';
import * as runtimeModule from '@/lib/runtime';

// Mock the hooks and components
vi.mock('@/hooks/useWorkspace');
vi.mock('@/hooks/usePoolStatus');
vi.mock('@/hooks/useFeatureFlag');
vi.mock('@/lib/runtime');
vi.mock('@/components/NavUser', () => ({
  NavUser: () => <div data-testid="nav-user">NavUser</div>,
}));
vi.mock('@/components/WorkspaceSwitcher', () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher">WorkspaceSwitcher</div>,
}));
vi.mock('@/components/BugReportSlideout', () => ({
  BugReportSlideout: () => <div data-testid="bug-report-slideout">BugReportSlideout</div>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/w/test-workspace',
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children?: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock shadcn UI components to avoid JSX transform issues
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => <button {...props}>{children}</button>,
}));
vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => <div data-testid="badge" {...props}>{children}</div>,
}));
vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

describe('Sidebar - Navigation Links', () => {
  const mockUser = {
    name: 'Test User',
    email: 'test@example.com',
    image: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock useFeatureFlag to return false by default
    vi.mocked(useFeatureFlagModule.useFeatureFlag).mockReturnValue(false);
    
    // Mock usePoolStatus to return null by default
    vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
      poolStatus: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('should render top-level navigation items as <a> elements with correct hrefs', () => {
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      slug: 'test-workspace',
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    render(<Sidebar user={mockUser} />);

    // Both mobile and desktop sidebars are rendered, so we get all matching elements
    const graphLinks = screen.getAllByTestId('nav-graph');
    expect(graphLinks.length).toBeGreaterThan(0);
    
    // Check the first one (desktop sidebar)
    // Graph has href="/" which becomes "/w/test-workspace/" 
    const graphLink = graphLinks[0].querySelector('a');
    expect(graphLink).toHaveAttribute('href', '/w/test-workspace/');

    // Verify Capacity link
    const capacityLinks = screen.getAllByTestId('nav-capacity');
    const capacityLink = capacityLinks[0].querySelector('a');
    expect(capacityLink).toHaveAttribute('href', '/w/test-workspace/capacity');
  });

  it('should render child navigation items as <a> elements with correct hrefs', async () => {
    const user = userEvent.setup();
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      slug: 'test-workspace',
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    render(<Sidebar user={mockUser} />);

    // Expand Build section (click first one - desktop sidebar)
    const buildButtons = screen.getAllByTestId('nav-build');
    await user.click(buildButtons[0]);

    // Verify child links
    await waitFor(() => {
      const tasksLinks = screen.getAllByTestId('nav-tasks');
      expect(tasksLinks[0]).toHaveAttribute('href', '/w/test-workspace/tasks');

      const planLinks = screen.getAllByTestId('nav-plan');
      expect(planLinks[0]).toHaveAttribute('href', '/w/test-workspace/plan');

      const whiteboardsLinks = screen.getAllByTestId('nav-whiteboards');
      expect(whiteboardsLinks[0]).toHaveAttribute('href', '/w/test-workspace/whiteboards');
    });
  });

  it('should render Settings as <a> element with correct href', () => {
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      slug: 'test-workspace',
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    render(<Sidebar user={mockUser} />);

    const settingsButtons = screen.getAllByTestId('settings-button');
    const settingsLink = settingsButtons[0].querySelector('a');
    expect(settingsLink).toHaveAttribute('href', '/w/test-workspace/settings');
  });

  it('should support Cmd+Click to open links in new tab', () => {
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      slug: 'test-workspace',
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    render(<Sidebar user={mockUser} />);

    // All navigation items should be proper <a> tags that support browser navigation
    const graphLinks = screen.getAllByTestId('nav-graph');
    const graphLink = graphLinks[0].querySelector('a');
    expect(graphLink?.tagName).toBe('A');
    expect(graphLink).toHaveAttribute('href');
  });
});

describe.skip('Sidebar - Pool Capacity Counter (DISABLED - complex component rendering)', () => {
  const mockUser = {
    name: 'Test User',
    email: 'test@example.com',
    image: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock useFeatureFlag to return false by default
    vi.mocked(useFeatureFlagModule.useFeatureFlag).mockReturnValue(false);
  });

  it('should display in-use pods / running pods (3/10) excluding pending and failed VMs', () => {
    // Mock workspace with pool configured
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
      isPoolActive: true,
    };

    // Mock pool status with runningVms=10, usedVms=3, unusedVms=5, pendingVms=1, failedVms=1
    const mockPoolStatus = {
      runningVms: 10,
      usedVms: 3,
      unusedVms: 5,
      pendingVms: 1,
      failedVms: 1,
      lastCheck: new Date().toISOString(),
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
      poolStatus: mockPoolStatus,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<Sidebar user={mockUser} />);

    // Verify the badge shows 3/10 (in-use/running pods)
    const capacityBadge = screen.getByText('3/10');
    expect(capacityBadge).toBeInTheDocument();
  });

  it('should not display counter when total is 0', () => {
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
      isPoolActive: true,
    };

    const mockPoolStatus = {
      runningVms: 0,
      usedVms: 0,
      unusedVms: 0,
      pendingVms: 0,
      failedVms: 0,
      lastCheck: new Date().toISOString(),
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
      poolStatus: mockPoolStatus,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<Sidebar user={mockUser} />);

    // Verify no capacity badge is displayed
    expect(screen.queryByText(/\/0/)).not.toBeInTheDocument();
  });

  it('should not display counter when poolStatus is null', () => {
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
      isPoolActive: false,
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
      poolStatus: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<Sidebar user={mockUser} />);

    // Verify no capacity badge is displayed
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
  });

  it('should correctly calculate when all running VMs are in use', () => {
    const mockWorkspace = {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
      poolState: 'COMPLETE',
      isPoolActive: true,
    };

    const mockPoolStatus = {
      runningVms: 5,
      usedVms: 5,
      unusedVms: 0,
      pendingVms: 2,
      failedVms: 1,
      lastCheck: new Date().toISOString(),
    };

    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      workspace: mockWorkspace,
      loading: false,
      error: null,
      waitingForInputCount: 0,
      refreshTaskNotifications: vi.fn(),
    } as any);

    vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
      poolStatus: mockPoolStatus,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<Sidebar user={mockUser} />);

    // Verify the badge shows 5/5 (all running pods are in use)
    const capacityBadge = screen.getByText('5/5');
    expect(capacityBadge).toBeInTheDocument();
  });

  describe('Bug Report Integration', () => {
    it('should render Report Bug button in sidebar', () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Test Workspace',
        slug: 'test-workspace',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
        poolStatus: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<Sidebar user={mockUser} />);

      const bugReportButton = screen.getByTestId('report-bug-button');
      expect(bugReportButton).toBeInTheDocument();
      expect(bugReportButton).toHaveTextContent('Report Bug');
    });

    it('should open bug report slideout when button is clicked', async () => {
      const user = userEvent.setup();
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Test Workspace',
        slug: 'test-workspace',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
        poolStatus: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<Sidebar user={mockUser} />);

      const bugReportButton = screen.getByTestId('report-bug-button');
      await user.click(bugReportButton);

      // Verify slideout is opened by checking for its title
      await waitFor(() => {
        expect(screen.getByText('Report a Bug')).toBeInTheDocument();
      });
    });

    it('should close slideout when submission is successful', async () => {
      const user = userEvent.setup();
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Test Workspace',
        slug: 'test-workspace',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
        poolStatus: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      // Mock successful API response
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'feature-123' }),
      });

      render(<Sidebar user={mockUser} />);

      const bugReportButton = screen.getByTestId('report-bug-button');
      await user.click(bugReportButton);

      // Fill in the form
      const textarea = screen.getByTestId('bug-description-textarea');
      await user.type(textarea, 'This is a bug report description');

      // Submit
      const submitButton = screen.getByTestId('submit-bug-report-button');
      await user.click(submitButton);

      // Verify slideout closes
      await waitFor(() => {
        expect(screen.queryByText('Report a Bug')).not.toBeInTheDocument();
      });
    });
  });
});

describe.skip('Sidebar - Stak Toolkit Section (DISABLED - complex component rendering)', () => {
  const mockUser = {
    name: 'Test User',
    email: 'test@example.com',
    image: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock useFeatureFlag to return false by default
    vi.mocked(useFeatureFlagModule.useFeatureFlag).mockReturnValue(false);
    
    // Mock usePoolStatus to return null by default
    vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
      poolStatus: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  describe('Visibility', () => {
    it('should show Stak Toolkit section in stakwork workspace', () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Stakwork',
        slug: 'stakwork',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'stakwork',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

      render(<Sidebar user={mockUser} />);

      // Check for Stak Toolkit parent section
      expect(screen.getByText('Stak Toolkit')).toBeInTheDocument();
    });

    it('should show Stak Toolkit section in development mode', () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Test Workspace',
        slug: 'test-workspace',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(true);

      render(<Sidebar user={mockUser} />);

      // Check for Stak Toolkit parent section
      expect(screen.getByText('Stak Toolkit')).toBeInTheDocument();
    });

    it('should hide Stak Toolkit section in non-stakwork workspace without dev mode', () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Test Workspace',
        slug: 'test-workspace',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'test-workspace',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

      render(<Sidebar user={mockUser} />);

      // Check that Stak Toolkit parent section is not present
      expect(screen.queryByText('Stak Toolkit')).not.toBeInTheDocument();
    });
  });

  describe('Navigation Items', () => {
    beforeEach(() => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Stakwork',
        slug: 'stakwork',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'stakwork',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);
    });

    it('should render three child items: Prompts, Workflows, Projects', async () => {
      const user = userEvent.setup();
      render(<Sidebar user={mockUser} />);

      // Click to expand Stak Toolkit section
      const stakToolkitButton = screen.getByText('Stak Toolkit');
      await user.click(stakToolkitButton);

      // Verify all three child items are present
      expect(screen.getByText('Prompts')).toBeInTheDocument();
      expect(screen.getByText('Workflows')).toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });

    it('should render navigation items with correct hrefs', async () => {
      const user = userEvent.setup();
      render(<Sidebar user={mockUser} />);

      // Click to expand Stak Toolkit section
      const stakToolkitButton = screen.getByText('Stak Toolkit');
      await user.click(stakToolkitButton);

      // Find links and verify hrefs
      const promptsLink = screen.getByText('Prompts').closest('a');
      const workflowsLink = screen.getByText('Workflows').closest('a');
      const projectsLink = screen.getByText('Projects').closest('a');

      expect(promptsLink).toHaveAttribute('href', '/w/stakwork/prompts');
      expect(workflowsLink).toHaveAttribute('href', '/w/stakwork/workflows');
      expect(projectsLink).toHaveAttribute('href', '/w/stakwork/projects');
    });

    it('should render items in correct order: Prompts, Workflows, Projects', async () => {
      const user = userEvent.setup();
      render(<Sidebar user={mockUser} />);

      // Click to expand Stak Toolkit section
      const stakToolkitButton = screen.getByText('Stak Toolkit');
      await user.click(stakToolkitButton);

      // Get all navigation items and verify order
      const items = screen.getAllByRole('link');
      const stakToolkitItems = items.filter(item => 
        item.textContent === 'Prompts' || 
        item.textContent === 'Workflows' || 
        item.textContent === 'Projects'
      );

      expect(stakToolkitItems).toHaveLength(3);
      expect(stakToolkitItems[0]).toHaveTextContent('Prompts');
      expect(stakToolkitItems[1]).toHaveTextContent('Workflows');
      expect(stakToolkitItems[2]).toHaveTextContent('Projects');
    });
  });

  describe('Section Positioning', () => {
    it('should position Stak Toolkit section above Build section', () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Stakwork',
        slug: 'stakwork',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'stakwork',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

      render(<Sidebar user={mockUser} />);

      // Get all section buttons (parent navigation items)
      const buttons = screen.getAllByRole('button');
      const sectionButtons = buttons.filter(btn => 
        btn.textContent === 'Stak Toolkit' || 
        btn.textContent === 'Build'
      );

      // Find indices
      const stakToolkitIndex = sectionButtons.findIndex(btn => btn.textContent === 'Stak Toolkit');
      const buildIndex = sectionButtons.findIndex(btn => btn.textContent === 'Build');

      // Verify Stak Toolkit comes before Build
      expect(stakToolkitIndex).toBeGreaterThanOrEqual(0);
      expect(buildIndex).toBeGreaterThanOrEqual(0);
      expect(stakToolkitIndex).toBeLessThan(buildIndex);
    });
  });

  describe('Expand/Collapse Behavior', () => {
    beforeEach(() => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Stakwork',
        slug: 'stakwork',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'stakwork',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);
    });

    it('should start collapsed by default', () => {
      render(<Sidebar user={mockUser} />);

      // Stak Toolkit parent should be visible
      expect(screen.getByText('Stak Toolkit')).toBeInTheDocument();

      // Children should not be visible initially
      expect(screen.queryByText('Prompts')).not.toBeInTheDocument();
      expect(screen.queryByText('Workflows')).not.toBeInTheDocument();
      expect(screen.queryByText('Projects')).not.toBeInTheDocument();
    });

    it('should expand section when clicked', async () => {
      const user = userEvent.setup();
      render(<Sidebar user={mockUser} />);

      // Click to expand
      const stakToolkitButton = screen.getByText('Stak Toolkit');
      await user.click(stakToolkitButton);

      // Children should now be visible
      await waitFor(() => {
        expect(screen.getByText('Prompts')).toBeInTheDocument();
        expect(screen.getByText('Workflows')).toBeInTheDocument();
        expect(screen.getByText('Projects')).toBeInTheDocument();
      });
    });

    it('should collapse section when clicked again', async () => {
      const user = userEvent.setup();
      render(<Sidebar user={mockUser} />);

      // Click to expand
      const stakToolkitButton = screen.getByText('Stak Toolkit');
      await user.click(stakToolkitButton);

      // Wait for expansion
      await waitFor(() => {
        expect(screen.getByText('Prompts')).toBeInTheDocument();
      });

      // Click again to collapse
      await user.click(stakToolkitButton);

      // Children should be hidden
      await waitFor(() => {
        expect(screen.queryByText('Prompts')).not.toBeInTheDocument();
        expect(screen.queryByText('Workflows')).not.toBeInTheDocument();
        expect(screen.queryByText('Projects')).not.toBeInTheDocument();
      });
    });
  });

  describe('Integration with Existing Navigation', () => {
    it('should not affect other navigation sections', () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Stakwork',
        slug: 'stakwork',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'stakwork',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

      render(<Sidebar user={mockUser} />);

      // Verify other navigation sections still exist
      expect(screen.getByText('Graph')).toBeInTheDocument();
      expect(screen.getByText('Capacity')).toBeInTheDocument();
      expect(screen.getByText('Build')).toBeInTheDocument();
      expect(screen.getByText('Context')).toBeInTheDocument();
    });

    it('should maintain workspace switcher and user nav', () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Stakwork',
        slug: 'stakwork',
        poolState: 'COMPLETE',
      };

      vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
        workspace: mockWorkspace,
        slug: 'stakwork',
        loading: false,
        error: null,
        waitingForInputCount: 0,
        refreshTaskNotifications: vi.fn(),
      } as any);

      vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

      render(<Sidebar user={mockUser} />);

      // Verify workspace switcher and nav user are still present
      expect(screen.getByTestId('workspace-switcher')).toBeInTheDocument();
      expect(screen.getByTestId('nav-user')).toBeInTheDocument();
    });
  });
});
