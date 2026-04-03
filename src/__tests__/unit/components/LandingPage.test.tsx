/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRouterPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows generic error on fetch failure", async () => {
    const LandingPage = await importComponent();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const user = userEvent.setup();
    render(<LandingPage />);

    await user.type(screen.getByPlaceholderText("Password"), "somepass");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("An error occurred. Please try again.")).toBeInTheDocument();
    });
  });

  it("calls router.push('/onboarding/workspace') on correct password", async () => {
    const LandingPage = await importComponent();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true }),
    });

    const user = userEvent.setup();
    render(<LandingPage />);

    await user.type(screen.getByPlaceholderText("Password"), "correctpass");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/onboarding/workspace");
    });
  });

  it("Continue button is disabled when password is empty", async () => {
    const LandingPage = await importComponent();
    render(<LandingPage />);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("shows loading state while verifying", async () => {
    const LandingPage = await importComponent();
    // Never resolves — keeps the component in loading state
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<LandingPage />);

    await user.type(screen.getByPlaceholderText("Password"), "somepass");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/verifying/i)).toBeInTheDocument();
    });
  });
});
