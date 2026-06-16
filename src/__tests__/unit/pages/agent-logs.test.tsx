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
  AgentLogsTable: ({
    onRowClick,
    showUserColumn,
    logs,
  }: {
    onRowClick: (id: string) => void;
    showUserColumn?: boolean;
    logs?: Array<{ id: string; initiatorName?: string | null; initiatorImage?: string | null }>;
  }) => (
    <div>
      {showUserColumn && <th data-testid="user-column-header">User</th>}
      {showUserColumn &&
        logs?.map((log) => (
          <div key={log.id} data-testid="user-avatar-cell">
            {log.initiatorName ?? "Anonymous"}
          </div>
        ))}
      <button data-testid="row" onClick={() => onRowClick("log-abc")}>
        Row
      </button>
    </div>
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
const TabsOnValueChangeCtx = React.createContext<((v: string) => void) | null>(null);
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, value, onValueChange }: any) => (
    <TabsOnValueChangeCtx.Provider value={onValueChange}>
      <div data-active-tab={value}>{children}</div>
    </TabsOnValueChangeCtx.Provider>
  ),
  TabsList: ({ children }: any) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children, value }: any) => {
    const onChange = React.useContext(TabsOnValueChangeCtx);
    return (
      <button role="tab" aria-label={children} onClick={() => onChange?.(value)} data-value={value}>
        {children}
      </button>
    );
  },
}));
vi.mock("lucide-react", () => ({
  FileText: () => null,
  Search: () => null,
  ChevronLeft: () => null,
  ChevronRight: () => null,
  MessageSquare: () => null,
  ExternalLink: () => null,
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

describe("AgentLogsPage — canvas tab showUserColumn", () => {
  function mockCanvasFetch(items: object[]) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("source=canvas")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items,
            pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 },
          }),
        });
      }
      // Default: empty agent logs
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [], hasMore: false }),
      });
    });
  }

  test("canvas tab passes showUserColumn=true to AgentLogsTable", async () => {
    const user = userEvent.setup();
    mockCanvasFetch([
      {
        id: "conv-1",
        title: "Canvas Chat",
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        preview: null,
        source: "org-canvas",
        isShared: false,
        creatorId: "user-1",
        creatorName: "Alice Smith",
        creatorImage: "https://example.com/alice.png",
      },
    ]);

    render(<AgentLogsPage />);

    // Switch to Canvas tab
    const canvasTab = screen.getByRole("tab", { name: /canvas/i });
    await user.click(canvasTab);

    // User column header should be rendered (showUserColumn=true)
    await waitFor(() =>
      expect(screen.getByTestId("user-column-header")).toBeInTheDocument()
    );

    // Avatar cell should show initiator name
    await waitFor(() =>
      expect(screen.getByTestId("user-avatar-cell")).toHaveTextContent("Alice Smith")
    );
  });

  test("anonymous canvas sessions render fallback text", async () => {
    const user = userEvent.setup();
    mockCanvasFetch([
      {
        id: "conv-anon",
        title: "Anonymous Canvas Chat",
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        preview: null,
        source: "org-canvas",
        isShared: false,
        creatorId: undefined,
        creatorName: null,
        creatorImage: null,
      },
    ]);

    render(<AgentLogsPage />);

    const canvasTab = screen.getByRole("tab", { name: /canvas/i });
    await user.click(canvasTab);

    // Avatar cell should show "Anonymous" fallback
    await waitFor(() =>
      expect(screen.getByTestId("user-avatar-cell")).toHaveTextContent("Anonymous")
    );
  });

  test("chats tab does NOT render user column header (showUserColumn defaults false)", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/chat/conversations")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                id: "chat-1",
                title: "My Chat",
                lastMessageAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                preview: null,
                source: null,
                isShared: false,
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          }),
        });
      }
      // Agent logs endpoint
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [], hasMore: false }),
      });
    });

    render(<AgentLogsPage />);

    const chatsTab = screen.getByRole("tab", { name: /chats/i });
    await user.click(chatsTab);

    // User column header should NOT be rendered for chats tab
    await waitFor(() => expect(screen.getByTestId("row")).toBeInTheDocument());
    expect(screen.queryByTestId("user-column-header")).not.toBeInTheDocument();
  });
});

