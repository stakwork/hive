// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WelcomeStep } from "@/app/onboarding/workspace/wizard/wizard-steps/welcome-step";

const mockRouterPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => ({ get: () => null }),
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

vi.mock("@/components/onboarding/GraphMindsetCard", () => ({
  GraphMindsetCard: () => (
    <div>
      <h3>GraphMindset</h3>
      <button disabled>Create my graph</button>
      <input placeholder="e.g., my-api-graph" />
    </div>
  ),
}));

import { useSession } from "next-auth/react";
import { useWorkspace } from "@/hooks/useWorkspace";

const mockUseSession = useSession as ReturnType<typeof vi.fn>;
const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;

describe("WelcomeStep - GraphMindsetCard integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
    mockUseSession.mockReturnValue({ data: null });
  });

  it("renders GraphMindsetCard below the Welcome card", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByText("GraphMindset")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create my graph/i })).toBeInTheDocument();
  });

  it("'Create my graph' button is disabled regardless of input state", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).toBeDisabled();
  });

  it("workspace name input is present and accepts input without errors", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    const input = screen.getByPlaceholderText("e.g., my-api-graph") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "test-workspace" } });
    // No errors thrown; button remains disabled
    expect(screen.getByRole("button", { name: /create my graph/i })).toBeDisabled();
  });
});

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
