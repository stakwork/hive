// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { GatewayView } from "@/app/org/[githubLogin]/_components/GatewayView";

const SEVEN_HOURS_MS = 7 * 60 * 60 * 1000;

const mockTicketResponse = (url = "https://gateway.example.com", ticket = "test-ticket-123") => ({
  url,
  ticket,
});

function makeIframeSrc(url: string, ticket: string) {
  return `${url}/_plugin/ui/?ticket=${encodeURIComponent(ticket)}`;
}

describe("GatewayView", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_000_000_000_000; // arbitrary fixed timestamp
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTicketResponse(),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows spinner while ticket is loading", async () => {
    // Never resolve fetch
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<GatewayView githubLogin="test-org" />);
    // Spinner is rendered (Loader2 wraps inside loading div)
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders iframe with correct src after successful ticket fetch", async () => {
    render(<GatewayView githubLogin="test-org" />);
    await waitFor(() => {
      expect(screen.getByTitle("Gateway admin")).toBeTruthy();
    });
    const iframe = screen.getByTitle("Gateway admin") as HTMLIFrameElement;
    expect(iframe.src).toBe(makeIframeSrc("https://gateway.example.com", "test-ticket-123"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows error UI when ticket fetch fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });
    render(<GatewayView githubLogin="test-org" />);
    await waitFor(() => {
      expect(screen.getByText("Gateway unavailable")).toBeTruthy();
      expect(screen.getByText("Service Unavailable")).toBeTruthy();
    });
  });

  it("elapsed < 7h → fetch called exactly once (no reload on visibility)", async () => {
    render(<GatewayView githubLogin="test-org" />);
    await waitFor(() => expect(screen.getByTitle("Gateway admin")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance time by less than 7 hours
    dateNowSpy.mockReturnValue(nowMs + SEVEN_HOURS_MS - 1);

    // Fire visibilitychange → visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Still only 1 fetch call
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("elapsed > 7h → fetch called again; spinner shown before new iframe src", async () => {
    render(<GatewayView githubLogin="test-org" />);
    await waitFor(() => expect(screen.getByTitle("Gateway admin")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance time past the threshold
    dateNowSpy.mockReturnValue(nowMs + SEVEN_HOURS_MS + 1);

    // Set up second fetch to resolve with a new ticket
    const newTicket = "fresh-ticket-456";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTicketResponse("https://gateway.example.com", newTicket),
      text: async () => "",
    });

    // Fire visibilitychange → visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Spinner should appear while re-fetching
    expect(document.querySelector(".animate-spin")).toBeTruthy();

    // Wait for new iframe to load
    await waitFor(() => {
      const iframe = screen.queryByTitle("Gateway admin") as HTMLIFrameElement | null;
      expect(iframe).toBeTruthy();
      expect(iframe?.src).toBe(makeIframeSrc("https://gateway.example.com", newTicket));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-mint failure after visibility event → error UI rendered (not blank iframe)", async () => {
    render(<GatewayView githubLogin="test-org" />);
    await waitFor(() => expect(screen.getByTitle("Gateway admin")).toBeTruthy());

    // Advance time past threshold
    dateNowSpy.mockReturnValue(nowMs + SEVEN_HOURS_MS + 1);

    // Second fetch fails
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "Bad Gateway",
    });

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(screen.getByText("Gateway unavailable")).toBeTruthy();
      expect(screen.getByText("Bad Gateway")).toBeTruthy();
    });

    // No stale iframe
    expect(screen.queryByTitle("Gateway admin")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("visibilitychange to hidden → no-op", async () => {
    render(<GatewayView githubLogin="test-org" />);
    await waitFor(() => expect(screen.getByTitle("Gateway admin")).toBeTruthy());

    dateNowSpy.mockReturnValue(nowMs + SEVEN_HOURS_MS + 1);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
