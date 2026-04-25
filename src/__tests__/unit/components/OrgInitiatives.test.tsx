// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock @dnd-kit so we don't need a full DnD environment in unit tests
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: "closestCenter",
  PointerSensor: class {},
  KeyboardSensor: class {},
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
  verticalListSortingStrategy: "verticalListSortingStrategy",
  arrayMove: vi.fn((arr: unknown[], from: number, to: number) => {
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    result.splice(to, 0, removed);
    return result;
  }),
  sortableKeyboardCoordinates: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: vi.fn(() => "") } },
}));

vi.mock("@/hooks/useReorderMilestones", () => ({
  useReorderMilestones: vi.fn(() => ({
    sensors: [],
    milestoneIds: [],
    handleDragEnd: vi.fn(),
    collisionDetection: "closestCenter",
  })),
}));

vi.mock("@/lib/date-utils", () => ({
  formatRelativeOrDate: (v: string) => v,
}));

// Minimal shadcn/ui stubs — render children transparently
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogAction: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant: _v,
    size: _s,
    className: _c,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; children: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      data-testid="select"
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    (props, ref) => <textarea ref={ref} {...props} />
  ),
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({
    children,
    onClick,
    className,
    style,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <tr onClick={onClick} className={className} style={style}>
      {children}
    </tr>
  ),
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({
    children,
    colSpan,
    onClick,
  }: {
    children: React.ReactNode;
    colSpan?: number;
    onClick?: () => void;
  }) => (
    <td colSpan={colSpan} onClick={onClick}>
      {children}
    </td>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild: _a }: { children: React.ReactNode; asChild?: boolean }) => (
    <div data-testid="dropdown-trigger">{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button data-testid="dropdown-item" onClick={onClick}>
      {children}
    </button>
  ),
}));

// Mock lucide icons
vi.mock("lucide-react", () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  GripVertical: () => <span data-testid="grip-vertical" />,
  MoreHorizontal: () => <span data-testid="more-horizontal" />,
  Pencil: () => <span data-testid="pencil" />,
  Plus: () => <span data-testid="plus" />,
  Trash2: () => <span data-testid="trash2" />,
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

import type { MilestoneResponse, InitiativeResponse } from "@/types/initiatives";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeMilestone(overrides: Partial<MilestoneResponse> = {}): MilestoneResponse {
  return {
    id: "m-1",
    initiativeId: "ini-1",
    name: "Milestone 1",
    description: null,
    status: "NOT_STARTED",
    sequence: 1,
    dueDate: null,
    completedAt: null,
    assignee: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInitiative(milestones: MilestoneResponse[] = []): InitiativeResponse {
  return {
    id: "ini-1",
    orgId: "org-1",
    name: "Test Initiative",
    description: null,
    status: "ACTIVE",
    assignee: null,
    startDate: null,
    targetDate: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    milestones,
  };
}

// ── Import after mocks are set up ─────────────────────────────────────────────

// We test via the OrgInitiatives component which renders MilestoneDialog and MilestonesTable
import { OrgInitiatives } from "@/app/org/[githubLogin]/OrgInitiatives";

// ── MilestoneDialog tests (via OrgInitiatives integration) ─────────────────

describe("MilestoneDialog – auto-sequence and duplicate guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pre-fills sequence with nextSequence (max + 1) when milestones exist", async () => {
    const initiative = makeInitiative([
      makeMilestone({ id: "m-1", sequence: 1 }),
      makeMilestone({ id: "m-2", sequence: 2 }),
      makeMilestone({ id: "m-3", sequence: 3 }),
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([initiative]),
    });

    const user = userEvent.setup();
    render(<OrgInitiatives githubLogin="test-org" />);

    // Wait for initiatives to load
    await waitFor(() => screen.getByText("Test Initiative"));

    // Expand the initiative row
    await user.click(screen.getByText("Test Initiative"));

    // Click "Add Milestone"
    await user.click(screen.getByRole("button", { name: /add milestone/i }));

    // The sequence input should be pre-filled with 4 (max 3 + 1)
    const seqInput = screen.getByLabelText(/sequence/i);
    expect((seqInput as HTMLInputElement).value).toBe("4");
  });

  it("pre-fills sequence with 1 when no milestones exist", async () => {
    const initiative = makeInitiative([]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([initiative]),
    });

    const user = userEvent.setup();
    render(<OrgInitiatives githubLogin="test-org" />);

    await waitFor(() => screen.getByText("Test Initiative"));
    await user.click(screen.getByText("Test Initiative"));
    await user.click(screen.getByRole("button", { name: /add milestone/i }));

    const seqInput = screen.getByLabelText(/sequence/i);
    expect((seqInput as HTMLInputElement).value).toBe("1");
  });

  it("shows inline error and blocks submission when sequence is already in use", async () => {
    const initiative = makeInitiative([
      makeMilestone({ id: "m-1", sequence: 1 }),
      makeMilestone({ id: "m-2", sequence: 2 }),
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([initiative]),
    });

    const user = userEvent.setup();
    render(<OrgInitiatives githubLogin="test-org" />);

    await waitFor(() => screen.getByText("Test Initiative"));
    await user.click(screen.getByText("Test Initiative"));

    // Click the "Add Milestone" table button (not the dialog submit)
    const addBtn = screen.getByRole("button", { name: /add milestone/i });
    await user.click(addBtn);

    // Fill in name
    await user.type(screen.getByLabelText(/name \*/i), "New Milestone");

    // Change sequence to 1 (already used)
    const seqInput = screen.getByLabelText(/sequence \*/i);
    await user.clear(seqInput);
    await user.type(seqInput, "1");

    // Click dialog submit button (last "Add Milestone" button — table + dialog both visible)
    const allAddBtns = screen.getAllByRole("button", { name: /add milestone/i });
    await user.click(allAddBtns[allAddBtns.length - 1]);

    // Error should appear
    await waitFor(() =>
      expect(screen.getByText(/sequence already in use/i)).toBeDefined()
    );

    // fetch should NOT have been called with POST (only the initial GET)
    const postCalls = mockFetch.mock.calls.filter((c) => c[1]?.method === "POST");
    expect(postCalls).toHaveLength(0);
  });

  it("clears error when sequence is changed to a valid value", async () => {
    const initiative = makeInitiative([
      makeMilestone({ id: "m-1", sequence: 1 }),
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([initiative]),
    });

    const user = userEvent.setup();
    render(<OrgInitiatives githubLogin="test-org" />);

    await waitFor(() => screen.getByText("Test Initiative"));
    await user.click(screen.getByText("Test Initiative"));

    const addBtn = screen.getByRole("button", { name: /add milestone/i });
    await user.click(addBtn);

    await user.type(screen.getByLabelText(/name \*/i), "New Milestone");

    // Enter duplicate sequence
    const seqInput = screen.getByLabelText(/sequence \*/i);
    await user.clear(seqInput);
    await user.type(seqInput, "1");
    const allAddBtns = screen.getAllByRole("button", { name: /add milestone/i });
    await user.click(allAddBtns[allAddBtns.length - 1]);

    await waitFor(() => screen.getByText(/sequence already in use/i));

    // Now fix it by changing to a unique value
    await user.clear(seqInput);
    await user.type(seqInput, "5");

    // Error should be gone
    expect(screen.queryByText(/sequence already in use/i)).toBeNull();
  });

  it("excludes current milestone's own sequence from usedSequences in edit mode", async () => {
    const m1 = makeMilestone({ id: "m-1", sequence: 1, name: "Alpha" });
    const m2 = makeMilestone({ id: "m-2", sequence: 2, name: "Beta" });
    const initiative = makeInitiative([m1, m2]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([initiative]),
    });
    // Mock successful PATCH
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ...m1, sequence: 1 }),
    });

    const user = userEvent.setup();
    render(<OrgInitiatives githubLogin="test-org" />);

    await waitFor(() => screen.getByText("Test Initiative"));
    // Expand initiative row by clicking the name text
    await user.click(screen.getByText("Test Initiative"));

    // Click the pencil (edit) button for m-1 (first pencil = initiative edit, skip it)
    // Initiative pencil is in the main table, milestone pencils are in the expanded table
    // There are 3 pencil icons: initiative + 2 milestones
    const editButtons = screen.getAllByTestId("pencil");
    // editButtons[0] = initiative edit; [1] = Alpha edit; [2] = Beta edit
    await user.click(editButtons[1]); // Alpha

    // The dialog should open with sequence = 1 (m-1's own sequence)
    await waitFor(() => screen.getByLabelText(/sequence \*/i));
    const seqInput = screen.getByLabelText(/sequence \*/i);
    expect((seqInput as HTMLInputElement).value).toBe("1");

    // Submitting with sequence=1 (own value) should NOT trigger duplicate error
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    // No error message
    expect(screen.queryByText(/sequence already in use/i)).toBeNull();
  });
});

// ── Delete with renumber tests ─────────────────────────────────────────────

describe("MilestonesTable – delete with ?renumber=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls DELETE ?renumber=true and updates milestones with returned siblings", async () => {
    const m1 = makeMilestone({ id: "m-1", sequence: 1, name: "Alpha" });
    const m2 = makeMilestone({ id: "m-2", sequence: 2, name: "Beta" });
    const m3 = makeMilestone({ id: "m-3", sequence: 3, name: "Gamma" });
    const initiative = makeInitiative([m1, m2, m3]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([initiative]),
    });

    // After deleting m-2, siblings are m1(seq=1) and m3 renumbered to seq=2
    const siblings = [
      { ...m1, sequence: 1 },
      { ...m3, sequence: 2 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "deleted", milestones: siblings }),
    });

    const user = userEvent.setup();
    render(<OrgInitiatives githubLogin="test-org" />);

    await waitFor(() => screen.getByText("Test Initiative"));
    await user.click(screen.getByText("Test Initiative"));

    // Click delete for second milestone (Beta)
    const deleteButtons = screen.getAllByTestId("trash2");
    await user.click(deleteButtons[1]); // Beta

    // Confirm in alert dialog
    const confirmBtn = screen.getByRole("button", { name: /^delete$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      // DELETE was called with ?renumber=true
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("?renumber=true"),
        expect.objectContaining({ method: "DELETE" })
      );
    });

    // Beta should be gone; Gamma should now show sequence 2
    await waitFor(() => {
      expect(screen.queryByText("Beta")).toBeNull();
    });
  });
});
