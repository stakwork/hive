// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("date-fns", () => ({
  formatDistanceToNow: vi.fn(() => "2 hours ago"),
}));

vi.mock("lucide-react", () => ({
  Sparkles: () => React.createElement("svg", { "data-testid": "sparkles-icon" }),
  X: () => React.createElement("svg", { "data-testid": "x-icon" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...props }, children),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ── sessionStorage mock ───────────────────────────────────────────────────────

function makeStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
  };
}

let sessionStorageMock = makeStorageMock();

beforeEach(() => {
  sessionStorageMock = makeStorageMock();
  vi.stubGlobal("sessionStorage", sessionStorageMock);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Import after mocks ────────────────────────────────────────────────────────

import { DailyRecapCard } from "@/components/daily-recap/DailyRecapCard";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(body: { recap: string | null; generatedAt: string | null }) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

const RECAP_TEXT = "You merged 2 PRs and created 3 tasks yesterday.";
const GENERATED_AT = new Date().toISOString();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DailyRecapCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Basic render ─────────────────────────────────────────────────────────

  it("renders null (nothing in DOM) while loading", () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(<DailyRecapCard />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when API returns { recap: null }", async () => {
    mockFetch({ recap: null, generatedAt: null });
    const { container } = render(<DailyRecapCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("daily-recap-card")).toBeNull();
  });

  it("renders recap text when a recap is present", async () => {
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    render(<DailyRecapCard />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    expect(screen.getByText(RECAP_TEXT)).toBeInTheDocument();
  });

  // ── Heading ──────────────────────────────────────────────────────────────

  it("heading reads \"Recap\" (not \"Daily Recap\")", async () => {
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    render(<DailyRecapCard />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    expect(screen.getByText("Recap")).toBeInTheDocument();
    expect(screen.queryByText(/Daily Recap/i)).toBeNull();
  });

  // ── Timestamp ────────────────────────────────────────────────────────────

  it("shows relative timestamp without \"Generated\" prefix", async () => {
    mockFetch({ recap: "Solid day.", generatedAt: GENERATED_AT });
    render(<DailyRecapCard />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
    expect(screen.queryByText(/Generated/)).toBeNull();
  });

  it("does not show a timestamp line when generatedAt is null", async () => {
    mockFetch({ recap: "Solid day.", generatedAt: null });
    render(<DailyRecapCard />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    expect(screen.queryByText(/Generated/)).toBeNull();
    expect(screen.queryByText(/hours ago/)).toBeNull();
  });

  // ── dismissible ──────────────────────────────────────────────────────────

  it("renders X dismiss button when dismissible prop is set", async () => {
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    render(<DailyRecapCard dismissible />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("does not render X button when dismissible is not set", async () => {
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    render(<DailyRecapCard />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("clicking X hides the card and sets sessionStorage flag", async () => {
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    render(<DailyRecapCard dismissible />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByTestId("daily-recap-card")).toBeNull();
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith("hive:daily-recap-dismissed", "1");
  });

  it("stays hidden when sessionStorage flag is pre-set", async () => {
    sessionStorageMock.getItem.mockReturnValue("1");
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    const { container } = render(<DailyRecapCard dismissible />);
    // Give async effects time to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("daily-recap-card")).toBeNull();
  });

  // ── showActivityLink ─────────────────────────────────────────────────────

  it("renders \"My Activity\" link to /profile when showActivityLink is set", async () => {
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    render(<DailyRecapCard showActivityLink />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /My Activity/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("does not render \"My Activity\" link when showActivityLink is not set", async () => {
    mockFetch({ recap: RECAP_TEXT, generatedAt: GENERATED_AT });
    render(<DailyRecapCard />);
    await waitFor(() => expect(screen.getByTestId("daily-recap-card")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /My Activity/i })).toBeNull();
  });

  // ── Error / network ──────────────────────────────────────────────────────

  it("renders null when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const { container } = render(<DailyRecapCard />);
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
