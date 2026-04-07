// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockUseSession, mockUseWorkspace, mockUseSidebar } = vi.hoisted(() => ({
  mockUseSession: vi.fn(() => ({ data: null })),
  mockUseWorkspace: vi.fn(() => ({ workspace: null })),
  mockUseSidebar: vi.fn(() => ({ isMobile: false })),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
  signOut: vi.fn(),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// Mock sidebar
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: mockUseSidebar,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, ...props }: React.HTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button {...props}>{children}</button>
  ),
}));

// Mock useWorkspace
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: mockUseWorkspace,
}));

// Mock SphinxLinkModal
vi.mock("@/components/SphinxLinkModal", () => ({
  SphinxLinkModal: () => null,
}));

// Mock dropdown menu
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuLabel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
    onClick?: () => void;
  }) => <div onClick={onClick}>{children}</div>,
}));

// Mock avatar
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />,
  AvatarFallback: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

import { NavUser } from "@/components/NavUser";

const mockUser = {
  name: "Test User",
  email: "test@example.com",
  avatar: "https://example.com/avatar.png",
};

const mockOrgs = [
  {
    id: "org-1",
    githubLogin: "my-org",
    name: "My Organization",
    avatarUrl: "https://example.com/org1.png",
    type: "ORG" as const,
  },
  {
    id: "org-2",
    githubLogin: "tomsmith8",
    name: null,
    avatarUrl: null,
    type: "USER" as const,
  },
];

describe("NavUser - Organizations section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({ data: null });
    mockUseWorkspace.mockReturnValue({ workspace: null });
    mockUseSidebar.mockReturnValue({ isMobile: false });
  });

  test("renders Organizations section with 2 orgs and correct hrefs", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrgs,
    } as Response);

    render(<NavUser user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText("Organizations")).toBeDefined();
    });

    const links = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href")?.startsWith("/org/"));
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/org/my-org");
    expect(links[1].getAttribute("href")).toBe("/org/tomsmith8");

    expect(screen.getByText("My Organization")).toBeDefined();
    expect(screen.getByText("tomsmith8")).toBeDefined();
  });

  test("hides Organizations section when API returns empty array", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<NavUser user={mockUser} />);

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Organizations")).toBeNull();
  });

  test("hides Organizations section when API fails", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

    render(<NavUser user={mockUser} />);

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Organizations")).toBeNull();
  });

  test("org avatar fallback shows first letter of githubLogin when name is null", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [mockOrgs[1]],
    } as Response);

    render(<NavUser user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText("Organizations")).toBeDefined();
    });

    // Fallback should show "T" (first letter of "tomsmith8")
    expect(screen.getByText("T")).toBeDefined();
  });
});
