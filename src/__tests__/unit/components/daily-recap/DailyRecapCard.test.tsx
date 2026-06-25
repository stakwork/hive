// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("date-fns", () => ({
  formatDistanceToNow: vi.fn(() => "2 hours ago"),
}));

vi.mock("lucide-react", () => ({
  Sparkles: () => React.createElement("svg", { "data-testid": "sparkles-icon" }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ── Import after mocks ────────────────────────────────────────────────────────

import { DailyRecapCard } from "@/components/daily-recap/DailyRecapCard";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(body: { recap: string | null; generatedAt: string | null }) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DailyRecapCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders null (nothing in DOM) while loading", () => {
    // fetch never resolves during this test
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(<DailyRecapCard />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when API returns { recap: null }", async () => {
    mockFetch({ recap: null, generatedAt: null });
    const { container } = render(<DailyRecapCard />);
    // After the promise resolves, the card should still not appear
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("daily-recap-card")).toBeNull();
  });

  it("renders recap text when a recap is present", async () => {
    mockFetch({
      recap: "You merged 2 PRs and created 3 tasks yesterday.",
      generatedAt: new Date().toISOString(),
    });

    render(<DailyRecapCard />);

    await waitFor(() =>
      expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument(),
    );

    expect(
      screen.getByText("You merged 2 PRs and created 3 tasks yesterday."),
    ).toBeInTheDocument();
  });

  it("shows the relative timestamp when generatedAt is present", async () => {
    mockFetch({
      recap: "Solid day.",
      generatedAt: new Date().toISOString(),
    });

    render(<DailyRecapCard />);

    await waitFor(() =>
      expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument(),
    );

    expect(screen.getByText(/Generated 2 hours ago/)).toBeInTheDocument();
  });

  it("does not show a timestamp line when generatedAt is null", async () => {
    mockFetch({ recap: "Solid day.", generatedAt: null });

    render(<DailyRecapCard />);

    await waitFor(() =>
      expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument(),
    );

    expect(screen.queryByText(/Generated/)).toBeNull();
  });

  it("renders null when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const { container } = render(<DailyRecapCard />);
    // Give any microtasks a chance to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });

  it("renders null when fetch returns a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    const { container } = render(<DailyRecapCard />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });

  it("calls the correct endpoint", async () => {
    mockFetch({ recap: null, generatedAt: null });
    render(<DailyRecapCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/user/daily-recap");
  });
});
