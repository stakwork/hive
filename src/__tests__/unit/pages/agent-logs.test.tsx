// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks ---

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockSearchParamsGet = vi.fn();
const mockSearchParamsToString = vi.fn(() => "");

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "test-workspace" }),
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
    toString: mockSearchParamsToString,
  }),
  usePathname: () => "/w/test-workspace/agent-logs",
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { name: "Test" }, id: "ws-1" }),
}));

vi.mock("@/components/agent-logs", () => ({
  AgentLogsTable: ({ onRowClick }: { onRowClick: (id: string) => void }) => (
    <button data-testid="row" onClick={() => onRowClick("log-abc")}>
      Row
    </button>
  ),
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: () => <div />,
}));

// Stub out all the heavy shadcn/ui pieces used in the page
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, asChild }: any) =>
    asChild ? <span>{children}</span> : <button onClick={onClick} disabled={disabled}>{children}</button>,
  buttonVariants: () => "",
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <div />,
}));
vi.mock("@/components/ui/pagination", () => ({
  Pagination: ({ children }: any) => <div>{children}</div>,
  PaginationContent: ({ children }: any) => <div>{children}</div>,
  PaginationEllipsis: () => <span>…</span>,
  PaginationItem: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div />,
}));
vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock("lucide-react", () => ({
  FileText: () => null,
  Search: () => null,
  ChevronLeft: () => null,
  ChevronRight: () => null,
  MessageSquare: () => null,
}));

// --- Import page after all mocks are set up ---
import AgentLogsPage from "@/app/w/[slug]/agent-logs/page";

// Helper: reset fetch to return an empty log list
function mockEmptyFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [], hasMore: false }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParamsGet.mockReturnValue(null);
  mockSearchParamsToString.mockReturnValue("");
  mockEmptyFetch();
});

// ---------------------------------------------------------------------------

describe("AgentLogsPage — debounce pagination guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("pagination stays on page 2 after 500ms with no search change", async () => {
    // Simulate page=2 already in URL
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "page" ? "2" : null
    );
    mockSearchParamsToString.mockReturnValue("page=2");

    render(<AgentLogsPage />);

    // Advance past the debounce timer — no search change should have occurred
    vi.advanceTimersByTime(600);

    // mockReplace should never have been called with page=1 or bare pathname
    const replaceCallsWithPage1 = mockReplace.mock.calls.filter((args) => {
      const url = args[0] as string;
      return url.includes("page=1") || url === "/w/test-workspace/agent-logs";
    });
    expect(replaceCallsWithPage1).toHaveLength(0);
  });

  test("typing in search resets to page 1", async () => {
    mockSearchParamsGet.mockReturnValue(null);
    mockSearchParamsToString.mockReturnValue("");

    const { getByPlaceholderText } = render(<AgentLogsPage />);

    // Advance past initial debounce (no keyword change → no reset)
    vi.advanceTimersByTime(600);
    mockReplace.mockClear();

    // Type in the search input
    const input = getByPlaceholderText("Search logs...");
    // Simulate a change event
    input.focus();
    // Fire a React change event
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, "new-search");
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(600);

    // Should have called replace without page param (i.e. page 1)
    const replaceCallsToPage1 = mockReplace.mock.calls.filter((args) => {
      const url = args[0] as string;
      return !url.includes("page=") || url.includes("page=1");
    });
    expect(replaceCallsToPage1.length).toBeGreaterThan(0);
  });

  test("no page reset on mount — debounce does not fire goToPage(1) on initial render", async () => {
    mockSearchParamsGet.mockReturnValue(null);
    mockSearchParamsToString.mockReturnValue("");

    render(<AgentLogsPage />);

    // Advance past debounce
    vi.advanceTimersByTime(600);

    // mockReplace should not have been called with a bare pathname or page=1
    const unwantedCalls = mockReplace.mock.calls.filter((args) => {
      const url = args[0] as string;
      return url === "/w/test-workspace/agent-logs" || url.includes("page=1");
    });
    expect(unwantedCalls).toHaveLength(0);
  });
});

describe("AgentLogsPage — goToPage stable reference", () => {
  test("goToPage does not snap back to page 1 when called sequentially", async () => {
    mockSearchParamsGet.mockReturnValue(null);
    mockSearchParamsToString.mockReturnValue("");

    const user = userEvent.setup();

    // Mock fetch to return 20 items (hasMore = true) so pagination buttons appear
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: Array.from({ length: 20 }, (_, i) => ({
          id: `log-${i}`,
          agent: "test-agent",
          blobUrl: "http://example.com/blob",
          stakworkRunId: null,
          taskId: null,
          featureId: null,
          featureTitle: null,
          createdAt: new Date().toISOString(),
        })),
        hasMore: true,
      }),
    });

    render(<AgentLogsPage />);

    // Wait for logs to load and Next button to appear
    await waitFor(() => expect(screen.getByText("Next")).toBeInTheDocument());

    // Simulate searchParams updating after goToPage(2) — as happens in the browser
    mockSearchParamsToString.mockReturnValue("page=2");
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "page" ? "2" : null
    );

    // Click Next
    await user.click(screen.getByText("Next"));

    // router.replace should have been called with page=2
    const calls = mockReplace.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes("page=2"))).toBe(true);

    // Critically: replace should NOT have been called with bare pathname (page reset)
    const resetCalls = calls.filter(
      (url) => url === "/w/test-workspace/agent-logs"
    );
    expect(resetCalls).toHaveLength(0);
  });
});

describe("AgentLogsPage — row click navigation", () => {
  test("clicking a row navigates to the full-page detail route", async () => {
    const user = userEvent.setup();
    render(<AgentLogsPage />);

    await waitFor(() => expect(screen.getByTestId("row")).toBeInTheDocument());

    await user.click(screen.getByTestId("row"));

    expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/agent-logs/log-abc");
  });

  test("no dialog is rendered after row click", async () => {
    const user = userEvent.setup();
    render(<AgentLogsPage />);

    await waitFor(() => expect(screen.getByTestId("row")).toBeInTheDocument());

    await user.click(screen.getByTestId("row"));

    // No dialog should be present — navigation happens instead
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });
});
