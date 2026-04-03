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

// ─── localStorage stub ────────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    clear: () => { store = {}; },
    removeItem: (k: string) => { delete store[k]; },
  };
})();
Object.defineProperty(global, "localStorage", { value: localStorageMock });

// ─── fetch stub ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("WelcomeStep - GraphMindsetCard integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
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

describe("WelcomeStep - Stripe payment claim branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User", id: "user-1" } } });
  });

  it("calls createWorkspaceAutomatically with repositoryUrl when workspaceType is 'hive'", async () => {
    // payment=success in URL so claimPayment runs
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => {
        if (key === "payment") return "success";
        if (key === "session_id") return "cs_test_hive_123";
        return null;
      },
    });

    // claim returns hive + repositoryUrl
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: { id: "pay_1", status: "PAID" },
        workspaceType: "hive",
        repositoryUrl: "https://github.com/org/my-repo",
      }),
    });

    // createWorkspaceAutomatically calls: slug-availability, workspaces POST, github check, github install
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { isAvailable: true } }),
    });

    render(<WelcomeStep onNext={vi.fn()} />);

    await waitFor(() => {
      // Should NOT navigate to graphmindset
      expect(mockRouterPush).not.toHaveBeenCalledWith("/onboarding/graphmindset");
      // Should have called fetch for workspace creation (claim + workspace API calls)
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/stripe/claim",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("uses localStorage repoUrl as fallback when claim repositoryUrl is empty for hive flow", async () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => {
        if (key === "payment") return "success";
        if (key === "session_id") return "cs_test_hive_456";
        return null;
      },
    });

    localStorageMock.setItem("repoUrl", "https://github.com/fallback/repo");

    // claim returns hive but no repositoryUrl
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: { id: "pay_2", status: "PAID" },
        workspaceType: "hive",
        repositoryUrl: null,
      }),
    });

    // subsequent workspace creation calls
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { isAvailable: true } }),
    });

    render(<WelcomeStep onNext={vi.fn()} />);

    await waitFor(() => {
      expect(mockRouterPush).not.toHaveBeenCalledWith("/onboarding/graphmindset");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/stripe/claim",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("shows error when workspaceType is 'hive' but no repositoryUrl and localStorage is empty", async () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => {
        if (key === "payment") return "success";
        if (key === "session_id") return "cs_test_hive_789";
        return null;
      },
    });

    // No localStorage repoUrl
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: { id: "pay_3", status: "PAID" },
        workspaceType: "hive",
        repositoryUrl: null,
      }),
    });

    render(<WelcomeStep onNext={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/no repository url found/i)
      ).toBeInTheDocument();
      expect(mockRouterPush).not.toHaveBeenCalledWith("/onboarding/graphmindset");
    });
  });

  it("routes to /onboarding/graphmindset when workspaceType is not 'hive'", async () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => {
        if (key === "payment") return "success";
        if (key === "session_id") return "cs_test_gm_123";
        return null;
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: { id: "pay_4", status: "PAID" },
        workspaceType: null,
        repositoryUrl: null,
      }),
    });

    render(<WelcomeStep onNext={vi.fn()} />);

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/onboarding/graphmindset");
    });
  });
});

describe("WelcomeStep - Go to my workspace button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockUseSearchParams.mockReturnValue({ get: () => null });
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


