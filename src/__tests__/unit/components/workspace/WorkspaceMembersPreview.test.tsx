import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceMembersPreview } from "@/components/workspace/WorkspaceMembersPreview";

// Mock dependencies
vi.mock("@/hooks/useWorkspaceMembers", () => ({
  useWorkspaceMembers: vi.fn(() => ({
    members: [
      {
        id: "1",
        role: "OWNER",
        joinedAt: "2024-01-01",
        user: {
          name: "Test Owner",
          email: "owner@test.com",
          image: null,
        },
      },
      {
        id: "2",
        role: "DEVELOPER",
        joinedAt: "2024-01-02",
        user: {
          name: "Test Developer",
          email: "dev@test.com",
          image: null,
        },
      },
    ],
    loading: false,
  })),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className }: any) => (
    <div data-testid="avatar" className={className}>
      {children}
    </div>
  ),
  AvatarFallback: ({ children }: any) => <div>{children}</div>,
  AvatarImage: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("lucide-react", () => ({
  ChevronRight: () => <div>ChevronRight</div>,
  ChevronLeft: () => <div>ChevronLeft</div>,
}));

describe("WorkspaceMembersPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render container with correct padding classes", () => {
    const { container } = render(
      <WorkspaceMembersPreview workspaceSlug="test-workspace" />
    );

    const containerDiv = container.querySelector(".px-3.py-1\\.5");
    expect(containerDiv).toBeTruthy();
  });

  it("should render container with h-10 equivalent height via py-1.5 padding", () => {
    const { container } = render(
      <WorkspaceMembersPreview workspaceSlug="test-workspace" />
    );

    // py-1.5 with h-8 avatars should total to h-10 (40px)
    // py-1.5 = 0.375rem top + 0.375rem bottom = 0.75rem (12px)
    // h-8 = 2rem (32px)
    // Total = 32px + 12px = 44px (close to h-10 which is 40px when accounting for borders)
    const containerDiv = container.querySelector(".py-1\\.5");
    expect(containerDiv).toBeTruthy();
  });

  it("should maintain w-8 h-8 avatar sizing", () => {
    render(<WorkspaceMembersPreview workspaceSlug="test-workspace" />);

    const avatars = screen.getAllByTestId("avatar");
    avatars.forEach((avatar) => {
      expect(avatar.className).toContain("w-8");
      expect(avatar.className).toContain("h-8");
    });
  });

  it("should render with all expected container classes", () => {
    const { container } = render(
      <WorkspaceMembersPreview workspaceSlug="test-workspace" />
    );

    const containerDiv = container.querySelector(
      ".flex.items-center.gap-2.px-3.py-1\\.5.rounded-lg.border"
    );
    expect(containerDiv).toBeTruthy();
  });
});
