// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

globalThis.React = React;

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();
const mockSearchParamsGet = vi.fn(() => null);
const mockSearchParamsToString = vi.fn(() => "");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
    toString: mockSearchParamsToString,
  }),
  usePathname: () => "/w/test-workspace/whiteboards",
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: "user-1", name: "Test User" } } })),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({ id: "workspace-1", slug: "test-workspace", role: "OWNER" })),
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, size, className }: any) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardHeader: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock("@/components/features/TableColumnHeaders", () => ({
  FilterDropdownHeader: ({ label, onChange, value }: any) => (
    <button data-testid={`filter-${label}`} onClick={() => onChange("ALL")}>
      {label}: {value}
    </button>
  ),
  SortableColumnHeader: ({ label, onSort }: any) => (
    <button data-testid={`sort-${label}`} onClick={() => onSort("desc")}>
      {label}
    </button>
  ),
}));

vi.mock("@/components/whiteboard/MoveWhiteboardDialog", () => ({
  MoveWhiteboardDialog: () => null,
}));

vi.mock("@/components/ui/pagination", () => ({
  Pagination: ({ children }: any) => <nav>{children}</nav>,
  PaginationContent: ({ children }: any) => <ul>{children}</ul>,
  PaginationItem: ({ children }: any) => <li>{children}</li>,
  PaginationLink: ({ children, onClick }: any) => <a href="#" onClick={onClick}>{children}</a>,
  PaginationPrevious: ({ onClick }: any) => <a href="#" onClick={onClick}>Prev</a>,
  PaginationNext: ({ onClick }: any) => <a href="#" onClick={onClick}>Next</a>,
  PaginationEllipsis: () => <span>...</span>,
}));

// Shared ref so AlertDialogCancel can call the parent's onOpenChange
let _alertDialogOnOpenChange: ((open: boolean) => void) | null = null;

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open, onOpenChange }: any) => {
    _alertDialogOnOpenChange = onOpenChange;
    return open ? <div role="dialog">{children}</div> : null;
  },
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid="confirm-delete">
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children, disabled }: any) => (
    <button
      disabled={disabled}
      data-testid="cancel-delete"
      onClick={() => _alertDialogOnOpenChange?.(false)}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  DropdownMenuItem: ({ children, onClick, className }: any) => (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div>{children}</div>,
  AvatarImage: ({ src }: any) => <img src={src} alt="" />,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

const mockWhiteboards = [
  {
    id: "wb-1",
    name: "Test Whiteboard 1",
    featureId: null,
    feature: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    createdBy: { id: "user-1", name: "Test User", image: null },
  },
  {
    id: "wb-2",
    name: "Test Whiteboard 2",
    featureId: null,
    feature: null,
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-04T00:00:00Z",
    createdBy: { id: "user-2", name: "Another User", image: null },
  },
];

const pagination = { totalPages: 1, total: 2, page: 1, limit: 24 };

function makeFetchMock(deleteOk = true) {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (options?.method === "DELETE") {
      return Promise.resolve({ ok: deleteOk, json: () => Promise.resolve({ success: deleteOk }) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockWhiteboards, pagination }),
    });
  });
}

async function renderPage() {
  const { default: WhiteboardsPage } = await import("@/app/w/[slug]/whiteboards/page");
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<WhiteboardsPage />);
  });
  await waitFor(() => {
    expect(screen.queryByText("Test Whiteboard 1")).toBeTruthy();
  });
  return result!;
}

describe("WhiteboardsPage — delete button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockSearchParamsToString.mockReturnValue("");
    global.fetch = makeFetchMock() as any;
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      },
      writable: true,
    });
  });

  it("calls e.preventDefault() and e.stopPropagation() and sets deleteId when delete button is clicked", async () => {
    await renderPage();

    const deleteButtons = screen.getAllByText("Delete");
    expect(deleteButtons.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  it("opens delete dialog without navigating when delete button is clicked", async () => {
    await renderPage();

    const deleteButtons = screen.getAllByText("Delete");
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByText("Delete whiteboard?")).toBeTruthy();
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("does not open delete dialog when clicking the card body link", async () => {
    await renderPage();

    const cardLink = screen.getByText("Test Whiteboard 1").closest("a");
    expect(cardLink).toBeTruthy();

    await act(async () => {
      fireEvent.click(cardLink!);
    });

    expect(screen.queryByText("Delete whiteboard?")).toBeNull();
  });

  it("removes the whiteboard from the list after confirming deletion", async () => {
    global.fetch = makeFetchMock(true) as any;

    await renderPage();

    const deleteButtons = screen.getAllByText("Delete");
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("confirm-delete")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-delete"));
    });

    await waitFor(() => {
      expect(screen.queryByText("Test Whiteboard 1")).toBeNull();
    });
  });

  it("keeps the whiteboard list intact and closes dialog on cancel", async () => {
    await renderPage();

    const deleteButtons = screen.getAllByText("Delete");
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("cancel-delete")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("cancel-delete"));
    });

    await waitFor(() => {
      expect(screen.queryByText("Delete whiteboard?")).toBeNull();
    });

    expect(screen.getByText("Test Whiteboard 1")).toBeTruthy();
  });
});
