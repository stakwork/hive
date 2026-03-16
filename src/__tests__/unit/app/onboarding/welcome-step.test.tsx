import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WelcomeStep } from "@/app/onboarding/workspace/wizard/wizard-steps/welcome-step";

const mockRouterPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  redirect: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/components/auth/GitHubAuthModal", () => ({
  GitHubAuthModal: () => null,
}));

import { useSession } from "next-auth/react";
import { useWorkspace } from "@/hooks/useWorkspace";

const mockUseSession = useSession as ReturnType<typeof vi.fn>;
const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;

describe("WelcomeStep - Go to my workspace button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
  });

  it("shows button when signed-in user has workspaces", () => {
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User" } } });
    mockUseWorkspace.mockReturnValue({
      refreshWorkspaces: vi.fn(),
      workspaces: [{ slug: "my-workspace", id: "1" }],
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /go to my workspace/i })).toBeInTheDocument();
  });

  it("does not show button when signed-in user has no workspaces", () => {
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User" } } });
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });

    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /go to my workspace/i })).not.toBeInTheDocument();
  });

  it("does not show button when user is not signed in", () => {
    mockUseSession.mockReturnValue({ data: null });
    mockUseWorkspace.mockReturnValue({
      refreshWorkspaces: vi.fn(),
      workspaces: [{ slug: "my-workspace", id: "1" }],
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /go to my workspace/i })).not.toBeInTheDocument();
  });

  it("navigates to / when button is clicked", () => {
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User" } } });
    mockUseWorkspace.mockReturnValue({
      refreshWorkspaces: vi.fn(),
      workspaces: [{ slug: "my-workspace", id: "1" }],
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /go to my workspace/i }));
    expect(mockRouterPush).toHaveBeenCalledWith("/");
  });
});
