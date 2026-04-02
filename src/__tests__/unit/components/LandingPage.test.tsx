/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/utils/slug", () => ({
  extractRepoNameFromUrl: (url: string) => {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? match[2].toLowerCase() : null;
  },
}));

// Stub ui components with minimal HTML equivalents
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type,
    className,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} onClick={onClick} type={type} className={className}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

// localStorage stub
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    clear: () => {
      store = {};
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
})();
Object.defineProperty(global, "localStorage", { value: localStorageMock });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function importComponent() {
    const mod = await import("@/components/LandingPage");
    return mod.default;
  }

  it("renders password gate by default", async () => {
    const LandingPage = await importComponent();
    render(<LandingPage />);
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
    expect(screen.queryByText(/Create Hive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Build Graph/i)).not.toBeInTheDocument();
  });

  it("shows error on wrong password response", async () => {
    const LandingPage = await importComponent();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: false, message: "Incorrect password" }),
    });

    const user = userEvent.setup();
    render(<LandingPage />);

    await user.type(screen.getByPlaceholderText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Incorrect password")).toBeInTheDocument();
    });
  });

  it("reveals two-card layout on correct password", async () => {
    const LandingPage = await importComponent();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true }),
    });

    const user = userEvent.setup();
    render(<LandingPage />);

    await user.type(screen.getByPlaceholderText("Password"), "correctpass");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create hive/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /build graph/i })).toBeInTheDocument();
    });
    // Password input should be gone
    expect(screen.queryByPlaceholderText("Password")).not.toBeInTheDocument();
  });

  describe("Hive card", () => {
    async function renderUnlocked() {
      const LandingPage = await importComponent();
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ success: true }),
      });
      const user = userEvent.setup();
      render(<LandingPage />);
      await user.type(screen.getByPlaceholderText("Password"), "pass");
      await user.click(screen.getByRole("button", { name: /continue/i }));
      await waitFor(() => screen.getByRole("button", { name: /create hive/i }));
      return user;
    }

    it("Create Hive button is disabled for empty input", async () => {
      await renderUnlocked();
      expect(screen.getByRole("button", { name: /create hive/i })).toBeDisabled();
    });

    it("Create Hive button is disabled for invalid GitHub URL", async () => {
      const user = await renderUnlocked();
      const input = screen.getByPlaceholderText("https://github.com/username/repository");
      await user.type(input, "not-a-github-url");
      expect(screen.getByRole("button", { name: /create hive/i })).toBeDisabled();
    });

    it("Create Hive button is enabled for valid GitHub URL", async () => {
      const user = await renderUnlocked();
      const input = screen.getByPlaceholderText("https://github.com/username/repository");
      await user.type(input, "https://github.com/org/repo");
      expect(screen.getByRole("button", { name: /create hive/i })).not.toBeDisabled();
    });

    it("clicking Create Hive stores repoUrl and calls Stripe checkout", async () => {
      const user = await renderUnlocked();
      // Mock the checkout response
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ sessionUrl: "https://checkout.stripe.com/pay/test" }),
      });

      const input = screen.getByPlaceholderText("https://github.com/username/repository");
      await user.type(input, "https://github.com/org/my-repo");
      await user.click(screen.getByRole("button", { name: /create hive/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/stripe/checkout",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ workspaceName: "my-repo", workspaceSlug: "my-repo" }),
          })
        );
        expect(localStorageMock.getItem("repoUrl")).toBe("https://github.com/org/my-repo");
      });
    });
  });

  describe("GraphMindset card", () => {
    // renderUnlocked must set the password mock last so per-test mocks
    // added AFTER this call are consumed in the correct order.
    async function renderUnlocked() {
      const LandingPage = await importComponent();
      const user = userEvent.setup();
      render(<LandingPage />);

      // Set password mock right before the submit so nothing else consumes it first
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ success: true }),
      });

      await user.type(screen.getByPlaceholderText("Password"), "pass");
      await user.click(screen.getByRole("button", { name: /continue/i }));
      await waitFor(() => screen.getByRole("button", { name: /build graph/i }));
      return user;
    }

    it("Build Graph button is disabled when name is empty", async () => {
      await renderUnlocked();
      expect(screen.getByRole("button", { name: /build graph/i })).toBeDisabled();
    });

    it("Build Graph button is disabled while slug is checking", async () => {
      const user = await renderUnlocked();
      // Never resolves so it stays in checking state
      mockFetch.mockImplementationOnce(() => new Promise(() => {}));
      const input = screen.getByPlaceholderText("Workspace name");
      await user.type(input, "my-workspace");

      // During debounce / checking the button stays disabled
      expect(screen.getByRole("button", { name: /build graph/i })).toBeDisabled();
    });

    it("Build Graph button is disabled when slug is unavailable", async () => {
      const user = await renderUnlocked();
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ available: false, message: "Already taken" }),
      });
      const input = screen.getByPlaceholderText("Workspace name");
      await user.type(input, "taken-name");

      await waitFor(() => {
        expect(screen.getByText("Already taken")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /build graph/i })).toBeDisabled();
    });

    it("Build Graph button is enabled when slug is available", async () => {
      const user = await renderUnlocked();
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ available: true }),
      });
      const input = screen.getByPlaceholderText("Workspace name");
      await user.type(input, "my-workspace");

      await waitFor(() => {
        expect(screen.getByText(/name is available/i)).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /build graph/i })).not.toBeDisabled();
    });

    it("clicking Build Graph stores name and calls Stripe checkout", async () => {
      const user = await renderUnlocked();
      // slug availability
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ available: true }),
      });
      // stripe checkout
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ sessionUrl: "https://checkout.stripe.com/pay/gm-test" }),
      });

      const input = screen.getByPlaceholderText("Workspace name");
      await user.type(input, "my-graph");

      await waitFor(() => screen.getByText(/name is available/i));

      await user.click(screen.getByRole("button", { name: /build graph/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/stripe/checkout",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ workspaceName: "my-graph", workspaceSlug: "my-graph" }),
          })
        );
        expect(localStorageMock.getItem("graphMindsetWorkspaceName")).toBe("my-graph");
      });
    });
  });
});
