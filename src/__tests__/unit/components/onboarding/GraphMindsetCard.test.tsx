// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { GraphMindsetCard } from "@/components/onboarding/GraphMindsetCard";

vi.mock("@/components/onboarding/GraphNetworkIcon", () => ({
  GraphNetworkIcon: () => <div data-testid="graph-network-icon" />,
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: "user-1" } } })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Suppress window.location.href assignment errors in jsdom
const originalLocation = window.location;
beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "" },
  });
  mockFetch.mockReset();
  localStorage.clear();
});
afterEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: originalLocation,
  });
  vi.useRealTimers();
});

function availableSlugResponse() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: { isAvailable: true, slug: "my-graph" } }),
  });
}

function takenSlugResponse() {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({ data: { isAvailable: false, slug: "taken", message: "Name is already taken" } }),
  });
}

describe("GraphMindsetCard", () => {
  it("renders left panel with $50 price badge", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("/ workspace")).toBeInTheDocument();
  });

  it("renders left panel with GraphMindset title and subtitle", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("GraphMindset")).toBeInTheDocument();
    expect(screen.getByText("Build a knowledge graph from your codebase")).toBeInTheDocument();
  });

  it("renders right panel with all three feature bullets", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("Automatic code graph indexing")).toBeInTheDocument();
    expect(screen.getByText("AI-powered codebase queries")).toBeInTheDocument();
    expect(screen.getByText("Real-time graph updates on push")).toBeInTheDocument();
  });

  it("renders 'Create my graph' button that is disabled when name is empty", () => {
    render(<GraphMindsetCard />);
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).toBeDisabled();
  });

  it("button remains disabled while name is being validated (isValidating)", async () => {
    vi.useFakeTimers();
    // fetch won't resolve until we advance timers
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<GraphMindsetCard />);
    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "my-graph" } });
    // advance past debounce
    await act(async () => { vi.advanceTimersByTime(600); });
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).toBeDisabled();
  });

  it("button remains disabled when slug is taken", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValue(takenSlugResponse());
    render(<GraphMindsetCard />);
    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "taken" } });
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.getByText("Name is already taken")).toBeInTheDocument();
    });
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).toBeDisabled();
  });

  it("button is enabled when slug is available", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValue(availableSlugResponse());
    render(<GraphMindsetCard />);
    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "my-graph" } });
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.getByText(/Name is available/i)).toBeInTheDocument();
    });
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).not.toBeDisabled();
  });

  it("shows inline error for invalid/taken slug", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValue(takenSlugResponse());
    render(<GraphMindsetCard />);
    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "taken" } });
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.getByText("Name is already taken")).toBeInTheDocument();
    });
  });

  it("sets window.location.href to sessionUrl on successful flow", async () => {
    vi.useFakeTimers();
    // Slug availability
    mockFetch.mockReturnValueOnce(availableSlugResponse());
    render(<GraphMindsetCard />);

    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "my-graph" } });
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText(/Name is available/i)).toBeInTheDocument());

    // Workspace creation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ workspace: { id: "ws-123" } }),
    });
    // Stripe checkout
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: "https://checkout.stripe.com/pay/test" }),
    });

    const button = screen.getByRole("button", { name: /create my graph/i });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => {
      expect(window.location.href).toBe("https://checkout.stripe.com/pay/test");
    });
    expect(localStorage.getItem("graphMindsetWorkspaceId")).toBe("ws-123");
  });

  it("shows inline error on workspace creation failure", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValueOnce(availableSlugResponse());
    render(<GraphMindsetCard />);

    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "my-graph" } });
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText(/Name is available/i)).toBeInTheDocument());

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Workspace creation failed" }),
    });

    const button = screen.getByRole("button", { name: /create my graph/i });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => {
      expect(screen.getByText("Workspace creation failed")).toBeInTheDocument();
    });
  });

  it("shows inline error on Stripe session creation failure", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValueOnce(availableSlugResponse());
    render(<GraphMindsetCard />);

    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "my-graph" } });
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText(/Name is available/i)).toBeInTheDocument());

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ workspace: { id: "ws-456" } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Stripe error" }),
    });

    const button = screen.getByRole("button", { name: /create my graph/i });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => {
      expect(screen.getByText("Stripe error")).toBeInTheDocument();
    });
  });

  it("skips workspace creation and uses existingWorkspaceId when provided", async () => {
    // Only stripe checkout fetch should be called
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: "https://checkout.stripe.com/pay/existing" }),
    });

    render(<GraphMindsetCard existingWorkspaceId="ws-existing" />);

    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).not.toBeDisabled();

    await act(async () => { fireEvent.click(button); });

    await waitFor(() => {
      expect(window.location.href).toBe("https://checkout.stripe.com/pay/existing");
    });
    // Should have only made ONE fetch call (Stripe, not workspace creation)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/stripe/checkout",
      expect.objectContaining({ method: "POST" })
    );
  });
});
