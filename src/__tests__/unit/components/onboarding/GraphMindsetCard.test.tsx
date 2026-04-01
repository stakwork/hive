// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { GraphMindsetCard } from "@/components/onboarding/GraphMindsetCard";

vi.mock("@/components/onboarding/GraphNetworkIcon", () => ({
  GraphNetworkIcon: () => <div data-testid="graph-network-icon" />,
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
  // Default fallback response
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  });
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

/** Helper: type into the name field and advance the debounce timer */
async function fillName(value: string) {
  const input = screen.getByPlaceholderText("e.g., my-api-graph");
  fireEvent.change(input, { target: { value } });
  await act(async () => { vi.advanceTimersByTime(600); });
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
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<GraphMindsetCard />);
    await fillName("my-graph");
    const button = screen.getByRole("button", { name: /create my graph/i });
    expect(button).toBeDisabled();
  });

  it("button remains disabled when slug is taken", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValue(takenSlugResponse());
    render(<GraphMindsetCard />);
    await fillName("taken");
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.getByText("Name is already taken")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /create my graph/i })).toBeDisabled();
  });

  it("button is enabled when slug is available", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValue(availableSlugResponse());
    render(<GraphMindsetCard />);
    await fillName("my-graph");
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.getByText(/Name is available/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /create my graph/i })).not.toBeDisabled();
  });

  it("shows inline error for taken slug", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValue(takenSlugResponse());
    render(<GraphMindsetCard />);
    await fillName("taken");
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.getByText("Name is already taken")).toBeInTheDocument();
    });
  });

  it("stores name in localStorage and redirects to Stripe on success", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValueOnce(availableSlugResponse());
    render(<GraphMindsetCard />);

    await fillName("my-graph");
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText(/Name is available/i)).toBeInTheDocument());

    // Stripe checkout
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: "https://checkout.stripe.com/pay/test", sessionId: "cs_test_123" }),
    });

    const button = screen.getByRole("button", { name: /create my graph/i });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => {
      expect(window.location.href).toBe("https://checkout.stripe.com/pay/test");
    });
    expect(localStorage.getItem("graphMindsetSessionId")).toBe("cs_test_123");
    expect(localStorage.getItem("graphMindsetWorkspaceName")).toBe("my-graph");

    // Two fetches: slug check + Stripe checkout
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/stripe/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workspaceName: "my-graph", workspaceSlug: "my-graph" }),
      })
    );
  });

  it("redirects to Stripe and stores sessionId + name in localStorage on success", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValueOnce(availableSlugResponse());
    render(<GraphMindsetCard />);

    const input = screen.getByPlaceholderText("e.g., my-api-graph");
    fireEvent.change(input, { target: { value: "my-graph" } });
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText(/Name is available/i)).toBeInTheDocument());

    // Stripe checkout
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: "https://checkout.stripe.com/pay/test", sessionId: "cs_test_123" }),
    });

    const button = screen.getByRole("button", { name: /create my graph/i });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => {
      expect(window.location.href).toBe("https://checkout.stripe.com/pay/test");
    });
    expect(localStorage.getItem("graphMindsetSessionId")).toBe("cs_test_123");
    expect(localStorage.getItem("graphMindsetWorkspaceName")).toBe("my-graph");
    expect(localStorage.getItem("graphMindsetWorkspaceId")).toBeNull();

    // Two fetches: slug check + Stripe checkout (no fork config, no workspace creation)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/stripe/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workspaceName: "my-graph", workspaceSlug: "my-graph" }),
      })
    );
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

    // Stripe checkout fails
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
});
