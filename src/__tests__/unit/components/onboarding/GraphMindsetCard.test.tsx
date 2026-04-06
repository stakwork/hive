// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { GraphMindsetCard } from "@/components/onboarding/GraphMindsetCard";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
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
  mockRouterPush.mockReset();
  localStorage.clear();
  // Default: first call is price endpoint, subsequent calls return empty
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/config/price")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ amountUsd: 50 }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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
  const input = screen.getByPlaceholderText("Workspace name");
  fireEvent.change(input, { target: { value } });
  await act(async () => { vi.advanceTimersByTime(600); });
}

function priceResponse(amountUsd = 50) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ amountUsd }),
  });
}

/** Helper: fill valid form and wait for "available" message */
async function fillValidForm(name = "my-graph") {
  vi.useFakeTimers();
  // First fetch on mount is the price endpoint, second is slug availability
  mockFetch.mockReturnValueOnce(priceResponse());
  mockFetch.mockReturnValueOnce(availableSlugResponse());
  render(<GraphMindsetCard />);
  await fillName(name);
  vi.useRealTimers();
  await waitFor(() => expect(screen.getByText(/Name is available/i)).toBeInTheDocument());
}

describe("GraphMindsetCard", () => {
  it("renders price dynamically from API", async () => {
    render(<GraphMindsetCard />);
    await waitFor(() => expect(screen.getByText("$50")).toBeInTheDocument());
    expect(screen.getByText("/ workspace")).toBeInTheDocument();
  });

  it("renders GraphMindset title and description", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("GraphMindset")).toBeInTheDocument();
    expect(screen.getByText(/Build an AI-powered knowledge graph/i)).toBeInTheDocument();
  });

  it("renders feature bullets", () => {
    render(<GraphMindsetCard />);
    expect(screen.getByText("Graph-based code exploration")).toBeInTheDocument();
    expect(screen.getByText("Team collaboration workspace")).toBeInTheDocument();
    expect(screen.getByText("Persistent knowledge store")).toBeInTheDocument();
    expect(screen.getByText("AI-powered graph insights")).toBeInTheDocument();
  });

  it("renders 'Build Graph' button that is disabled when name is empty", () => {
    render(<GraphMindsetCard />);
    const button = screen.getByRole("button", { name: /build graph/i });
    expect(button).toBeDisabled();
  });

  it("button remains disabled while name is being validated (isValidating)", async () => {
    vi.useFakeTimers();
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<GraphMindsetCard />);
    await fillName("my-graph");
    const button = screen.getByRole("button", { name: /build graph/i });
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
    expect(screen.getByRole("button", { name: /build graph/i })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: /build graph/i })).not.toBeDisabled();
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

  it("shows payment options after clicking 'Create my graph' with valid form", async () => {
    await fillValidForm();

    const createBtn = screen.getByRole("button", { name: /build graph/i });
    await act(async () => { fireEvent.click(createBtn); });

    expect(screen.getByRole("button", { name: /pay with card/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay with lightning/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build graph/i })).not.toBeInTheDocument();
  });

  it("stores name in localStorage and redirects to Stripe when 'Pay with Card' is clicked", async () => {
    await fillValidForm();

    const createBtn = screen.getByRole("button", { name: /build graph/i });
    await act(async () => { fireEvent.click(createBtn); });

    // Stripe checkout
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: "https://checkout.stripe.com/pay/test", sessionId: "cs_test_123" }),
    });

    const cardBtn = screen.getByRole("button", { name: /pay with card/i });
    await act(async () => { fireEvent.click(cardBtn); });

    await waitFor(() => {
      expect(window.location.href).toBe("https://checkout.stripe.com/pay/test");
    });
    // sessionId is now stored in an httpOnly cookie by the checkout API, not localStorage
    expect(localStorage.getItem("graphMindsetWorkspaceName")).toBe("my-graph");

    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/stripe/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workspaceName: "my-graph", workspaceSlug: "my-graph" }),
      })
    );
  });

  it("stores localStorage keys and calls router.push when 'Pay with Lightning' is clicked", async () => {
    await fillValidForm();

    const createBtn = screen.getByRole("button", { name: /build graph/i });
    await act(async () => { fireEvent.click(createBtn); });

    const lightningBtn = screen.getByRole("button", { name: /pay with lightning/i });
    await act(async () => { fireEvent.click(lightningBtn); });

    expect(localStorage.getItem("graphMindsetWorkspaceName")).toBe("my-graph");
    expect(localStorage.getItem("graphMindsetWorkspaceSlug")).toBe("my-graph");
    expect(mockRouterPush).toHaveBeenCalledWith("/onboarding/lightning-payment");
  });

  it("redirects to Stripe and stores sessionId + name in localStorage on success", async () => {
    await fillValidForm();

    const createBtn = screen.getByRole("button", { name: /build graph/i });
    await act(async () => { fireEvent.click(createBtn); });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: "https://checkout.stripe.com/pay/test", sessionId: "cs_test_123" }),
    });

    const cardBtn = screen.getByRole("button", { name: /pay with card/i });
    await act(async () => { fireEvent.click(cardBtn); });

    await waitFor(() => {
      expect(window.location.href).toBe("https://checkout.stripe.com/pay/test");
    });
    // sessionId is now stored in an httpOnly cookie by the checkout API, not localStorage
    expect(localStorage.getItem("graphMindsetWorkspaceName")).toBe("my-graph");
    expect(localStorage.getItem("graphMindsetWorkspaceId")).toBeNull();

    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/stripe/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workspaceName: "my-graph", workspaceSlug: "my-graph" }),
      })
    );
  });

  it("shows inline error on Stripe session creation failure", async () => {
    await fillValidForm();

    const createBtn = screen.getByRole("button", { name: /build graph/i });
    await act(async () => { fireEvent.click(createBtn); });

    // Stripe checkout fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Stripe error" }),
    });

    const cardBtn = screen.getByRole("button", { name: /pay with card/i });
    await act(async () => { fireEvent.click(cardBtn); });

    await waitFor(() => {
      expect(screen.getByText("Stripe error")).toBeInTheDocument();
    });
  });
});
