// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { WelcomeStep } from "@/app/onboarding/workspace/wizard/wizard-steps/welcome-step";

const mockRouterPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: vi.fn(() => ({ get: () => null })),
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

vi.mock("@/components/onboarding/SwarmSetupLoader", () => ({
  SwarmSetupLoader: () => null,
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
import { useSearchParams } from "next/navigation";

const mockUseSession = useSession as ReturnType<typeof vi.fn>;
const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
const mockUseSearchParams = useSearchParams as ReturnType<typeof vi.fn>;

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

// ---------------------------------------------------------------------------
// claimPayment tests — exercise WelcomeStep via payment=success search params
// ---------------------------------------------------------------------------
describe("WelcomeStep - claimPayment password handling", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  function makeSearchParams(params: Record<string, string>) {
    return { get: (key: string) => params[key] ?? null };
  }

  function setupMocks(searchParams: Record<string, string>, sessionUser: object | null) {
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: mockRouterPush }),
      useSearchParams: () => makeSearchParams(searchParams),
      redirect: vi.fn(),
    }));
    mockUseSession.mockReturnValue({ data: sessionUser ? { user: sessionUser } : null });
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
  }

  it("shows error when graphMindsetPassword is missing from localStorage on claim", async () => {
    mockUseSearchParams.mockReturnValue(
      makeSearchParams({ payment: "success", session_id: "cs_test_abc" })
    );
    mockUseSession.mockReturnValue({ data: { user: { name: "Alice" } } });
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });

    // No password in localStorage
    render(<WelcomeStep onNext={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Please restart onboarding from the beginning/i)
      ).toBeInTheDocument();
    });

    // fetch (claim) should NOT have been called
    expect(mockFetch).not.toHaveBeenCalledWith(
      "/api/stripe/claim",
      expect.anything()
    );
  });

  it("includes password in claim request body and clears it from localStorage on success", async () => {
    mockUseSearchParams.mockReturnValue(
      makeSearchParams({ payment: "success", session_id: "cs_test_xyz" })
    );
    mockUseSession.mockReturnValue({ data: { user: { name: "Bob" } } });
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: mockRefresh, workspaces: [] });

    localStorage.setItem("graphMindsetPassword", "supersecret");

    // Claim succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workspace: { id: "ws-1" } }),
    });
    // Swarm poll (never resolves ACTIVE in this test — we just check localStorage)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ workspace: { id: "ws-1" } }),
    });

    await act(async () => {
      render(<WelcomeStep onNext={vi.fn()} />);
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/stripe/claim",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sessionId: "cs_test_xyz", password: "supersecret" }),
        })
      );
    });

    // Password must be cleared after successful claim
    expect(localStorage.getItem("graphMindsetPassword")).toBeNull();
  });
});
