import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '@/components/Sidebar';
import * as useWorkspaceModule from '@/hooks/useWorkspace';
import * as usePoolStatusModule from '@/hooks/usePoolStatus';
import * as useFeatureFlagModule from '@/hooks/useFeatureFlag';
import * as useWorkspaceAccessModule from '@/hooks/useWorkspaceAccess';
import * as useUnresolvedErrorCountModule from '@/hooks/useUnresolvedErrorCount';
import * as runtimeModule from '@/lib/runtime';

vi.mock('@/hooks/useWorkspace');
vi.mock('@/hooks/usePoolStatus');
vi.mock('@/hooks/useFeatureFlag');
vi.mock('@/hooks/useWorkspaceAccess');
vi.mock('@/hooks/useUnresolvedErrorCount', () => ({
  useUnresolvedErrorCount: vi.fn(() => ({ count: 0 })),
}));
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

describe('Sidebar - OpenHealth Section', () => {
  const mockUser = {
    name: 'Test User',
    email: 'test@example.com',
    image: null,
  };

  const makeWorkspaceMock = (slug: string) => ({
    workspace: { id: 'workspace-1', name: slug, slug, poolState: 'COMPLETE' },
    slug,
    loading: false,
    error: null,
    waitingForInputCount: 0,
    refreshTaskNotifications: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useFeatureFlagModule.useFeatureFlag).mockReturnValue(false);
    vi.mocked(usePoolStatusModule.usePoolStatus).mockReturnValue({
      poolStatus: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useWorkspaceAccessModule.useWorkspaceAccess).mockReturnValue({
      canRead: true,
      canWrite: true,
      canAdmin: false,
      isOwner: false,
      hasAccess: true,
      role: 'DEVELOPER',
    } as any);
    vi.mocked(useUnresolvedErrorCountModule.useUnresolvedErrorCount).mockReturnValue({ count: 0 });
  });

  it('renders OpenHealth nav item for the hive workspace', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue(makeWorkspaceMock('hive') as any);
    vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

    render(<Sidebar user={mockUser} />);

    expect(screen.getAllByText('OpenHealth').length).toBeGreaterThan(0);
  });

  it('does not render OpenHealth nav item for a non-hive workspace (including openhealth)', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue(makeWorkspaceMock('openhealth') as any);
    vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

    render(<Sidebar user={mockUser} />);

    expect(screen.queryByText('OpenHealth')).not.toBeInTheDocument();
  });

  it('does NOT render OpenHealth nav item in dev mode for another slug — no dev-mode bypass', () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue(makeWorkspaceMock('random-workspace') as any);
    vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(true);

    render(<Sidebar user={mockUser} />);

    // Unlike Legal, OpenHealth has NO isDevelopmentMode() OR-bypass.
    expect(screen.queryByText('OpenHealth')).not.toBeInTheDocument();
  });

  it('renders the OpenHealth Benchmarks child link when expanded', async () => {
    const user = userEvent.setup();
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue(makeWorkspaceMock('hive') as any);
    vi.mocked(runtimeModule.isDevelopmentMode).mockReturnValue(false);

    render(<Sidebar user={mockUser} />);

    const buttons = screen.getAllByTestId('nav-openhealth');
    await user.click(buttons[0]);

    expect(screen.getAllByText('OpenHealth Benchmarks').length).toBeGreaterThan(0);
  });
});
