import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks ---

const mockReplace = vi.fn();
const mockSearchParamsGet = vi.fn();
const mockSearchParamsToString = vi.fn(() => "");

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "test-workspace" }),
  useRouter: () => ({ replace: mockReplace }),
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

vi.mock("@/components/agent-logs/LogDetailDialog", () => ({
  LogDetailDialog: ({
    open,
    onOpenChange,
    logId,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    logId: string | null;
  }) => (
    <div>
      {open && (
        <div data-testid="dialog">
          <span data-testid="dialog-log-id">{logId}</span>
          <button data-testid="close-dialog" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </div>
      )}
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

describe("AgentLogsPage — URL param sync", () => {
  test("initialises dialogOpen=false and selectedLogId=null when no logId param", async () => {
    render(<AgentLogsPage />);

    // Dialog should not be open
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  test("initialises dialogOpen=true and shows logId when searchParams has logId", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "logId" ? "existing-log-id" : null
    );
    mockSearchParamsToString.mockReturnValue("logId=existing-log-id");

    render(<AgentLogsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("dialog-log-id")).toHaveTextContent("existing-log-id");
    });
  });

  test("handleRowClick sets logId in URL and opens dialog", async () => {
    const user = userEvent.setup();
    render(<AgentLogsPage />);

    await waitFor(() => expect(screen.getByTestId("row")).toBeInTheDocument());

    await user.click(screen.getByTestId("row"));

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("logId=log-abc"),
      { scroll: false }
    );
    expect(screen.getByTestId("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-log-id")).toHaveTextContent("log-abc");
  });

  test("handleRowClick preserves existing URL params alongside logId", async () => {
    mockSearchParamsToString.mockReturnValue("page=3");
    const user = userEvent.setup();
    render(<AgentLogsPage />);

    await waitFor(() => expect(screen.getByTestId("row")).toBeInTheDocument());

    await user.click(screen.getByTestId("row"));

    const calledUrl = mockReplace.mock.calls[0][0] as string;
    expect(calledUrl).toContain("page=3");
    expect(calledUrl).toContain("logId=log-abc");
  });

  test("handleDialogOpenChange(false) removes logId from URL", async () => {
    const user = userEvent.setup();
    // Start with logId already in URL so dialog is open
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "logId" ? "log-abc" : null
    );
    mockSearchParamsToString.mockReturnValue("logId=log-abc");

    render(<AgentLogsPage />);

    await waitFor(() => expect(screen.getByTestId("dialog")).toBeInTheDocument());

    // Close the dialog
    await user.click(screen.getByTestId("close-dialog"));

    const lastCall = mockReplace.mock.calls[mockReplace.mock.calls.length - 1];
    const calledUrl = lastCall[0] as string;
    expect(calledUrl).not.toContain("logId");
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  test("handleDialogOpenChange(false) preserves other params when removing logId", async () => {
    const user = userEvent.setup();
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === "logId") return "log-abc";
      return null;
    });
    mockSearchParamsToString.mockReturnValue("page=2&logId=log-abc");

    render(<AgentLogsPage />);

    await waitFor(() => expect(screen.getByTestId("dialog")).toBeInTheDocument());

    await user.click(screen.getByTestId("close-dialog"));

    const lastCall = mockReplace.mock.calls[mockReplace.mock.calls.length - 1];
    const calledUrl = lastCall[0] as string;
    expect(calledUrl).toContain("page=2");
    expect(calledUrl).not.toContain("logId");
  });

  test("handleDialogOpenChange(false) navigates to bare pathname when no params remain", async () => {
    const user = userEvent.setup();
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "logId" ? "log-abc" : null
    );
    // Only logId in params — after deletion the string is empty
    mockSearchParamsToString.mockReturnValue("logId=log-abc");

    render(<AgentLogsPage />);

    await waitFor(() => expect(screen.getByTestId("dialog")).toBeInTheDocument());

    await user.click(screen.getByTestId("close-dialog"));

    const lastCall = mockReplace.mock.calls[mockReplace.mock.calls.length - 1];
    expect(lastCall[0]).toBe("/w/test-workspace/agent-logs");
  });
});
