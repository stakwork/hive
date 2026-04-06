// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
      <h2>GraphMindset</h2>
      <button disabled>Build Graph</button>
      <input placeholder="Workspace name" />
    </div>
  ),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
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

function priceResponse(amountUsd = 50) {
  return Promise.resolve({ ok: true, json: async () => ({ amountUsd }) });
}

/** Default fetch mock: returns price for /api/config/price, empty for others */
function setupDefaultFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/config/price")) {
      return priceResponse();
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe("WelcomeStep - Sign In button visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockFetch.mockReset();
    setupDefaultFetch();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
    mockUseSearchParams.mockReturnValue({ get: () => null });
  });

  it("shows 'Sign in to existing workspace' link when user has no session", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign in to existing workspace/i })).toBeInTheDocument();
  });

  it("does NOT show 'Sign in to existing workspace' link when user is signed in", () => {
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User", id: "user-1" } }, status: "authenticated" });
    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /sign in to existing workspace/i })).not.toBeInTheDocument();
  });

  it("navigates to /auth/signin?redirect=/workspaces when Sign In link is clicked", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    render(<WelcomeStep onNext={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /sign in to existing workspace/i }));
    expect(mockRouterPush).toHaveBeenCalledWith("/auth/signin?redirect=/workspaces");
  });
});

describe("WelcomeStep - GraphMindsetCard integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockFetch.mockReset();
    setupDefaultFetch();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    mockUseSearchParams.mockReturnValue({ get: () => null });
  });

  it("renders GraphMindsetCard alongside the Hive card", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByText("GraphMindset")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build graph/i })).toBeInTheDocument();
  });

  it("'Build Graph' button is disabled regardless of input state", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    const button = screen.getByRole("button", { name: /build graph/i });
    expect(button).toBeDisabled();
  });

  it("workspace name input is present and accepts input without errors", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    const input = screen.getByPlaceholderText("Workspace name") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "test-workspace" } });
    expect(screen.getByRole("button", { name: /build graph/i })).toBeDisabled();
  });
});

describe("WelcomeStep - Hive card rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockFetch.mockReset();
    setupDefaultFetch();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
    mockUseSearchParams.mockReturnValue({ get: () => null });
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  it("renders the Hive card with title and Create Hive button", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByText("Hive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create hive/i })).toBeInTheDocument();
  });

  it("renders the repository URL input", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByPlaceholderText(/https:\/\/github\.com\/username\/repository/i)).toBeInTheDocument();
  });

  it("Create Hive button is disabled when input is empty", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /create hive/i })).toBeDisabled();
  });

  it("Create Hive button is enabled when repo URL is entered", () => {
    render(<WelcomeStep onNext={vi.fn()} />);
    const input = screen.getByPlaceholderText(/https:\/\/github\.com\/username\/repository/i);
    fireEvent.change(input, { target: { value: "https://github.com/org/repo" } });
    expect(screen.getByRole("button", { name: /create hive/i })).not.toBeDisabled();
  });
});

describe("WelcomeStep - Stripe payment claim branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockFetch.mockReset();
    setupDefaultFetch();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User", id: "user-1" } }, status: "authenticated" });
  });

  it("calls createWorkspaceAutomatically with repositoryUrl when workspaceType is 'hive'", async () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => {
        if (key === "payment") return "success";
        if (key === "session_id") return "cs_test_hive_123";
        return null;
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: { id: "pay_1", status: "PAID" },
        workspaceType: "hive",
        repositoryUrl: "https://github.com/org/my-repo",
      }),
    });

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

  it("uses localStorage repoUrl as fallback when claim repositoryUrl is empty for hive flow", async () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => {
        if (key === "payment") return "success";
        if (key === "session_id") return "cs_test_hive_456";
        return null;
      },
    });

    localStorageMock.setItem("repoUrl", "https://github.com/fallback/repo");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: { id: "pay_2", status: "PAID" },
        workspaceType: "hive",
        repositoryUrl: null,
      }),
    });

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

    // Price fetch runs first on mount; claim fetch is second
    mockFetch.mockReturnValueOnce(priceResponse());
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

    // Price fetch runs first on mount; claim fetch is second
    mockFetch.mockReturnValueOnce(priceResponse());
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
    mockFetch.mockReset();
    setupDefaultFetch();
    mockUseSearchParams.mockReturnValue({ get: () => null });
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
  });

  it("shows button when signed-in user has workspaces", () => {
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User" } }, status: "authenticated" });
    mockUseWorkspace.mockReturnValue({
      refreshWorkspaces: vi.fn(),
      workspaces: [{ slug: "my-workspace", id: "1" }],
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /go to my workspace/i })).toBeInTheDocument();
  });

  it("does not show button when signed-in user has no workspaces", () => {
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User" } }, status: "authenticated" });
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });

    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /go to my workspace/i })).not.toBeInTheDocument();
  });

  it("does not show button when user is not signed in", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    mockUseWorkspace.mockReturnValue({
      refreshWorkspaces: vi.fn(),
      workspaces: [{ slug: "my-workspace", id: "1" }],
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /go to my workspace/i })).not.toBeInTheDocument();
  });

  it("navigates to / when button is clicked", () => {
    mockUseSession.mockReturnValue({ data: { user: { name: "Test User" } }, status: "authenticated" });
    mockUseWorkspace.mockReturnValue({
      refreshWorkspaces: vi.fn(),
      workspaces: [{ slug: "my-workspace", id: "1" }],
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /go to my workspace/i }));
    expect(mockRouterPush).toHaveBeenCalledWith("/");
  });
});

describe("WelcomeStep - Cancel banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockFetch.mockReset();
    setupDefaultFetch();
    mockUseWorkspace.mockReturnValue({ refreshWorkspaces: vi.fn(), workspaces: [] });
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  it("shows cancel banner when payment=cancelled is in URL", () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "payment" ? "cancelled" : null),
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    expect(screen.getByText(/payment cancelled/i)).toBeInTheDocument();
  });

  it("dismisses cancel banner when X is clicked", () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "payment" ? "cancelled" : null),
    });

    render(<WelcomeStep onNext={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/payment cancelled/i)).not.toBeInTheDocument();
  });
});
